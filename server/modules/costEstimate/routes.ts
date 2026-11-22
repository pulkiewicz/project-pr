import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import {
  computeCostEstimate,
  costItemInput,
  costItemMove,
  costItemPatch,
  costCommentInput,
  costEstimateAccessInput,
  costSettingsInput,
  type CostCommentDto,
  type Action,
  type CostBudget,
  type CostCurrency,
  type CostEstimateResponse,
  type CostForecastMode,
  type CostItemRow,
  type CostSettingsDto,
  type ModuleKey,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { appSettings, costEstimateComments, costEstimateItems, costEstimates, hrfTasks, purchaseItems, users } from '../../db/schema.ts'
import { COST_ESTIMATE_SETTING_KEY, costEstimateSettings } from '../../auth/access.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { getProject } from '../hrf/service.ts'

export const costEstimateRouter = newRouter()

/** Kurs domyślny, dopóki kosztorys projektu nie ma ustawień. */
export const DEFAULT_EUR_RATE = 4.3

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const BASE = '/projects/{projectId}/cost-estimate'
const projectParam = z.object({ projectId: z.uuid() })
const itemParam = projectParam.extend({ itemId: z.uuid() })
const commentParam = itemParam.extend({ commentId: z.uuid() })
const route = <R extends RouteConfig>(r: R, action: Action, module: ModuleKey = 'costEstimate') => secureRoute('', r, { permission: { module, action } })

type ItemRow = typeof costEstimateItems.$inferSelect

const toRow = (r: ItemRow): CostItemRow => ({
  id: r.id,
  parentId: r.parentId,
  position: r.position,
  category: r.category,
  name: r.name,
  budget: r.budget as CostBudget,
  estimate: r.estimate,
  quoteAmount: r.quoteAmount,
  quoteCurrency: r.quoteCurrency as CostCurrency,
  actual: r.actual,
  forecastMode: r.forecastMode as CostForecastMode,
  forecastManual: r.forecastManual,
  supplier: r.supplier,
  notes: r.notes,
  inactive: r.inactive,
  inactiveReason: r.inactiveReason,
  purchaseItemId: r.purchaseItemId,
  version: r.version,
})

async function loadSettings(db: Database, projectId: string): Promise<CostSettingsDto> {
  const [s] = await db.select().from(costEstimates).where(eq(costEstimates.projectId, projectId))
  if (!s) return { eurRate: DEFAULT_EUR_RATE, eurRateNote: null, sources: null, contract: null, version: 0 }
  return { eurRate: s.eurRate, eurRateNote: s.eurRateNote, sources: s.sources, contract: s.contract ?? null, version: s.version }
}

async function activeItems(db: Database, projectId: string) {
  return db
    .select()
    .from(costEstimateItems)
    .where(and(eq(costEstimateItems.projectId, projectId), isNull(costEstimateItems.deletedAt)))
    .orderBy(asc(costEstimateItems.position))
}

async function load(db: Database, projectId: string): Promise<CostEstimateResponse> {
  const settings = await loadSettings(db, projectId)
  const rows = (await activeItems(db, projectId)).map(toRow)
  const ids = rows.map((r) => r.purchaseItemId).filter((x): x is string => !!x)
  const linked = ids.length
    ? await db
        .select({ id: purchaseItems.id, status: purchaseItems.status, isCritical: purchaseItems.isCritical, hrfTaskCode: hrfTasks.code })
        .from(purchaseItems)
        .leftJoin(hrfTasks, eq(hrfTasks.id, purchaseItems.hrfTaskId))
        .where(and(inArray(purchaseItems.id, ids), isNull(purchaseItems.deletedAt)))
    : []
  const purchases = new Map(linked.map(({ id, ...p }) => [id, p]))
  const counts = await db
    .select({ itemId: costEstimateComments.itemId, count: sql<number>`count(*)::int`, last: sql<string | null>`to_char(max(${costEstimateComments.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` })
    .from(costEstimateComments)
    .where(and(eq(costEstimateComments.projectId, projectId), isNull(costEstimateComments.deletedAt)))
    .groupBy(costEstimateComments.itemId)
  const comments = new Map(counts.map((r) => [r.itemId, { count: r.count, last: r.last }]))
  return { settings, ...computeCostEstimate(rows, settings, purchases, comments) }
}

async function getItem(db: Database, projectId: string, itemId: string) {
  const [r] = await db
    .select()
    .from(costEstimateItems)
    .where(and(eq(costEstimateItems.id, itemId), eq(costEstimateItems.projectId, projectId), isNull(costEstimateItems.deletedAt)))
  if (!r) throw notFound()
  return r
}

/** Podpozycje tylko w pozycjach głównych budżetu Envcheck (doszczegółowienie zakupów Envcheck). */
function assertParent(parent: ItemRow) {
  if (parent.parentId) throw new HttpProblem(422, 'cost_nested_too_deep')
  if (parent.budget !== 'Envcheck') throw new HttpProblem(422, 'cost_children_envcheck_only')
}

/** Dezaktywacja wymaga powodu (adnotacji); po ponownej aktywacji powód jest czyszczony. */
function normalizeInactive<T extends { inactive?: boolean; inactiveReason?: string | null }>(v: T, current?: { inactive: boolean; inactiveReason: string | null }): T {
  const inactive = v.inactive ?? current?.inactive ?? false
  const reason = v.inactiveReason !== undefined ? v.inactiveReason : (current?.inactiveReason ?? null)
  if (inactive && !reason?.trim()) throw new HttpProblem(422, 'cost_inactive_reason_required')
  return v.inactive === false ? { ...v, inactiveReason: null } : v
}

const nextPosition = async (db: Database, projectId: string, parentId: string | null) => {
  const [r] = await db
    .select({ max: sql<number | null>`max(${costEstimateItems.position})` })
    .from(costEstimateItems)
    .where(and(eq(costEstimateItems.projectId, projectId), isNull(costEstimateItems.deletedAt), parentId ? eq(costEstimateItems.parentId, parentId) : isNull(costEstimateItems.parentId)))
  return (Number(r?.max ?? 0) || 0) + 10
}

costEstimateRouter.openapi(route({ method: 'get', path: BASE, request: { params: projectParam }, responses: ok }, 'view'), async (c) => {
  const { projectId } = c.req.valid('param')
  await getProject(c.get('deps').db, projectId)
  return c.json(await load(c.get('deps').db, projectId), 200)
})

costEstimateRouter.openapi(route({ method: 'put', path: `${BASE}/settings`, request: { params: projectParam, body: body(costSettingsInput) }, responses: ok }, 'edit'), async (c) => {
  const { projectId } = c.req.valid('param')
  const { version, ...input } = c.req.valid('json')
  const { db } = c.get('deps')
  const user = c.get('user')
  await getProject(db, projectId)
  const current = await loadSettings(db, projectId)
  const saved = await db.transaction(async (tx) => {
    const values = { ...input, eurRateNote: input.eurRateNote ?? null, sources: input.sources ?? null, updatedBy: user.id }
    const r =
      version === 0
        ? await tx.insert(costEstimates).values({ projectId, ...values, createdBy: user.id }).onConflictDoNothing().returning({ v: costEstimates.version })
        : await tx
            .update(costEstimates)
            .set({ ...values, version: sql`${costEstimates.version} + 1`, updatedAt: sql`now()` })
            .where(and(eq(costEstimates.projectId, projectId), eq(costEstimates.version, version)))
            .returning({ v: costEstimates.version })
    if (r.length) await writeAudit(c, { action: 'costEstimate.settings', entity: 'cost_estimates', entityId: projectId, projectId, changes: diffFields(current as unknown as Record<string, unknown>, input) }, tx)
    return r.length > 0
  })
  const data = await load(db, projectId)
  if (!saved) throw conflict(data.settings)
  return c.json(data, 200)
})

costEstimateRouter.openapi(
  route({ method: 'post', path: `${BASE}/items`, request: { params: projectParam, body: body(costItemInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { parentId, ...input } = c.req.valid('json')
    const { db } = c.get('deps')
    const user = c.get('user')
    await getProject(db, projectId)
    let values = normalizeInactive(input)
    if (parentId) {
      const parent = await getItem(db, projectId, parentId)
      assertParent(parent)
      // Podpozycja dziedziczy kategorię i budżet.
      values = { ...values, category: parent.category, budget: 'Envcheck' }
    }
    const id = await db.transaction(async (tx) => {
      const position = await nextPosition(tx, projectId, parentId ?? null)
      const [r] = await tx
        .insert(costEstimateItems)
        .values({ ...values, projectId, parentId: parentId ?? null, position, createdBy: user.id, updatedBy: user.id })
        .returning({ id: costEstimateItems.id })
      await writeAudit(c, { action: 'costEstimate.create', entity: 'cost_estimate_items', entityId: r!.id, projectId, changes: { ...values, parentId } }, tx)
      return r!.id
    })
    const data = await load(db, projectId)
    return c.json({ ...data, id }, 201)
  },
)

costEstimateRouter.openapi(route({ method: 'patch', path: `${BASE}/items/{itemId}`, request: { params: itemParam, body: body(costItemPatch) }, responses: ok }, 'edit'), async (c) => {
  const { projectId, itemId } = c.req.valid('param')
  const { version, ...input } = c.req.valid('json')
  const { db } = c.get('deps')
  const user = c.get('user')
  const current = await getItem(db, projectId, itemId)
  const patch = normalizeInactive(input, current)
  if (current.parentId) {
    // Kategoria i budżet podpozycji pochodzą z pozycji nadrzędnej.
    delete patch.category
    delete patch.budget
  }
  const [{ n: childCount } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(costEstimateItems)
    .where(and(eq(costEstimateItems.parentId, itemId), isNull(costEstimateItems.deletedAt)))
  if (childCount > 0 && patch.budget && patch.budget !== 'Envcheck') throw new HttpProblem(422, 'cost_children_envcheck_only')
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(costEstimateItems)
      .set({ ...patch, version: sql`${costEstimateItems.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
      .where(and(eq(costEstimateItems.id, itemId), eq(costEstimateItems.version, version)))
      .returning({ id: costEstimateItems.id })
    if (!r) return false
    if (childCount > 0 && patch.category && patch.category !== current.category) {
      await tx
        .update(costEstimateItems)
        .set({ category: patch.category, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(costEstimateItems.parentId, itemId), isNull(costEstimateItems.deletedAt)))
    }
    if (patch.inactive !== undefined && patch.inactive !== current.inactive) {
      // Dezaktywacja / aktywacja trafia też do historii komentarzy pozycji (z autorem).
      const body = patch.inactive ? `Dezaktywowano pozycję: ${patch.inactiveReason ?? current.inactiveReason ?? ''}`.trim() : 'Przywrócono pozycję (aktywna)'
      await tx.insert(costEstimateComments).values({ projectId, itemId, body, createdBy: user.id, updatedBy: user.id })
    }
    await writeAudit(c, { action: 'costEstimate.update', entity: 'cost_estimate_items', entityId: itemId, projectId, changes: diffFields(current, patch) }, tx)
    return true
  })
  const data = await load(db, projectId)
  if (!updated) throw conflict(data.items.find((i) => i.id === itemId) ?? null)
  return c.json(data, 200)
})

/** Przesunięcie pozycji w górę / w dół (zamiana z sąsiadem w obrębie tego samego rodzica). */
costEstimateRouter.openapi(route({ method: 'post', path: `${BASE}/items/{itemId}/move`, request: { params: itemParam, body: body(costItemMove) }, responses: ok }, 'edit'), async (c) => {
  const { projectId, itemId } = c.req.valid('param')
  const { direction } = c.req.valid('json')
  const { db } = c.get('deps')
  const current = await getItem(db, projectId, itemId)
  const siblings = (await activeItems(db, projectId)).filter((r) => r.parentId === current.parentId)
  const idx = siblings.findIndex((r) => r.id === itemId)
  const other = siblings[direction === 'up' ? idx - 1 : idx + 1]
  if (other) {
    await db.transaction(async (tx) => {
      // Pozycje mogą się powtarzać (import) — nadaj kolejne numery całej grupie, a potem zamień parę.
      const order = siblings.map((s) => s.id)
      ;[order[idx], order[siblings.indexOf(other)]] = [order[siblings.indexOf(other)]!, order[idx]!]
      for (const [i, id] of order.entries()) await tx.update(costEstimateItems).set({ position: (i + 1) * 10 }).where(eq(costEstimateItems.id, id))
    })
  }
  return c.json(await load(db, projectId), 200)
})

costEstimateRouter.openapi(route({ method: 'delete', path: `${BASE}/items/{itemId}`, request: { params: itemParam }, responses: ok }, 'delete'), async (c) => {
  const { projectId, itemId } = c.req.valid('param')
  const { db } = c.get('deps')
  const user = c.get('user')
  const current = await getItem(db, projectId, itemId)
  await db.transaction(async (tx) => {
    const kids = await tx
      .update(costEstimateItems)
      .set({ deletedAt: sql`now()`, deletedBy: user.id })
      .where(and(eq(costEstimateItems.parentId, itemId), isNull(costEstimateItems.deletedAt)))
      .returning({ id: costEstimateItems.id })
    await tx.update(costEstimateItems).set({ deletedAt: sql`now()`, deletedBy: user.id }).where(eq(costEstimateItems.id, itemId))
    await writeAudit(c, { action: 'costEstimate.delete', entity: 'cost_estimate_items', entityId: itemId, projectId, changes: { name: current.name, children: kids.length } }, tx)
  })
  return c.json(await load(db, projectId), 200)
})

// ---------------- Ustawienia (Admin): kto ma dostęp do Kosztorysu ----------------

const ACCESS_ROLES = ['Admin', 'EnvcheckInternal'] as const

costEstimateRouter.openapi(
  secureRoute('', { method: 'get', path: '/admin/settings/cost-estimate', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const { db } = c.get('deps')
    const staff = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.role, [...ACCESS_ROLES]), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.name))
    return c.json({ settings: await costEstimateSettings(db), users: staff }, 200)
  },
)

costEstimateRouter.openapi(
  secureRoute('', { method: 'put', path: '/admin/settings/cost-estimate', request: { body: body(costEstimateAccessInput) }, responses: ok }, { permission: { module: 'admin', action: 'edit' } }),
  async (c) => {
    const value = c.req.valid('json')
    const { db } = c.get('deps')
    if (value.userIds.length) {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, value.userIds), inArray(users.role, [...ACCESS_ROLES]), isNull(users.deletedAt)))
      if (found.length !== new Set(value.userIds).size) throw new HttpProblem(422, 'user_not_staff')
    }
    const before = await costEstimateSettings(db)
    const me = c.get('user').id
    await db.transaction(async (tx) => {
      await tx
        .insert(appSettings)
        .values({ key: COST_ESTIMATE_SETTING_KEY, value, updatedBy: me })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: me } })
      await writeAudit(c, { action: 'settings.cost_estimate', entity: 'app_settings', entityId: COST_ESTIMATE_SETTING_KEY, changes: { old: before, new: value } }, tx)
    })
    return c.json(value, 200)
  },
)

// ---------------- Komentarze do pozycji ----------------

async function listComments(c: Context<AppEnv>, db: Database, itemId: string): Promise<CostCommentDto[]> {
  const user = c.get('user')
  const perms = c.get('permissions')
  const rows = await db
    .select({ id: costEstimateComments.id, body: costEstimateComments.body, createdAt: costEstimateComments.createdAt, authorId: costEstimateComments.createdBy, authorName: users.name })
    .from(costEstimateComments)
    .leftJoin(users, eq(users.id, costEstimateComments.createdBy))
    .where(and(eq(costEstimateComments.itemId, itemId), isNull(costEstimateComments.deletedAt)))
    .orderBy(asc(costEstimateComments.createdAt))
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: new Date(r.createdAt).toISOString(),
    authorId: r.authorId,
    authorName: r.authorName,
    canDelete: r.authorId === user.id || perms.has('costEstimate:delete'),
  }))
}

costEstimateRouter.openapi(route({ method: 'get', path: `${BASE}/items/{itemId}/comments`, request: { params: itemParam }, responses: ok }, 'view'), async (c) => {
  const { projectId, itemId } = c.req.valid('param')
  const { db } = c.get('deps')
  await getItem(db, projectId, itemId)
  return c.json(await listComments(c, db, itemId), 200)
})

costEstimateRouter.openapi(
  route({ method: 'post', path: `${BASE}/items/{itemId}/comments`, request: { params: itemParam, body: body(costCommentInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, 'create'),
  async (c) => {
    const { projectId, itemId } = c.req.valid('param')
    const { body: text } = c.req.valid('json')
    const { db } = c.get('deps')
    const user = c.get('user')
    await getItem(db, projectId, itemId)
    await db.transaction(async (tx) => {
      const [r] = await tx.insert(costEstimateComments).values({ projectId, itemId, body: text, createdBy: user.id, updatedBy: user.id }).returning({ id: costEstimateComments.id })
      await writeAudit(c, { action: 'costEstimate.comment', entity: 'cost_estimate_comments', entityId: r!.id, projectId, changes: { itemId } }, tx)
    })
    return c.json(await listComments(c, db, itemId), 201)
  },
)

costEstimateRouter.openapi(route({ method: 'delete', path: `${BASE}/items/{itemId}/comments/{commentId}`, request: { params: commentParam }, responses: ok }, 'create'), async (c) => {
  const { projectId, itemId, commentId } = c.req.valid('param')
  const { db } = c.get('deps')
  const user = c.get('user')
  const [cm] = await db
    .select()
    .from(costEstimateComments)
    .where(and(eq(costEstimateComments.id, commentId), eq(costEstimateComments.itemId, itemId), eq(costEstimateComments.projectId, projectId), isNull(costEstimateComments.deletedAt)))
  if (!cm) throw notFound()
  if (cm.createdBy !== user.id && !c.get('permissions').has('costEstimate:delete')) throw forbidden('not_own_record')
  await db.transaction(async (tx) => {
    await tx.update(costEstimateComments).set({ deletedAt: sql`now()`, deletedBy: user.id }).where(eq(costEstimateComments.id, commentId))
    await writeAudit(c, { action: 'costEstimate.comment_delete', entity: 'cost_estimate_comments', entityId: commentId, projectId, changes: { itemId, body: cm.body } }, tx)
  })
  return c.json(await listComments(c, db, itemId), 200)
})

costEstimateRouter.openapi(
  route(
    { method: 'get', path: `${BASE}/export.xlsx`, request: { params: projectParam }, responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } } },
    'export',
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { db } = c.get('deps')
    await getProject(db, projectId)
    const xlsx = await buildCostEstimateXlsx(await load(db, projectId))
    await writeAudit(c, { action: 'costEstimate.export_xlsx', entity: 'cost_estimate_items', projectId })
    return c.body(xlsx, 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="kosztorys.xlsx"',
    })
  },
)

const PLN = '#,##0.00 "zł"'
const PCT = '0.0%'
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } } } as const

/** Eksport w układzie arkusza źródłowego: Podsumowanie + Pozycje (podpozycje wcięte pod pozycją). */
export async function buildCostEstimateXlsx(data: CostEstimateResponse): Promise<ArrayBuffer> {
  const { settings, items, summary } = data
  const wb = new ExcelJS.Workbook()
  const sum = wb.addWorksheet('Podsumowanie')
  sum.columns = [{ width: 46 }, { width: 18 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 }]
  const head = (row: ExcelJS.Row) => row.eachCell((cell) => Object.assign(cell, { font: HEAD.font, fill: HEAD.fill }))
  const title = (text: string) => {
    sum.addRow([])
    sum.addRow([text]).font = { bold: true, size: 12 }
  }
  const money = (row: ExcelJS.Row, cols: number[], pct: number[] = []) => {
    for (const col of cols) row.getCell(col).numFmt = PLN
    for (const col of pct) row.getCell(col).numFmt = PCT
  }
  sum.addRow(['Kurs EUR/PLN', settings.eurRate, settings.eurRateNote ?? ''])
  for (const line of (settings.sources ?? '').split('\n').filter(Boolean)) sum.addRow([line])

  title('Koszty Envcheck wg kategorii (zł netto)')
  head(sum.addRow(['Kategoria', 'Szacowane', '% kosztu', 'Wycena', 'Faktyczne', 'Prognoza']))
  for (const k of summary.categories) money(sum.addRow([k.category, k.estimate, k.share, k.quote, k.actual, k.forecast]), [2, 4, 5, 6], [3])
  const env = sum.addRow(['Razem Envcheck', summary.envcheck.estimate, 1, summary.envcheck.quote, summary.envcheck.actual, summary.envcheck.forecast])
  env.font = { bold: true }
  money(env, [2, 4, 5, 6], [3])

  title('Koszty wg budżetu (zł netto)')
  head(sum.addRow(['Budżet', 'Szacowane', '% całości', 'Wycena', 'Faktyczne', 'Prognoza']))
  for (const b of summary.budgets) money(sum.addRow([b.budget, b.estimate, b.share, b.quote, b.actual, b.forecast]), [2, 4, 5, 6], [3])
  const tot = sum.addRow(['Razem', summary.total.estimate, 1, summary.total.quote, summary.total.actual, summary.total.forecast])
  tot.font = { bold: true }
  money(tot, [2, 4, 5, 6], [3])

  const k = summary.contract
  if (k) {
    title('Zakres Arsanit a aneks (zł netto)')
    money(sum.addRow(['Budżet Arsanit wg aneksu', k.partnerBudget]), [2])
    for (const s of k.partnerStages) money(sum.addRow([`w tym ${s.name}`, s.amount]), [2])
    money(sum.addRow(['Pozycje przypisane do Arsanit wg kosztorysu', k.partnerAssigned]), [2])
    money(sum.addRow(['Różnica: aneks minus kosztorys', k.partnerDiff]), [2])

    title('Podział wynagrodzenia i wynik Envcheck (zł netto)')
    head(sum.addRow(['Pozycja', 'Szacowane', '% kwoty Envcheck', 'Prognoza']))
    const pct = (v: number) => (k.envcheckAmount ? v / k.envcheckAmount : 0)
    money(sum.addRow(['Wynagrodzenie z umowy', k.contractValue]), [2])
    money(sum.addRow(['Budżet Arsanit', k.partnerBudget]), [2])
    money(sum.addRow(['Stała marża Arsanit', k.partnerMargin]), [2])
    money(sum.addRow(['Rezerwa gwarancyjna (wspólna)', k.guaranteeReserve]), [2])
    money(sum.addRow(['Kwota Envcheck', k.envcheckAmount, 1, k.envcheckAmount]), [2, 4], [3])
    money(sum.addRow(['Koszt Envcheck', k.envcheckCost, pct(k.envcheckCost), k.envcheckCostForecast]), [2, 4], [3])
    const res = sum.addRow(['Wynik Envcheck', k.result, pct(k.result), k.resultForecast])
    res.font = { bold: true }
    money(res, [2, 4], [3])
    sum.addRow(['Udział Envcheck w niewykorzystanej rezerwie', k.reserveShare]).getCell(2).numFmt = PCT
    money(sum.addRow(['Maks. zwrot z rezerwy dla Envcheck', k.maxReserveReturn]), [2])
    if (k.partnerStages.length || settings.contract?.source) sum.addRow([`Źródło: ${settings.contract?.source ?? ''}`])
  }

  const ws = wb.addWorksheet('Pozycje', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: 'Kategoria', key: 'category', width: 28 },
    { header: 'Pozycja', key: 'name', width: 50 },
    { header: 'Budżet', key: 'budget', width: 11 },
    { header: 'Szacowane (zł)', key: 'estimate', width: 16, style: { numFmt: PLN } },
    { header: '% kosztu', key: 'share', width: 9, style: { numFmt: PCT } },
    { header: 'Wycena', key: 'quoteAmount', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Waluta', key: 'quoteCurrency', width: 7 },
    { header: 'Wycena (zł)', key: 'quotePln', width: 16, style: { numFmt: PLN } },
    { header: 'Faktyczne (zł)', key: 'actual', width: 16, style: { numFmt: PLN } },
    { header: 'Prognoza (zł)', key: 'forecast', width: 16, style: { numFmt: PLN } },
    { header: 'Dostawca', key: 'supplier', width: 20 },
    { header: 'Uwagi', key: 'notes', width: 60 },
    { header: 'Nieaktywna — powód', key: 'inactiveReason', width: 40 },
    { header: 'Komentarze', key: 'commentCount', width: 11 },
  ]
  head(ws.getRow(1))
  for (const i of items) {
    const row = ws.addRow({
      ...i,
      name: i.parentId ? `    ↳ ${i.name}` : i.name,
      share: i.parentId ? null : i.share,
      quoteAmount: i.childCount ? null : i.quoteAmount,
      quoteCurrency: i.childCount || i.quoteAmount == null ? '' : i.quoteCurrency,
      actual: i.actualTotal,
      inactiveReason: i.inactive ? (i.inactiveReason ?? 'tak') : '',
      commentCount: i.commentCount || null,
    })
    if (i.childCount) row.font = { bold: true }
    if (i.parentId) row.font = { color: { argb: 'FF555555' } }
    if (i.inactive) row.font = { strike: true, color: { argb: 'FF999999' } }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

