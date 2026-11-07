import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, sql } from 'drizzle-orm'
import { requiredDocInput, requiredDocPatch, type Action, type ModuleKey, type RequiredDocDto } from '#shared'
import type { Database } from '../../db/client.ts'
import { quoteRequiredDocs } from '../../db/schema.ts'
import { HttpProblem, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { assertEditable, getQuoteRow, touch } from './service.ts'

/** Krok 3 przepływu wyceny: lista dokumentów wymaganych do złożenia oferty (z SIWZ — AI — lub ręcznie). */
export const formalRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const docParam = idParam.extend({ docId: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

export async function listRequiredDocs(db: Database, quoteId: string): Promise<RequiredDocDto[]> {
  const rows = await db.select().from(quoteRequiredDocs).where(eq(quoteRequiredDocs.quoteId, quoteId)).orderBy(asc(quoteRequiredDocs.sortOrder), asc(quoteRequiredDocs.createdAt))
  return rows.map((r) => ({ id: r.id, name: r.name, note: r.note, status: r.status, source: r.source, sourceRef: r.sourceRef, sortOrder: r.sortOrder, updatedAt: r.updatedAt }))
}

/** Kopia listy przy nowej rewizji — statusy zostają (dokumenty zwykle są te same). */
export async function copyRequiredDocs(tx: Database, fromQuoteId: string, toQuoteId: string) {
  const docs = await tx.select().from(quoteRequiredDocs).where(eq(quoteRequiredDocs.quoteId, fromQuoteId))
  if (!docs.length) return
  await tx.insert(quoteRequiredDocs).values(docs.map(({ id: _id, quoteId: _q, createdAt: _c, updatedAt: _u, ...d }) => ({ ...d, quoteId: toQuoteId })))
}

async function quoteOnly(db: Database, id: string) {
  const q = await getQuoteRow(db, id)
  if (q.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
  return q
}

formalRouter.openapi(route({ method: 'get', path: '/quotes/{id}/required-docs', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const db = c.get('deps').db
  const { id } = c.req.valid('param')
  await quoteOnly(db, id)
  return c.json(await listRequiredDocs(db, id), 200)
})

formalRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/required-docs', request: { params: idParam, body: body(requiredDocInput) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    await quoteOnly(db, id)
    await assertEditable(db, c.get('permissions'), id)
    const user = c.get('user')
    await db.transaction(async (tx) => {
      const [{ max } = { max: -1 }] = await tx.select({ max: sql<number>`coalesce(max(${quoteRequiredDocs.sortOrder}), -1)::int` }).from(quoteRequiredDocs).where(eq(quoteRequiredDocs.quoteId, id))
      await tx.insert(quoteRequiredDocs).values({ quoteId: id, name: input.name, note: input.note ?? null, status: input.status, source: 'manual', sortOrder: max + 1, updatedBy: user.id })
      await touch(tx, id, user.id)
      await writeAudit(c, { action: 'quote.required_doc_add', entity: 'quotes', entityId: id, changes: { name: input.name } }, tx)
    })
    return c.json(await listRequiredDocs(db, id), 200)
  },
)

formalRouter.openapi(
  route({ method: 'patch', path: '/quotes/{id}/required-docs/{docId}', request: { params: docParam, body: body(requiredDocPatch) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id, docId } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    await quoteOnly(db, id)
    await assertEditable(db, c.get('permissions'), id)
    const user = c.get('user')
    await db.transaction(async (tx) => {
      const [r] = await tx
        .update(quoteRequiredDocs)
        .set({ ...input, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(quoteRequiredDocs.id, docId), eq(quoteRequiredDocs.quoteId, id)))
        .returning({ id: quoteRequiredDocs.id })
      if (!r) throw notFound('required_doc_not_found')
      await touch(tx, id, user.id)
      await writeAudit(c, { action: 'quote.required_doc_update', entity: 'quotes', entityId: id, changes: { docId, ...input } }, tx)
    })
    return c.json(await listRequiredDocs(db, id), 200)
  },
)

formalRouter.openapi(route({ method: 'delete', path: '/quotes/{id}/required-docs/{docId}', request: { params: docParam }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id, docId } = c.req.valid('param')
  const db = c.get('deps').db
  await quoteOnly(db, id)
  await assertEditable(db, c.get('permissions'), id)
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(quoteRequiredDocs).where(and(eq(quoteRequiredDocs.id, docId), eq(quoteRequiredDocs.quoteId, id))).returning({ name: quoteRequiredDocs.name })
    if (!r) throw notFound('required_doc_not_found')
    await touch(tx, id, c.get('user').id)
    await writeAudit(c, { action: 'quote.required_doc_delete', entity: 'quotes', entityId: id, changes: { docId, name: r.name } }, tx)
  })
  return c.json(await listRequiredDocs(db, id), 200)
})
