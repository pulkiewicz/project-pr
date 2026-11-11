import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { DEFAULT_PARAMS, QUOTE_EDITABLE, quoteApplyProfileInput, quoteRejectInput, type Action, type OpportunityStage } from '#shared'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { crmActivities, opportunities, quoteDevices, quotes } from '../../db/schema.ts'
import { HttpProblem, conflict } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { assertKind, copyTree, getQuote, getQuoteRow } from './service.ts'

/** Odrzucenie wyceny (z przyczyną; szansa → „Porzucona wycena”), przywrócenie oraz zmiana profilu wyceny (krok 7). */
export const quoteStatusRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'quotes', action } })
const respond = async (c: Context<AppEnv>, id: string) => c.json(await getQuote(c.get('deps').db, c.get('permissions'), id), 200)

/** Zmiana etapu szansy z wpisem w historii CRM (jak przy zmianie etapu w lejku). */
async function moveOpportunity(c: Context<AppEnv>, tx: Database, opportunityId: string | null, to: OpportunityStage, note: string, quoteId: string, only?: OpportunityStage) {
  if (!opportunityId) return
  const [o] = await tx.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, opportunityId))
  if (!o || o.stage === to || (only && o.stage !== only)) return
  const user = c.get('user')
  await tx
    .update(opportunities)
    .set({ stage: to, stageChangedAt: sql`now()`, version: sql`${opportunities.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
    .where(eq(opportunities.id, opportunityId))
  const meta = { from: o.stage, to, quoteId }
  await tx.insert(crmActivities).values({ opportunityId, kind: 'stage_change', body: note, meta, userId: user.id })
  await writeAudit(c, { action: 'crm.opportunity_stage', entity: 'opportunities', entityId: opportunityId, changes: meta }, tx)
}

quoteStatusRouter.openapi(route({ method: 'post', path: '/quotes/{id}/reject', request: { params: idParam, body: body(quoteRejectInput) }, responses: ok }, 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const { reason, version } = c.req.valid('json')
  const db = c.get('deps').db
  const q = await getQuoteRow(db, id)
  if (q.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
  if (q.status === 'rejected') throw new HttpProblem(422, 'quote_status_not_allowed', 'rejected → rejected')
  const user = c.get('user')
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(quotes)
      .set({ status: 'rejected', rejectReason: reason, rejectedAt: sql`now()`, rejectedBy: user.id, version: sql`${quotes.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
      .where(and(eq(quotes.id, id), eq(quotes.version, version)))
      .returning({ id: quotes.id })
    if (!r) return null
    await writeAudit(c, { action: 'quote.reject', entity: 'quotes', entityId: id, changes: { from: q.status, reason } }, tx)
    await moveOpportunity(c, tx, q.opportunityId, 'abandoned', `Wycena rew. ${q.revision ?? ''} odrzucona: ${reason}`, id)
    return r
  })
  if (!updated) throw conflict(await getQuote(db, c.get('permissions'), id))
  return respond(c, id)
})

/** Etap szansy sprzed odrzucenia tej wyceny (z historii CRM); domyślnie „W wycenie”. */
async function stageBeforeReject(tx: Database, opportunityId: string | null, quoteId: string): Promise<OpportunityStage> {
  if (!opportunityId) return 'quoting'
  const [a] = await tx
    .select({ meta: crmActivities.meta })
    .from(crmActivities)
    .where(and(eq(crmActivities.opportunityId, opportunityId), eq(crmActivities.kind, 'stage_change'), sql`${crmActivities.meta}->>'quoteId' = ${quoteId}`, sql`${crmActivities.meta}->>'to' = 'abandoned'`))
    .orderBy(desc(crmActivities.occurredAt))
    .limit(1)
  const from = (a?.meta as { from?: OpportunityStage } | null)?.from
  return from && from !== 'abandoned' ? from : 'quoting'
}

/** Przywrócenie odrzuconej wyceny do roboczej; szansa wraca z „Porzucona wycena” do etapu sprzed odrzucenia. */
quoteStatusRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/reopen', request: { params: idParam, body: body(z.object({ version: z.number().int() })) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { version } = c.req.valid('json')
    const db = c.get('deps').db
    const q = await getQuoteRow(db, id)
    if (q.status !== 'rejected') throw new HttpProblem(422, 'quote_status_not_allowed', `${q.status} → draft`)
    const user = c.get('user')
    const updated = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(quotes)
        .set({ status: 'draft', rejectReason: null, rejectedAt: null, rejectedBy: null, approvedAt: null, approvedBy: null, version: sql`${quotes.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(quotes.id, id), eq(quotes.version, version)))
        .returning({ id: quotes.id })
      if (!r) return null
      await writeAudit(c, { action: 'quote.reopen', entity: 'quotes', entityId: id, changes: { reason: q.rejectReason } }, tx)
      await moveOpportunity(c, tx, q.opportunityId, await stageBeforeReject(tx, q.opportunityId, id), `Wycena rew. ${q.revision ?? ''} przywrócona`, id, 'abandoned')
      return r
    })
    if (!updated) throw conflict(await getQuote(db, c.get('permissions'), id))
    return respond(c, id)
  },
)

/** Zmiana profilu: urządzenia, sekcje i pozycje oraz parametry (marża, złożoność, gwarancja) z wybranego profilu. */
quoteStatusRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/apply-profile', request: { params: idParam, body: body(quoteApplyProfileInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { profileId, version } = c.req.valid('json')
    const db = c.get('deps').db
    const perms = c.get('permissions')
    const q = await getQuoteRow(db, id)
    if (q.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
    if (!QUOTE_EDITABLE.includes(q.status)) throw new HttpProblem(409, 'quote_locked', q.status)
    const profile = await getQuoteRow(db, profileId)
    if (profile.kind !== 'profile') throw new HttpProblem(422, 'not_a_profile')
    assertKind(perms, 'profile', 'view')
    const user = c.get('user')
    const updated = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(quotes)
        .set({
          basedOnId: profile.id,
          basedOnLabel: `Profil: ${profile.name ?? ''}`,
          params: { ...DEFAULT_PARAMS, ...profile.params },
          version: sql`${quotes.version} + 1`,
          updatedAt: sql`now()`,
          updatedBy: user.id,
        })
        .where(and(eq(quotes.id, id), eq(quotes.version, version)))
        .returning({ id: quotes.id })
      if (!r) return null
      // Urządzenia z kaskadą: sekcje, pozycje i sugestie AI; kalkulacje tracą tylko powiązanie z urządzeniem.
      await tx.delete(quoteDevices).where(eq(quoteDevices.quoteId, id))
      await copyTree(tx, profile.id, id, 'profile')
      await writeAudit(c, { action: 'quote.apply_profile', entity: 'quotes', entityId: id, changes: { from: q.basedOnLabel, to: profile.name, profileId } }, tx)
      return r
    })
    if (!updated) throw conflict(await getQuote(db, perms, id))
    return respond(c, id)
  },
)
