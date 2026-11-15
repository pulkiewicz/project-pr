import { asc, eq } from 'drizzle-orm'
import { evaluateBom, type BomAckDto, type BomCheckDto, type BomContext, type BomRuleDto, type QuoteDeviceDto, type SpecValue } from '#shared'
import type { Database } from '../../db/client.ts'
import { quoteBomAcks, quoteBomRules, quotes, users } from '../../db/schema.ts'
import { getChecklist } from './checklist.ts'

/** W3 — ocena kompletności kosztorysu (bez zależności od tras, używana w `getQuote` i przy zatwierdzaniu). */
type RuleRow = typeof quoteBomRules.$inferSelect
const toRuleDto = (r: RuleRow): BomRuleDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  active: r.active,
  when: r.when,
  require: { section: r.require.section ?? null, keywords: r.require.keywords, positiveCost: r.require.positiveCost },
  suggestion: r.suggestion ?? null,
  exceptionLabel: r.exceptionLabel,
  sortOrder: r.sortOrder,
  updatedAt: r.updatedAt,
})

export async function listBomRules(db: Database): Promise<BomRuleDto[]> {
  return (await db.select().from(quoteBomRules).orderBy(asc(quoteBomRules.sortOrder), asc(quoteBomRules.createdAt))).map(toRuleDto)
}

/** Ocena kompletności wyceny (pełne drzewo kosztów, niezależnie od uprawnień oglądającego). */
export async function bomCheck(db: Database, quote: typeof quotes.$inferSelect, devices: QuoteDeviceDto[]): Promise<BomCheckDto> {
  const rules = await listBomRules(db)
  const checklist = new Map<string, { label: string; value: SpecValue | null }>()
  if (rules.some((r) => r.active && r.when.some((c) => c.kind === 'checklist'))) {
    for (const i of (await getChecklist(db, quote)).items) if (i.status !== 'na') checklist.set(i.key, { label: i.label, value: i.value })
  }
  const lines = devices.flatMap((d) =>
    d.sections.flatMap((s) => s.lines.map((l) => ({ name: l.name, group: l.group, section: s.name, cost: l.cost ?? 0, counted: d.included && !d.isOption }))),
  )
  const ctx: BomContext = { flags: quote.bomFlags ?? [], checklist, lines }
  const ackRows = await db
    .select({ key: quoteBomAcks.issueKey, reason: quoteBomAcks.reason, at: quoteBomAcks.createdAt, byName: users.name })
    .from(quoteBomAcks)
    .leftJoin(users, eq(users.id, quoteBomAcks.createdBy))
    .where(eq(quoteBomAcks.quoteId, quote.id))
  const acks = new Map<string, BomAckDto>(ackRows.map((a) => [a.key, { reason: a.reason, byName: a.byName, at: a.at }]))
  return evaluateBom(rules, ctx, acks)
}

/** Kopia flag i akceptacji przy nowej rewizji (kopii). */
export async function copyBom(tx: Database, fromId: string, toId: string) {
  const [from] = await tx.select({ flags: quotes.bomFlags }).from(quotes).where(eq(quotes.id, fromId))
  await tx.update(quotes).set({ bomFlags: from?.flags ?? [] }).where(eq(quotes.id, toId))
  const acks = await tx.select().from(quoteBomAcks).where(eq(quoteBomAcks.quoteId, fromId))
  if (acks.length) await tx.insert(quoteBomAcks).values(acks.map(({ id: _id, quoteId: _q, ...a }) => ({ ...a, quoteId: toId })))
}

