import { and, asc, eq } from 'drizzle-orm'
import {
  DEFAULT_PARAMS,
  computeCalc,
  evaluateBom,
  finalizeChecks,
  formatSpecValue,
  quoteMode,
  quoteChecks,
  type BomAckDto,
  type BomCheckDto,
  type BomContext,
  type BomRuleDto,
  type Dims,
  type QuoteDeviceDto,
  type QuoteSettings,
  type SpecValue,
} from '#shared'
import type { Database } from '../../db/client.ts'
import { quoteBomAcks, quoteBomRules, quoteCalcs, quoteQuestions, quotes, users } from '../../db/schema.ts'
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

/** Pozycje checklisty pokazywane jako twarde wymogi do bilansu cieplnego i doboru technologii (W2). */
const REQUIREMENT_KEYS = ['temp_range', 'rate', 'rate_standard', 'heat_compensation', 'humidity_range', 'humidity_temp_range', 'sample_mass', 'sample_material', 'inner_dims', 'heat_rejection', 'cooling_type']

/**
 * Kompletność kosztorysu (W3) + walidatory wyceny (W1/W2/W4/W5) z akceptacjami; liczone na pełnym drzewie kosztów,
 * niezależnie od uprawnień oglądającego (kwot nie zwraca — tylko opisy alertów).
 */
export async function bomCheck(
  db: Database,
  quote: typeof quotes.$inferSelect,
  devices: QuoteDeviceDto[],
  price: { net: number | null; gross: number | null },
  settings: Pick<QuoteSettings, 'blockedCerts' | 'standardLeadDays' | 'customMarginMin'>,
): Promise<BomCheckDto> {
  const rules = await listBomRules(db)
  const checklist = new Map<string, { label: string; value: SpecValue | null }>()
  const units = new Map<string, string | null>()
  for (const i of (await getChecklist(db, quote)).items)
    if (i.status !== 'na') {
      checklist.set(i.key, { label: i.label, value: i.value })
      units.set(i.key, i.unit)
    }
  const lines = devices.flatMap((d) =>
    d.sections.flatMap((s) => s.lines.map((l) => ({ name: l.name, group: l.group, section: s.name, cost: l.cost ?? 0, counted: d.included && !d.isOption }))),
  )
  const ctx: BomContext = { flags: quote.bomFlags ?? [], checklist, lines }
  const [ackRows, calcRows, critical] = await Promise.all([
    db
      .select({ key: quoteBomAcks.issueKey, reason: quoteBomAcks.reason, at: quoteBomAcks.createdAt, byName: users.name })
      .from(quoteBomAcks)
      .leftJoin(users, eq(users.id, quoteBomAcks.createdBy))
      .where(eq(quoteBomAcks.quoteId, quote.id)),
    db.select({ name: quoteCalcs.name, input: quoteCalcs.input }).from(quoteCalcs).where(eq(quoteCalcs.quoteId, quote.id)),
    db.select({ text: quoteQuestions.text }).from(quoteQuestions).where(and(eq(quoteQuestions.quoteId, quote.id), eq(quoteQuestions.critical, true), eq(quoteQuestions.status, 'open'))),
  ])
  const acks = new Map<string, BomAckDto>(ackRows.map((a) => [a.key, { reason: a.reason, byName: a.byName, at: a.at }]))
  const bom = evaluateBom(rules, ctx, acks)
  const innerVal = checklist.get('inner_dims')?.value
  const spec = quote.profileSpec ?? {}
  const inner: Dims | null =
    innerVal && 'w' in innerVal ? innerVal : spec.innerWidth && spec.innerHeight && spec.innerDepth ? { w: spec.innerWidth, h: spec.innerHeight, d: spec.innerDepth } : null
  const checks = quoteChecks({
    info: quote.info ?? {},
    params: { ...DEFAULT_PARAMS, ...quote.params },
    settings,
    net: price.net,
    gross: price.gross,
    checklist,
    flags: ctx.flags,
    calcs: calcRows.map((c) => {
      const r = computeCalc(c.input)
      return { name: c.name, mode: c.input.mode, requiredKw: r.requiredKw, loadsW: r.loadsW }
    }),
    inner,
    competitionPln: (quote.competition?.products ?? []).filter((p) => p.price != null && (p.currency ?? 'PLN').toUpperCase() === 'PLN' && p.priceNet !== false).map((p) => p.price!),
    criticalOpenQuestions: critical.map((q) => q.text),
  }).map((i) => ({ ...i, ack: acks.get(i.key) ?? null }))
  const calcs = calcRows.map((c) => ({ mode: c.input.mode, kw: computeCalc(c.input).requiredKw }))
  const tr = checklist.get('temp_range')?.value
  const context = {
    mode: quoteMode(checklist, ctx.flags),
    inner,
    tMin: tr && 'min' in tr ? tr.min : null,
    requirements: REQUIREMENT_KEYS.flatMap((k) => {
      const i = checklist.get(k)
      return i?.value ? [{ label: i.label, value: formatSpecValue(i.value, units.get(k) ?? null) }] : []
    }),
    coolingKw: Math.max(0, ...calcs.filter((c) => c.mode === 'cooling').map((c) => c.kw)),
    heatingKw: Math.max(0, ...calcs.filter((c) => c.mode === 'heating').map((c) => c.kw)),
  }
  return { ...finalizeChecks(bom.flags, bom.availableFlags, [...checks, ...bom.issues]), context }
}

/** Kopia flag i akceptacji przy nowej rewizji (kopii). */
export async function copyBom(tx: Database, fromId: string, toId: string) {
  const [from] = await tx.select({ flags: quotes.bomFlags }).from(quotes).where(eq(quotes.id, fromId))
  await tx.update(quotes).set({ bomFlags: from?.flags ?? [] }).where(eq(quotes.id, toId))
  const acks = await tx.select().from(quoteBomAcks).where(eq(quoteBomAcks.quoteId, fromId))
  if (acks.length) await tx.insert(quoteBomAcks).values(acks.map(({ id: _id, quoteId: _q, ...a }) => ({ ...a, quoteId: toId })))
}

