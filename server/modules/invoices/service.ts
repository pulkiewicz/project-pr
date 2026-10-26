import { asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { INFAKT_COST_KINDS, INVOICE_MANUAL_FIELDS, shareAmount, type InvoiceDto, type InvoiceManualField, type InvoiceEventDto, type InvoiceSettings, type InvoiceSyncResult } from '#shared'
import type { Database } from '../../db/client.ts'
import { appSettings, costInvoiceAllocations, costInvoiceEvents, costInvoices, projects, users } from '../../db/schema.ts'
import type { InfaktClient, InfaktCost } from '../../integrations/infakt/types.ts'

export const LAST_SYNC_KEY = 'invoices.lastSync'

const status = (c: InfaktCost, group: string) => c.statuses?.find((s) => s.group === group)?.symbol ?? null

/** Pola kopiowane z inFakt (nadpisywane przy każdej synchronizacji). */
export function mapCost(c: InfaktCost) {
  return {
    infaktUuid: c.uuid,
    kind: c.kind,
    number: c.number ?? null,
    sellerName: c.seller_name ?? null,
    description: c.description ?? null,
    category: c.category ?? null,
    issueDate: c.issue_date ?? null,
    dueDate: c.due_date ?? null,
    currency: c.currency || 'PLN',
    netPrice: c.net_price ?? null,
    grossPrice: c.gross_price ?? null,
    taxPrice: c.tax_price ?? null,
    paymentStatus: status(c, 'payment'),
    accountingStatus: status(c, 'cost_accounting'),
    infaktCreatedAt: c.created_at ?? null,
  }
}
type Mapped = ReturnType<typeof mapCost>
const COMPARED = ['kind', 'number', 'sellerName', 'description', 'category', 'issueDate', 'dueDate', 'currency', 'netPrice', 'grossPrice', 'taxPrice', 'paymentStatus', 'accountingStatus'] as const
/** Zmiana tych pól cofa zaakceptowaną / wysłaną fakturę do ponownego przypisania. */
const MATERIAL = ['netPrice', 'grossPrice', 'currency'] as const

type InvoiceRow = typeof costInvoices.$inferSelect

/** Wartości efektywne: dane uzupełnione ręcznie mają pierwszeństwo przed danymi z inFakt. */
export function effective(row: InvoiceRow) {
  const m = row.manual ?? {}
  const out = { ...row }
  for (const k of INVOICE_MANUAL_FIELDS) if (m[k] !== undefined) (out as Record<string, unknown>)[k] = m[k]
  return out
}

/**
 * Pobiera dokumenty kosztowe z inFakt (dodane od `settings.syncFrom`) i zapisuje nowe / zmienione.
 * Zmiana kwoty lub waluty w fakturze wysłanej lub zaakceptowanej cofa ją do „do przypisania” (udziały % zostają) —
 * chyba że to pole jest uzupełnione ręcznie (wtedy obowiązuje wartość ręczna).
 */
export async function syncInvoices(db: Database, client: InfaktClient, settings: InvoiceSettings, userId: string | null, now: Date): Promise<InvoiceSyncResult> {
  const all = await client.listCosts(settings.syncFrom)
  const costs = all.filter((c) => (INFAKT_COST_KINDS as readonly string[]).includes(c.kind) && c.uuid)
  const result: InvoiceSyncResult = { fetched: all.length, created: 0, updated: 0, skipped: all.length - costs.length, syncedAt: now.toISOString() }

  await db.transaction(async (tx) => {
    const existing = new Map<string, typeof costInvoices.$inferSelect>()
    for (let i = 0; i < costs.length; i += 500) {
      const chunk = costs.slice(i, i + 500).map((c) => c.uuid)
      for (const r of await tx.select().from(costInvoices).where(inArray(costInvoices.infaktUuid, chunk))) existing.set(r.infaktUuid, r)
    }
    const fresh: Mapped[] = []
    for (const c of costs) {
      const m = mapCost(c)
      const cur = existing.get(c.uuid)
      if (!cur) {
        fresh.push(m)
        continue
      }
      const changed = COMPARED.filter((k) => cur[k] !== m[k])
      if (!changed.length) continue
      const material = MATERIAL.some((k) => changed.includes(k) && cur.manual?.[k] === undefined)
      const revert = material && (cur.status === 'pending' || cur.status === 'approved')
      await tx
        .update(costInvoices)
        .set({ ...m, syncedAt: sql`now()`, updatedAt: sql`now()`, version: sql`${costInvoices.version} + 1`, ...(revert ? { status: 'new' as const, decidedBy: null, decidedAt: null } : {}) })
        .where(eq(costInvoices.id, cur.id))
      if (material) {
        await tx.insert(costInvoiceEvents).values({
          invoiceId: cur.id,
          kind: 'changed_in_infakt',
          userId,
          meta: Object.fromEntries(changed.map((k) => [k, { old: cur[k], new: m[k] }])),
        })
      }
      result.updated += 1
    }
    for (let i = 0; i < fresh.length; i += 200) {
      const rows = await tx.insert(costInvoices).values(fresh.slice(i, i + 200)).returning({ id: costInvoices.id })
      await tx.insert(costInvoiceEvents).values(rows.map((r) => ({ invoiceId: r.id, kind: 'imported' as const, userId })))
      result.created += rows.length
    }
    const value = { at: result.syncedAt, by: userId, result }
    await tx.insert(appSettings).values({ key: LAST_SYNC_KEY, value, updatedBy: userId }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: userId } })
  })
  return result
}

export async function lastSync(db: Database) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LAST_SYNC_KEY))
  if (!row) return null
  const v = row.value as { at: string; by: string | null; result: InvoiceSyncResult | null }
  const [u] = v.by ? await db.select({ name: users.name }).from(users).where(eq(users.id, v.by)) : []
  return { at: v.at, by: u?.name ?? null, result: v.result }
}

const submitter = alias(users, 'submitter')
const decider = alias(users, 'decider')

export async function listInvoices(db: Database, where?: SQL): Promise<InvoiceDto[]> {
  const rows = await db
    .select({ inv: costInvoices, submittedByName: submitter.name, decidedByName: decider.name })
    .from(costInvoices)
    .leftJoin(submitter, eq(submitter.id, costInvoices.submittedBy))
    .leftJoin(decider, eq(decider.id, costInvoices.decidedBy))
    .where(where)
    // Pliki bez daty wystawienia — według daty dodania do inFakt.
    .orderBy(sql`coalesce(${costInvoices.manual}->>'issueDate', ${costInvoices.issueDate}::text, (${costInvoices.infaktCreatedAt} AT TIME ZONE 'Europe/Warsaw')::date::text) DESC NULLS LAST`, desc(costInvoices.createdAt))
  if (!rows.length) return []
  const allocs = await db
    .select({ invoiceId: costInvoiceAllocations.invoiceId, projectId: costInvoiceAllocations.projectId, share: costInvoiceAllocations.share, code: projects.code, name: projects.name })
    .from(costInvoiceAllocations)
    .innerJoin(projects, eq(projects.id, costInvoiceAllocations.projectId))
    .where(where ? inArray(costInvoiceAllocations.invoiceId, rows.map((r) => r.inv.id)) : undefined)
    .orderBy(asc(projects.code))
  const byInvoice = new Map<string, typeof allocs>()
  for (const a of allocs) byInvoice.set(a.invoiceId, [...(byInvoice.get(a.invoiceId) ?? []), a])

  return rows.map(({ inv: raw, submittedByName, decidedByName }) => {
    const inv = effective(raw)
    const list = byInvoice.get(inv.id) ?? []
    return {
      id: inv.id,
      infaktUuid: inv.infaktUuid,
      kind: inv.kind,
      number: inv.number,
      sellerName: inv.sellerName,
      description: inv.description,
      category: inv.category,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      netPrice: inv.netPrice,
      grossPrice: inv.grossPrice,
      taxPrice: inv.taxPrice,
      paymentStatus: inv.paymentStatus,
      accountingStatus: inv.accountingStatus,
      infaktCreatedAt: inv.infaktCreatedAt,
      manualFields: INVOICE_MANUAL_FIELDS.filter((k): k is InvoiceManualField => raw.manual?.[k] !== undefined),
      status: inv.status,
      note: inv.note,
      allocations: list.map((a) => ({
        projectId: a.projectId,
        projectCode: a.code,
        projectName: a.name,
        share: a.share,
        netAmount: inv.netPrice == null ? null : shareAmount(inv.netPrice, a.share),
      })),
      allocatedShare: Math.round(list.reduce((s, a) => s + a.share * 100, 0)) / 100,
      submittedBy: inv.submittedBy,
      submittedByName,
      submittedAt: inv.submittedAt,
      decidedByName,
      decidedAt: inv.decidedAt,
      version: inv.version,
    }
  })
}

export async function getInvoice(db: Database, id: string) {
  const [dto] = await listInvoices(db, eq(costInvoices.id, id))
  return dto ?? null
}

export async function listEvents(db: Database, invoiceId: string): Promise<InvoiceEventDto[]> {
  const rows = await db
    .select({ e: costInvoiceEvents, userName: users.name })
    .from(costInvoiceEvents)
    .leftJoin(users, eq(users.id, costInvoiceEvents.userId))
    .where(eq(costInvoiceEvents.invoiceId, invoiceId))
    .orderBy(desc(costInvoiceEvents.createdAt))
  return rows.map(({ e, userName }) => ({ id: e.id, kind: e.kind, comment: e.comment, meta: e.meta, userName, createdAt: e.createdAt }))
}
