import { employerRate, monthStart, staffCost, type StaffInput } from './finance.ts'
import { daysBetween, type ContractType, type PayBasis } from './management.ts'

/**
 * Koszty pracownicze (Finanse → Koszty pracownicze): widok roku per osoba z prognozą.
 * Źródła kwot: umowa o pracę — karta pracownika (brutto); zlecenie / dzieło / staż — wypłaty z wyciągów bankowych;
 * B2B — faktury kosztowe (netto). Miesiące od bieżącego to prognoza (zlecenia i B2B: średnia z ostatnich płatności).
 * Kwoty w groszach.
 */

export const STAFF_GROUPS = ['employment', 'mandate', 'b2b', 'other'] as const
export type StaffGroup = (typeof STAFF_GROUPS)[number]

export function staffGroup(c: ContractType | string | null): StaffGroup {
  if (c === 'employment') return 'employment'
  if (c === 'mandate' || c === 'specific_task') return 'mandate'
  if (c === 'b2b') return 'b2b'
  return 'other'
}

/** Ile miesięcy wstecz szukamy płatności do prognozy i ile ostatnich bierzemy do średniej. */
export const FORECAST_LOOKBACK_MONTHS = 6
export const FORECAST_AVG_MONTHS = 3
/** Koniec umowy w ciągu tylu dni — „kończy się wkrótce”. */
export const STAFF_ENDS_SOON_DAYS = 60

/** `kind`: `card` — z karty pracownika, `bank` — wypłata z wyciągu, `invoice` — faktura B2B, `forecast` — prognoza. */
export type StaffCellSource = 'card' | 'bank' | 'invoice' | 'forecast'
export type StaffCellMark = 'contract_start' | 'contract_end' | 'after_end' | 'paid_after_end' | 'student_end'

export interface StaffDoc {
  date: string
  label: string
  amount: number
}

export interface StaffCostCell {
  month: string
  /** Wynagrodzenie (UoP — brutto z karty, zlecenie — wypłata z banku, B2B — netto z faktur); 0 gdy brak. */
  amount: number
  /** Koszty pracodawcy ponad wynagrodzenie (ZUS pracodawcy, FP, FGŚP) — szacunek wg stawki. */
  employer: number
  source: StaffCellSource | null
  /** Miesiąc po końcu umowy: prognoza przy założeniu przedłużenia (null, gdy nie dotyczy). */
  extended: { amount: number; employer: number } | null
  /** Wypłaty z banku dopasowane do osoby (kontrolnie — przy UoP kwota netto do ręki). */
  paid: number
  /** Przelewy / faktury składające się na kwotę (podgląd w dymku). */
  docs: StaffDoc[]
  marks: StaffCellMark[]
}

export type StaffIssueCode = 'expired' | 'ends_soon' | 'ends_this_year' | 'paid_after_end' | 'missing_pay' | 'no_recent_payments' | 'student_ends'
export type StaffIssueSeverity = 'red' | 'orange' | 'yellow' | 'gray'
export interface StaffIssue {
  code: StaffIssueCode
  severity: StaffIssueSeverity
  date?: string | null
  month?: string | null
}

export interface StaffCostRow {
  employeeId: string
  name: string
  position: string | null
  contractType: ContractType | null
  group: StaffGroup
  contractStart: string | null
  contractEnd: string | null
  isActive: boolean
  isStudent: boolean
  studentUntil: string | null
  payBasis: PayBasis | null
  payAmount: number | null
  billingName: string | null
  cells: StaffCostCell[]
  /** Podstawa prognozy: średnia z ostatnich płatności, karta pracownika albo brak. */
  forecastBasis: 'avg' | 'card' | null
  issues: StaffIssue[]
}

export interface StaffBankMonth {
  month: string
  /** Wynagrodzenia (operacje „WYNAGRODZENIE”), ZUS i zaliczki PIT-4 z wyciągów — wartości dodatnie. */
  salaries: number
  zus: number
  pit: number
}

export interface StaffUnmatchedPayment {
  date: string
  name: string | null
  title: string | null
  amount: number
}

export interface StaffCostsResponse {
  year: string
  today: string
  /** Pierwszy miesiąc prognozy (bieżący); wcześniejsze miesiące — wykonanie. */
  currentMonth: string
  months: string[]
  rows: StaffCostRow[]
  bank: StaffBankMonth[]
  /** Ostatnia data operacji z zaimportowanych wyciągów (null — brak wyciągów). */
  bankUntil: string | null
  /** Wypłaty „WYNAGRODZENIE” z roku bez dopasowanej osoby — do uzupełnienia nazwy w karcie pracownika. */
  unmatched: StaffUnmatchedPayment[]
  /** Aktywni pracownicy bez rodzaju umowy (pominięci w widoku). */
  missingContract: string[]
}

// ---------------- Dane wejściowe ----------------

export interface StaffEmployeeInput extends StaffInput {
  billingName: string | null
}

export interface StaffBankTxInput {
  id: string
  bookingDate: string
  /** Wydatek jako kwota dodatnia. */
  amount: number
  kind: string
  counterpartyName: string | null
  title: string | null
  description: string
}

export interface StaffInvoiceInput {
  id: string
  number: string | null
  sellerName: string | null
  date: string | null
  net: number
}

// ---------------- Pomocnicze ----------------

export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number) as [number, number]
  const idx = y * 12 + (mo - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Tekst do porównań: małe litery bez polskich znaków, tylko litery i cyfry rozdzielone spacją. */
export function normName(s: string): string {
  return s
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Tekst (kontrahent / sprzedawca) dotyczy osoby: nazwa z karty albo imię i nazwisko jako osobne słowa (w dowolnej kolejności). */
export function matchesPerson(text: string, e: Pick<StaffEmployeeInput, 'firstName' | 'lastName' | 'billingName'>): boolean {
  const t = ` ${normName(text)} `
  if (t.trim() === '') return false
  const billing = e.billingName ? normName(e.billingName) : ''
  if (billing && t.includes(` ${billing} `)) return true
  const first = normName(e.firstName)
  const last = normName(e.lastName)
  return !!first && !!last && t.includes(` ${first} `) && t.includes(` ${last} `)
}

/** Miesiąc, za który jest wypłata: „WYNAGRODZENIE 10/2026” → 2026-10; bez okresu — miesiąc księgowania. */
export function payoutMonth(tx: Pick<StaffBankTxInput, 'bookingDate' | 'title' | 'description'>): string {
  const m = /WYNAGRODZENIE\s+(\d{1,2})[/.-](\d{4})\b/i.exec(`${tx.title ?? ''} ${tx.description}`)
  if (m) {
    const mo = Number(m[1])
    const y = Number(m[2])
    const booking = tx.bookingDate.slice(0, 7)
    const period = `${y}-${String(mo).padStart(2, '0')}`
    // Okres z tytułu tylko, gdy wiarygodny (do 3 miesięcy przed datą księgowania).
    if (mo >= 1 && mo <= 12 && period <= booking && period >= addMonths(booking, -3)) return period
  }
  return tx.bookingDate.slice(0, 7)
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const isPit = (t: Pick<StaffBankTxInput, 'kind' | 'title'>) => t.kind === 'tax' && /\bPIT-?\d/i.test(t.title ?? '')

/** Zlecenie: status ucznia / studenta obowiązuje w miesiącu (bez daty — bezterminowo). */
const studentIn = (e: StaffEmployeeInput, m: string) => e.isStudent && (!e.studentUntil || e.studentUntil >= monthStart(m))

// ---------------- Obliczenie ----------------

export interface StaffCostsArgs {
  year: string
  today: string
  employees: StaffEmployeeInput[]
  /** Wydatki z wyciągów (od co najmniej 6 miesięcy przed rokiem / bieżącym miesiącem). */
  bank: StaffBankTxInput[]
  /** Faktury kosztowe w PLN (jak wyżej). */
  invoices: StaffInvoiceInput[]
  workingDays: (from: string, to: string) => number
}

export function buildStaffCosts(a: StaffCostsArgs): StaffCostsResponse {
  const months = Array.from({ length: 12 }, (_, i) => `${a.year}-${String(i + 1).padStart(2, '0')}`)
  const currentMonth = a.today.slice(0, 7)
  const bankUntil = a.bank.reduce<string | null>((max, t) => (!max || t.bookingDate > max ? t.bookingDate : max), null)
  const bankUntilMonth = bankUntil?.slice(0, 7) ?? null

  const payTx = a.bank.filter((t) => t.kind === 'salary' || t.kind === 'transfer')
  const usedTx = new Set<string>()
  const usedInv = new Set<string>()
  const missingContract: string[] = []

  // Kolejność: najpierw osoby z nazwą z karty (dokładniejsze dopasowanie), potem po nazwisku.
  const people = [...a.employees].sort((x, y) => Number(!!y.billingName) - Number(!!x.billingName))
  const rows: StaffCostRow[] = []

  for (const e of people) {
    const contractType = (e.contractType as ContractType | null) ?? null
    const group = staffGroup(contractType)
    const text = (t: StaffBankTxInput) => `${t.counterpartyName ?? ''} ${t.counterpartyName ? '' : t.description}`
    const myTx = payTx.filter((t) => !usedTx.has(t.id) && matchesPerson(text(t), e))
    myTx.forEach((t) => usedTx.add(t.id))
    const myInv = group === 'b2b' ? a.invoices.filter((i) => !usedInv.has(i.id) && matchesPerson(i.sellerName ?? '', e)) : []
    myInv.forEach((i) => usedInv.add(i.id))

    const bankBy = new Map<string, StaffDoc[]>()
    for (const t of myTx) {
      const m = payoutMonth(t)
      bankBy.set(m, [...(bankBy.get(m) ?? []), { date: t.bookingDate, label: t.title ?? t.description, amount: t.amount }])
    }
    const invBy = new Map<string, StaffDoc[]>()
    for (const i of myInv) {
      if (!i.date) continue
      const m = i.date.slice(0, 7)
      invBy.set(m, [...(invBy.get(m) ?? []), { date: i.date, label: i.number ?? i.sellerName ?? '', amount: i.net }])
    }
    const actualBy = group === 'b2b' ? invBy : group === 'employment' ? null : bankBy
    const actual = (m: string) => sum((actualBy?.get(m) ?? []).map((d) => d.amount))

    const card = (m: string) => staffCost(e, m, a.workingDays)
    const extendable = !!e.contractEnd && (e.isActive || e.contractEnd >= a.today)
    // Umowa kończy się przed końcem roku, a osoba nadal aktywna — widoczna także w kolejnych latach (prognoza po przedłużeniu).
    const endedButActive = extendable && e.contractEnd! < `${a.year}-12-31` && a.year >= currentMonth.slice(0, 4)
    const covered = months.some((m) => card(m)) || months.some((m) => actual(m) !== 0) || endedButActive
    if (!covered) continue
    if (!contractType) {
      if (e.isActive) missingContract.push(`${e.lastName} ${e.firstName}`)
      continue
    }

    // Podstawa prognozy (zlecenia, B2B): średnia z ostatnich miesięcy z płatnościami przed bieżącym.
    let forecastBasis: StaffCostRow['forecastBasis'] = null
    let basis = 0
    if (group !== 'employment') {
      const recent = Array.from({ length: FORECAST_LOOKBACK_MONTHS }, (_, i) => addMonths(currentMonth, -(i + 1)))
        .map(actual)
        .filter((v) => v > 0)
        .slice(0, FORECAST_AVG_MONTHS)
      if (recent.length) {
        basis = Math.round(sum(recent) / recent.length)
        forecastBasis = 'avg'
      }
    }
    const forecastPay = (m: string, ignoreEnd = false): number | null => {
      if (group === 'employment' || forecastBasis !== 'avg') {
        const r = ignoreEnd ? staffCost({ ...e, contractEnd: null, isActive: true }, m, a.workingDays) : card(m)
        if (!r || r.missingPay) return null
        if (group !== 'employment' && forecastBasis === null) forecastBasis = 'card'
        return r.pay
      }
      return basis
    }
    const rate = (m: string) => (group === 'b2b' ? 0 : employerRate(contractType, studentIn(e, m)))
    const withEmployer = (m: string, amount: number) => ({ amount, employer: Math.round((amount * rate(m)) / 100) })

    const endMonth = e.contractEnd?.slice(0, 7) ?? null
    const cells: StaffCostCell[] = months.map((m) => {
      const isForecast = m > currentMonth || (m === currentMonth && (group === 'employment' || actual(m) === 0))
      const inContract = !!card(m)
      const docs = group === 'b2b' ? (invBy.get(m) ?? []) : (bankBy.get(m) ?? [])
      const paid = sum((bankBy.get(m) ?? []).map((d) => d.amount))
      const marks: StaffCellMark[] = []
      if (e.contractStart?.slice(0, 7) === m) marks.push('contract_start')
      if (endMonth === m) marks.push('contract_end')
      if (endMonth && m > endMonth) marks.push('after_end')
      if (group === 'mandate' && e.isStudent && e.studentUntil?.slice(0, 7) === m) marks.push('student_end')

      let amount = 0
      let employer = 0
      let source: StaffCellSource | null = null
      let extended: StaffCostCell['extended'] = null
      if (group === 'employment') {
        const r = card(m)
        if (r && !r.missingPay) {
          amount = r.pay
          employer = r.employerCost
          source = isForecast ? 'forecast' : 'card'
        }
      } else if (!isForecast) {
        const v = actual(m)
        if (v !== 0) ({ amount, employer } = withEmployer(m, v))
        if (v !== 0) source = group === 'b2b' ? 'invoice' : 'bank'
      } else if (inContract) {
        const v = forecastPay(m)
        if (v) {
          ;({ amount, employer } = withEmployer(m, v))
          source = 'forecast'
        }
      }
      if (isForecast && !inContract && extendable && endMonth && m > endMonth) {
        const v = forecastPay(m, true)
        if (v) extended = withEmployer(m, v)
      }
      // Płatność po końcu umowy (miesiąc po końcu dopuszczalny — rozliczenie ostatniego miesiąca).
      const lateActual = group === 'employment' ? paid : actual(m)
      if (endMonth && m > addMonths(endMonth, 1) && lateActual > 0 && !isForecast) marks.push('paid_after_end')
      return { month: m, amount, employer, source, extended, paid, docs, marks }
    })

    const issues: StaffIssue[] = []
    if (e.contractEnd) {
      const days = daysBetween(a.today, e.contractEnd)
      if (days < 0 && e.isActive) issues.push({ code: 'expired', severity: 'red', date: e.contractEnd })
      else if (days >= 0 && days <= STAFF_ENDS_SOON_DAYS) issues.push({ code: 'ends_soon', severity: 'orange', date: e.contractEnd })
      else if (days > STAFF_ENDS_SOON_DAYS && e.contractEnd.startsWith(a.year)) issues.push({ code: 'ends_this_year', severity: 'yellow', date: e.contractEnd })
    }
    const late = cells.find((c) => c.marks.includes('paid_after_end'))
    if (late) issues.push({ code: 'paid_after_end', severity: 'red', month: late.month, date: e.contractEnd })
    if (group === 'employment' && months.some((m) => card(m)?.missingPay)) issues.push({ code: 'missing_pay', severity: 'orange' })
    if (group === 'mandate' && e.isStudent && e.studentUntil && e.studentUntil >= a.today && e.studentUntil.startsWith(a.year))
      issues.push({ code: 'student_ends', severity: 'yellow', date: e.studentUntil })
    // Brak płatności w 2 ostatnich zamkniętych miesiącach (dla zleceń tylko w okresie, za który są wyciągi).
    if (group !== 'employment' && card(currentMonth)) {
      const check = [addMonths(currentMonth, -1), addMonths(currentMonth, -2)].filter((m) => group === 'b2b' || (bankUntilMonth && m <= bankUntilMonth))
      if (check.length === 2 && check.every((m) => actual(m) === 0)) issues.push({ code: 'no_recent_payments', severity: 'gray' })
    }

    rows.push({
      employeeId: e.id,
      name: `${e.lastName} ${e.firstName}`,
      position: e.position,
      contractType,
      group,
      contractStart: e.contractStart,
      contractEnd: e.contractEnd,
      isActive: e.isActive,
      isStudent: e.isStudent,
      studentUntil: e.studentUntil,
      payBasis: (e.payBasis as PayBasis | null) ?? null,
      payAmount: e.payAmount,
      billingName: e.billingName,
      cells,
      forecastBasis: group === 'employment' ? 'card' : forecastBasis,
      issues,
    })
  }
  rows.sort((x, y) => x.name.localeCompare(y.name, 'pl'))

  const yearTx = a.bank.filter((t) => t.bookingDate.startsWith(a.year))
  const bank: StaffBankMonth[] = months.map((m) => {
    const inM = yearTx.filter((t) => t.bookingDate.startsWith(m))
    return {
      month: m,
      salaries: sum(inM.filter((t) => t.kind === 'salary').map((t) => t.amount)),
      zus: sum(inM.filter((t) => t.kind === 'zus').map((t) => t.amount)),
      pit: sum(inM.filter(isPit).map((t) => t.amount)),
    }
  })
  const unmatched = yearTx
    .filter((t) => t.kind === 'salary' && !usedTx.has(t.id))
    .map((t) => ({ date: t.bookingDate, name: t.counterpartyName, title: t.title, amount: t.amount }))
    .sort((x, y) => x.date.localeCompare(y.date))

  return { year: a.year, today: a.today, currentMonth, months, rows, bank, bankUntil, unmatched, missingContract: missingContract.sort((x, y) => x.localeCompare(y, 'pl')) }
}
