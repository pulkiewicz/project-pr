import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import {
  computeCostEstimate,
  costItemInput,
  costItemMove,
  costItemPatch,
  costSettingsInput,
  type Action,
  type CostBudget,
  type CostCurrency,
  type CostEstimateResponse,
  type CostForecastMode,
  type CostItemRow,
  type CostSettingsDto,
  type ModuleKey,
} from '#shared'
import type { Database } from '../../db/client.ts'
import { costEstimateItems, costEstimates, hrfTasks, purchaseItems } from '../../db/schema.ts'
import { HttpProblem, conflict, notFound } from '../../lib/problem.ts'
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
  return { settings, ...computeCostEstimate(rows, settings, purchases) }
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
    let values = input
    if (parentId) {
      const parent = await getItem(db, projectId, parentId)
      assertParent(parent)
      // Podpozycja dziedziczy kategorię i budżet.
      values = { ...input, category: parent.category, budget: 'Envcheck' }
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
  const { version, ...patch } = c.req.valid('json')
  const { db } = c.get('deps')
  const user = c.get('user')
  const current = await getItem(db, projectId, itemId)
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
    })
    if (i.childCount) row.font = { bold: true }
    if (i.parentId) row.font = { color: { argb: 'FF555555' } }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

