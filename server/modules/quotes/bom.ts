import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, eq, sql } from 'drizzle-orm'
import { bomAckInput, bomFlagsInput, bomRuleInput, bomRulePatch, type Action, type ModuleKey } from '#shared'
import type { Database } from '../../db/client.ts'
import { quoteBomAcks, quoteBomRules, quotes } from '../../db/schema.ts'
import { HttpProblem, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { listBomRules } from './bom-check.ts'
import { assertEditable, getQuote, getQuoteRow, touch } from './service.ts'

/** W3 — kompletność kosztorysu: reguły (Baza wiedzy), flagi architektury i akceptacje alertów w wycenie. */
export const bomRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

// ---------------- Reguły (Baza wiedzy) ----------------

bomRouter.openapi(route({ method: 'get', path: '/quote-bom-rules', responses: ok }, 'quoteKnowledge', 'view'), async (c) => c.json(await listBomRules(c.get('deps').db), 200))

bomRouter.openapi(route({ method: 'post', path: '/quote-bom-rules', request: { body: body(bomRuleInput) }, responses: ok }, 'quoteKnowledge', 'edit'), async (c) => {
  const input = c.req.valid('json')
  const db = c.get('deps').db
  await db.transaction(async (tx) => {
    const [{ max } = { max: -1 }] = await tx.select({ max: sql<number>`coalesce(max(${quoteBomRules.sortOrder}), -1)::int` }).from(quoteBomRules)
    const [r] = await tx
      .insert(quoteBomRules)
      .values({ ...input, description: input.description ?? null, suggestion: input.suggestion ?? null, exceptionLabel: input.exceptionLabel ?? null, sortOrder: max + 1, updatedBy: c.get('user').id })
      .returning({ id: quoteBomRules.id })
    await writeAudit(c, { action: 'quotes.bom_rule_create', entity: 'quote_bom_rules', entityId: r!.id, changes: input }, tx)
  })
  return c.json(await listBomRules(db), 200)
})

bomRouter.openapi(
  route({ method: 'patch', path: '/quote-bom-rules/{id}', request: { params: idParam, body: body(bomRulePatch) }, responses: ok }, 'quoteKnowledge', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    await db.transaction(async (tx) => {
      const [r] = await tx.update(quoteBomRules).set({ ...input, updatedAt: sql`now()`, updatedBy: c.get('user').id }).where(eq(quoteBomRules.id, id)).returning({ id: quoteBomRules.id })
      if (!r) throw notFound('bom_rule_not_found')
      await writeAudit(c, { action: 'quotes.bom_rule_update', entity: 'quote_bom_rules', entityId: id, changes: input }, tx)
    })
    return c.json(await listBomRules(db), 200)
  },
)

bomRouter.openapi(route({ method: 'delete', path: '/quote-bom-rules/{id}', request: { params: idParam }, responses: ok }, 'quoteKnowledge', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const db = c.get('deps').db
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(quoteBomRules).where(eq(quoteBomRules.id, id)).returning({ name: quoteBomRules.name })
    if (!r) throw notFound('bom_rule_not_found')
    await writeAudit(c, { action: 'quotes.bom_rule_delete', entity: 'quote_bom_rules', entityId: id, changes: { name: r.name } }, tx)
  })
  return c.json(await listBomRules(db), 200)
})

// ---------------- Wycena: flagi architektury i akceptacje ----------------

async function quoteOnly(db: Database, id: string) {
  const q = await getQuoteRow(db, id)
  if (q.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
  return q
}

bomRouter.openapi(route({ method: 'put', path: '/quotes/{id}/bom/flags', request: { params: idParam, body: body(bomFlagsInput) }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const { flags } = c.req.valid('json')
  const db = c.get('deps').db
  await quoteOnly(db, id)
  await assertEditable(db, c.get('permissions'), id)
  const uniq = [...new Set(flags)]
  await db.transaction(async (tx) => {
    await tx.update(quotes).set({ bomFlags: uniq }).where(eq(quotes.id, id))
    await touch(tx, id, c.get('user').id)
    await writeAudit(c, { action: 'quote.bom_flags', entity: 'quotes', entityId: id, changes: { flags: uniq } }, tx)
  })
  return c.json(await getQuote(db, c.get('permissions'), id), 200)
})

bomRouter.openapi(route({ method: 'post', path: '/quotes/{id}/bom/acks', request: { params: idParam, body: body(bomAckInput) }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const { issueKey, reason } = c.req.valid('json')
  const db = c.get('deps').db
  await quoteOnly(db, id)
  await assertEditable(db, c.get('permissions'), id)
  const user = c.get('user')
  await db.transaction(async (tx) => {
    await tx
      .insert(quoteBomAcks)
      .values({ quoteId: id, issueKey, reason, createdBy: user.id })
      .onConflictDoUpdate({ target: [quoteBomAcks.quoteId, quoteBomAcks.issueKey], set: { reason, createdBy: user.id, createdAt: sql`now()` } })
    await touch(tx, id, user.id)
    await writeAudit(c, { action: 'quote.bom_ack', entity: 'quotes', entityId: id, changes: { issueKey, reason } }, tx)
  })
  return c.json(await getQuote(db, c.get('permissions'), id), 200)
})

bomRouter.openapi(
  route({ method: 'delete', path: '/quotes/{id}/bom/acks/{issueKey}', request: { params: idParam.extend({ issueKey: z.string().min(1).max(100) }) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id, issueKey } = c.req.valid('param')
    const db = c.get('deps').db
    await quoteOnly(db, id)
    await assertEditable(db, c.get('permissions'), id)
    await db.transaction(async (tx) => {
      const [r] = await tx.delete(quoteBomAcks).where(and(eq(quoteBomAcks.quoteId, id), eq(quoteBomAcks.issueKey, issueKey))).returning({ reason: quoteBomAcks.reason })
      if (!r) throw notFound()
      await touch(tx, id, c.get('user').id)
      await writeAudit(c, { action: 'quote.bom_ack_delete', entity: 'quotes', entityId: id, changes: { issueKey, reason: r.reason } }, tx)
    })
    return c.json(await getQuote(db, c.get('permissions'), id), 200)
  },
)
