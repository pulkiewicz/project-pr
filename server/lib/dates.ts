import Holidays from 'date-holidays'
import { formatInTimeZone } from 'date-fns-tz'

/** Daty bez czasu przechowujemy jako `yyyy-MM-dd`; arytmetyka w UTC (bez wpływu zmiany czasu). */
const DAY = 86_400_000

export function parseDate(d: string): number {
  const [y, m, day] = d.split('-').map(Number)
  return Date.UTC(y!, m! - 1, day!)
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(d: string, days: number): string {
  return formatDate(parseDate(d) + days * DAY)
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a) - parseDate(b)) / DAY)
}

export const maxDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b)

/** Dzisiejsza data w strefie Europe/Warsaw. */
export function todayWarsaw(now: Date = new Date()): string {
  return formatInTimeZone(now, 'Europe/Warsaw', 'yyyy-MM-dd')
}

/**
 * Daty planowane z kotwicy dnia „0” (jak B2 w Excelu HRF):
 * start = dzień0 + offset, koniec = start + czas trwania − 1 (włącznie).
 */
export function plannedDates(dayZero: string | null, offset: number, duration: number) {
  if (!dayZero) return { plannedStart: null, plannedEnd: null }
  const plannedStart = addDays(dayZero, offset)
  return { plannedStart, plannedEnd: addDays(plannedStart, duration - 1) }
}

const hd = new Holidays('PL')
const holidayCache = new Map<number, Set<string>>()

function holidaysOf(year: number): Set<string> {
  let set = holidayCache.get(year)
  if (!set) {
    set = new Set(
      hd
        .getHolidays(year)
        .filter((h) => h.type === 'public')
        .map((h) => h.date.slice(0, 10)),
    )
    holidayCache.set(year, set)
  }
  return set
}

export function isWorkingDay(d: string): boolean {
  const dow = new Date(parseDate(d)).getUTCDay()
  if (dow === 0 || dow === 6) return false
  return !holidaysOf(Number(d.slice(0, 4))).has(d)
}

/** Liczba dni roboczych w przedziale (from, to] — od jutra do dnia terminu włącznie. */
export function workingDaysBetween(from: string, to: string): number {
  if (to <= from) return 0
  let n = 0
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorkingDay(d)) n++
  return n
}

/** Data `n` dni roboczych przed `d` (weekendy i święta PL pomijane). */
export function subtractWorkingDays(d: string, n: number): string {
  let cur = d
  let left = n
  while (left > 0) {
    cur = addDays(cur, -1)
    if (isWorkingDay(cur)) left--
  }
  return cur
}
