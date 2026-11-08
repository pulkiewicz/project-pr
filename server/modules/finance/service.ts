import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import {
  INFAKT_SALES_SKIPPED_KINDS,
  invoiceCostDate,
  staffCost,
  type FinanceCostCell,
  type FinanceCostInvoice,
  type FinanceMonthSummary,
  type FinancePlanResponse,
  type FinanceStaffRow,
  type InvoiceDto,
  type SalesInvoiceDto,
  type SalesSyncResult,
} from '#shared'
import type { Database } from '../../db/client.ts'
import { appSettings, costCategories, employees, projects, salesInvoices } from '../../db/schema.ts'
import { InfaktError, type InfaktClient, type InfaktSalesInvoice } from '../../integrations/infakt/types.ts'
import { addDays, workingDaysBetween } from '../../lib/dates.ts'
import { listInvoices } from '../invoices/service.ts'

export const SALES_LAST_SYNC_KEY = 'finance.salesLastSync'

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)
const day = (v: unknown) => {
  const s = text(v)?.slice(0, 10)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null
}
const cents = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Pola faktury sprzedażowej kopiowane z inFakt; nabywca — firma albo imię i nazwisko osoby fizycznej. */
export function mapSale(s: InfaktSalesInvoice) {
  const person = [text(s.client_first_name), text(s.client_last_name)].filter(Boolean).join(' ')
  const cur = text(s.currency)?.toUpperCase()
  return {
    infaktUuid: s.uuid,
    kind: text(s.kind) ?? 'vat',
    number: text(s.number),
    clientName: text(s.client_company_name) ?? (person || null),
    invoiceDate: day(s.invoice_date),
    saleDate: day(s.sale_date),
    paymentDate: day(s.payment_date),
    currency: cur && /^[A-Z]{3}$/.test(cur) ? cur : 'PLN',
    netPrice: cents(s.net_price),
    grossPrice: cents(s.gross_price),
    taxPrice: cents(s.tax_price),
    paidPrice: cents(s.paid_price),
    status: text(s.status),
  }
}

/** Pobiera faktury sprzedażowe wystawione od `issuedFrom` i zapisuje nowe / zmienione (kopia bez edycji w aplikacji). */
export async function syncSalesInvoices(db: Database, client: InfaktClient, issuedFrom: string, userId: string | null, now: Date): Promise<SalesSyncResult> {
  const all = (await client.listSalesInvoices(issuedFrom)).filter((s) => s.uuid)
  const result: SalesSyncResult = { fetched: all.length, created: 0, updated: 0, syncedAt: now.toISOString() }
  await db.transaction(async (tx) => {
    const existing = new Map((await tx.select().from(salesInvoices).where(gte(salesInvoices.invoiceDate, issuedFrom))).map((r) => [r.infaktUuid, r]))
    for (const s of all) {
      const m = mapSale(s)
      const cur = existing.get(s.uuid)
      if (cur && (Object.keys(m) as (keyof typeof m)[]).every((k) => cur[k] === m[k])) continue
      await tx
        .insert(salesInvoices)
        .values(m)
        .onConflictDoUpdate({ target: salesInvoices.infaktUuid, set: { ...m, syncedAt: sql`now()` } })
      if (cur) result.updated += 1
      else result.created += 1
    }
    const value = { at: result.syncedAt, by: userId, result }
    await tx.insert(appSettings).values({ key: SALES_LAST_SYNC_KEY, value, updatedBy: userId }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: userId } })
  })
  return result
}

async function salesLastSync(db: Database): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SALES_LAST_SYNC_KEY))
  return (row?.value as { at?: string } | undefined)?.at ?? null
}

/** Miesiąc przychodu: data wystawienia (bez niej — data sprzedaży). */
const saleMonth = (s: { invoiceDate: string | null; saleDate: string | null }) => (s.invoiceDate ?? s.saleDate ?? '').slice(0, 7)
const costMonth = (i: InvoiceDto) => (invoiceCostDate(i) ?? '').slice(0, 7)
const isRevenue = (s: { kind: string }) => !(INFAKT_SALES_SKIPPED_KINDS as readonly string[]).includes(s.kind)

/** Dni robocze w przedziale włącznie. */
const workingDays = (from: string, to: string) => workingDaysBetween(addDays(from, -1), to)

/** Koszt części faktury bez projektu: świadomie ogólne / reszta podziału % → ogólne, bez decyzji → nieprzypisane. */
function costCells(i: InvoiceDto): FinanceCostCell[] {
  const cells: FinanceCostCell[] = i.allocations.map((a) => ({ kind: 'project', projectId: a.projectId, categoryId: i.costCategoryId, net: a.netAmount ?? 0 }))
  const rest = i.netPrice! - i.allocations.reduce((s, a) => s + (a.netAmount ?? 0), 0)
  if (rest !== 0) cells.push({ kind: i.allocations.length || i.general ? 'general' : 'unassigned', projectId: null, categoryId: i.costCategoryId, net: rest })
  return cells
}

function allocationLabel(i: InvoiceDto, generalLabel: string, unassignedLabel: string) {
  const parts = i.allocations.map((a) => `${a.projectCode} ${a.share.toLocaleString('pl-PL')}%`)
  const rest = Math.round((100 - i.allocatedShare) * 100) / 100
  if (!i.allocations.length) parts.push(i.general ? generalLabel : unassignedLabel)
  else if (rest > 0) parts.push(`${generalLabel} ${rest.toLocaleString('pl-PL')}%`)
  return parts.join(', ')
}

const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)

/**
 * Plan finansowy miesiąca `month` (yyyy-MM) i podsumowanie 12 miesięcy jego roku.
 * Sumy tylko PLN. Koszty z faktur — wszystkie statusy (także przed akceptacją), netto.
 * Koszty pracownicze z listy Pracowników (B2B pominięty — jest w fakturach kosztowych).
 */
export async function financePlan(db: Database, month: string, opts: { staffRows: boolean; configured: boolean }): Promise<FinancePlanResponse> {
  const year = month.slice(0, 4)
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

  const sales = (
    await db
      .select()
      .from(salesInvoices)
      .where(and(gte(sql`coalesce(${salesInvoices.invoiceDate}, ${salesInvoices.saleDate})`, `${year}-01-01`), lte(sql`coalesce(${salesInvoices.invoiceDate}, ${salesInvoices.saleDate})`, `${year}-12-31`)))
      .orderBy(asc(salesInvoices.invoiceDate), asc(salesInvoices.number))
  ).filter(isRevenue)
  const costs = (await listInvoices(db)).filter((i) => costMonth(i).startsWith(year))
  const staffInput = await db.select().from(employees).where(isNull(employees.deletedAt)).orderBy(asc(employees.lastName), asc(employees.firstName))

  const staffFor = (m: string) => staffInput.map((e) => staffCost(e, m, workingDays)).filter((r): r is FinanceStaffRow => !!r)
  const countedStaff = (rows: FinanceStaffRow[]) => rows.filter((r) => !r.invoiced)
  const plnSales = (m: string) => sales.filter((s) => saleMonth(s) === m && s.currency === 'PLN')
  const plnCosts = (m: string) => costs.filter((i) => costMonth(i) === m && i.currency === 'PLN' && i.netPrice != null)

  const summary: FinanceMonthSummary[] = months.map((m) => {
    const revenue = sumBy(plnSales(m), (s) => s.netPrice ?? 0)
    const invoiceCosts = sumBy(plnCosts(m), (i) => i.netPrice!)
    const staffCosts = sumBy(countedStaff(staffFor(m)), (r) => r.total)
    return { month: m, revenue, invoiceCosts, staffCosts, result: revenue - invoiceCosts - staffCosts }
  })
  const cur = summary.find((s) => s.month === month)!

  // Przychody miesiąca.
  const monthSales = sales.filter((s) => saleMonth(s) === month)
  const salesDtos: SalesInvoiceDto[] = monthSales.map((s) => ({
    id: s.id,
    number: s.number,
    kind: s.kind,
    clientName: s.clientName,
    invoiceDate: s.invoiceDate,
    saleDate: s.saleDate,
    paymentDate: s.paymentDate,
    currency: s.currency,
    netPrice: s.netPrice,
    grossPrice: s.grossPrice,
    status: s.status,
    paidPrice: s.paidPrice,
  }))

  // Koszty miesiąca: komórki projekt × kategoria (zsumowane).
  const monthCosts = costs.filter((i) => costMonth(i) === month)
  const cellMap = new Map<string, FinanceCostCell>()
  for (const i of plnCosts(month)) {
    for (const c of costCells(i)) {
      const key = `${c.kind}|${c.projectId ?? ''}|${c.categoryId ?? ''}`
      const prev = cellMap.get(key)
      if (prev) prev.net += c.net
      else cellMap.set(key, { ...c })
    }
  }
  const cells = [...cellMap.values()].filter((c) => c.net !== 0)
  const projectIds = new Set(cells.map((c) => c.projectId).filter((p): p is string => !!p))
  const projectRows = projectIds.size ? (await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects)).filter((p) => projectIds.has(p.id)).sort((a, b) => a.code.localeCompare(b.code, 'pl')) : []
  const categoryIds = new Set(cells.map((c) => c.categoryId).filter((c): c is string => !!c))
  const categoryRows = categoryIds.size
    ? (await db.select({ id: costCategories.id, name: costCategories.name, staff: costCategories.staff }).from(costCategories)).filter((k) => categoryIds.has(k.id)).sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    : []

  const costInvoices: FinanceCostInvoice[] = monthCosts.map((i) => ({
    id: i.id,
    number: i.number,
    sellerName: i.sellerName,
    date: invoiceCostDate(i),
    status: i.status,
    currency: i.currency,
    netPrice: i.netPrice,
    categoryName: i.costCategoryName,
    allocation: allocationLabel(i, 'Ogólne', 'Nieprzypisana'),
  }))

  const staffRows = staffFor(month)
  const counted = countedStaff(staffRows)

  return {
    month,
    year: summary,
    revenue: {
      net: cur.revenue,
      gross: sumBy(plnSales(month), (s) => s.grossPrice ?? 0),
      invoices: salesDtos,
      foreign: monthSales.filter((s) => s.currency !== 'PLN').length,
    },
    costs: {
      net: cur.invoiceCosts,
      cells,
      projects: projectRows,
      categories: categoryRows,
      invoices: costInvoices,
      missingAmount: monthCosts.filter((i) => i.netPrice == null).length,
      foreign: monthCosts.filter((i) => i.currency !== 'PLN').length,
    },
    staff: {
      total: cur.staffCosts,
      pay: sumBy(counted, (r) => r.pay),
      employer: sumBy(counted, (r) => r.employerCost),
      rows: opts.staffRows ? staffRows : null,
      count: counted.length,
    },
    result: cur.result,
    sales: { lastSync: await salesLastSync(db), configured: opts.configured },
  }
}

/**
 * Faktury sprzedażowe przy synchronizacji kosztów: błąd (np. klucz API bez `api:invoices:read`) nie przerywa
 * synchronizacji kosztów — wraca jako `salesError`.
 */
export async function syncSalesSafe(db: Database, client: InfaktClient, issuedFrom: string, userId: string | null, now: Date): Promise<{ sales: SalesSyncResult | null; salesError: string | null }> {
  try {
    return { sales: await syncSalesInvoices(db, client, issuedFrom, userId, now), salesError: null }
  } catch (e) {
    if (!(e instanceof InfaktError)) throw e
    console.warn(`[pmo] infakt sales sync: ${e.message.slice(0, 200)}`)
    return { sales: null, salesError: e.status === 401 || e.status === 403 ? 'infakt_unauthorized' : 'infakt_failed' }
  }
}
