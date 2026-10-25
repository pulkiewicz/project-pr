import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  calcSaveInput,
  checklistItemInput,
  computeCalc,
  customRequirementInput,
  specListInput,
  type Action,
  type ModuleKey,
  type QuoteCalcDto,
  type SpecItemDef,
  type SpecValue,
} from '#shared'
import type { Database } from '../../db/client.ts'
import { quoteCalcs, quoteChecklistItems, quoteDevices, specListVersions, users } from '../../db/schema.ts'
import { HttpProblem, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { CUSTOM_PREFIX, getChecklist, latestSpecList, listSpecVersions, pinSpecList, specListFor } from './checklist.ts'
import { assertEditable, getQuoteRow, touch } from './service.ts'

export const specRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const keyParam = idParam.extend({ key: z.string().min(1).max(100) })
const calcParam = idParam.extend({ calcId: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

// ---------------- Lista specyfikacyjna (Baza wiedzy, wersjonowana) ----------------

specRouter.openapi(route({ method: 'get', path: '/spec-list', responses: ok }, 'quotes', 'view'), async (c) => c.json(await listSpecVersions(c.get('deps').db), 200))

specRouter.openapi(route({ method: 'post', path: '/spec-list', request: { body: body(specListInput) }, responses: ok }, 'quoteKnowledge', 'edit'), async (c) => {
  const input = c.req.valid('json')
  const db = c.get('deps').db
  const prev = await latestSpecList(db)
  const version = await db.transaction(async (tx) => {
    const [v] = await tx
      .insert(specListVersions)
      .values({ version: prev.version + 1, items: input.items, notes: input.notes ?? null, createdBy: c.get('user').id })
      .returning({ id: specListVersions.id, version: specListVersions.version })
    const prevKeys = new Set(prev.items.map((i) => i.key))
    const nextKeys = new Set(input.items.map((i) => i.key))
    await writeAudit(c, {
      action: 'spec_list.version',
      entity: 'spec_list_versions',
      entityId: v!.id,
      changes: { version: v!.version, added: [...nextKeys].filter((k) => !prevKeys.has(k)), removed: [...prevKeys].filter((k) => !nextKeys.has(k)) },
    }, tx)
    return v!.version
  })
  return c.json((await listSpecVersions(db)).find((v) => v.version === version), 200)
})

// ---------------- Checklista wyceny (krok 3) ----------------

async function quoteOnly(db: Database, id: string) {
  const q = await getQuoteRow(db, id)
  if (q.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
  return q
}

const VALUE_SHAPE: Record<SpecItemDef['type'], string> = { text: 't', number: 'n', range: 'min', dims: 'w', choice: 'v', bool: 'b' }

function assertValue(def: Pick<SpecItemDef, 'type' | 'options'>, value: SpecValue | null | undefined) {
  if (value == null) return
  if (!(VALUE_SHAPE[def.type] in value)) throw new HttpProblem(422, 'checklist_value_type', def.type)
  if (def.type === 'choice' && def.options?.length && 'v' in value && !def.options.includes(value.v)) throw new HttpProblem(422, 'checklist_value_option', value.v)
}

specRouter.openapi(route({ method: 'get', path: '/quotes/{id}/checklist', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const db = c.get('deps').db
  return c.json(await getChecklist(db, await quoteOnly(db, c.req.valid('param').id)), 200)
})

specRouter.openapi(
  route({ method: 'put', path: '/quotes/{id}/checklist/{key}', request: { params: keyParam, body: body(checklistItemInput) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id, key } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const q = await quoteOnly(db, id)
    await assertEditable(db, c.get('permissions'), id)
    const spec = await specListFor(db, q)
    const isCustom = key.startsWith(CUSTOM_PREFIX)
    const def = isCustom ? null : spec.items.find((i) => i.key === key)
    if (!isCustom && !def) throw notFound('checklist_item_not_found')
    if (def) assertValue(def, input.value)
    if (isCustom) {
      const [existing] = await db.select({ id: quoteChecklistItems.id }).from(quoteChecklistItems).where(and(eq(quoteChecklistItems.quoteId, id), eq(quoteChecklistItems.key, key)))
      if (!existing) throw notFound('checklist_item_not_found')
      if (input.value && !('t' in input.value)) throw new HttpProblem(422, 'checklist_value_type', 'text')
    }
    const user = c.get('user')
    await db.transaction(async (tx) => {
      await pinSpecList(tx, q)
      const set = {
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
        updatedAt: sql`now()`,
        updatedBy: user.id,
      }
      const sortOrder = def ? spec.items.indexOf(def) : 1000
      await tx
        .insert(quoteChecklistItems)
        .values({ quoteId: id, key, sortOrder, value: input.value ?? null, status: input.status ?? 'pending', note: input.note ?? null, sourceRef: input.sourceRef ?? null, updatedBy: user.id })
        .onConflictDoUpdate({ target: [quoteChecklistItems.quoteId, quoteChecklistItems.key], set })
      await touch(tx, id, user.id)
      await writeAudit(c, { action: 'quote.checklist', entity: 'quotes', entityId: id, changes: { key, ...input } }, tx)
    })
    return c.json(await getChecklist(db, await getQuoteRow(db, id)), 200)
  },
)

specRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/checklist/custom', request: { params: idParam, body: body(customRequirementInput) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const q = await quoteOnly(db, id)
    await assertEditable(db, c.get('permissions'), id)
    const user = c.get('user')
    await db.transaction(async (tx) => {
      await pinSpecList(tx, q)
      const key = `${CUSTOM_PREFIX}${crypto.randomUUID()}`
      await tx.insert(quoteChecklistItems).values({
        quoteId: id,
        key,
        label: input.label,
        group: input.group || 'Wymagania dodatkowe',
        value: input.value ? { t: input.value } : null,
        sortOrder: 1000,
        updatedBy: user.id,
      })
      await touch(tx, id, user.id)
      await writeAudit(c, { action: 'quote.checklist_custom', entity: 'quotes', entityId: id, changes: { key, label: input.label } }, tx)
    })
    return c.json(await getChecklist(db, await getQuoteRow(db, id)), 200)
  },
)

specRouter.openapi(route({ method: 'delete', path: '/quotes/{id}/checklist/{key}', request: { params: keyParam }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id, key } = c.req.valid('param')
  const db = c.get('deps').db
  await quoteOnly(db, id)
  await assertEditable(db, c.get('permissions'), id)
  if (!key.startsWith(CUSTOM_PREFIX)) throw new HttpProblem(422, 'checklist_item_not_custom')
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(quoteChecklistItems).where(and(eq(quoteChecklistItems.quoteId, id), eq(quoteChecklistItems.key, key))).returning({ label: quoteChecklistItems.label })
    if (!r) throw notFound('checklist_item_not_found')
    await touch(tx, id, c.get('user').id)
    await writeAudit(c, { action: 'quote.checklist_custom_delete', entity: 'quotes', entityId: id, changes: { key, label: r.label } }, tx)
  })
  return c.json(await getChecklist(db, await getQuoteRow(db, id)), 200)
})

// ---------------- Kalkulator mocy w wycenie ----------------

async function listCalcs(db: Database, quoteId: string): Promise<QuoteCalcDto[]> {
  const rows = await db
    .select({ k: quoteCalcs, updatedByName: users.name })
    .from(quoteCalcs)
    .leftJoin(users, eq(users.id, quoteCalcs.updatedBy))
    .where(eq(quoteCalcs.quoteId, quoteId))
    .orderBy(asc(quoteCalcs.name))
  return rows.map(({ k, updatedByName }) => ({ id: k.id, name: k.name, deviceId: k.deviceId, input: k.input, result: computeCalc(k.input), updatedAt: k.updatedAt, updatedByName }))
}

async function assertDevice(db: Database, quoteId: string, deviceId: string | null | undefined) {
  if (!deviceId) return
  const [d] = await db.select({ id: quoteDevices.id }).from(quoteDevices).where(and(eq(quoteDevices.id, deviceId), eq(quoteDevices.quoteId, quoteId)))
  if (!d) throw new HttpProblem(422, 'device_not_found')
}

specRouter.openapi(route({ method: 'get', path: '/quotes/{id}/calcs', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const db = c.get('deps').db
  const { id } = c.req.valid('param')
  await quoteOnly(db, id)
  return c.json(await listCalcs(db, id), 200)
})

specRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/calcs', request: { params: idParam, body: body(calcSaveInput) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    await quoteOnly(db, id)
    await assertEditable(db, c.get('permissions'), id)
    await assertDevice(db, id, input.deviceId)
    const user = c.get('user')
    await db.transaction(async (tx) => {
      const [k] = await tx.insert(quoteCalcs).values({ quoteId: id, deviceId: input.deviceId ?? null, name: input.name, input: input.input, updatedBy: user.id }).returning({ id: quoteCalcs.id })
      await touch(tx, id, user.id)
      await writeAudit(c, { action: 'quote.calc_create', entity: 'quotes', entityId: id, changes: { calcId: k!.id, name: input.name, totalW: computeCalc(input.input).totalW } }, tx)
    })
    return c.json(await listCalcs(db, id), 200)
  },
)

specRouter.openapi(
  route({ method: 'put', path: '/quotes/{id}/calcs/{calcId}', request: { params: calcParam, body: body(calcSaveInput) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id, calcId } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    await assertEditable(db, c.get('permissions'), id)
    await assertDevice(db, id, input.deviceId)
    const user = c.get('user')
    await db.transaction(async (tx) => {
      const [r] = await tx
        .update(quoteCalcs)
        .set({ name: input.name, deviceId: input.deviceId ?? null, input: input.input, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(quoteCalcs.id, calcId), eq(quoteCalcs.quoteId, id)))
        .returning({ id: quoteCalcs.id })
      if (!r) throw notFound()
      await touch(tx, id, user.id)
      await writeAudit(c, { action: 'quote.calc_update', entity: 'quotes', entityId: id, changes: { calcId, totalW: computeCalc(input.input).totalW } }, tx)
    })
    return c.json(await listCalcs(db, id), 200)
  },
)

specRouter.openapi(route({ method: 'delete', path: '/quotes/{id}/calcs/{calcId}', request: { params: calcParam }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id, calcId } = c.req.valid('param')
  const db = c.get('deps').db
  await assertEditable(db, c.get('permissions'), id)
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(quoteCalcs).where(and(eq(quoteCalcs.id, calcId), eq(quoteCalcs.quoteId, id))).returning({ name: quoteCalcs.name })
    if (!r) throw notFound()
    await touch(tx, id, c.get('user').id)
    await writeAudit(c, { action: 'quote.calc_delete', entity: 'quotes', entityId: id, changes: { calcId, name: r.name } }, tx)
  })
  return c.json(await listCalcs(db, id), 200)
})

/** Nowa rewizja przejmuje kalkulacje (urządzenia dopasowane po kolejności). */
export async function copyCalcs(tx: Database, fromQuoteId: string, toQuoteId: string) {
  const calcs = await tx.select().from(quoteCalcs).where(eq(quoteCalcs.quoteId, fromQuoteId))
  if (!calcs.length) return
  const [fromDevs, toDevs] = await Promise.all([
    tx.select({ id: quoteDevices.id }).from(quoteDevices).where(eq(quoteDevices.quoteId, fromQuoteId)).orderBy(asc(quoteDevices.sortOrder)),
    tx.select({ id: quoteDevices.id }).from(quoteDevices).where(eq(quoteDevices.quoteId, toQuoteId)).orderBy(asc(quoteDevices.sortOrder)),
  ])
  const map = new Map(fromDevs.map((d, i) => [d.id, toDevs[i]?.id ?? null]))
  await tx.insert(quoteCalcs).values(calcs.map(({ id: _id, quoteId: _q, deviceId, ...k }) => ({ ...k, quoteId: toQuoteId, deviceId: deviceId ? (map.get(deviceId) ?? null) : null })))
}

