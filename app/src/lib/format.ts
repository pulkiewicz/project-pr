import { differenceInCalendarDays, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

export const TZ = 'Europe/Warsaw'
export const LOCALE = 'pl-PL'

/** dd.MM.yyyy w strefie Europe/Warsaw. Akceptuje ISO timestamp albo datę `yyyy-MM-dd`. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-')
    return `${d}.${m}.${y}`
  }
  return formatInTimeZone(typeof value === 'string' ? parseISO(value) : value, TZ, 'dd.MM.yyyy')
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return formatInTimeZone(typeof value === 'string' ? parseISO(value) : value, TZ, 'dd.MM.yyyy HH:mm')
}

const numberFmt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const currencyFmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'PLN' })

/** 1 234 567,89 */
export const formatNumber = (n: number | string) => numberFmt.format(Number(n))
export const formatPLN = (n: number | string) => currencyFmt.format(Number(n))

/** Dzisiejsza data (yyyy-MM-dd) w Warszawie. */
export function todayWarsaw(now = new Date()): string {
  return formatInTimeZone(now, TZ, 'yyyy-MM-dd')
}

/** Dni kalendarzowe od dziś (Warszawa) do daty `yyyy-MM-dd`. */
export function daysUntil(date: string, now = new Date()): number {
  return differenceInCalendarDays(parseISO(date), parseISO(todayWarsaw(now)))
}
