import { z } from 'zod'
import type { QuoteStep } from './quotes.ts'
import type { SpecValue } from './spec.ts'

/**
 * W3 — kompletność kosztorysu (BOM). Reguły zależności z Bazy wiedzy: *jeśli* (flaga architektury / wartość
 * z checklisty / zawsze) *to* w kosztorysie musi być pozycja pasująca do słów kluczowych (z kwotą > 0),
 * inaczej alert blokujący zatwierdzenie — do czasu dodania pozycji albo akceptacji z uzasadnieniem.
 */

const optText = (max: number) => z.string().trim().max(max).nullable().optional()

/** Operatory warunku na wartości z checklisty (krok 4). */
export const BOM_CHECKLIST_OPS = ['eq', 'contains', 'true', 'gte', 'lte', 'filled'] as const
export type BomChecklistOp = (typeof BOM_CHECKLIST_OPS)[number]

export const bomConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('always') }),
  /** Flaga architektury zaznaczana w wycenie (krok 7), np. „Skraplanie wodne”. */
  z.object({ kind: z.literal('flag'), flag: z.string().trim().min(1).max(120) }),
  /** Wartość pozycji checklisty (`key` z listy specyfikacyjnej); pozycje „nie dotyczy” są pomijane. */
  z.object({ kind: z.literal('checklist'), key: z.string().trim().min(1).max(100), op: z.enum(BOM_CHECKLIST_OPS), value: z.union([z.string().trim().max(200), z.number()]).nullable().optional() }),
])
export type BomCondition = z.infer<typeof bomConditionSchema>

export const bomRuleInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: optText(2000),
  active: z.boolean().default(true),
  /** Warunki łączone przez „lub” — reguła działa, gdy spełniony jest którykolwiek. */
  when: z.array(bomConditionSchema).min(1).max(10),
  require: z.object({
    /** Sekcja kosztorysu (np. „Wyposażenie dodatkowe”); puste = dowolna. */
    section: z.string().trim().max(100).nullable().optional(),
    /** Pozycja spełnia regułę, gdy nazwa lub grupa zawiera którekolwiek słowo (bez wielkości liter i polskich znaków). */
    keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(20),
    /** Pozycja musi mieć koszt > 0. */
    positiveCost: z.boolean().default(true),
  }),
  /** Podpowiedź dla „Dodaj pozycję”. */
  suggestion: z.object({ name: z.string().trim().min(1).max(300), section: z.string().trim().max(100).nullable().optional() }).nullable().optional(),
  /** Wyjątek akceptowany jednym kliknięciem (np. „Woda lodowa po stronie klienta”). */
  exceptionLabel: optText(200),
})
export type BomRuleInput = z.input<typeof bomRuleInput>
export const bomRulePatch = bomRuleInput.partial().extend({ sortOrder: z.number().int().min(0).max(10000).optional() })

export interface BomRuleDto extends z.output<typeof bomRuleInput> {
  id: string
  sortOrder: number
  updatedAt: string
}

export const bomFlagsInput = z.object({ flags: z.array(z.string().trim().min(1).max(120)).max(50) })
export const bomAckInput = z.object({ issueKey: z.string().trim().min(1).max(100), reason: z.string().trim().min(3, 'validation.ackReasonRequired').max(2000) })

export interface BomAckDto {
  reason: string
  byName: string | null
  at: string
}

export interface BomIssue {
  /** `rule:<id>`, `zero_cost` (pozycje bez ceny) albo `check:<walidator>` (W1/W2/W4/W5). */
  key: string
  kind: 'rule' | 'zero_cost' | 'check'
  /** Krok wyceny, w którym alert jest pokazywany. */
  step: QuoteStep
  /** Błąd blokuje zatwierdzenie (do akceptacji z uzasadnieniem); ostrzeżenie tylko informuje. */
  severity: 'error' | 'warning'
  /** Projekt pytania do zamawiającego (przycisk „Utwórz pytanie”). */
  question: string | null
  ruleId: string | null
  title: string
  description: string | null
  /** Co uruchomiło regułę (czytelny opis warunków). */
  triggers: string[]
  section: string | null
  keywords: string[]
  suggestion: { name: string; section: string | null } | null
  exceptionLabel: string | null
  /** Dla `zero_cost` — pozycje bez ceny. */
  lines: string[]
  ack: BomAckDto | null
}

export interface BomCheckDto {
  /** Flagi architektury zaznaczone w wycenie. */
  flags: string[]
  /** Flagi używane przez aktywne reguły (do zaznaczenia w kroku 7). */
  availableFlags: string[]
  issues: BomIssue[]
  /** Błędy bez akceptacji — blokują zatwierdzenie wyceny. */
  open: number
  /** Ostrzeżenia bez akceptacji (nie blokują). */
  warnings: number
  /** Kontekst do kart kroków (W2): tryb wyceny, wnętrze, wymogi z checklisty, moce z kalkulatora. */
  context?: QuoteCheckContext
}

export interface QuoteCheckContext {
  mode: { custom: boolean; reasons: string[] }
  inner: { w: number; h: number; d: number } | null
  tMin: number | null
  /** Wymogi z checklisty istotne dla bilansu i doboru (etykieta → wartość). */
  requirements: { label: string; value: string }[]
  /** Suma mocy wymaganych z kalkulacji [kW]. */
  coolingKw: number
  heatingKw: number
}

/** Liczniki otwartych alertów po akceptacjach. */
export function finalizeChecks(flags: string[], availableFlags: string[], issues: BomIssue[]): BomCheckDto {
  const open = issues.filter((i) => !i.ack)
  return { flags, availableFlags, issues, open: open.filter((i) => i.severity === 'error').length, warnings: open.filter((i) => i.severity === 'warning').length }
}

export interface BomLine {
  name: string
  group: string | null
  section: string
  cost: number
  /** Urządzenie wliczone do ceny (nie opcja). */
  counted: boolean
}

export interface BomContext {
  flags: string[]
  /** Wartości checklisty (bez pozycji „nie dotyczy”). */
  checklist: Map<string, { label: string; value: SpecValue | null }>
  lines: BomLine[]
}

/** Porównania bez wielkości liter i polskich znaków. */
export function normalizeText(s: string) {
  return s.toLocaleLowerCase('pl').replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

function valueText(v: SpecValue): string {
  if ('t' in v) return v.t
  if ('v' in v) return v.v
  if ('n' in v) return String(v.n)
  if ('b' in v) return v.b ? 'tak' : 'nie'
  if ('min' in v) return `${v.min ?? ''}…${v.max ?? ''}`
  return `${v.w}×${v.h}×${v.d}`
}

/** Liczba do `gte`/`lte`: liczba wprost, a dla zakresu — górna (gte) / dolna (lte) granica. */
function valueNumber(v: SpecValue, op: 'gte' | 'lte'): number | null {
  if ('n' in v) return v.n
  if ('min' in v) return op === 'gte' ? v.max : v.min
  return null
}

function checklistMatch(c: Extract<BomCondition, { kind: 'checklist' }>, v: SpecValue | null): boolean {
  if (!v) return false
  switch (c.op) {
    case 'filled':
      return 'b' in v ? v.b : normalizeText(valueText(v)) !== ''
    case 'true':
      return 'b' in v && v.b
    case 'eq':
      return c.value != null && normalizeText(valueText(v)) === normalizeText(String(c.value))
    case 'contains':
      return c.value != null && normalizeText(valueText(v)).includes(normalizeText(String(c.value)))
    case 'gte':
    case 'lte': {
      const n = valueNumber(v, c.op)
      const ref = typeof c.value === 'number' ? c.value : Number(String(c.value ?? '').replace(',', '.'))
      if (n == null || !Number.isFinite(ref)) return false
      return c.op === 'gte' ? n >= ref : n <= ref
    }
  }
}

const OP_LABEL: Record<BomChecklistOp, string> = { eq: '=', contains: 'zawiera', true: 'tak', gte: '≥', lte: '≤', filled: 'wypełnione' }

/** Warunki reguły spełnione w wycenie (pusta lista = reguła nie dotyczy). */
export function ruleTriggers(rule: Pick<BomRuleDto, 'when'>, ctx: BomContext): string[] {
  const flags = new Set(ctx.flags.map(normalizeText))
  const out: string[] = []
  for (const c of rule.when) {
    if (c.kind === 'always') out.push('zawsze')
    else if (c.kind === 'flag' && flags.has(normalizeText(c.flag))) out.push(`flaga: ${c.flag}`)
    else if (c.kind === 'checklist') {
      const item = ctx.checklist.get(c.key)
      if (item && checklistMatch(c, item.value)) out.push(`checklista: ${item.label} ${OP_LABEL[c.op]}${c.value != null && c.op !== 'true' && c.op !== 'filled' ? ` ${c.value}` : ''} (${valueText(item.value!)})`)
    }
  }
  return out
}

/** Czy kosztorys zawiera pozycję spełniającą wymaganie reguły. */
export function ruleSatisfied(rule: Pick<BomRuleDto, 'require'>, lines: BomLine[]): boolean {
  const section = rule.require.section ? normalizeText(rule.require.section) : null
  const words = rule.require.keywords.map(normalizeText).filter(Boolean)
  return lines.some(
    (l) =>
      l.counted &&
      (!section || normalizeText(l.section) === section) &&
      (!rule.require.positiveCost || l.cost > 0) &&
      words.some((w) => normalizeText(`${l.group ?? ''} ${l.name}`).includes(w)),
  )
}

/** Alerty kompletności: reguły spełnione warunkowo, ale bez pozycji w kosztorysie, oraz pozycje bez ceny. */
export function evaluateBom(rules: BomRuleDto[], ctx: BomContext, acks: Map<string, BomAckDto>): BomCheckDto {
  const issues: BomIssue[] = []
  for (const r of rules) {
    if (!r.active) continue
    const triggers = ruleTriggers(r, ctx)
    if (!triggers.length || ruleSatisfied(r, ctx.lines)) continue
    const key = `rule:${r.id}`
    issues.push({
      key,
      kind: 'rule',
      step: 'pricing',
      severity: 'error',
      question: null,
      ruleId: r.id,
      title: r.name,
      description: r.description ?? null,
      triggers,
      section: r.require.section ?? null,
      keywords: r.require.keywords,
      suggestion: r.suggestion ? { name: r.suggestion.name, section: r.suggestion.section ?? r.require.section ?? null } : null,
      exceptionLabel: r.exceptionLabel ?? null,
      lines: [],
      ack: acks.get(key) ?? null,
    })
  }
  const zero = ctx.lines.filter((l) => l.counted && l.cost <= 0).map((l) => `${l.section}: ${l.group ? `${l.group} · ` : ''}${l.name}`)
  if (zero.length)
    issues.push({
      key: 'zero_cost',
      kind: 'zero_cost',
      step: 'pricing',
      severity: 'error',
      question: null,
      ruleId: null,
      title: 'Pozycje bez ceny',
      description: 'Pozycje z kosztem 0 zł — uzupełnij cenę albo potwierdź, że są bezkosztowe.',
      triggers: [],
      section: null,
      keywords: [],
      suggestion: null,
      exceptionLabel: null,
      lines: zero,
      ack: acks.get('zero_cost') ?? null,
    })
  const availableFlags = [...new Set(rules.filter((r) => r.active).flatMap((r) => r.when.flatMap((c) => (c.kind === 'flag' ? [c.flag] : [])))).values()]
  return finalizeChecks(ctx.flags, availableFlags, issues)
}
