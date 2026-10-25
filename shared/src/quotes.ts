import { z } from 'zod'

/** Wycena (`quote`) albo profil wyceny z bazy wiedzy (`profile`) — ta sama struktura: urządzenia → sekcje → pozycje. */
export const QUOTE_KINDS = ['quote', 'profile'] as const
export type QuoteKind = (typeof QUOTE_KINDS)[number]

/** Roboczy → zatwierdzony (uprawnienie approve) → wysłany; `imported` = historyczny arkusz (tylko do odczytu). */
export const QUOTE_STATUSES = ['draft', 'approved', 'sent', 'imported'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
export const QUOTE_EDITABLE: readonly QuoteStatus[] = ['draft']

export const COMPLEXITIES = ['low', 'medium', 'high'] as const
export type Complexity = (typeof COMPLEXITIES)[number]

/** Skąd pochodzi pozycja (uzasadnienie i ocena wiarygodności w R4 — AI). */
export const LINE_SOURCES = ['manual', 'profile', 'previous', 'calculator', 'ai', 'import'] as const
export type LineSource = (typeof LINE_SOURCES)[number]
export const CONFIDENCES = ['low', 'medium', 'high'] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** Domyślne sekcje (jak w arkuszach „Wstępna cena wykonania”); w wycenie i profilu edytowalne (decyzja D2). */
export const DEFAULT_SECTIONS = ['Obudowa', 'Układ chłodzenia', 'Automatyka i sterowanie', 'Układy dodatkowe', 'Wyposażenie dodatkowe', 'Koszty inne'] as const

/** Rezerwa gwarancyjna (decyzja F2): baza(złożoność) × (1 + perExtraYear × (lata gwarancji − 1)), liczona od kosztu (F3). */
export interface ReserveSettings {
  low: number
  medium: number
  high: number
  perExtraYear: number
}
export const DEFAULT_RESERVE: ReserveSettings = { low: 0.15, medium: 0.2, high: 0.3, perExtraYear: 0.5 }

export interface QuoteSettings {
  reserve: ReserveSettings
  /** Domyślna stawka robocizny (PLN/h) podpowiadana w pozycjach; null = nieustawiona. */
  laborRate: number | null
}

export interface QuoteParams {
  /** Mnożnik kosztu (F1): 2 → wartość marży = koszt. */
  marginMultiplier: number
  complexity: Complexity
  warrantyMonths: number
  /** Nadpisanie wzoru rezerwy (ułamek kosztu); null = wzór. */
  reservePctOverride: number | null
  /** Narzut na ryzyko / nieprzewidziane (F4), ułamek kosztu. */
  riskPct: number
  vatPct: number
}
export const DEFAULT_PARAMS: QuoteParams = { marginMultiplier: 2, complexity: 'medium', warrantyMonths: 12, reservePctOverride: null, riskPct: 0, vatPct: 0.23 }

export function reservePct(params: Pick<QuoteParams, 'complexity' | 'warrantyMonths' | 'reservePctOverride'>, s: ReserveSettings = DEFAULT_RESERVE): number {
  if (params.reservePctOverride != null) return params.reservePctOverride
  const years = params.warrantyMonths / 12
  return round6(s[params.complexity] * (1 + s.perExtraYear * (years - 1)))
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Koszt pozycji: ilość × cena jednostkowa + godziny × stawka (D5). */
export function lineCost(l: { quantity: number; unitCost: number | null; laborHours: number | null; laborRate: number | null }): number {
  return round2(l.quantity * (l.unitCost ?? 0) + (l.laborHours ?? 0) * (l.laborRate ?? 0))
}

export interface PriceBreakdown {
  cost: number
  marginValue: number
  reservePct: number
  reserveValue: number
  riskValue: number
  net: number
  gross: number
}

export function priceFor(cost: number, params: QuoteParams, s: ReserveSettings = DEFAULT_RESERVE): PriceBreakdown {
  const pct = reservePct(params, s)
  const marginValue = round2(cost * (params.marginMultiplier - 1))
  const reserveValue = round2(cost * pct)
  const riskValue = round2(cost * params.riskPct)
  const net = round2(cost + marginValue + reserveValue + riskValue)
  return { cost: round2(cost), marginValue, reservePct: pct, reserveValue, riskValue, net, gross: round2(net * (1 + params.vatPct)) }
}

export interface QuoteSummary extends PriceBreakdown {
  /** Koszt per sekcja (nazwa → suma) dla urządzeń włączonych do ceny — jak „Zestawienie kosztów” w arkuszu. */
  sections: { name: string; cost: number }[]
  devices: { id: string; name: string; quantity: number; isOption: boolean; included: boolean; price: PriceBreakdown }[]
}

export interface QuoteCostSummary {
  cost: number
  sections: { name: string; cost: number }[]
  devices: { id: string; name: string; quantity: number; isOption: boolean; included: boolean; cost: number }[]
}

export function toCostSummary(s: QuoteSummary): QuoteCostSummary {
  return { cost: s.cost, sections: s.sections, devices: s.devices.map(({ price, ...d }) => ({ ...d, cost: price.cost })) }
}

/** Podsumowanie: urządzenia włączone do ceny (× ilość) + osobne ceny opcji/wariantów (D6). */
export function computeSummary(devices: QuoteDeviceDto[], params: QuoteParams, s: ReserveSettings = DEFAULT_RESERVE): QuoteSummary {
  const sectionTotals = new Map<string, number>()
  let cost = 0
  const perDevice = devices.map((d) => {
    const unit = d.sections.reduce((acc, sec) => acc + sec.lines.reduce((a, l) => a + lineCost({ ...l, unitCost: l.unitCost ?? 0, laborRate: l.laborRate ?? 0 }), 0), 0)
    const devCost = unit * d.quantity
    if (d.included && !d.isOption) {
      cost += devCost
      for (const sec of d.sections) {
        const v = sec.lines.reduce((a, l) => a + lineCost({ ...l, unitCost: l.unitCost ?? 0, laborRate: l.laborRate ?? 0 }), 0) * d.quantity
        sectionTotals.set(sec.name, (sectionTotals.get(sec.name) ?? 0) + v)
      }
    }
    return { id: d.id, name: d.name, quantity: d.quantity, isOption: d.isOption, included: d.included, price: priceFor(devCost, params, s) }
  })
  return { ...priceFor(cost, params, s), sections: [...sectionTotals].map(([name, c]) => ({ name, cost: round2(c) })), devices: perDevice }
}

/** Kolejna litera rewizji: A → B …, Z → AA. */
export function nextRevision(existing: readonly string[]): string {
  const toN = (r: string) => [...r].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
  const max = existing.reduce((m, r) => Math.max(m, /^[A-Z]+$/.test(r) ? toN(r) : 0), 0)
  let n = max + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

// ---------------- Wejścia API ----------------

const optText = (max: number) => z.string().trim().max(max).nullable().optional()
const money = z.number().min(0).max(1e11)

export const quoteInfoSchema = z.object({
  /** Wartość zamówienia (budżet zamawiającego), PLN brutto lub netto — wg dokumentu. */
  budget: money.nullable().optional(),
  deliveryPlace: optText(500),
  deliveryTerm: optText(200),
  participationConditions: optText(2000),
  evaluationCriteria: optText(2000),
})
export type QuoteInfo = z.infer<typeof quoteInfoSchema>

export const quoteParamsSchema = z.object({
  marginMultiplier: z.number().min(1).max(20),
  complexity: z.enum(COMPLEXITIES),
  warrantyMonths: z.number().int().min(0).max(240),
  reservePctOverride: z.number().min(0).max(10).nullable(),
  riskPct: z.number().min(0).max(10),
  vatPct: z.number().min(0).max(1),
})

export const quoteCreateInput = z
  .object({
    kind: z.enum(QUOTE_KINDS).default('quote'),
    opportunityId: z.uuid().nullable().optional(),
    name: optText(300),
    description: optText(2000),
    /** Baza: profil lub wcześniejsza wycena (kopiowane w całości); brak = 1 urządzenie z domyślnymi sekcjami. */
    basedOnId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.kind === 'profile' || !!v.opportunityId, { message: 'validation.opportunityRequired', path: ['opportunityId'] })
  .refine((v) => v.kind === 'quote' || !!v.name?.trim(), { message: 'validation.profileNameRequired', path: ['name'] })
export type QuoteCreateInput = z.input<typeof quoteCreateInput>

export const quotePatch = z.object({
  name: optText(300),
  description: optText(2000),
  notes: optText(20000),
  info: quoteInfoSchema.optional(),
  params: quoteParamsSchema.partial().optional(),
  version: z.number().int(),
})
export type QuotePatch = z.input<typeof quotePatch>

export const quoteStatusInput = z.object({ status: z.enum(['draft', 'approved', 'sent']), version: z.number().int() })

export const saveAsProfileInput = z.object({ name: z.string().trim().min(1).max(300), description: optText(2000) })

export const deviceInput = z.object({
  name: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(1).max(1000).default(1),
  isOption: z.boolean().default(false),
  included: z.boolean().default(true),
  /** Nowe urządzenie: z domyślnymi sekcjami (true) albo puste. */
  withDefaultSections: z.boolean().default(true),
})
export const devicePatch = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  isOption: z.boolean().optional(),
  included: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
})

export const sectionInput = z.object({ name: z.string().trim().min(1).max(200) })
export const sectionPatch = z.object({ name: z.string().trim().min(1).max(200).optional(), sortOrder: z.number().int().min(0).max(10000).optional() })

const lineFields = z.object({
  name: z.string().trim().min(1).max(300),
  group: optText(100),
  quantity: z.number().min(0).max(1e7),
  unit: optText(20),
  unitCost: money.nullable().optional(),
  laborHours: z.number().min(0).max(1e6).nullable().optional(),
  laborRate: money.nullable().optional(),
  justification: optText(10000),
  source: z.enum(LINE_SOURCES),
  confidence: z.enum(CONFIDENCES).nullable().optional(),
  approved: z.boolean(),
})
export const lineInput = lineFields.extend({
  quantity: lineFields.shape.quantity.default(1),
  source: lineFields.shape.source.default('manual'),
  approved: lineFields.shape.approved.default(false),
})
export type LineInput = z.input<typeof lineInput>
/** Bez wartości domyślnych — `partial()` w Zod 4 zachowuje `.default()` i nadpisywałby pola przy każdym PATCH. */
export const linePatch = lineFields.partial().extend({ sortOrder: z.number().int().min(0).max(10000).optional(), sectionId: z.uuid().optional() })
export type LinePatch = z.input<typeof linePatch>

export const quoteSettingsInput = z.object({
  reserve: z.object({ low: z.number().min(0).max(10), medium: z.number().min(0).max(10), high: z.number().min(0).max(10), perExtraYear: z.number().min(0).max(10) }),
  laborRate: money.nullable(),
})

// ---------------- DTO ----------------

/** Pola kosztowe są null bez uprawnienia `quotesCost:view`. */
export interface QuoteLineDto {
  id: string
  name: string
  group: string | null
  quantity: number
  unit: string | null
  unitCost: number | null
  laborHours: number | null
  laborRate: number | null
  cost: number | null
  justification: string | null
  source: LineSource
  confidence: Confidence | null
  approved: boolean
  sortOrder: number
}

export interface QuoteSectionDto {
  id: string
  name: string
  sortOrder: number
  cost: number | null
  lines: QuoteLineDto[]
}

export interface QuoteDeviceDto {
  id: string
  name: string
  quantity: number
  isOption: boolean
  included: boolean
  sortOrder: number
  cost: number | null
  sections: QuoteSectionDto[]
}

export interface QuoteListItemDto {
  id: string
  kind: QuoteKind
  name: string | null
  description: string | null
  opportunityId: string | null
  opportunityCode: string | null
  opportunityName: string | null
  companyName: string | null
  revision: string | null
  status: QuoteStatus
  basedOnLabel: string | null
  /** Null bez `quotesCost:view`. */
  cost: number | null
  /** Null bez `quotesPricing:view`. */
  net: number | null
  updatedAt: string
  updatedByName: string | null
}

/** Parametry w DTO: pola cenowe (marża, rezerwa, ryzyko, VAT) są null bez `quotesPricing:view`. */
export type QuoteParamsView = Omit<QuoteParams, 'marginMultiplier' | 'riskPct' | 'vatPct'> & { marginMultiplier: number | null; riskPct: number | null; vatPct: number | null }

export interface QuoteDto extends QuoteListItemDto {
  params: QuoteParamsView
  info: QuoteInfo
  notes: string | null
  devices: QuoteDeviceDto[]
  /** Koszty (zestawienie per sekcja i urządzenie) — z `quotesCost:view`. */
  costSummary: QuoteCostSummary | null
  /** Marża, rezerwa, ryzyko, netto/brutto — tylko z `quotesPricing:view`. */
  summary: QuoteSummary | null
  canEdit: boolean
  canSeeCosts: boolean
  canEditCosts: boolean
  canSeePricing: boolean
  canEditPricing: boolean
  approvedAt: string | null
  approvedByName: string | null
  version: number
}
