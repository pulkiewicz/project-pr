import ExcelJS from 'exceljs'
import type { ImportInspectResponse, ImportIssue, ImportMapping, ImportPreviewResponse } from '#shared'
import { plannedDates } from '../../lib/dates.ts'

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024
const PREVIEW_ROWS = 30
const CODE_RE = /^\d+(\.\d+)*$/
const WEEKS_RE = /^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$/

export async function loadWorkbook(buf: ArrayBuffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer)
  return wb
}

/** Tekst komórki: wynik formuły, data jako yyyy-MM-dd, tekst sformatowany (zachowuje „2.10”). */
export function cellText(cell: ExcelJS.Cell): string {
  let v: unknown = cell.value
  if (v && typeof v === 'object' && 'result' in v) v = (v as { result: unknown }).result
  if (v && typeof v === 'object' && 'richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('').trim()
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    // Kod zapisany jako liczba (np. 2.1) — użyj tekstu wyświetlanego, by nie zgubić formatu.
    const shown = cell.text
    return (shown && shown !== 'NaN' ? shown : String(v)).trim()
  }
  return String(v).trim()
}

const colIndex = (letter: string) => letter.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)

const HEADER_HINTS: Record<keyof ImportMapping['columns'], RegExp> = {
  code: /^(l\.?\s*p\.?|lp|kod|nr)$/i,
  name: /(etap|nazwa|rodzaj prac|zadanie)/i,
  weeks: /tydz/i,
  party: /(wykonawca|strona|odpowiedzialn)/i,
  notes: /(uwagi|notatki)/i,
}

function columnLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function inspectWorkbook(wb: ExcelJS.Workbook): ImportInspectResponse {
  const sheets = wb.worksheets
    .filter((ws) => ws.state === 'visible')
    .map((ws) => {
      const rows: string[][] = []
      const last = Math.min(ws.rowCount, PREVIEW_ROWS)
      const cols = Math.min(ws.columnCount, 26)
      for (let r = 1; r <= last; r++) {
        const row = ws.getRow(r)
        rows.push(Array.from({ length: cols }, (_, i) => cellText(row.getCell(i + 1))))
      }
      return { name: ws.name, rows }
    })

  // Sugestia: pierwszy arkusz z wierszem nagłówka pasującym do kodu, nazwy i tygodni.
  let suggested: Partial<ImportMapping> | null = null
  const partyValuesFound: Record<string, string[]> = {}
  for (const s of sheets) {
    for (let r = 0; r < s.rows.length && !suggested; r++) {
      const found: Partial<ImportMapping['columns']> = {}
      s.rows[r]!.forEach((text, i) => {
        for (const [field, re] of Object.entries(HEADER_HINTS) as [keyof ImportMapping['columns'], RegExp][]) {
          if (!found[field] && re.test(text)) found[field] = columnLetter(i + 1)
        }
      })
      if (found.code && found.name && found.weeks) {
        suggested = { sheet: s.name, headerRow: r + 1, columns: found as ImportMapping['columns'] }
      }
    }
  }
  for (const ws of wb.worksheets) {
    const values = new Set<string>()
    const partyCol = suggested?.sheet === ws.name ? suggested.columns?.party : undefined
    if (partyCol) {
      for (let r = (suggested!.headerRow ?? 1) + 1; r <= ws.rowCount; r++) {
        const v = cellText(ws.getRow(r).getCell(colIndex(partyCol)))
        if (v) values.add(v)
      }
      partyValuesFound[ws.name] = [...values].sort()
    }
  }
  return { sheets, suggested, partyValuesFound }
}

/** Wartości z kolumny strony w wybranym arkuszu (do mapowania w kreatorze). */
export function distinctColumnValues(wb: ExcelJS.Workbook, sheet: string, headerRow: number, col: string) {
  const ws = wb.getWorksheet(sheet)
  if (!ws) return []
  const values = new Set<string>()
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const v = cellText(ws.getRow(r).getCell(colIndex(col)))
    if (v) values.add(v)
  }
  return [...values].sort()
}

export interface ParsedTask {
  row: number
  code: string
  name: string
  parentCode: string | null
  startOffsetDays: number
  durationDays: number
  party: string
  isAcceptancePoint: boolean
  postAcceptanceAllowed: boolean
  notes: string | null
  sortOrder: number
}

export interface ParseResult {
  tasks: ParsedTask[]
  issues: ImportIssue[]
}

const parentOf = (code: string) => (code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : null)

export function parseTasks(wb: ExcelJS.Workbook, m: ImportMapping): ParseResult {
  const issues: ImportIssue[] = []
  const ws = wb.getWorksheet(m.sheet)
  if (!ws) return { tasks: [], issues: [{ row: 0, severity: 'error', message: `Brak arkusza „${m.sheet}”` }] }

  const tasks: ParsedTask[] = []
  const seen = new Map<string, number>()
  const postStages = new Set(m.postAcceptanceStageCodes)
  const get = (row: ExcelJS.Row, col?: string) => (col ? cellText(row.getCell(colIndex(col))) : '')

  for (let r = m.headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const code = get(row, m.columns.code)
    const name = get(row, m.columns.name)
    if (!code && !name) continue
    if (!CODE_RE.test(code)) {
      issues.push({ row: r, severity: 'warning', message: `Pominięto — „${code || name}” nie jest kodem HRF` })
      continue
    }
    if (!name) {
      issues.push({ row: r, code, severity: 'error', message: 'Brak nazwy' })
      continue
    }
    if (seen.has(code)) {
      issues.push({ row: r, code, severity: 'error', message: `Zduplikowany kod (także w wierszu ${seen.get(code)})` })
      continue
    }
    seen.set(code, r)

    const weeks = get(row, m.columns.weeks)
    const wm = WEEKS_RE.exec(weeks)
    if (!wm) {
      issues.push({ row: r, code, severity: 'error', message: `Niepoprawny termin „${weeks}” (oczekiwano „a-b” lub „n”)` })
      continue
    }
    const from = Number(wm[1])
    const to = Number(wm[2] ?? wm[1])
    if (from < 1 || to < from) {
      issues.push({ row: r, code, severity: 'error', message: `Niepoprawny zakres tygodni „${weeks}”` })
      continue
    }

    const partyRaw = get(row, m.columns.party)
    let party: string = m.emptyParty
    let isAcceptancePoint = false
    if (partyRaw) {
      const mapped = m.partyValues[partyRaw]
      if (!mapped) {
        issues.push({ row: r, code, severity: 'error', message: `Nieznana wartość strony „${partyRaw}” — uzupełnij mapowanie` })
        continue
      }
      party = mapped.party
      isAcceptancePoint = mapped.acceptancePoint
    }

    const parentCode = parentOf(code)
    if (parentCode && !seen.has(parentCode)) {
      issues.push({ row: r, code, severity: 'error', message: `Brak nadrzędnego Etapu/zadania „${parentCode}” przed tym wierszem` })
      continue
    }
    const root = code.split('.')[0]!
    const postAcceptanceAllowed = [...postStages].some((s) => code === s || code.startsWith(`${s}.`) || root === s)

    tasks.push({
      row: r,
      code,
      name,
      parentCode,
      startOffsetDays: (from - 1) * 7,
      durationDays: (to - from + 1) * 7,
      party,
      isAcceptancePoint,
      postAcceptanceAllowed,
      notes: get(row, m.columns.notes) || null,
      sortOrder: tasks.length,
    })
  }

  // Spójność: zadanie poza zakresem Etapu nadrzędnego → ostrzeżenie.
  const byCode = new Map(tasks.map((t) => [t.code, t]))
  for (const t of tasks) {
    const p = t.parentCode ? byCode.get(t.parentCode) : undefined
    if (p && (t.startOffsetDays < p.startOffsetDays || t.startOffsetDays + t.durationDays > p.startOffsetDays + p.durationDays)) {
      issues.push({ row: t.row, code: t.code, severity: 'warning', message: `Termin wykracza poza zakres nadrzędnego „${p.code}”` })
    }
  }
  if (!tasks.length) issues.push({ row: 0, severity: 'error', message: 'Nie znaleziono żadnych zadań' })
  return { tasks, issues }
}

export interface ExistingTask {
  code: string
  name: string
  parentCode: string | null
  startOffsetDays: number
  durationDays: number
  party: string
  isAcceptancePoint: boolean
  postAcceptanceAllowed: boolean
  notes: string | null
}

/** Pola nadpisywane przy re-imporcie. Nigdy: actual_*, status, % wykonania, prognoza, odpowiedzialny, party (może być zawężone ręcznie). */
export const REIMPORT_FIELDS = ['name', 'parentCode', 'startOffsetDays', 'durationDays', 'isAcceptancePoint', 'postAcceptanceAllowed'] as const

export function buildPreview(
  parsed: ParseResult,
  existing: ExistingTask[],
  ctx: { dayZero: string | null; contractEnd: string; notesMapped: boolean },
): ImportPreviewResponse {
  const issues = [...parsed.issues]
  if (!ctx.dayZero) {
    issues.push({ row: 0, severity: 'warning', message: 'Dzień „0” nie jest ustawiony — daty planowane i zgodność z terminem umownym zostaną sprawdzone po jego ustawieniu' })
  }
  const tasks = parsed.tasks.map((t) => {
    const { plannedStart, plannedEnd } = plannedDates(ctx.dayZero, t.startOffsetDays, t.durationDays)
    if (plannedEnd && plannedEnd > ctx.contractEnd) {
      issues.push({
        row: t.row,
        code: t.code,
        severity: t.postAcceptanceAllowed ? 'warning' : 'error',
        message: t.postAcceptanceAllowed
          ? `Koniec ${plannedEnd} po terminie umownym — dopuszczone po odbiorze (§ 3 ust. 8)`
          : `Koniec ${plannedEnd} po terminie umownym ${ctx.contractEnd}`,
      })
    }
    return { ...t, plannedStart, plannedEnd }
  })

  const existingByCode = new Map(existing.map((e) => [e.code, e]))
  const fileCodes = new Set(tasks.map((t) => t.code))
  const diff: ImportPreviewResponse['diff'] = { created: [], updated: [], unchanged: [], missingInFile: [] }
  for (const t of parsed.tasks) {
    const e = existingByCode.get(t.code)
    if (!e) {
      diff.created.push(t.code)
      continue
    }
    const fields: string[] = REIMPORT_FIELDS.filter((f) => e[f] !== t[f])
    if (ctx.notesMapped && (e.notes ?? null) !== t.notes) fields.push('notes')
    if (e.party !== t.party) {
      issues.push({ row: t.row, code: t.code, severity: 'warning', message: `Strona w pliku (${t.party}) różni się od aplikacji (${e.party}) — zostaje wartość z aplikacji` })
    }
    if (fields.length) diff.updated.push({ code: t.code, fields })
    else diff.unchanged.push(t.code)
  }
  for (const e of existing) if (!fileCodes.has(e.code)) diff.missingInFile.push(e.code)
  if (diff.missingInFile.length) {
    issues.push({ row: 0, severity: 'warning', message: `Zadania w aplikacji nieobecne w pliku (nie zostaną usunięte): ${diff.missingInFile.join(', ')}` })
  }
  return {
    tasks: tasks.map(({ row, code, name, parentCode, startOffsetDays, durationDays, party, isAcceptancePoint, postAcceptanceAllowed, plannedStart, plannedEnd }) => ({
      row, code, name, parentCode, startOffsetDays, durationDays, party, isAcceptancePoint, postAcceptanceAllowed, plannedStart, plannedEnd,
    })),
    issues,
    diff,
    canCommit: !issues.some((i) => i.severity === 'error'),
  }
}
