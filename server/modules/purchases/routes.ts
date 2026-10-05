import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, eq, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import { purchaseItemInput, purchaseItemPatch, type Action, type ModuleKey, type PurchasesResponse } from '#shared'
import i18nPl from '../../../shared/i18n/pl.json' with { type: 'json' }
import type { AppEnv } from '../../context.ts'
import { hrfTasks, purchaseItems } from '../../db/schema.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { canCreateForParty, canEditRecord } from '../../lib/ownership.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { getProject } from '../hrf/service.ts'
import { defaultBuffer, listPurchases } from './service.ts'

export const purchasesRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const BASE = '/projects/{projectId}/purchases'
const projectParam = z.object({ projectId: z.uuid() })
const itemParam = projectParam.extend({ itemId: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

async function list(c: Context<AppEnv>, projectId: string) {
  const db = c.get('deps').db
  const project = await getProject(db, projectId)
  const buffer = defaultBuffer(project)
  const items = await listPurchases(db, projectId, { user: c.get('user'), perms: c.get('permissions'), today: todayWarsaw(c.get('deps').now?.()), buffer })
  return { buffer, items }
}

async function assertTask(c: Context<AppEnv>, projectId: string, taskId: string | null | undefined) {
  if (!taskId) return
  const [t] = await c.get('deps').db.select({ id: hrfTasks.id }).from(hrfTasks).where(and(eq(hrfTasks.id, taskId), eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
  if (!t) throw new HttpProblem(422, 'hrf_task_not_found')
}

purchasesRouter.openapi(route({ method: 'get', path: BASE, request: { params: projectParam }, responses: ok }, 'purchases', 'view'), async (c) => {
  const { buffer, items } = await list(c, c.req.valid('param').projectId)
  return c.json({ defaultBufferDays: buffer, items } satisfies PurchasesResponse, 200)
})

purchasesRouter.openapi(
  route({ method: 'post', path: BASE, request: { params: projectParam, body: body(purchaseItemInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, 'purchases', 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const user = c.get('user')
    const deps = c.get('deps')
    await getProject(deps.db, projectId)
    if (!canCreateForParty(user, c.get('permissions'), 'purchases', input.party, 'purchases')) throw forbidden('party_not_allowed', input.party)
    await assertTask(c, projectId, input.hrfTaskId)
    const id = await deps.db.transaction(async (tx) => {
      const [r] = await tx.insert(purchaseItems).values({ ...input, projectId, createdBy: user.id, updatedBy: user.id }).returning({ id: purchaseItems.id })
      await writeAudit(c, { action: 'purchases.create', entity: 'purchase_items', entityId: r!.id, projectId, changes: input }, tx)
      return r!.id
    })
    const { items } = await list(c, projectId)
    return c.json(items.find((i) => i.id === id), 201)
  },
)

purchasesRouter.openapi(
  route({ method: 'patch', path: `${BASE}/{itemId}`, request: { params: itemParam, body: body(purchaseItemPatch) }, responses: ok }, 'purchases', 'edit'),
  async (c) => {
    const { projectId, itemId } = c.req.valid('param')
    const { version, ...patch } = c.req.valid('json')
    const user = c.get('user')
    const perms = c.get('permissions')
    const deps = c.get('deps')
    const [current] = await deps.db.select().from(purchaseItems).where(and(eq(purchaseItems.id, itemId), eq(purchaseItems.projectId, projectId), isNull(purchaseItems.deletedAt)))
    if (!current) throw notFound()
    if (!canEditRecord(user, perms, 'purchases', current, 'purchases')) throw forbidden('not_own_record')
    if (patch.party && patch.party !== current.party && !canCreateForParty(user, perms, 'purchases', patch.party, 'purchases')) throw forbidden('party_not_allowed', patch.party)
    await assertTask(c, projectId, patch.hrfTaskId)
    const updated = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(purchaseItems)
        .set({ ...patch, version: sql`${purchaseItems.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(purchaseItems.id, itemId), eq(purchaseItems.version, version)))
        .returning({ id: purchaseItems.id })
      if (r) await writeAudit(c, { action: 'purchases.update', entity: 'purchase_items', entityId: itemId, projectId, changes: diffFields(current, patch) }, tx)
      return r
    })
    const { items } = await list(c, projectId)
    const dto = items.find((i) => i.id === itemId)
    if (!updated) throw conflict(dto ?? null)
    return c.json(dto, 200)
  },
)

purchasesRouter.openapi(
  route({ method: 'delete', path: `${BASE}/{itemId}`, request: { params: itemParam }, responses: ok }, 'purchases', 'delete'),
  async (c) => {
    const { projectId, itemId } = c.req.valid('param')
    const deps = c.get('deps')
    await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(purchaseItems)
        .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
        .where(and(eq(purchaseItems.id, itemId), eq(purchaseItems.projectId, projectId), isNull(purchaseItems.deletedAt)))
        .returning({ name: purchaseItems.name })
      if (!r) throw notFound()
      await writeAudit(c, { action: 'purchases.delete', entity: 'purchase_items', entityId: itemId, projectId, changes: { name: r.name } }, tx)
    })
    return c.json({ ok: true }, 200)
  },
)

purchasesRouter.openapi(
  route(
    { method: 'get', path: `${BASE}/export.xlsx`, request: { params: projectParam }, responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } } },
    'purchases',
    'export',
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { items } = await list(c, projectId)
    const t = i18nPl as unknown as { purchases: { status: Record<string, string>; alert: Record<string, string> }; parties: Record<string, string> }
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Plan zakupów', { views: [{ state: 'frozen', ySplit: 1 }] })
    const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null)
    ws.columns = [
      { header: 'Komponent', key: 'name', width: 40 },
      { header: 'Kategoria', key: 'category', width: 16 },
      { header: 'Producent', key: 'manufacturer', width: 18 },
      { header: 'Nr katalogowy', key: 'partNo', width: 16 },
      { header: 'Ilość', key: 'quantity', width: 8 },
      { header: 'J.m.', key: 'unit', width: 6 },
      { header: 'Dostawca', key: 'supplierName', width: 20 },
      { header: 'Kupuje', key: 'party', width: 10 },
      { header: 'Zadanie HRF', key: 'hrf', width: 12 },
      { header: 'Krytyczny', key: 'isCritical', width: 10 },
      { header: 'Lead time (tyg.)', key: 'leadTimeWeeks', width: 14 },
      { header: 'Zamówić do', key: 'orderByDate', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Data potrzeby', key: 'needDate', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Zamówiono', key: 'orderDateActual', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Potw. dostawa', key: 'confirmedDeliveryDate', width: 13, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Dostarczono', key: 'actualDeliveryDate', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Alerty', key: 'alerts', width: 40 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }
    for (const i of items) {
      ws.addRow({
        ...i,
        party: t.parties[i.party] ?? i.party,
        hrf: i.hrfTaskCode ?? '',
        isCritical: i.isCritical ? 'tak' : '',
        orderByDate: date(i.orderByDate),
        needDate: date(i.needDate),
        orderDateActual: date(i.orderDateActual),
        confirmedDeliveryDate: date(i.confirmedDeliveryDate),
        actualDeliveryDate: date(i.actualDeliveryDate),
        status: t.purchases.status[i.status],
        alerts: i.alerts.map((a) => t.purchases.alert[a.code]!.replace('{{count}}', String(a.days))).join('; '),
      })
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 18 } }
    await writeAudit(c, { action: 'purchases.export_xlsx', entity: 'purchase_items', projectId, changes: { rows: items.length } })
    return c.body((await wb.xlsx.writeBuffer()) as ArrayBuffer, 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="plan-zakupow.xlsx"',
    })
  },
)
