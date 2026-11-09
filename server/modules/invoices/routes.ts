import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import {
  INVOICE_EDITABLE,
  INVOICE_MANUAL_FIELDS,
  invoiceDetailsInput,
  type InvoiceManual,
  STAFF_ROLES,
  invoiceAllocationInput,
  invoiceBulkAllocationInput,
  invoiceBulkApproveInput,
  invoiceBulkCategoryInput,
  invoiceBulkSubmitInput,
  invoiceCostDate,
  invoiceExportQuery,
  invoiceCategoryInput,
  costCategoryInput,
  costCategoryPatch,
  type CostCategoryDto,
  type InvoiceBulkResult,
  invoiceRejectInput,
  invoiceSettingsInput,
  invoiceSubmitInput,
  invoiceTransitionInput,
  type Action,
  type InvoiceDetailDto,
  type InvoiceListResponse,
  type InvoiceStatus,
  type InvoiceUserOption,
} from '#shared'
import { INVOICES_SETTING_KEY, invoiceSettings } from '../../auth/access.ts'
import type { AppEnv } from '../../context.ts'
import { appSettings, bankTransactions, costCategories, costInvoiceAllocations, costInvoiceEvents, costInvoices, projects, users } from '../../db/schema.ts'
import { InfaktError } from '../../integrations/infakt/types.ts'
import { syncSalesSafe } from '../finance/service.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { invoicePayments } from '../bank/reconcile.ts'
import { awaitsDecisionOf, eligibleApprovers, notifySubmitted } from './notify.ts'
import { effective, getInvoice, lastSync, listEvents, listInvoices, syncInvoices } from './service.ts'

export const invoicesRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'invoices', action } })
const now = (c: Context<AppEnv>) => c.get('deps').now?.() ?? new Date()

/** E-mail do akceptujących po wysłaniu do akceptacji (gdy włączony w Ustawieniach i skonfigurowana poczta). */
async function notifyApprovers(c: Context<AppEnv>, invoiceIds: string[]) {
  const deps = c.get('deps')
  const user = c.get('user')
  await notifySubmitted(deps.db, deps.mailer, { invoiceIds, submitter: { id: user.id, name: user.name }, baseUrl: deps.config.appUrl ?? new URL(c.req.url).origin })
}

/** Wskazany akceptujący: osoba z listy akceptujących, inna niż wysyłająca (zasada czterech oczu). Zwraca jego dane. */
async function checkApprover(c: Context<AppEnv>, approverId: string) {
  if (approverId === c.get('user').id) throw forbidden('invoice_self_approval')
  const found = (await eligibleApprovers(c.get('deps').db)).find((a) => a.id === approverId)
  if (!found) throw new HttpProblem(422, 'invoice_approver_invalid')
  return found
}

async function detail(c: Context<AppEnv>, id: string): Promise<InvoiceDetailDto> {
  const db = c.get('deps').db
  const dto = await getInvoice(db, id)
  if (!dto) throw notFound()
  return { ...dto, events: await listEvents(db, id), payments: await invoicePayments(db, id) }
}

/**
 * Zmiana statusu z kontrolą wersji: `from` — dozwolone statusy wyjściowe. Zwraca bieżący rekord (do dalszych warunków).
 * Zapis zdarzenia i audytu w tej samej transakcji.
 */
async function transition(
  c: Context<AppEnv>,
  id: string,
  version: number,
  from: readonly InvoiceStatus[],
  to: InvoiceStatus,
  event: { kind: 'submitted' | 'approved' | 'rejected' | 'reopened'; comment?: string | null; meta?: Record<string, unknown> },
  check?: (cur: typeof costInvoices.$inferSelect) => void,
  /** Przy wysłaniu do akceptacji: wskazany akceptujący. */
  approverId: string | null = null,
) {
  const deps = c.get('deps')
  const user = c.get('user')
  const [cur] = await deps.db.select().from(costInvoices).where(eq(costInvoices.id, id))
  if (!cur) throw notFound()
  if (!from.includes(cur.status)) throw new HttpProblem(409, 'invoice_wrong_status', cur.status)
  check?.(cur)
  const decision = to === 'approved' || to === 'rejected'
  const updated = await deps.db.transaction(async (tx) => {
    const [r] = await tx
      .update(costInvoices)
      .set({
        status: to,
        ...(to === 'pending' ? { submittedBy: user.id, submittedAt: sql`now()`, approverId, decidedBy: null, decidedAt: null } : {}),
        ...(decision ? { decidedBy: user.id, decidedAt: sql`now()` } : {}),
        ...(to === 'new' ? { approverId: null, decidedBy: null, decidedAt: null } : {}),
        version: sql`${costInvoices.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: user.id,
      })
      .where(and(eq(costInvoices.id, id), eq(costInvoices.version, version)))
      .returning({ id: costInvoices.id })
    if (r) {
      await tx.insert(costInvoiceEvents).values({ invoiceId: id, kind: event.kind, comment: event.comment ?? null, userId: user.id, meta: event.meta ?? null })
      await writeAudit(c, { action: `invoices.${event.kind}`, entity: 'cost_invoices', entityId: id, changes: { status: { old: cur.status, new: to }, comment: event.comment ?? undefined } }, tx)
    }
    return r
  })
  if (!updated) throw conflict(await getInvoice(deps.db, id))
  return c.json(await detail(c, id), 200)
}

// ---------------- Lista, szczegóły, synchronizacja ----------------

invoicesRouter.openapi(route({ method: 'get', path: '/invoices', responses: ok }, 'view'), async (c) => {
  const db = c.get('deps').db
  const res: InvoiceListResponse = { items: await listInvoices(db), lastSync: await lastSync(db), configured: !!c.get('deps').infakt }
  return c.json(res, 200)
})

invoicesRouter.openapi(route({ method: 'post', path: '/invoices/sync', responses: ok }, 'create'), async (c) => {
  const deps = c.get('deps')
  if (!deps.infakt) throw new HttpProblem(503, 'infakt_not_configured')
  try {
    const settings = await invoiceSettings(deps.db)
    const result = await syncInvoices(deps.db, deps.infakt, settings, c.get('user').id, now(c))
    // Faktury sprzedażowe do Planu finansowego — błąd nie przerywa synchronizacji kosztów.
    Object.assign(result, await syncSalesSafe(deps.db, deps.infakt, settings.syncFrom, c.get('user').id, now(c)))
    await writeAudit(c, { action: 'invoices.sync', entity: 'cost_invoices', changes: result })
    return c.json(result, 200)
  } catch (e) {
    if (e instanceof InfaktError) throw new HttpProblem(502, e.status === 401 || e.status === 403 ? 'infakt_unauthorized' : 'infakt_failed', e.message.slice(0, 300))
    throw e
  }
})

// Słownik kategorii (przed `/invoices/{id}`, żeby „categories” nie trafiło do trasy z ID).
invoicesRouter.openapi(route({ method: 'get', path: '/invoices/categories', responses: ok }, 'view'), async (c) => c.json(await listCategories(c), 200))

// ---------------- Eksport ----------------

invoicesRouter.openapi(
  route(
    { method: 'get', path: '/invoices/export.xlsx', request: { query: invoiceExportQuery }, responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } } },
    'export',
  ),
  async (c) => {
    const { from, to } = c.req.valid('query')
    // Okres po dacie kosztu (wystawienie / dodanie do inFakt); bez granic — wszystkie faktury.
    const items = (await listInvoices(c.get('deps').db)).filter((i) => {
      const d = invoiceCostDate(i)
      return (!from || (!!d && d >= from)) && (!to || (!!d && d <= to))
    })
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Faktury → projekty', { views: [{ state: 'frozen', ySplit: 1 }] })
    const STATUS: Record<InvoiceStatus, string> = { new: 'do przypisania', pending: 'do akceptacji', approved: 'zaakceptowana', rejected: 'odrzucona' }
    const money = '#,##0.00'
    ws.columns = [
      { header: 'Numer', key: 'number', width: 22 },
      { header: 'Sprzedawca', key: 'seller', width: 30 },
      { header: 'Data wystawienia', key: 'issueDate', width: 14, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Dodano do inFakt', key: 'addedAt', width: 14, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Waluta', key: 'currency', width: 8 },
      { header: 'Netto faktury', key: 'net', width: 14, style: { numFmt: money } },
      { header: 'Brutto faktury', key: 'gross', width: 14, style: { numFmt: money } },
      { header: 'Kategoria', key: 'category', width: 20 },
      { header: 'Projekt', key: 'project', width: 14 },
      { header: 'Udział %', key: 'share', width: 10 },
      { header: 'Netto udziału', key: 'shareNet', width: 14, style: { numFmt: money } },
      { header: 'Opis', key: 'description', width: 36 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Zaakceptował', key: 'decidedBy', width: 18 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }
    const pln = (v: number | null) => (v == null ? null : v / 100)
    for (const i of items) {
      const base = {
        number: i.number ?? i.description ?? '',
        seller: i.sellerName ?? '',
        issueDate: i.issueDate ? new Date(`${i.issueDate}T00:00:00Z`) : null,
        addedAt: i.infaktCreatedAt ? new Date(`${i.infaktCreatedAt.slice(0, 10)}T00:00:00Z`) : null,
        currency: i.currency,
        net: pln(i.netPrice),
        gross: pln(i.grossPrice),
        status: i.status === 'new' && (i.allocations.length || i.general) ? 'przypisana — do wysłania' : STATUS[i.status],
        category: i.costCategoryName ?? '',
        decidedBy: i.status === 'approved' ? (i.decidedByName ?? '') : '',
      }
      for (const a of i.allocations) ws.addRow({ ...base, project: a.projectCode, share: a.share, shareNet: pln(a.netAmount), description: a.description ?? '' })
      const rest = Math.round((100 - i.allocatedShare) * 100) / 100
      if (rest > 0 && (i.allocations.length || i.general)) {
        const restNet = i.netPrice == null ? null : i.netPrice - i.allocations.reduce((s, a) => s + (a.netAmount ?? 0), 0)
        ws.addRow({ ...base, project: 'Ogólne', share: rest, shareNet: pln(restNet) })
      }
      // Nieprzypisana (jeszcze nie zdecydowano: projekt czy koszty ogólne).
      if (!i.allocations.length && !i.general) ws.addRow({ ...base, project: '—', description: 'do przypisania' })
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 14 } }
    await writeAudit(c, { action: 'invoices.export_xlsx', entity: 'cost_invoices', changes: { invoices: items.length, from, to } })
    const suffix = from || to ? `-${from ?? 'start'}_${to ?? 'dzis'}` : ''
    return c.body((await wb.xlsx.writeBuffer()) as ArrayBuffer, 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="faktury-projekty${suffix}.xlsx"`,
    })
  },
)

/**
 * Licznik do menu: faktury czekające na moją decyzję — wskazane mnie, a wysłane bez wskazania akceptującego
 * (sprzed wyboru akceptującego) — wysłane przez kogoś innego. Bez uprawnienia `approve` — 0.
 */
invoicesRouter.openapi(route({ method: 'get', path: '/invoices/awaiting-approval', responses: ok }, 'view'), async (c) => {
  if (!c.get('permissions').has('invoices:approve')) return c.json({ count: 0 }, 200)
  const me = c.get('user').id
  const [r] = await c
    .get('deps')
    .db.select({ n: count() })
    .from(costInvoices)
    .where(
      and(
        eq(costInvoices.status, 'pending'),
        sql`(${costInvoices.approverId} = ${me} OR (${costInvoices.approverId} IS NULL AND ${costInvoices.submittedBy} IS DISTINCT FROM ${me}))`,
      ),
    )
  return c.json({ count: r?.n ?? 0 }, 200)
})

/** Osoby do wyboru przy wysłaniu do akceptacji (bez mnie — zasada czterech oczu). */
invoicesRouter.openapi(route({ method: 'get', path: '/invoices/approvers', responses: ok }, 'edit'), async (c) => {
  const me = c.get('user').id
  const list: InvoiceUserOption[] = (await eligibleApprovers(c.get('deps').db)).filter((a) => a.id !== me).map((a) => ({ id: a.id, name: a.name }))
  return c.json(list, 200)
})

invoicesRouter.openapi(route({ method: 'get', path: '/invoices/{id}', request: { params: idParam }, responses: ok }, 'view'), async (c) =>
  c.json(await detail(c, c.req.valid('param').id), 200),
)

/** Załączniki (PDF) z inFakt — linki do aplikacji inFakt (wymagają zalogowania w inFakt). */
invoicesRouter.openapi(route({ method: 'get', path: '/invoices/{id}/attachments', request: { params: idParam }, responses: ok }, 'view'), async (c) => {
  const deps = c.get('deps')
  if (!deps.infakt) throw new HttpProblem(503, 'infakt_not_configured')
  const [inv] = await deps.db.select({ uuid: costInvoices.infaktUuid }).from(costInvoices).where(eq(costInvoices.id, c.req.valid('param').id))
  if (!inv) throw notFound()
  try {
    const list = await deps.infakt.costAttachments(inv.uuid)
    return c.json(list.map((a) => ({ fileName: a.file_name, url: a.file_url })), 200)
  } catch (e) {
    if (e instanceof InfaktError) throw new HttpProblem(502, 'infakt_failed', e.message.slice(0, 300))
    throw e
  }
})

const PREVIEW_MAX_BYTES = 15 * 1024 * 1024
const PREVIEW_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']
const attachmentParam = z.object({ id: z.uuid(), index: z.coerce.number().int().min(0).max(50) })

/**
 * Podgląd pliku faktury w aplikacji (bez zapisywania na dysku): serwer pobiera plik z inFakt i zwraca go `inline`.
 * Klucz API inFakt trafia tylko do hostów inFakt; zwracane są wyłącznie PDF i obrazy (inna odpowiedź, np. strona logowania — 502).
 */
invoicesRouter.openapi(
  route({ method: 'get', path: '/invoices/{id}/attachments/{index}/file', request: { params: attachmentParam }, responses: { 200: { description: 'Plik', content: { 'application/pdf': { schema: z.any() } } } } }, 'view'),
  async (c) => {
    const deps = c.get('deps')
    if (!deps.infakt) throw new HttpProblem(503, 'infakt_not_configured')
    const { id, index } = c.req.valid('param')
    const [inv] = await deps.db.select({ uuid: costInvoices.infaktUuid }).from(costInvoices).where(eq(costInvoices.id, id))
    if (!inv) throw notFound()
    let file: { body: ArrayBuffer; type: string; name: string }
    try {
      const list = await deps.infakt.costAttachments(inv.uuid)
      const a = list[index]
      if (!a) throw notFound()
      const res = await deps.infakt.downloadAttachment(a.file_url)
      const type = (res.type.split(';')[0] ?? '').trim().toLowerCase()
      if (!PREVIEW_TYPES.includes(type) || res.body.byteLength > PREVIEW_MAX_BYTES) throw new HttpProblem(502, 'invoice_preview_unavailable', type)
      file = { ...res, type, name: a.file_name }
    } catch (e) {
      if (e instanceof InfaktError) throw new HttpProblem(502, 'invoice_preview_unavailable', e.message.slice(0, 300))
      throw e
    }
    return c.body(file.body, 200, {
      'content-type': file.type,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    })
  },
)

// ---------------- Przypisanie do projektów ----------------

invoicesRouter.openapi(
  route({ method: 'put', path: '/invoices/{id}/allocation', request: { params: idParam, body: body(invoiceAllocationInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { allocations, note, general, version } = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    const [cur] = await deps.db.select().from(costInvoices).where(eq(costInvoices.id, id))
    if (!cur) throw notFound()
    if (!INVOICE_EDITABLE.includes(cur.status)) throw new HttpProblem(409, 'invoice_not_editable', cur.status)
    if (allocations.length) {
      const ids = allocations.map((a) => a.projectId)
      const found = await deps.db.select({ id: projects.id }).from(projects).where(and(inArray(projects.id, ids), isNull(projects.deletedAt)))
      if (found.length !== ids.length) throw new HttpProblem(422, 'project_not_found')
    }
    const updated = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(costInvoices)
        .set({
          ...(note !== undefined ? { note } : {}),
          general: !allocations.length && general === true,
          version: sql`${costInvoices.version} + 1`,
          updatedAt: sql`now()`,
          updatedBy: user.id,
        })
        .where(and(eq(costInvoices.id, id), eq(costInvoices.version, version)))
        .returning({ id: costInvoices.id })
      if (!r) return null
      await tx.delete(costInvoiceAllocations).where(eq(costInvoiceAllocations.invoiceId, id))
      if (allocations.length) await tx.insert(costInvoiceAllocations).values(allocations.map((a) => ({ invoiceId: id, projectId: a.projectId, share: a.share, description: a.description || null })))
      await tx.insert(costInvoiceEvents).values({ invoiceId: id, kind: 'allocated', userId: user.id, meta: { allocations, ...(!allocations.length && general ? { general: true } : {}) } })
      await writeAudit(c, { action: 'invoices.allocate', entity: 'cost_invoices', entityId: id, changes: { allocations, note, general } }, tx)
      return r
    })
    if (!updated) throw conflict(await getInvoice(deps.db, id))
    return c.json(await detail(c, id), 200)
  },
)

/** Uzupełnienie / poprawa danych, których inFakt nie odczytał z pliku (numer, sprzedawca, daty, kwoty). */
invoicesRouter.openapi(
  route({ method: 'patch', path: '/invoices/{id}/details', request: { params: idParam, body: body(invoiceDetailsInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { version, ...patch } = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    const [cur] = await deps.db.select().from(costInvoices).where(eq(costInvoices.id, id))
    if (!cur) throw notFound()
    if (!INVOICE_EDITABLE.includes(cur.status)) throw new HttpProblem(409, 'invoice_not_editable', cur.status)
    const manual: InvoiceManual = { ...cur.manual }
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    for (const k of INVOICE_MANUAL_FIELDS) {
      const v = patch[k]
      if (v === undefined) continue
      // Wartość równa danym z inFakt nie jest „ręczna” — synchronizacja dalej ją aktualizuje.
      const next = v === null || v === cur[k] ? undefined : v
      if (next === manual[k]) continue
      changes[k] = { old: effective(cur)[k], new: next ?? cur[k] }
      if (next === undefined) delete manual[k]
      else (manual as Record<string, unknown>)[k] = next
    }
    if (!Object.keys(changes).length) return c.json(await detail(c, id), 200)
    const updated = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(costInvoices)
        .set({ manual, version: sql`${costInvoices.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(costInvoices.id, id), eq(costInvoices.version, version)))
        .returning({ id: costInvoices.id })
      if (!r) return null
      await tx.insert(costInvoiceEvents).values({ invoiceId: id, kind: 'edited', userId: user.id, meta: changes })
      await writeAudit(c, { action: 'invoices.edit_details', entity: 'cost_invoices', entityId: id, changes }, tx)
      return r
    })
    if (!updated) throw conflict(await getInvoice(deps.db, id))
    return c.json(await detail(c, id), 200)
  },
)

/**
 * Zbiorcza zmiana przypisania (zaznaczone na liście): każda faktura → 100% na jeden projekt albo koszty ogólne.
 * Pomija faktury wysłane do akceptacji i zaakceptowane. Bez kontroli wersji (świadoma operacja zbiorcza),
 * każda zmiana ma wpis w historii faktury i jeden wpis w audit logu.
 */
invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/bulk-allocation', request: { body: body(invoiceBulkAllocationInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { ids, projectId, description } = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    if (projectId) {
      const [p] = await deps.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      if (!p) throw new HttpProblem(422, 'project_not_found')
    }
    const result = await deps.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: costInvoices.id, status: costInvoices.status })
        .from(costInvoices)
        .where(inArray(costInvoices.id, [...new Set(ids)]))
      const target = rows.filter((r) => INVOICE_EDITABLE.includes(r.status)).map((r) => r.id)
      if (target.length) {
        // Opis pominięty: zachowaj dotychczasowy opis, jeśli faktura miała już jeden projekt.
        const keep =
          description === undefined && projectId
            ? new Map(
                (await tx.select().from(costInvoiceAllocations).where(inArray(costInvoiceAllocations.invoiceId, target))).map((a) => [a.invoiceId, a.description] as const),
              )
            : new Map<string, string | null>()
        const allocations = projectId ? target.map((invoiceId) => ({ invoiceId, projectId, share: 100, description: description === undefined ? (keep.get(invoiceId) ?? null) : description || null })) : []
        await tx.delete(costInvoiceAllocations).where(inArray(costInvoiceAllocations.invoiceId, target))
        if (allocations.length) await tx.insert(costInvoiceAllocations).values(allocations)
        await tx
          .update(costInvoices)
          .set({ general: !projectId, version: sql`${costInvoices.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
          .where(inArray(costInvoices.id, target))
        await tx.insert(costInvoiceEvents).values(
          target.map((invoiceId) => ({ invoiceId, kind: 'allocated' as const, userId: user.id, meta: { bulk: true, allocations: projectId ? [{ projectId, share: 100, description: allocations.find((a) => a.invoiceId === invoiceId)?.description ?? null }] : [] } })),
        )
      }
      const res: InvoiceBulkResult = { updated: target.length, skipped: new Set(ids).size - target.length }
      await writeAudit(c, { action: 'invoices.bulk_allocate', entity: 'cost_invoices', changes: { ids: target, projectId, description, ...res } }, tx)
      return res
    })
    return c.json(result, 200)
  },
)

// ---------------- Kategoria kosztu ----------------

async function assertActiveCategory(c: Context<AppEnv>, id: string | null) {
  if (!id) return
  const [cat] = await c.get('deps').db.select().from(costCategories).where(eq(costCategories.id, id))
  if (!cat || !cat.active) throw new HttpProblem(422, 'cost_category_not_found')
}

invoicesRouter.openapi(
  route({ method: 'patch', path: '/invoices/{id}/category', request: { params: idParam, body: body(invoiceCategoryInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { costCategoryId, version } = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    const [cur] = await deps.db.select().from(costInvoices).where(eq(costInvoices.id, id))
    if (!cur) throw notFound()
    if (cur.costCategoryId === costCategoryId) return c.json(await detail(c, id), 200)
    await assertActiveCategory(c, costCategoryId)
    const updated = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(costInvoices)
        .set({ costCategoryId, version: sql`${costInvoices.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(costInvoices.id, id), version === undefined ? undefined : eq(costInvoices.version, version)))
        .returning({ id: costInvoices.id })
      if (!r) return null
      const meta = { costCategoryId: { old: cur.costCategoryId, new: costCategoryId } }
      await tx.insert(costInvoiceEvents).values({ invoiceId: id, kind: 'edited', userId: user.id, meta })
      await writeAudit(c, { action: 'invoices.category', entity: 'cost_invoices', entityId: id, changes: meta }, tx)
      return r
    })
    if (!updated) throw conflict(await getInvoice(deps.db, id))
    return c.json(await detail(c, id), 200)
  },
)

invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/bulk-category', request: { body: body(invoiceBulkCategoryInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { ids, costCategoryId } = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    await assertActiveCategory(c, costCategoryId)
    const result = await deps.db.transaction(async (tx) => {
      const rows = await tx.select({ id: costInvoices.id, old: costInvoices.costCategoryId }).from(costInvoices).where(inArray(costInvoices.id, [...new Set(ids)]))
      const target = rows.filter((r) => r.old !== costCategoryId)
      if (target.length) {
        await tx
          .update(costInvoices)
          .set({ costCategoryId, version: sql`${costInvoices.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
          .where(inArray(costInvoices.id, target.map((r) => r.id)))
        await tx.insert(costInvoiceEvents).values(target.map((r) => ({ invoiceId: r.id, kind: 'edited' as const, userId: user.id, meta: { bulk: true, costCategoryId: { old: r.old, new: costCategoryId } } })))
      }
      const res: InvoiceBulkResult = { updated: target.length, skipped: new Set(ids).size - target.length }
      await writeAudit(c, { action: 'invoices.bulk_category', entity: 'cost_invoices', changes: { ids: target.map((r) => r.id), costCategoryId, ...res } }, tx)
      return res
    })
    return c.json(result, 200)
  },
)

async function listCategories(c: Context<AppEnv>): Promise<CostCategoryDto[]> {
  const db = c.get('deps').db
  const used = new Map(
    (await db.select({ id: costInvoices.costCategoryId, n: count() }).from(costInvoices).groupBy(costInvoices.costCategoryId)).map((r) => [r.id, r.n] as const),
  )
  const usedTx = new Map(
    (await db.select({ id: bankTransactions.costCategoryId, n: count() }).from(bankTransactions).groupBy(bankTransactions.costCategoryId)).map((r) => [r.id, r.n] as const),
  )
  return (await db.select().from(costCategories).orderBy(asc(costCategories.name))).map((k) => ({
    id: k.id,
    name: k.name,
    active: k.active,
    invoiceCount: used.get(k.id) ?? 0,
    transactionCount: usedTx.get(k.id) ?? 0,
    staff: k.staff,
  }))
}


const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } }
  return err.code === '23505' || err.cause?.code === '23505'
}

const adminCategoryRoute = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'admin', action } })
const categoryParam = z.object({ id: z.uuid() })

invoicesRouter.openapi(adminCategoryRoute({ method: 'get', path: '/admin/settings/cost-categories', responses: ok }, 'view'), async (c) => c.json(await listCategories(c), 200))

invoicesRouter.openapi(
  adminCategoryRoute({ method: 'post', path: '/admin/settings/cost-categories', request: { body: body(costCategoryInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { name } = c.req.valid('json')
    try {
      const [row] = await c.get('deps').db.insert(costCategories).values({ name, updatedBy: c.get('user').id }).returning()
      await writeAudit(c, { action: 'settings.cost_category_create', entity: 'cost_categories', entityId: row!.id, changes: { name } })
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpProblem(409, 'cost_category_exists')
      throw e
    }
    return c.json(await listCategories(c), 200)
  },
)

invoicesRouter.openapi(
  adminCategoryRoute({ method: 'patch', path: '/admin/settings/cost-categories/{id}', request: { params: categoryParam, body: body(costCategoryPatch) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const patch = c.req.valid('json')
    const db = c.get('deps').db
    const [cur] = await db.select().from(costCategories).where(eq(costCategories.id, id))
    if (!cur) throw notFound()
    try {
      await db.update(costCategories).set({ ...patch, updatedAt: sql`now()`, updatedBy: c.get('user').id }).where(eq(costCategories.id, id))
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpProblem(409, 'cost_category_exists')
      throw e
    }
    await writeAudit(c, { action: 'settings.cost_category_update', entity: 'cost_categories', entityId: id, changes: { old: { name: cur.name, active: cur.active }, new: patch } })
    return c.json(await listCategories(c), 200)
  },
)

invoicesRouter.openapi(
  adminCategoryRoute({ method: 'delete', path: '/admin/settings/cost-categories/{id}', request: { params: categoryParam }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const db = c.get('deps').db
    const [cur] = await db.select().from(costCategories).where(eq(costCategories.id, id))
    if (!cur) throw notFound()
    // „Pracownicze” ma osobną kolumnę w kosztach per projekt i jest domyślna dla wynagrodzeń — tylko zmiana nazwy.
    if (cur.staff) throw new HttpProblem(409, 'cost_category_staff')
    const [{ n: invoices }] = (await db.select({ n: count() }).from(costInvoices).where(eq(costInvoices.costCategoryId, id))) as [{ n: number }]
    const [{ n: txs }] = (await db.select({ n: count() }).from(bankTransactions).where(eq(bankTransactions.costCategoryId, id))) as [{ n: number }]
    const n = invoices + txs
    // Używanej kategorii nie usuwamy (faktury i operacje z wyciągów straciłyby klasyfikację) — można ją wyłączyć.
    if (n > 0) throw new HttpProblem(409, 'cost_category_in_use', String(n))
    await db.delete(costCategories).where(eq(costCategories.id, id))
    await writeAudit(c, { action: 'settings.cost_category_delete', entity: 'cost_categories', entityId: id, changes: { name: cur.name } })
    return c.json(await listCategories(c), 200)
  },
)

// ---------------- Akceptacja ----------------

invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/{id}/submit', request: { params: idParam, body: body(invoiceSubmitInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { comment, version, approverId } = c.req.valid('json')
    const id = c.req.valid('param').id
    const approver = await checkApprover(c, approverId)
    // Bez kwoty netto podział % nie daje kosztów projektów — trzeba ją uzupełnić (plik bez odczytanych kwot).
    const res = await transition(
      c,
      id,
      version,
      INVOICE_EDITABLE,
      'pending',
      { kind: 'submitted', comment, meta: { approverId, approverName: approver.name } },
      (cur) => {
        if (effective(cur).netPrice == null) throw new HttpProblem(422, 'invoice_amount_missing')
      },
      approverId,
    )
    await notifyApprovers(c, [id])
    return res
  },
)

/**
 * Zbiorcze wysłanie do akceptacji z listy. Pomijane: w innym statusie niż do przypisania / odrzucona,
 * bez decyzji (ani projektu, ani kosztów ogólnych) i bez kwoty netto.
 */
invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/bulk-submit', request: { body: body(invoiceBulkSubmitInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { ids, comment, approverId } = c.req.valid('json')
    const user = c.get('user')
    const approver = await checkApprover(c, approverId)
    const unique = [...new Set(ids)]
    const result = await c.get('deps').db.transaction(async (tx) => {
      const rows = await tx.select().from(costInvoices).where(inArray(costInvoices.id, unique))
      const allocated = new Set(
        rows.length ? (await tx.select({ id: costInvoiceAllocations.invoiceId }).from(costInvoiceAllocations).where(inArray(costInvoiceAllocations.invoiceId, rows.map((r) => r.id)))).map((r) => r.id) : [],
      )
      const target = rows.filter((r) => INVOICE_EDITABLE.includes(r.status) && (r.general || allocated.has(r.id)) && effective(r).netPrice != null).map((r) => r.id)
      if (target.length) {
        await tx
          .update(costInvoices)
          .set({ status: 'pending', submittedBy: user.id, submittedAt: sql`now()`, approverId, decidedBy: null, decidedAt: null, version: sql`${costInvoices.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
          .where(and(inArray(costInvoices.id, target), inArray(costInvoices.status, [...INVOICE_EDITABLE])))
        await tx
          .insert(costInvoiceEvents)
          .values(target.map((invoiceId) => ({ invoiceId, kind: 'submitted' as const, comment: comment || null, userId: user.id, meta: { bulk: true, approverId, approverName: approver.name } })))
      }
      const res: InvoiceBulkResult = { updated: target.length, skipped: unique.length - target.length }
      await writeAudit(c, { action: 'invoices.bulk_submit', entity: 'cost_invoices', changes: { ids: target, ...res } }, tx)
      return { res, target }
    })
    // Jeden zbiorczy e-mail na wysłanie, nie po mailu na fakturę.
    await notifyApprovers(c, result.target)
    return c.json(result.res, 200)
  },
)

/**
 * Decyzję podejmuje wskazany akceptujący (Admin — także za niego); faktury wysłane bez wskazania — każdy uprawniony.
 * Zawsze inna osoba niż wysyłająca (zasada czterech oczu).
 */
const notSubmitter = (c: Context<AppEnv>) => (cur: typeof costInvoices.$inferSelect) => {
  const user = c.get('user')
  if (cur.submittedBy === user.id) throw forbidden('invoice_self_approval')
  if (user.role !== 'Admin' && !awaitsDecisionOf(cur, user.id)) throw forbidden('invoice_not_approver')
}

invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/{id}/approve', request: { params: idParam, body: body(invoiceTransitionInput) }, responses: ok }, 'approve'),
  async (c) => {
    const { comment, version } = c.req.valid('json')
    return transition(c, c.req.valid('param').id, version, ['pending'], 'approved', { kind: 'approved', comment }, notSubmitter(c))
  },
)

/**
 * Zbiorcza akceptacja (strona „Do akceptacji”). Akceptowane tylko faktury w akceptacji, które ta osoba może zatwierdzić
 * (wskazana jej lub bez wskazania; Admin — każda), nigdy wysłane przez siebie; pozostałe pominięte.
 */
invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/bulk-approve', request: { body: body(invoiceBulkApproveInput) }, responses: ok }, 'approve'),
  async (c) => {
    const { ids, comment } = c.req.valid('json')
    const user = c.get('user')
    const unique = [...new Set(ids)]
    const res = await c.get('deps').db.transaction(async (tx) => {
      const rows = await tx.select().from(costInvoices).where(inArray(costInvoices.id, unique))
      const target = rows
        .filter((r) => r.status === 'pending' && r.submittedBy !== user.id && (user.role === 'Admin' || awaitsDecisionOf(r, user.id)))
        .map((r) => r.id)
      if (target.length) {
        await tx
          .update(costInvoices)
          .set({ status: 'approved', decidedBy: user.id, decidedAt: sql`now()`, version: sql`${costInvoices.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
          .where(and(inArray(costInvoices.id, target), eq(costInvoices.status, 'pending')))
        await tx.insert(costInvoiceEvents).values(target.map((invoiceId) => ({ invoiceId, kind: 'approved' as const, comment: comment || null, userId: user.id, meta: { bulk: true } })))
      }
      const result: InvoiceBulkResult = { updated: target.length, skipped: unique.length - target.length }
      await writeAudit(c, { action: 'invoices.bulk_approve', entity: 'cost_invoices', changes: { ids: target, ...result } }, tx)
      return result
    })
    return c.json(res, 200)
  },
)

invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/{id}/reject', request: { params: idParam, body: body(invoiceRejectInput) }, responses: ok }, 'approve'),
  async (c) => {
    const { comment, version } = c.req.valid('json')
    return transition(c, c.req.valid('param').id, version, ['pending'], 'rejected', { kind: 'rejected', comment }, notSubmitter(c))
  },
)

/** Wycofanie z akceptacji (wysyłający) albo cofnięcie akceptacji — faktura wraca do „do przypisania”. */
invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/{id}/reopen', request: { params: idParam, body: body(invoiceTransitionInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { comment, version } = c.req.valid('json')
    return transition(c, c.req.valid('param').id, version, ['pending', 'approved'], 'new', { kind: 'reopened', comment })
  },
)

// ---------------- Ustawienia (Admin): kto ma dostęp, od kiedy synchronizować, powiadomienia e-mail ----------------

invoicesRouter.openapi(
  secureRoute('', { method: 'get', path: '/admin/settings/invoices', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const db = c.get('deps').db
    const staff: InvoiceUserOption[] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.name))
    return c.json({ settings: await invoiceSettings(db), users: staff, configured: !!c.get('deps').infakt, mailConfigured: !!c.get('deps').mailer }, 200)
  },
)

invoicesRouter.openapi(
  secureRoute('', { method: 'put', path: '/admin/settings/invoices', request: { body: body(invoiceSettingsInput) }, responses: ok }, { permission: { module: 'admin', action: 'edit' } }),
  async (c) => {
    const value = c.req.valid('json')
    const db = c.get('deps').db
    if (value.userIds.length) {
      const ok = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, value.userIds), inArray(users.role, [...STAFF_ROLES]), isNull(users.deletedAt)))
      if (ok.length !== new Set(value.userIds).size) throw new HttpProblem(422, 'invoice_user_not_staff')
    }
    const before = await invoiceSettings(db)
    const me = c.get('user').id
    await db.transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: INVOICES_SETTING_KEY, value, updatedBy: me }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: me } })
      await writeAudit(c, { action: 'settings.invoices', entity: 'app_settings', entityId: INVOICES_SETTING_KEY, changes: { old: before, new: value } }, tx)
    })
    return c.json(value, 200)
  },
)
