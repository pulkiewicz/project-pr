/**
 * Ewidencja czasu pracy — wspólna logika dat, godzin i walidacji.
 * Przeniesiona 1:1 z aplikacji „workload-calendar” (`shared/hours.js`), żeby sumy w ekranie pracownika,
 * w panelu, w Excelu i w historycznych wpisach były identyczne. Używana przez frontend i przez API.
 * Wszystkie obliczenia dat prowadzone są w UTC (odporność na zmianę czasu i strefę przeglądarki).
 */

// ---------------------------------------------------------------------------
// Identyfikatory pracowników
// ---------------------------------------------------------------------------

/** Alfabet bez znaków mylących się wzrokowo (brak I, O, 0, 1). */
export const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ID_LENGTH = 8

/** Normalizuje ID wpisane przez użytkownika: wielkie litery, bez myślników i spacji; null, gdy niepoprawne. */
export function normalizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (cleaned.length !== ID_LENGTH) return null
  for (const ch of cleaned) {
    if (!ID_ALPHABET.includes(ch)) return null
  }
  return cleaned
}

/** Formatuje ID do postaci czytelnej dla człowieka: XXXX-XXXX. */
export function formatId(id: string | null | undefined): string {
  if (typeof id !== 'string' || id.length !== ID_LENGTH) return id ?? ''
  return `${id.slice(0, 4)}-${id.slice(4)}`
}

// ---------------------------------------------------------------------------
// Nazewnictwo po polsku
// ---------------------------------------------------------------------------

/** Nazwy dni tygodnia, indeks 1 = poniedziałek ... 7 = niedziela. */
export const DAY_NAMES = [null, 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'] as const

/** Skróty dni tygodnia, indeks 1 = poniedziałek ... 7 = niedziela. */
export const DAY_SHORT = [null, 'pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'] as const

/** Nazwy miesięcy w mianowniku, indeks 1 = styczeń. */
export const MONTH_NAMES = [
  null, 'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
] as const

/** Nazwy miesięcy w dopełniaczu (używane przy datach: „28 września”). */
export const MONTH_NAMES_GENITIVE = [
  null, 'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
] as const

// ---------------------------------------------------------------------------
// Daty (stringi YYYY-MM-DD, obliczenia w UTC)
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000

/** Czy string jest poprawną, istniejącą datą YYYY-MM-DD. */
export function isValidDate(str: unknown): str is string {
  return parseDate(str) !== null
}

/** Zamienia "YYYY-MM-DD" na obiekt Date w UTC; odrzuca daty nieistniejące (np. 2026-02-30). */
export function parseDate(str: unknown): Date | null {
  if (typeof str !== 'string') return null
  const m = DATE_RE.exec(str)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  // Wykrywa "przewinięcie" miesiąca, np. 31 lutego -> 3 marca.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null
  }
  return d
}

/** Zamienia obiekt Date na string YYYY-MM-DD (wg UTC). */
export function toISODate(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0')
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function mustParse(dateStr: string): Date {
  const d = parseDate(dateStr)
  if (!d) throw new Error(`Niepoprawna data: ${dateStr}`)
  return d
}

/** Dodaje (lub odejmuje) dni do daty YYYY-MM-DD. */
export function addDays(dateStr: string, amount: number): string {
  return toISODate(new Date(mustParse(dateStr).getTime() + amount * DAY_MS))
}

/** Liczba dni pomiędzy dwiema datami (to - from). */
export function daysBetween(fromStr: string, toStr: string): number {
  const a = parseDate(fromStr)
  const b = parseDate(toStr)
  if (!a || !b) throw new Error('Niepoprawny zakres dat')
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/** Dzień tygodnia: 1 = poniedziałek ... 7 = niedziela. */
export function dayOfWeek(dateStr: string): number {
  return ((mustParse(dateStr).getUTCDay() + 6) % 7) + 1
}

/** Czy data wypada w sobotę lub niedzielę. */
export function isWeekend(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr)
  return dow === 6 || dow === 7
}

/** Poniedziałek tygodnia, w którym leży podana data. */
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -(dayOfWeek(dateStr) - 1))
}

/** Tablica 7 dat (poniedziałek -> niedziela) dla tygodnia zawierającego datę. */
export function weekDates(dateStr: string): string[] {
  const monday = startOfWeek(dateStr)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Numer tygodnia wg ISO 8601 (1-53). */
export function isoWeekNumber(dateStr: string): number {
  const d = mustParse(dateStr)
  // Czwartek bieżącego tygodnia wyznacza rok i numer tygodnia ISO.
  const thursday = new Date(d.getTime() + (4 - dayOfWeek(dateStr)) * DAY_MS)
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  return Math.floor((thursday.getTime() - yearStart.getTime()) / DAY_MS / 7) + 1
}

/** Rok wg ISO 8601 (może różnić się od roku kalendarzowego na przełomie lat). */
export function isoWeekYear(dateStr: string): number {
  const d = mustParse(dateStr)
  const thursday = new Date(d.getTime() + (4 - dayOfWeek(dateStr)) * DAY_MS)
  return thursday.getUTCFullYear()
}

// ---------------------------------------------------------------------------
// Miesiące (stringi YYYY-MM)
// ---------------------------------------------------------------------------

/** Czy string jest poprawnym kluczem miesiąca YYYY-MM. */
export function isValidMonth(str: unknown): str is string {
  if (typeof str !== 'string') return false
  const m = MONTH_RE.exec(str)
  if (!m) return false
  const month = Number(m[2])
  return month >= 1 && month <= 12
}

/** Klucz miesiąca "YYYY-MM" dla podanej daty. */
export function monthKey(dateStr: string): string {
  if (!isValidDate(dateStr)) throw new Error(`Niepoprawna data: ${dateStr}`)
  return dateStr.slice(0, 7)
}

/** Liczba dni w miesiącu YYYY-MM. */
export function daysInMonth(month: string): number {
  if (!isValidMonth(month)) throw new Error(`Niepoprawny miesiąc: ${month}`)
  const year = Number(month.slice(0, 4))
  const mon = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, mon, 0)).getUTCDate()
}

/** Wszystkie daty miesiąca jako tablica stringów YYYY-MM-DD. */
export function monthDates(month: string): string[] {
  const count = daysInMonth(month)
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** Przesuwa miesiąc o podaną liczbę miesięcy (może być ujemna). */
export function addMonths(month: string, amount: number): string {
  if (!isValidMonth(month)) throw new Error(`Niepoprawny miesiąc: ${month}`)
  const year = Number(month.slice(0, 4))
  const mon = Number(month.slice(5, 7))
  const d = new Date(Date.UTC(year, mon - 1 + amount, 1))
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Lista kluczy miesięcy pokrytych przez zakres dat (włącznie z krańcami); tydzień na przełomie miesięcy da dwa klucze. */
export function monthsInRange(fromStr: string, toStr: string): string[] {
  if (!isValidDate(fromStr) || !isValidDate(toStr)) throw new Error('Niepoprawny zakres dat')
  if (fromStr > toStr) throw new Error('Data początkowa jest późniejsza niż końcowa')
  const months: string[] = []
  let current = monthKey(fromStr)
  const last = monthKey(toStr)
  while (current <= last) {
    months.push(current)
    current = addMonths(current, 1)
  }
  return months
}

/** Lista kluczy miesięcy od-do włącznie (oba argumenty YYYY-MM) — zbiorcze podsumowanie w panelu. */
export function monthRange(fromMonth: string, toMonth: string): string[] {
  if (!isValidMonth(fromMonth) || !isValidMonth(toMonth)) throw new Error('Niepoprawny zakres miesięcy')
  if (fromMonth > toMonth) throw new Error('Miesiąc początkowy jest późniejszy niż końcowy')
  const months: string[] = []
  let current = fromMonth
  while (current <= toMonth) {
    months.push(current)
    current = addMonths(current, 1)
  }
  return months
}

/** Tablica dat od-do włącznie. */
export function datesInRange(fromStr: string, toStr: string): string[] {
  const span = daysBetween(fromStr, toStr)
  if (span < 0) throw new Error('Data początkowa jest późniejsza niż końcowa')
  return Array.from({ length: span + 1 }, (_, i) => addDays(fromStr, i))
}

// ---------------------------------------------------------------------------
// Formatowanie dat po polsku
// ---------------------------------------------------------------------------

/** "2026-09-28" -> "28.09.2026" */
export function formatDatePL(dateStr: string): string {
  if (!isValidDate(dateStr)) return dateStr
  return `${dateStr.slice(8, 10)}.${dateStr.slice(5, 7)}.${dateStr.slice(0, 4)}`
}

/** "2026-09-28" -> "28 września" (dopełniacz). */
export function formatDayMonth(dateStr: string): string {
  if (!isValidDate(dateStr)) return dateStr
  const day = Number(dateStr.slice(8, 10))
  const month = Number(dateStr.slice(5, 7))
  return `${day} ${MONTH_NAMES_GENITIVE[month]}`
}

/** "2026-09-28" -> "28 września 2026" */
export function formatDayMonthYear(dateStr: string): string {
  if (!isValidDate(dateStr)) return dateStr
  return `${formatDayMonth(dateStr)} ${dateStr.slice(0, 4)}`
}

/** "2026-09" -> "Wrzesień 2026" */
export function formatMonth(month: string): string {
  if (!isValidMonth(month)) return month
  return `${MONTH_NAMES[Number(month.slice(5, 7))]} ${month.slice(0, 4)}`
}

/** Etykieta tygodnia, np. „Tydzień 40 · 28.09 – 04.10.2026”. */
export function formatWeekLabel(dateStr: string): string {
  const dates = weekDates(dateStr)
  const from = dates[0]!
  const to = dates[6]!
  const fromShort = `${from.slice(8, 10)}.${from.slice(5, 7)}`
  return `Tydzień ${isoWeekNumber(from)} · ${fromShort} – ${formatDatePL(to)}`
}

// ---------------------------------------------------------------------------
// Godziny
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
export const MAX_HOURS_PER_DAY = 24

/** Czy string jest poprawną godziną HH:MM (24 h). */
export function isValidTime(str: unknown): str is string {
  return typeof str === 'string' && TIME_RE.test(str)
}

/** "07:30" -> 450 (minuty od północy). */
export function timeToMinutes(str: string): number {
  if (!isValidTime(str)) throw new Error(`Niepoprawna godzina: ${str}`)
  return Number(str.slice(0, 2)) * 60 + Number(str.slice(3, 5))
}

/** Zaokrąglenie do 2 miejsc po przecinku, odporne na błędy zmiennoprzecinkowe. */
export function roundHours(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Najmniejsza jednostka czasu w całej aplikacji — kwadrans.
 * Godziny rozliczamy w krokach co 15 minut: tak wyglądają listy płac,
 * a pracownik nie musi się zastanawiać, czy wpisać 8:07 czy 8:08.
 */
export const QUARTER_MINUTES = 15

/** Zaokrągla minuty do pełnego kwadransa. */
export function snapMinutesToQuarter(minutes: number | string): number {
  return Math.round(Number(minutes) / QUARTER_MINUTES) * QUARTER_MINUTES
}

/** Zaokrągla liczbę godzin do pełnego kwadransa (0,25 h). */
export function roundToQuarter(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 4 + Number.EPSILON) / 4
}

/** Zaokrągla godzinę HH:MM do najbliższego kwadransa; 23:53 przechodzi na 00:00 następnej doby. */
export function snapTimeToQuarter(str: string): string {
  const snapped = snapMinutesToQuarter(timeToMinutes(str)) % (24 * 60)
  const hh = String(Math.floor(snapped / 60)).padStart(2, '0')
  const mm = String(snapped % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Parsuje liczbę godzin wpisaną przez użytkownika; przecinek jako separator ("7,5" -> 7.5); null, gdy puste/niepoprawne. */
export function parseHoursInput(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(',', '.')
  if (trimmed === '') return null
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

/** Formatuje godziny po polsku: 7.5 -> "7,5"; 8 -> "8". */
export function formatHours(value: unknown): string {
  const num = roundHours(Number(value) || 0)
  return String(num).replace('.', ',')
}

/** Formatuje godziny z jednostką: "7,5 h". Zero zwraca jako pusty string. */
export function formatHoursShort(value: unknown): string {
  const num = roundHours(Number(value) || 0)
  return num === 0 ? '' : `${formatHours(num)} h`
}

/** Godziny pracy z zakresu od-do minus przerwa; 22:00 -> 06:00 to 8 godzin; wynik zawsze w pełnych kwadransach. */
export function computeRangeHours(start: string, end: string, breakMin: number | string = 0): number {
  const startMin = snapMinutesToQuarter(timeToMinutes(start))
  const endMin = snapMinutesToQuarter(timeToMinutes(end))
  let duration = endMin - startMin
  if (duration <= 0) duration += 24 * 60 // praca przez północ
  const pause = snapMinutesToQuarter(Number(breakMin) || 0)
  return roundToQuarter((duration - pause) / 60)
}

/** Gotowe długości przerwy do wyboru w formularzu (w minutach, co kwadrans). */
export const BREAK_OPTIONS = [0, 15, 30, 45, 60, 90] as const

export type EntryMode = 'range' | 'total'

/** Znormalizowany wpis jednego dnia (to, co trafia do bazy). */
export interface TimesheetEntry {
  mode: EntryMode
  start: string | null
  end: string | null
  breakMin: number
  hours: number
  note: string
}

/** Wpis z datą ostatniej zmiany — tak zwraca go API. */
export interface StoredTimesheetEntry extends TimesheetEntry {
  updatedAt: string | null
}

/** Surowy wpis z formularza lub z żądania HTTP (przed walidacją). */
export interface RawEntry {
  mode?: unknown
  start?: unknown
  end?: unknown
  breakMin?: unknown
  hours?: unknown
  note?: unknown
}

/** Dane formularza dnia w ekranie pracownika. */
export interface DayForm {
  start: string
  end: string
  breakMin: number
  note: string
  legacyHours: number
}

/** Pusty (nieuzupełniony) dzień w formie używanej przez formularz pracownika. */
export function emptyForm(): DayForm {
  return { start: '', end: '', breakMin: 0, note: '', legacyHours: 0 }
}

/**
 * Zamienia dane z formularza pracownika na surowy wpis dla validateEntry().
 * Pracownik podaje wyłącznie godziny od-do i przerwę. Tryb "suma godzin" nie jest dostępny w interfejsie,
 * ale wpisy zapisane wcześniej w tej formie (pole legacyHours) nie są kasowane przy ponownym zapisie tygodnia.
 */
export function rawFromForm(form: Partial<DayForm> | null | undefined): RawEntry {
  const start = typeof form?.start === 'string' ? form.start.trim() : ''
  const end = typeof form?.end === 'string' ? form.end.trim() : ''
  const note = form?.note ?? ''
  const legacy = Number(form?.legacyHours) || 0

  if (!start && !end && legacy > 0) {
    return { mode: 'total', start: null, end: null, breakMin: 0, hours: legacy, note }
  }
  return { mode: 'range', start, end, breakMin: form?.breakMin ?? 0, note }
}

/** Zamienia zapisany wpis na dane formularza pracownika. */
export function formFromEntry(entry: Partial<TimesheetEntry> | null | undefined): DayForm {
  if (!entry) return emptyForm()
  const isLegacyTotal = entry.mode === 'total' && Number(entry.hours) > 0
  return {
    start: entry.start ?? '',
    end: entry.end ?? '',
    breakMin: Number(entry.breakMin) || 0,
    note: entry.note ?? '',
    legacyHours: isLegacyTotal ? Number(entry.hours) : 0,
  }
}

/** Czy surowy wpis jest w praktyce pusty (nic nie wpisano) — pusty dzień jest zapisywany jako usunięcie. */
export function isEntryBlank(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true
  const r = raw as RawEntry
  const note = typeof r.note === 'string' ? r.note.trim() : ''
  if (note !== '') return false
  if (r.mode === 'total') {
    const hours = parseHoursInput(r.hours)
    return hours === null || hours === 0
  }
  const hasStart = typeof r.start === 'string' && r.start.trim() !== ''
  const hasEnd = typeof r.end === 'string' && r.end.trim() !== ''
  return !hasStart && !hasEnd
}

export type ValidationResult = { ok: true; error: null; entry: TimesheetEntry | null } | { ok: false; error: string; entry: null }

/**
 * Waliduje i normalizuje wpis jednego dnia. To JEDYNE źródło prawdy o godzinach —
 * API wywołuje dokładnie tę samą funkcję co frontend, więc sumy zawsze się zgadzają.
 * `entry === null` oznacza dzień pusty (do usunięcia).
 */
export function validateEntry(raw: unknown): ValidationResult {
  if (raw === null || raw === undefined) {
    return { ok: true, error: null, entry: null }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Nieprawidłowy format wpisu.', entry: null }
  }
  const r = raw as RawEntry

  const note = typeof r.note === 'string' ? r.note.trim() : ''
  if (note.length > 500) {
    return { ok: false, error: 'Uwagi mogą mieć maksymalnie 500 znaków.', entry: null }
  }

  if (isEntryBlank(r)) {
    return { ok: true, error: null, entry: null }
  }

  const mode: EntryMode = r.mode === 'total' ? 'total' : 'range'

  if (mode === 'total') {
    const hours = parseHoursInput(r.hours)
    if (hours === null) {
      return { ok: false, error: 'Podaj liczbę godzin (np. 7,5).', entry: null }
    }
    if (hours < 0) {
      return { ok: false, error: 'Liczba godzin nie może być ujemna.', entry: null }
    }
    if (hours > MAX_HOURS_PER_DAY) {
      return { ok: false, error: 'Liczba godzin nie może przekraczać 24.', entry: null }
    }
    return {
      ok: true,
      error: null,
      entry: { mode: 'total', start: null, end: null, breakMin: 0, hours: roundToQuarter(hours), note },
    }
  }

  // mode === 'range'
  const rawStart = typeof r.start === 'string' ? r.start.trim() : ''
  const rawEnd = typeof r.end === 'string' ? r.end.trim() : ''

  if (!rawStart && !rawEnd) {
    // Sama uwaga bez godzin — zapisujemy jako 0 h, żeby notatka nie przepadła.
    return {
      ok: true,
      error: null,
      entry: { mode: 'total', start: null, end: null, breakMin: 0, hours: 0, note },
    }
  }
  if (!rawStart) return { ok: false, error: 'Podaj godzinę rozpoczęcia.', entry: null }
  if (!rawEnd) return { ok: false, error: 'Podaj godzinę zakończenia.', entry: null }
  if (!isValidTime(rawStart)) return { ok: false, error: 'Niepoprawna godzina rozpoczęcia.', entry: null }
  if (!isValidTime(rawEnd)) return { ok: false, error: 'Niepoprawna godzina zakończenia.', entry: null }

  // Wszystko rozliczamy w kwadransach — godziny przyciągamy do pełnych 15 minut.
  const start = snapTimeToQuarter(rawStart)
  const end = snapTimeToQuarter(rawEnd)
  if (start === end) {
    return { ok: false, error: 'Godzina zakończenia musi różnić się od rozpoczęcia.', entry: null }
  }

  const breakRaw = r.breakMin === '' || r.breakMin === null || r.breakMin === undefined ? 0 : Number(String(r.breakMin).replace(',', '.'))
  if (!Number.isFinite(breakRaw) || breakRaw < 0) {
    return { ok: false, error: 'Przerwa musi być liczbą minut (0 lub więcej).', entry: null }
  }
  if (breakRaw > 24 * 60) {
    return { ok: false, error: 'Przerwa nie może przekraczać 1440 minut.', entry: null }
  }
  const breakMin = snapMinutesToQuarter(breakRaw)

  const hours = computeRangeHours(start, end, breakMin)
  if (hours <= 0) {
    return { ok: false, error: 'Przerwa jest dłuższa niż czas pracy.', entry: null }
  }
  if (hours > MAX_HOURS_PER_DAY) {
    return { ok: false, error: 'Liczba godzin nie może przekraczać 24.', entry: null }
  }

  return {
    ok: true,
    error: null,
    entry: { mode: 'range', start, end, breakMin, hours, note },
  }
}

type EntryLike = { hours?: unknown } | null | undefined

/** Sumuje godziny ze zbioru wpisów (mapa data->wpis albo tablica). */
export function sumHours(entries: Record<string, EntryLike> | EntryLike[] | null | undefined): number {
  const list = Array.isArray(entries) ? entries : Object.values(entries ?? {})
  let total = 0
  for (const entry of list) {
    if (entry && Number.isFinite(Number(entry.hours))) total += Number(entry.hours)
  }
  return roundHours(total)
}

/** Liczba dni, w których zapisano więcej niż 0 godzin. */
export function countWorkedDays(entries: Record<string, EntryLike> | EntryLike[] | null | undefined): number {
  const list = Array.isArray(entries) ? entries : Object.values(entries ?? {})
  return list.filter((entry) => entry && Number(entry.hours) > 0).length
}

// ---------------------------------------------------------------------------
// Pomocnicze dla nazw plików / arkuszy Excela
// ---------------------------------------------------------------------------

const PL_MAP: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z',
}

/** Zamienia polskie znaki na odpowiedniki ASCII. */
export function deaccent(text: unknown): string {
  return String(text ?? '').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => PL_MAP[ch] ?? ch)
}

/** Buduje bezpieczną nazwę pliku: bez polskich znaków, spacji i znaków specjalnych. */
export function safeFileName(text: unknown, fallback = 'plik'): string {
  const slug = deaccent(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || fallback
}

/** Bezpieczna nazwa arkusza Excela: max 31 znaków, bez znaków zakazanych w XLSX, unikalna w obrębie `used`. */
export function safeSheetName(text: unknown, used: string[] = []): string {
  let name = deaccent(text).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!name) name = 'Arkusz'
  name = name.slice(0, 31)
  if (!used.includes(name)) return name
  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`
    const candidate = name.slice(0, 31 - suffix.length) + suffix
    if (!used.includes(candidate)) return candidate
  }
  return name.slice(0, 28) + '~~~'
}
