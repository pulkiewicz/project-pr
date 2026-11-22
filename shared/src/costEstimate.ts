import { z } from 'zod'
import type { PurchaseStatus } from './purchases.ts'

/**
 * Kosztorys projektu [W] (tylko Envcheck): szacunek (np. OF14), wyceny dostawców, kwoty faktyczne i prognoza,
 * w podziale na budżet Envcheck / Arsanit. Odwzorowuje arkusz „PIT-RADWAR – koszty szacunek, wyceny, wykonanie”.
 * Pozycje budżetu Envcheck można doszczegółowić podpozycjami (jeden poziom).
 */

/** Kto ponosi koszt w konsorcjum. */
export const COST_BUDGETS = ['Envcheck', 'Arsanit'] as const
export type CostBudget = (typeof COST_BUDGETS)[number]

/** Kategorie z arkusza (kolejność podsumowania); dozwolone są też własne. */
export const COST_CATEGORIES = [
  'Obudowa i prace budowlane',
  'Układ chłodzenia',
  'Automatyka i zasilanie',
  'Układy dodatkowe',
  'Wyposażenie dodatkowe',
  'Koszty osobowe i wykonawstwo',
  'Koszty odbiorowe i ogólne',
  'Rezerwa',
] as const

export const COST_CURRENCIES = ['PLN', 'EUR'] as const
export type CostCurrency = (typeof COST_CURRENCIES)[number]

/**
 * Sposób liczenia prognozy:
 * `auto` — faktyczne, a bez nich wycena, a bez niej szacunek;
 * `estimate` — faktyczne, a bez nich szacunek (wycena częściowa nie zastępuje szacunku);
 * `manual` — kwota wpisana ręcznie.
 */
export const COST_FORECAST_MODES = ['auto', 'estimate', 'manual'] as const
export type CostForecastMode = (typeof COST_FORECAST_MODES)[number]

const money = z.number().min(-1e12).max(1e12)
const optMoney = money.nullable().optional()
const optText = (max: number) => z.string().trim().max(max).nullable().optional()

const costItemBase = z.object({
  category: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  budget: z.enum(COST_BUDGETS),
  /** Szacowane (zł netto). W podpozycji — część szacunku pozycji nadrzędnej. */
  estimate: optMoney,
  /** Wycena dostawcy (netto) w walucie `quoteCurrency`. */
  quoteAmount: optMoney,
  quoteCurrency: z.enum(COST_CURRENCIES),
  /** Faktyczne (zł netto). */
  actual: optMoney,
  forecastMode: z.enum(COST_FORECAST_MODES),
  forecastManual: optMoney,
  supplier: optText(200),
  notes: optText(5000),
  /** Nieaktywna: zostaje na liście, prognoza = 0; wymaga powodu (adnotacji). */
  inactive: z.boolean(),
  inactiveReason: optText(1000),
})
export const costItemInput = costItemBase.extend({
  inactive: costItemBase.shape.inactive.default(false),
  quoteCurrency: costItemBase.shape.quoteCurrency.default('EUR'),
  forecastMode: costItemBase.shape.forecastMode.default('auto'),
  /** Podpozycja: id pozycji nadrzędnej (budżet Envcheck); kategoria i budżet dziedziczone. */
  parentId: z.uuid().nullable().optional(),
})
export type CostItemInput = z.input<typeof costItemInput>
export const costItemPatch = costItemBase.partial().extend({ version: z.number().int() })
export type CostItemPatch = z.infer<typeof costItemPatch>

/** Ustawienie `costEstimate.access`: kto ma dostęp do Kosztorysu (uprawnienia z roli działają tylko dla osób z listy). */
export interface CostEstimateAccessSettings {
  userIds: string[]
}
export const costEstimateAccessInput = z.object({ userIds: z.array(z.uuid()).max(50) })

/** Komentarz do pozycji. */
export const costCommentInput = z.object({ body: z.string().trim().min(1).max(5000) })

export interface CostCommentDto {
  id: string
  body: string
  createdAt: string
  authorId: string | null
  authorName: string | null
  /** Autor (albo osoba z `costEstimate:delete`) może usunąć komentarz. */
  canDelete: boolean
}

/** Kolejność pozycji (w obrębie rodzica). */
export const costItemMove = z.object({ direction: z.enum(['up', 'down']) })

const contractSchema = z.object({
  /** Wynagrodzenie z umowy (zł netto). */
  contractValue: money,
  /** Budżet partnera (Arsanit) wg aneksu. */
  partnerBudget: money,
  /** Rozbicie budżetu partnera (np. etapy). */
  partnerStages: z.array(z.object({ name: z.string().trim().min(1).max(200), amount: money })).max(20),
  partnerMargin: money,
  /** Rezerwa gwarancyjna (wspólna). */
  guaranteeReserve: money,
  /** Udział Envcheck w niewykorzystanej rezerwie (0–1). */
  reserveShare: z.number().min(0).max(1),
  source: optText(500),
})
export type CostContract = z.infer<typeof contractSchema>

export const costSettingsInput = z.object({
  eurRate: z.number().positive().max(100),
  eurRateNote: optText(300),
  /** Źródła danych (szacunek, wycena, podział w konsorcjum) — wolny tekst. */
  sources: optText(5000),
  /** Podział wynagrodzenia w konsorcjum; null — sekcja wyniku ukryta. */
  contract: contractSchema.nullable(),
  version: z.number().int(),
})
export type CostSettingsInput = z.infer<typeof costSettingsInput>

export interface CostSettingsDto extends Omit<CostSettingsInput, 'eurRateNote' | 'sources'> {
  eurRateNote: string | null
  sources: string | null
}

export interface CostItemRow {
  id: string
  parentId: string | null
  position: number
  category: string
  name: string
  budget: CostBudget
  estimate: number | null
  quoteAmount: number | null
  quoteCurrency: CostCurrency
  actual: number | null
  forecastMode: CostForecastMode
  forecastManual: number | null
  supplier: string | null
  notes: string | null
  inactive: boolean
  inactiveReason: string | null
  purchaseItemId: string | null
  version: number
}

export interface CostItemDto extends CostItemRow {
  /** Wycena w zł (EUR × kurs); w pozycji z podpozycjami — suma wycen podpozycji. */
  quotePln: number | null
  /** W pozycji z podpozycjami — suma faktycznych podpozycji; inaczej `actual`. */
  actualTotal: number | null
  forecast: number
  /** Podpozycja: własny szacunek albo równa część nierozpisanego szacunku pozycji (gdy własnego brak). */
  allocatedEstimate: number | null
  /** Udział w szacunku budżetu (tylko pozycje główne). */
  share: number | null
  childCount: number
  /** Suma szacunków podpozycji. */
  childrenEstimate: number | null
  /** Szacunek pozycji nierozpisany na podpozycje (wchodzi do prognozy); 0, gdy są podpozycje bez własnego szacunku. */
  unallocated: number | null
  commentCount: number
  lastCommentAt: string | null
  /** Powiązana pozycja planu zakupów. */
  purchase: { status: PurchaseStatus; isCritical: boolean; hrfTaskCode: string | null } | null
}

export interface CostTotals {
  estimate: number
  quote: number
  actual: number
  forecast: number
}

export interface CostEstimateSummary {
  /** Koszty Envcheck wg kategorii. */
  categories: (CostTotals & { category: string; share: number })[]
  envcheck: CostTotals
  budgets: (CostTotals & { budget: CostBudget; share: number })[]
  total: CostTotals
  contract: null | {
    partnerBudget: number
    partnerStages: { name: string; amount: number }[]
    /** Pozycje kosztorysu przypisane do partnera (szacunek). */
    partnerAssigned: number
    partnerDiff: number
    contractValue: number
    partnerMargin: number
    guaranteeReserve: number
    envcheckAmount: number
    envcheckCost: number
    envcheckCostForecast: number
    result: number
    resultForecast: number
    reserveShare: number
    maxReserveReturn: number
  }
}

export interface CostEstimateResponse {
  settings: CostSettingsDto
  items: CostItemDto[]
  summary: CostEstimateSummary
}

const round2 = (n: number) => Math.round(n * 100) / 100
const sumOrNull = (vals: (number | null)[]) => (vals.some((v) => v != null) ? round2(vals.reduce<number>((s, v) => s + (v ?? 0), 0)) : null)

export function quoteInPln(row: Pick<CostItemRow, 'quoteAmount' | 'quoteCurrency'>, eurRate: number): number | null {
  if (row.quoteAmount == null) return null
  return round2(row.quoteCurrency === 'EUR' ? row.quoteAmount * eurRate : row.quoteAmount)
}

function leafForecast(row: CostItemRow, quotePln: number | null, estimate: number | null): number {
  if (row.inactive) return 0
  if (row.forecastMode === 'manual') return row.forecastManual ?? 0
  if (row.actual != null) return row.actual
  if (row.forecastMode === 'auto' && quotePln != null) return quotePln
  return estimate ?? 0
}

/** Kolejność kategorii: z arkusza, potem pozostałe alfabetycznie. */
export function compareCategories(a: string, b: string): number {
  const ia = (COST_CATEGORIES as readonly string[]).indexOf(a)
  const ib = (COST_CATEGORIES as readonly string[]).indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  return a.localeCompare(b, 'pl')
}

/**
 * Wyliczenia kosztorysu (jak formuły arkusza). Sumy budżetów i kategorii liczone z pozycji głównych —
 * podpozycje to szczegół pozycji nadrzędnej: jej wycena i faktyczne są sumą podpozycji, a prognoza to suma
 * prognoz podpozycji plus nierozpisany szacunek. Szacunek pozycji nadrzędnej (np. z OF14) się nie zmienia.
 */
export function computeCostEstimate(
  rows: CostItemRow[],
  settings: Pick<CostSettingsDto, 'eurRate' | 'contract'>,
  purchases: ReadonlyMap<string, NonNullable<CostItemDto['purchase']>> = new Map(),
  comments: ReadonlyMap<string, { count: number; last: string | null }> = new Map(),
): { items: CostItemDto[]; summary: CostEstimateSummary } {
  const commentInfo = (id: string) => ({ commentCount: comments.get(id)?.count ?? 0, lastCommentAt: comments.get(id)?.last ?? null })
  const children = new Map<string, CostItemRow[]>()
  for (const r of rows) if (r.parentId) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r])
  const byPos = (a: CostItemRow, b: CostItemRow) => a.position - b.position || a.name.localeCompare(b.name, 'pl')

  const computed = new Map<string, CostItemDto>()
  const leaf = (r: CostItemRow, implicitEstimate: number | null = null): CostItemDto => {
    const quotePln = quoteInPln(r, settings.eurRate)
    const purchase = (r.purchaseItemId && purchases.get(r.purchaseItemId)) || null
    const allocatedEstimate = r.estimate ?? implicitEstimate
    return { ...r, quotePln, actualTotal: r.actual, forecast: round2(leafForecast(r, quotePln, allocatedEstimate)), allocatedEstimate, share: null, childCount: 0, childrenEstimate: null, unallocated: null, purchase, ...commentInfo(r.id) }
  }

  const top = rows.filter((r) => !r.parentId || !rows.some((p) => p.id === r.parentId)).sort(byPos)
  for (const r of top) {
    const rawKids = (children.get(r.id) ?? []).sort(byPos)
    if (!rawKids.length) {
      computed.set(r.id, leaf(r))
      continue
    }
    // Podpozycje bez własnego szacunku (np. z planu zakupów) dzielą równo nierozpisany szacunek pozycji;
    // gdy wszystkie mają szacunek, reszta zostaje „nierozpisana” i wchodzi do prognozy jako szacunek.
    const childrenEstimate = sumOrNull(rawKids.map((k) => k.estimate))
    const remaining = Math.max(0, (r.estimate ?? 0) - (childrenEstimate ?? 0))
    const withoutEstimate = rawKids.filter((k) => k.estimate == null).length
    // Równe części; ostatnia dostaje resztę z zaokrągleń, żeby suma była dokładnie równa szacunkowi.
    const part = withoutEstimate ? round2(remaining / withoutEstimate) : 0
    let seen = 0
    const kids = rawKids.map((k) => {
      if (k.estimate != null) return leaf(k)
      seen += 1
      return leaf(k, seen === withoutEstimate ? round2(remaining - part * (withoutEstimate - 1)) : part)
    })
    const unallocated = withoutEstimate ? 0 : round2(remaining)
    const forecast = r.inactive ? 0 : r.forecastMode === 'manual' ? (r.forecastManual ?? 0) : round2(kids.reduce((s, k) => s + k.forecast, 0) + unallocated)
    computed.set(r.id, {
      ...r,
      // Bez wycen / faktycznych w podpozycjach liczy się kwota wpisana w samej pozycji.
      quotePln: sumOrNull(kids.map((k) => k.quotePln)) ?? quoteInPln(r, settings.eurRate),
      actualTotal: sumOrNull(kids.map((k) => k.actual)) ?? r.actual,
      forecast,
      share: null,
      allocatedEstimate: r.estimate,
      childCount: kids.length,
      childrenEstimate,
      unallocated,
      purchase: (r.purchaseItemId && purchases.get(r.purchaseItemId)) || null,
      ...commentInfo(r.id),
    })
    for (const k of kids) computed.set(k.id, k)
  }

  const tops = top.map((r) => computed.get(r.id)!)
  const totals = (list: CostItemDto[]): CostTotals => ({
    estimate: round2(list.reduce((s, i) => s + (i.estimate ?? 0), 0)),
    quote: round2(list.reduce((s, i) => s + (i.quotePln ?? 0), 0)),
    actual: round2(list.reduce((s, i) => s + (i.actualTotal ?? 0), 0)),
    forecast: round2(list.reduce((s, i) => s + i.forecast, 0)),
  })

  const budgetTotals = Object.fromEntries(COST_BUDGETS.map((b) => [b, totals(tops.filter((i) => i.budget === b))])) as Record<CostBudget, CostTotals>
  for (const i of tops) {
    const base = budgetTotals[i.budget].estimate
    i.share = base ? (i.estimate ?? 0) / base : 0
  }

  const envTops = tops.filter((i) => i.budget === 'Envcheck')
  const envcheck = budgetTotals.Envcheck
  const categories = [...new Set([...COST_CATEGORIES, ...envTops.map((i) => i.category)])]
    .sort(compareCategories)
    .map((category) => {
      const t = totals(envTops.filter((i) => i.category === category))
      return { category, ...t, share: envcheck.estimate ? t.estimate / envcheck.estimate : 0 }
    })
    .filter((c) => (COST_CATEGORIES as readonly string[]).includes(c.category) || c.estimate || c.forecast)

  const total = totals(tops)
  const budgets = COST_BUDGETS.map((budget) => ({ budget, ...budgetTotals[budget], share: total.estimate ? budgetTotals[budget].estimate / total.estimate : 0 }))

  const c = settings.contract
  const contract = c
    ? (() => {
        const envcheckAmount = round2(c.contractValue - c.partnerBudget - c.partnerMargin - c.guaranteeReserve)
        return {
          partnerBudget: c.partnerBudget,
          partnerStages: c.partnerStages,
          partnerAssigned: budgetTotals.Arsanit.estimate,
          partnerDiff: round2(c.partnerBudget - budgetTotals.Arsanit.estimate),
          contractValue: c.contractValue,
          partnerMargin: c.partnerMargin,
          guaranteeReserve: c.guaranteeReserve,
          envcheckAmount,
          envcheckCost: envcheck.estimate,
          envcheckCostForecast: envcheck.forecast,
          result: round2(envcheckAmount - envcheck.estimate),
          resultForecast: round2(envcheckAmount - envcheck.forecast),
          reserveShare: c.reserveShare,
          maxReserveReturn: round2(c.guaranteeReserve * c.reserveShare),
        }
      })()
    : null

  // Kolejność listy: pozycja główna, a pod nią jej podpozycje.
  const items = tops.flatMap((t) => [t, ...(children.get(t.id) ?? []).sort(byPos).map((k) => computed.get(k.id)!)])
  return { items, summary: { categories, envcheck, budgets, total, contract } }
}
