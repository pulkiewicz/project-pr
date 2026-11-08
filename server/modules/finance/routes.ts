import { z } from '@hono/zod-openapi'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { PLAN_REPEAT_MAX, financeMonth, fixedCostInput, fixedCostPatch, monthsBetween, planItemInput, planItemPatch, type Action } from '#shared'
import type { Database } from '../../db/client.ts'
import { costCategories, financeFixedCosts, financePlanItems, projects } from '../../db/schema.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { HttpProblem, conflict, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { financePlan, listFixedCosts, listPlanItems } from './service.ts'

/** Plan finansowy — te same uprawnienia co Faktury (lista osób w Ustawieniach); wynagrodzenia imiennie tylko z dostępem do Pracowników. */
export const financeRouter = newRouter()

const ok = { 200: { description: 'OK', content: { 'application/json': { schema: z.any() } } } }
const planQuery = z.object({ month: z.string().regex(financeMonth, 'validation.month').optional() })

financeRouter.openapi(
  secureRoute('', { method: 'get', path: '/finance/plan', request: { query: planQuery }, responses: ok }, { permission: { module: 'invoices', action: 'view' } }),
  async (c) => {
    const deps = c.get('deps')
    const month = c.req.valid('query').month ?? todayWarsaw(deps.now?.()).slice(0, 7)
    const plan = await financePlan(deps.db, month, { staffRows: c.get('permissions').has('employees:view'), configured: !!deps.infakt })
    return c.json(plan, 200)
  },
)

// ---------------- Pozycje planowane i koszty stałe (zapis: uprawnienia Faktur) ----------------

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } }, required: true as const })
const idParam = z.object({ id: z.uuid() })
const perm = (action: Action) => ({ permission: { module: 'invoices' as const, action } })

/** Projekt i kategoria muszą istnieć (inaczej 422 zamiast błędu klucza obcego); kategoria tylko dla kosztów. */
async function checkRefs(db: Database, v: { projectId?: string | null; costCategoryId?: string | null }) {
  if (v.projectId) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, v.projectId), isNull(projects.deletedAt)))
    if (!p) throw new HttpProblem(422, 'project_not_found')
  }
  if (v.costCategoryId) {
    const [k] = await db.select({ id: costCategories.id }).from(costCategories).where(eq(costCategories.id, v.costCategoryId))
    if (!k) throw new HttpProblem(422, 'category_not_found')
  }
}

financeRouter.openapi(secureRoute('', { method: 'post', path: '/finance/plan-items', request: { body: json(planItemInput) }, responses: ok }, perm('create')), async (c) => {
  const db = c.get('deps').db
  const { month, repeatUntil, ...v } = c.req.valid('json')
  if (v.kind === 'revenue') v.costCategoryId = null
  await checkRefs(db, v)
  const months = monthsBetween(month, repeatUntil ?? month)
  if (months.length > PLAN_REPEAT_MAX) throw new HttpProblem(422, 'repeat_too_long')
  const userId = c.get('user').id
  const rows = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(financePlanItems)
      .values(months.map((m) => ({ ...v, projectId: v.projectId ?? null, costCategoryId: v.costCategoryId ?? null, note: v.note || null, month: m, createdBy: userId, updatedBy: userId })))
      .returning({ id: financePlanItems.id })
    await writeAudit(c, { action: 'finance.plan_item_create', entity: 'finance_plan_items', entityId: rows[0]!.id, changes: { ...v, months } }, tx)
    return rows
  })
  return c.json({ created: rows.length }, 200)
})

financeRouter.openapi(
  secureRoute('', { method: 'patch', path: '/finance/plan-items/{id}', request: { params: idParam, body: json(planItemPatch) }, responses: ok }, perm('edit')),
  async (c) => {
    const db = c.get('deps').db
    const { id } = c.req.valid('param')
    const { version, ...v } = c.req.valid('json')
    const [cur] = await listPlanItems(db, '', id)
    if (!cur) throw notFound()
    if ((v.kind ?? cur.kind) === 'revenue') v.costCategoryId = null
    await checkRefs(db, v)
    const [row] = await db
      .update(financePlanItems)
      .set({ ...v, note: v.note === undefined ? undefined : v.note || null, updatedAt: sql`now()`, updatedBy: c.get('user').id, version: sql`${financePlanItems.version} + 1` })
      .where(and(eq(financePlanItems.id, id), eq(financePlanItems.version, version), isNull(financePlanItems.deletedAt)))
      .returning({ id: financePlanItems.id })
    if (!row) throw conflict(cur)
    await writeAudit(c, { action: 'finance.plan_item_edit', entity: 'finance_plan_items', entityId: id, changes: v })
    return c.json((await listPlanItems(db, '', id))[0], 200)
  },
)

financeRouter.openapi(secureRoute('', { method: 'delete', path: '/finance/plan-items/{id}', request: { params: idParam }, responses: ok }, perm('delete')), async (c) => {
  const { id } = c.req.valid('param')
  const [row] = await c
    .get('deps')
    .db.update(financePlanItems)
    .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
    .where(and(eq(financePlanItems.id, id), isNull(financePlanItems.deletedAt)))
    .returning({ id: financePlanItems.id, name: financePlanItems.name, month: financePlanItems.month })
  if (!row) throw notFound()
  await writeAudit(c, { action: 'finance.plan_item_delete', entity: 'finance_plan_items', entityId: id, changes: row })
  return c.json({ ok: true }, 200)
})

financeRouter.openapi(secureRoute('', { method: 'post', path: '/finance/fixed-costs', request: { body: json(fixedCostInput) }, responses: ok }, perm('create')), async (c) => {
  const db = c.get('deps').db
  const v = c.req.valid('json')
  await checkRefs(db, v)
  const userId = c.get('user').id
  const [row] = await db
    .insert(financeFixedCosts)
    .values({ ...v, endMonth: v.endMonth ?? null, projectId: v.projectId ?? null, costCategoryId: v.costCategoryId ?? null, note: v.note || null, createdBy: userId, updatedBy: userId })
    .returning({ id: financeFixedCosts.id })
  await writeAudit(c, { action: 'finance.fixed_cost_create', entity: 'finance_fixed_costs', entityId: row!.id, changes: v })
  return c.json((await listFixedCosts(db, row!.id))[0], 200)
})

financeRouter.openapi(
  secureRoute('', { method: 'patch', path: '/finance/fixed-costs/{id}', request: { params: idParam, body: json(fixedCostPatch) }, responses: ok }, perm('edit')),
  async (c) => {
    const db = c.get('deps').db
    const { id } = c.req.valid('param')
    const { version, ...v } = c.req.valid('json')
    const [cur] = await listFixedCosts(db, id)
    if (!cur) throw notFound()
    const end = v.endMonth === undefined ? cur.endMonth : v.endMonth
    if (end && end < (v.startMonth ?? cur.startMonth)) throw new HttpProblem(422, 'validation.dateRange')
    await checkRefs(db, v)
    const [row] = await db
      .update(financeFixedCosts)
      .set({ ...v, note: v.note === undefined ? undefined : v.note || null, updatedAt: sql`now()`, updatedBy: c.get('user').id, version: sql`${financeFixedCosts.version} + 1` })
      .where(and(eq(financeFixedCosts.id, id), eq(financeFixedCosts.version, version), isNull(financeFixedCosts.deletedAt)))
      .returning({ id: financeFixedCosts.id })
    if (!row) throw conflict(cur)
    await writeAudit(c, { action: 'finance.fixed_cost_edit', entity: 'finance_fixed_costs', entityId: id, changes: v })
    return c.json((await listFixedCosts(db, id))[0], 200)
  },
)

financeRouter.openapi(secureRoute('', { method: 'delete', path: '/finance/fixed-costs/{id}', request: { params: idParam }, responses: ok }, perm('delete')), async (c) => {
  const { id } = c.req.valid('param')
  const [row] = await c
    .get('deps')
    .db.update(financeFixedCosts)
    .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
    .where(and(eq(financeFixedCosts.id, id), isNull(financeFixedCosts.deletedAt)))
    .returning({ id: financeFixedCosts.id, name: financeFixedCosts.name })
  if (!row) throw notFound()
  await writeAudit(c, { action: 'finance.fixed_cost_delete', entity: 'finance_fixed_costs', entityId: id, changes: row })
  return c.json({ ok: true }, 200)
})
