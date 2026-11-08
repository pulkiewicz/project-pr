import { z } from 'zod'
import type { ContractType, PayBasis } from './management.ts'

/**
 * Plan finansowy (Finanse → Plan finansowy): na jeden miesiąc przychody (faktury sprzedażowe z inFakt),
 * koszty z faktur kosztowych (projekty × kategorie) i stałe koszty pracownicze z listy Pracowników.
 * Kwoty w groszach; sumy tylko w PLN (dokumenty w walutach obcych są liczone osobno i nie wchodzą do wyniku).
 */

/** Rodzaje faktur sprzedażowych inFakt pomijane w przychodach (pro forma nie jest dokumentem księgowym). */
export const INFAKT_SALES_SKIPPED_KINDS = ['proforma'] as const

export const financeMonth = /^\d{4}-(0[1-9]|1[0-2])$/

/** Narzut pracodawcy (ZUS: emerytalne 9,76 + rentowe 6,5 + wypadkowe 1,67 + FP 2,45 + FGŚP 0,1) — szacunek. */
export const EMPLOYER_RATE = 20.48
/** Godziny pracy w dniu roboczym — do stawek godzinowych (wymiar czasu pracy miesiąca). */
export const HOURS_PER_WORKING_DAY = 8

/**
 * Narzut pracodawcy w % dla rodzaju umowy. Zlecenie ucznia / studenta (do 26 lat) bez składek;
 * dzieło, staż i inne — bez narzutu; B2B rozliczany fakturą (nie wchodzi do kosztów pracowniczych).
 */
export function employerRate(contract: ContractType | null, studentInMonth: boolean): number {
  if (contract === 'employment') return EMPLOYER_RATE
  if (contract === 'mandate') return studentInMonth ? 0 : EMPLOYER_RATE
  return 0
}

export interface SalesSyncResult {
  fetched: number
  created: number
  updated: number
  syncedAt: string
}

export interface SalesInvoiceDto {
  id: string
  number: string | null
  kind: string
  clientName: string | null
  invoiceDate: string | null
  saleDate: string | null
  paymentDate: string | null
  currency: string
  netPrice: number | null
  grossPrice: number | null
  /** Status inFakt: draft, sent, printed, paid… */
  status: string | null
  paidPrice: number | null
}

/** Komórka kosztów: projekt (null = bez projektu) × kategoria (null = bez kategorii). */
export interface FinanceCostCell {
  /** `project` — udział projektu, `general` — koszty ogólne (świadomie lub reszta podziału %), `unassigned` — faktura jeszcze nieprzypisana. */
  kind: 'project' | 'general' | 'unassigned'
  projectId: string | null
  categoryId: string | null
  net: number
}

export interface FinanceCostInvoice {
  id: string
  number: string | null
  sellerName: string | null
  date: string | null
  status: string
  currency: string
  netPrice: number | null
  categoryName: string | null
  /** „OF038 60%, Ogólne 40%”. */
  allocation: string
}

export interface FinanceStaffRow {
  employeeId: string
  name: string
  position: string | null
  contractType: ContractType | null
  payBasis: PayBasis | null
  /** Kwota z umowy (miesięczna lub za godzinę), grosze. */
  payAmount: number | null
  /** Część miesiąca objęta umową (0–1) — przy rozpoczęciu / zakończeniu umowy w trakcie miesiąca. */
  fraction: number
  /** Godziny (stawka godzinowa): wymiar czasu pracy w okresie umowy w tym miesiącu. */
  hours: number | null
  /** Wynagrodzenie za miesiąc (brutto; dla B2B — netto), grosze. */
  pay: number
  employerRate: number
  employerCost: number
  /** Koszt razem = wynagrodzenie + narzut. */
  total: number
  /** B2B — rozliczany fakturą kosztową, nie wliczany do kosztów pracowniczych (bez dublowania). */
  invoiced: boolean
  /** Brak kwoty lub podstawy wynagrodzenia w karcie pracownika. */
  missingPay: boolean
}

export interface FinanceMonthSummary {
  month: string
  revenue: number
  invoiceCosts: number
  staffCosts: number
  result: number
  /** Kwoty planowane ręcznie (niezależnie od inFakt). */
  plannedRevenue: number
  plannedCosts: number
  /** Koszty stałe niepracownicze (czynsz, leasing, abonamenty…) obowiązujące w miesiącu. */
  fixedCosts: number
  /** Wynik planowany = przychody planowane − koszty planowane − koszty stałe − koszty pracownicze. */
  plannedResult: number
}

// ---------------- Koszty stałe niepracownicze ----------------

export interface FinanceFixedCostDto {
  id: string
  name: string
  /** Netto miesięcznie, grosze (PLN). */
  amount: number
  startMonth: string
  /** Null = bezterminowo. */
  endMonth: string | null
  projectId: string | null
  projectCode: string | null
  costCategoryId: string | null
  costCategoryName: string | null
  note: string | null
  version: number
}

const fixedCostBase = z.object({
  name: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(100_000_000_000),
  startMonth: z.string().regex(financeMonth, 'validation.month'),
  endMonth: z.string().regex(financeMonth, 'validation.month').nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  costCategoryId: z.uuid().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})
const fixedRange = (v: { startMonth?: string; endMonth?: string | null }) => !v.startMonth || !v.endMonth || v.endMonth >= v.startMonth
export const fixedCostInput = fixedCostBase.refine(fixedRange, { message: 'validation.dateRange', path: ['endMonth'] })
export type FixedCostInput = z.input<typeof fixedCostInput>
export const fixedCostPatch = fixedCostBase.partial().extend({ version: z.number().int() }).refine(fixedRange, { message: 'validation.dateRange', path: ['endMonth'] })
export type FixedCostPatch = z.input<typeof fixedCostPatch>

/** Koszt stały obowiązuje w miesiącu `m` (okres włącznie). */
export const fixedCostActive = (f: { startMonth: string; endMonth: string | null }, m: string) => f.startMonth <= m && (!f.endMonth || f.endMonth >= m)

// ---------------- Pozycje planowane (wpisywane ręcznie) ----------------

export const PLAN_ITEM_KINDS = ['revenue', 'cost'] as const
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number]

export interface FinancePlanItemDto {
  id: string
  month: string
  kind: PlanItemKind
  name: string
  /** Netto, grosze (PLN). */
  amount: number
  projectId: string | null
  projectCode: string | null
  costCategoryId: string | null
  costCategoryName: string | null
  note: string | null
  version: number
}

const monthStr = z.string().regex(financeMonth, 'validation.month')
const planAmount = z.number().int().min(1).max(100_000_000_000)
const planItemBase = z.object({
  kind: z.enum(PLAN_ITEM_KINDS),
  name: z.string().trim().min(1).max(200),
  amount: planAmount,
  projectId: z.uuid().nullable().optional(),
  /** Tylko koszty. */
  costCategoryId: z.uuid().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})
/** Nowa pozycja; `repeatUntil` — ta sama pozycja w każdym miesiącu do podanego włącznie (maks. 36 miesięcy). */
export const planItemInput = planItemBase
  .extend({ month: monthStr, repeatUntil: monthStr.nullable().optional() })
  .refine((v) => !v.repeatUntil || v.repeatUntil >= v.month, { message: 'validation.dateRange', path: ['repeatUntil'] })
export type PlanItemInput = z.input<typeof planItemInput>
export const planItemPatch = planItemBase.partial().extend({ month: monthStr.optional(), version: z.number().int() })
export type PlanItemPatch = z.input<typeof planItemPatch>
export const PLAN_REPEAT_MAX = 36

/** Miesiące od `from` do `to` włącznie (yyyy-MM). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number) as [number, number]
  for (let cur = from; cur <= to && out.length <= PLAN_REPEAT_MAX; ) {
    out.push(cur)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
    cur = `${y}-${String(m).padStart(2, '0')}`
  }
  return out
}

export interface FinancePlanResponse {
  month: string
  /** Podsumowanie 12 miesięcy roku wybranego miesiąca (pasek u góry ekranu). */
  year: FinanceMonthSummary[]
  revenue: {
    net: number
    gross: number
    invoices: SalesInvoiceDto[]
    /** Faktury w walutach obcych (nie wliczone do sum PLN). */
    foreign: number
  }
  costs: {
    net: number
    cells: FinanceCostCell[]
    projects: { id: string; code: string; name: string }[]
    categories: { id: string; name: string; staff: boolean }[]
    invoices: FinanceCostInvoice[]
    /** Faktury bez kwoty netto (do uzupełnienia w karcie faktury). */
    missingAmount: number
    foreign: number
  }
  staff: {
    total: number
    pay: number
    employer: number
    /** Lista osób — tylko z uprawnieniem do modułu Pracownicy (wynagrodzenia); bez niego same sumy. */
    rows: FinanceStaffRow[] | null
    count: number
  }
  result: number
  /** Pozycje planowane miesiąca (przychody i koszty wpisane ręcznie). */
  planned: {
    items: FinancePlanItemDto[]
    revenue: number
    costs: number
    result: number
  }
  /** Koszty stałe niepracownicze: obowiązujące w miesiącu i pełna lista (do edycji). */
  fixed: {
    total: number
    active: FinanceFixedCostDto[]
    all: FinanceFixedCostDto[]
  }
  sales: { lastSync: string | null; configured: boolean }
}

// ---------------- Koszty pracownicze ----------------

const pad = (n: number) => String(n).padStart(2, '0')
export const monthStart = (m: string) => `${m}-01`
export function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number) as [number, number]
  return `${m}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}`
}

export interface StaffInput {
  id: string
  firstName: string
  lastName: string
  position: string | null
  contractType: string | null
  contractStart: string | null
  contractEnd: string | null
  payBasis: string | null
  payAmount: number | null
  isStudent: boolean
  studentUntil: string | null
  isActive: boolean
}

/**
 * Koszt pracownika w miesiącu albo null, gdy umowa nie obejmuje miesiąca.
 * Obowiązuje okres umowy; bez dat — pracownik aktywny. Nieaktywny bez daty końca nie jest liczony.
 * `workingDays(from, to)` — dni robocze w przedziale włącznie (weekendy i święta PL pominięte).
 */
export function staffCost(e: StaffInput, month: string, workingDays: (from: string, to: string) => number): FinanceStaffRow | null {
  const start = monthStart(month)
  const end = monthEnd(month)
  if (!e.isActive && !e.contractEnd) return null
  const from = e.contractStart && e.contractStart > start ? e.contractStart : start
  const to = e.contractEnd && e.contractEnd < end ? e.contractEnd : end
  if (from > to) return null

  const daysInMonth = Number(end.slice(8))
  const coveredDays = Number(to.slice(8)) - Number(from.slice(8)) + 1
  const fraction = Math.round((coveredDays / daysInMonth) * 10000) / 10000
  const contractType = (e.contractType as ContractType | null) ?? null
  const payBasis = (e.payBasis as PayBasis | null) ?? null
  const missingPay = !payBasis || e.payAmount == null
  let hours: number | null = null
  let pay = 0
  if (!missingPay && payBasis === 'monthly') pay = Math.round(e.payAmount! * fraction)
  if (!missingPay && payBasis === 'hourly') {
    hours = workingDays(from, to) * HOURS_PER_WORKING_DAY
    pay = Math.round(e.payAmount! * hours)
  }
  const studentInMonth = e.isStudent && (!e.studentUntil || e.studentUntil >= start)
  const invoiced = contractType === 'b2b'
  const rate = invoiced ? 0 : employerRate(contractType, studentInMonth)
  const employerCost = Math.round((pay * rate) / 100)
  return {
    employeeId: e.id,
    name: `${e.lastName} ${e.firstName}`,
    position: e.position,
    contractType,
    payBasis,
    payAmount: e.payAmount,
    fraction,
    hours,
    pay,
    employerRate: rate,
    employerCost,
    total: pay + employerCost,
    invoiced,
    missingPay,
  }
}
