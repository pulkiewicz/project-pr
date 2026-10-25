import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { COMPONENT_CATEGORIES, componentInput, componentPatch, isPriceStale, type Action, type ComponentDto } from '#shared'
import type { AppEnv } from '../../context.ts'
import { components } from '../../db/schema.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { loadSettings } from '../quotes/service.ts'

/** Katalog komponentów (Baza wiedzy, D4): ceny widoczne z `quotesCost:view`, zmiana cen — `quotesCost:edit`. */
export const catalogRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'quoteKnowledge', action } })

async function list(c: Context<AppEnv>, id?: string): Promise<ComponentDto[]> {
  const db = c.get('deps').db
  const settings = await loadSettings(db)
  const today = todayWarsaw(c.get('deps').now?.() ?? new Date())
  const canSee = c.get('permissions').has('quotesCost:view')
  const rows = await db
    .select()
    .from(components)
    .where(and(isNull(components.deletedAt), id ? eq(components.id, id) : undefined))
    .orderBy(asc(components.category), asc(components.capacityW), asc(components.name))
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    manufacturer: r.manufacturer,
    partNo: r.partNo,
    supplier: r.supplier,
    unit: r.unit,
    price: canSee ? r.price : null,
    priceDate: r.priceDate,
    priceStale: r.price != null && isPriceStale(r.priceDate, today, settings.priceMaxAgeMonths),
    capacityW: r.capacityW,
    evapTempC: r.evapTempC,
    refrigerant: r.refrigerant,
    notes: r.notes,
    version: r.version,
    updatedAt: r.updatedAt,
  }))
}

function assertPriceEdit(c: Context<AppEnv>, input: { price?: number | null }) {
  if (input.price !== undefined && !c.get('permissions').has('quotesCost:edit')) throw forbidden('cost_forbidden')
}

catalogRouter.openapi(
  route({ method: 'get', path: '/components', request: { query: z.object({ category: z.enum(COMPONENT_CATEGORIES).optional() }) }, responses: ok }, 'view'),
  async (c) => {
    const { category } = c.req.valid('query')
    const all = await list(c)
    return c.json(category ? all.filter((x) => x.category === category) : all, 200)
  },
)

catalogRouter.openapi(route({ method: 'post', path: '/components', request: { body: body(componentInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, 'create'), async (c) => {
  const input = c.req.valid('json')
  assertPriceEdit(c, input)
  const user = c.get('user')
  const id = await c.get('deps').db.transaction(async (tx) => {
    const [r] = await tx.insert(components).values({ ...input, createdBy: user.id, updatedBy: user.id }).returning({ id: components.id })
    await writeAudit(c, { action: 'catalog.create', entity: 'components', entityId: r!.id, changes: input }, tx)
    return r!.id
  })
  return c.json((await list(c, id))[0], 201)
})

catalogRouter.openapi(route({ method: 'patch', path: '/components/{id}', request: { params: idParam, body: body(componentPatch) }, responses: ok }, 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const { version, ...patch } = c.req.valid('json')
  assertPriceEdit(c, patch)
  const db = c.get('deps').db
  const [current] = await db.select().from(components).where(and(eq(components.id, id), isNull(components.deletedAt)))
  if (!current) throw notFound()
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(components)
      .set({ ...patch, version: sql`${components.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
      .where(and(eq(components.id, id), eq(components.version, version)))
      .returning({ id: components.id })
    if (r) await writeAudit(c, { action: 'catalog.update', entity: 'components', entityId: id, changes: diffFields(current, patch) }, tx)
    return r
  })
  const [dto] = await list(c, id)
  if (!updated) throw conflict(dto ?? null)
  return c.json(dto, 200)
})

catalogRouter.openapi(route({ method: 'delete', path: '/components/{id}', request: { params: idParam }, responses: ok }, 'delete'), async (c) => {
  const { id } = c.req.valid('param')
  await c.get('deps').db.transaction(async (tx) => {
    const [r] = await tx
      .update(components)
      .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
      .where(and(eq(components.id, id), isNull(components.deletedAt)))
      .returning({ name: components.name })
    if (!r) throw notFound()
    await writeAudit(c, { action: 'catalog.delete', entity: 'components', entityId: id, changes: { name: r.name } }, tx)
  })
  return c.json({ ok: true }, 200)
})
