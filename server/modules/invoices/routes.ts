import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import {
  INVOICE_EDITABLE,
  INVOICE_MANUAL_FIELDS,
  invoiceDetailsInput,
  type InvoiceManual,
  STAFF_ROLES,
  invoiceAllocationInput,
  invoiceRejectInput,
  invoiceSettingsInput,
  invoiceTransitionInput,
  type Action,
  type InvoiceDetailDto,
  type InvoiceListResponse,
  type InvoiceStatus,
  type InvoiceUserOption,
} from '#shared'
import { INVOICES_SETTING_KEY, invoiceSettings } from '../../auth/access.ts'
import type { AppEnv } from '../../context.ts'
import { appSettings, costInvoiceAllocations, costInvoiceEvents, costInvoices, projects, users } from '../../db/schema.ts'
import { InfaktError } from '../../integrations/infakt/types.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { effective, getInvoice, lastSync, listEvents, listInvoices, syncInvoices } from './service.ts'

export const invoicesRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'invoices', action } })
const now = (c: Context<AppEnv>) => c.get('deps').now?.() ?? new Date()

async function detail(c: Context<AppEnv>, id: string): Promise<InvoiceDetailDto> {
  const db = c.get('deps').db
  const dto = await getInvoice(db, id)
  if (!dto) throw notFound()
  return { ...dto, events: await listEvents(db, id) }
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
  event: { kind: 'submitted' | 'approved' | 'rejected' | 'reopened'; comment?: string | null },
  check?: (cur: typeof costInvoices.$inferSelect) => void,
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
        ...(to === 'pending' ? { submittedBy: user.id, submittedAt: sql`now()`, decidedBy: null, decidedAt: null } : {}),
        ...(decision ? { decidedBy: user.id, decidedAt: sql`now()` } : {}),
        ...(to === 'new' ? { decidedBy: null, decidedAt: null } : {}),
        version: sql`${costInvoices.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: user.id,
      })
      .where(and(eq(costInvoices.id, id), eq(costInvoices.version, version)))
      .returning({ id: costInvoices.id })
    if (r) {
      await tx.insert(costInvoiceEvents).values({ invoiceId: id, kind: event.kind, comment: event.comment ?? null, userId: user.id })
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
    const result = await syncInvoices(deps.db, deps.infakt, await invoiceSettings(deps.db), c.get('user').id, now(c))
    await writeAudit(c, { action: 'invoices.sync', entity: 'cost_invoices', changes: result })
    return c.json(result, 200)
  } catch (e) {
    if (e instanceof InfaktError) throw new HttpProblem(502, e.status === 401 || e.status === 403 ? 'infakt_unauthorized' : 'infakt_failed', e.message.slice(0, 300))
    throw e
  }
})

// ---------------- Eksport ----------------

invoicesRouter.openapi(
  route(
    { method: 'get', path: '/invoices/export.xlsx', responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } } },
    'export',
  ),
  async (c) => {
    const items = await listInvoices(c.get('deps').db)
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
      { header: 'Projekt', key: 'project', width: 14 },
      { header: 'Udział %', key: 'share', width: 10 },
      { header: 'Netto udziału', key: 'shareNet', width: 14, style: { numFmt: money } },
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
        status: STATUS[i.status],
        decidedBy: i.status === 'approved' ? (i.decidedByName ?? '') : '',
      }
      for (const a of i.allocations) ws.addRow({ ...base, project: a.projectCode, share: a.share, shareNet: pln(a.netAmount) })
      const rest = Math.round((100 - i.allocatedShare) * 100) / 100
      if (rest > 0) {
        const restNet = i.netPrice == null ? null : i.netPrice - i.allocations.reduce((s, a) => s + (a.netAmount ?? 0), 0)
        ws.addRow({ ...base, project: 'Ogólne', share: rest, shareNet: pln(restNet) })
      }
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } }
    await writeAudit(c, { action: 'invoices.export_xlsx', entity: 'cost_invoices', changes: { invoices: items.length } })
    return c.body((await wb.xlsx.writeBuffer()) as ArrayBuffer, 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="faktury-projekty.xlsx"',
    })
  },
)

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

// ---------------- Przypisanie do projektów ----------------

invoicesRouter.openapi(
  route({ method: 'put', path: '/invoices/{id}/allocation', request: { params: idParam, body: body(invoiceAllocationInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { allocations, note, version } = c.req.valid('json')
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
        .set({ ...(note !== undefined ? { note } : {}), version: sql`${costInvoices.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(costInvoices.id, id), eq(costInvoices.version, version)))
        .returning({ id: costInvoices.id })
      if (!r) return null
      await tx.delete(costInvoiceAllocations).where(eq(costInvoiceAllocations.invoiceId, id))
      if (allocations.length) await tx.insert(costInvoiceAllocations).values(allocations.map((a) => ({ invoiceId: id, projectId: a.projectId, share: a.share })))
      await tx.insert(costInvoiceEvents).values({ invoiceId: id, kind: 'allocated', userId: user.id, meta: { allocations } })
      await writeAudit(c, { action: 'invoices.allocate', entity: 'cost_invoices', entityId: id, changes: { allocations, note } }, tx)
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

// ---------------- Akceptacja ----------------

invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/{id}/submit', request: { params: idParam, body: body(invoiceTransitionInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { comment, version } = c.req.valid('json')
    // Bez kwoty netto podział % nie daje kosztów projektów — trzeba ją uzupełnić (plik bez odczytanych kwot).
    return transition(c, c.req.valid('param').id, version, INVOICE_EDITABLE, 'pending', { kind: 'submitted', comment }, (cur) => {
      if (effective(cur).netPrice == null) throw new HttpProblem(422, 'invoice_amount_missing')
    })
  },
)

/** Zasada czterech oczu: akceptuje / odrzuca inna osoba z dostępem niż ta, która wysłała do akceptacji. */
const notSubmitter = (c: Context<AppEnv>) => (cur: typeof costInvoices.$inferSelect) => {
  if (cur.submittedBy === c.get('user').id) throw forbidden('invoice_self_approval')
}

invoicesRouter.openapi(
  route({ method: 'post', path: '/invoices/{id}/approve', request: { params: idParam, body: body(invoiceTransitionInput) }, responses: ok }, 'approve'),
  async (c) => {
    const { comment, version } = c.req.valid('json')
    return transition(c, c.req.valid('param').id, version, ['pending'], 'approved', { kind: 'approved', comment }, notSubmitter(c))
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

// ---------------- Ustawienia (Admin): kto ma dostęp, od kiedy synchronizować ----------------

invoicesRouter.openapi(
  secureRoute('', { method: 'get', path: '/admin/settings/invoices', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const db = c.get('deps').db
    const staff: InvoiceUserOption[] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.name))
    return c.json({ settings: await invoiceSettings(db), users: staff, configured: !!c.get('deps').infakt }, 200)
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
