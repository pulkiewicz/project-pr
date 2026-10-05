/** Tydzień ISO (pon–niedz) na datach `yyyy-MM-dd`, arytmetyka w UTC. Format tygodnia: `2026-W41`. */
const DAY = 86_400_000

const parse = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return Date.UTC(y!, m! - 1, day!)
}
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const ISO_WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

export function isoWeekOf(date: string): string {
  const ms = parse(date)
  const dow = (new Date(ms).getUTCDay() + 6) % 7 // 0 = poniedziałek
  const thursday = ms + (3 - dow) * DAY
  const year = new Date(thursday).getUTCFullYear()
  const jan4 = Date.UTC(year, 0, 4)
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7
  const week1Monday = jan4 - jan4dow * DAY
  const week = Math.floor((thursday - week1Monday) / (7 * DAY)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Poniedziałek tygodnia ISO. */
export function weekStart(isoWeek: string): string {
  const [y, w] = isoWeek.split('-W').map(Number)
  const jan4 = Date.UTC(y!, 0, 4)
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7
  return fmt(jan4 - jan4dow * DAY + (w! - 1) * 7 * DAY)
}

export const weekEnd = (isoWeek: string) => fmt(parse(weekStart(isoWeek)) + 6 * DAY)

export function addWeeks(isoWeek: string, n: number): string {
  return isoWeekOf(fmt(parse(weekStart(isoWeek)) + n * 7 * DAY))
}

/** Dzień tygodnia (0 = pon … 6 = niedz) → data. */
export const weekDay = (isoWeek: string, i: number) => fmt(parse(weekStart(isoWeek)) + i * DAY)

/** Czy przedział [start, end] nachodzi na tydzień. */
export function overlapsWeek(isoWeek: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false
  return start <= weekEnd(isoWeek) && end >= weekStart(isoWeek)
}

/** Maska dni planowanych (bit 0 = poniedziałek). */
export const daysToMask = (days: number[]) => days.reduce((m, d) => m | (1 << d), 0)
export const maskToDays = (mask: number) => [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d))
