/**
 * Generowanie plików Excel w przeglądarce — przeniesione 1:1 z workload-calendar (src/excel.js):
 * te same arkusze, formuły z wynikami, nazwy plików i formatowanie.
 * ExcelJS ładowany jest dynamicznym importem — trafia do osobnego chunku
 * i nie obciąża pierwszego wejścia na stronę.
 *
 * Formuły zapisujemy razem z wyliczonym wynikiem ({ formula, result }),
 * żeby plik pokazywał poprawne liczby także w programach, które nie przeliczają
 * arkusza po otwarciu (np. podgląd w telefonie).
 */

import type ExcelJS from 'exceljs'
import { hours as H, type TimesheetReportResponse, type TimesheetSummaryResponse } from '#shared'

const {
  DAY_NAMES,
  DAY_SHORT,
  formatDatePL,
  formatId,
  formatMonth,
  monthDates,
  isWeekend,
  dayOfWeek,
  safeFileName,
  safeSheetName,
  sumHours,
  countWorkedDays,
  roundHours,
} = H

type ReportEmployee = TimesheetReportResponse['employees'][number]
type Built = { workbook: ExcelJS.Workbook; fileName: string; title: string }

let excelJsPromise: Promise<typeof ExcelJS> | null = null

/** Ładuje ExcelJS raz i zapamiętuje wynik. */
async function loadExcelJs(): Promise<typeof ExcelJS> {
  excelJsPromise ??= import('exceljs').then((mod) => (mod as unknown as { default?: typeof ExcelJS }).default ?? (mod as unknown as typeof ExcelJS))
  return excelJsPromise
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

const INK = 'FF1B3A6B'
const GREY_FILL = 'FFEFEDE7'
const TOTAL_FILL = 'FFEEF2F9'

/** Numer kolumny (1-based) na literę Excela: 1 -> A, 27 -> AA. */
export function columnLetter(index: number) {
  let result = ''
  let n = index
  while (n > 0) {
    const rest = (n - 1) % 26
    result = String.fromCharCode(65 + rest) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

const A4_PORTRAIT: Partial<ExcelJS.PageSetup> = {
  paperSize: 9,
  orientation: 'portrait',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  margins: {
    left: 0.4,
    right: 0.4,
    top: 0.5,
    bottom: 0.5,
    header: 0.2,
    footer: 0.2,
  },
}

const A4_LANDSCAPE: Partial<ExcelJS.PageSetup> = {
  paperSize: 9,
  orientation: 'landscape',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  margins: {
    left: 0.3,
    right: 0.3,
    top: 0.4,
    bottom: 0.4,
    header: 0.2,
    footer: 0.2,
  },
}

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function border(cell: ExcelJS.Cell) {
  const thin: Partial<ExcelJS.Border> = {
    style: 'thin',
    color: { argb: 'FFD0D0D0' },
  }
  cell.border = { top: thin, left: thin, bottom: thin, right: thin }
}

/** Typ MIME plików .xlsx — używany i przy pobieraniu, i przy wysyłce na Dysk Google. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Zamienia gotowy skoroszyt na plik w pamięci.
 * Rozdzielone od pobierania, bo ten sam plik trafia albo na dysk, albo na Dysk Google.
 * @param {{workbook: object, fileName: string, title: string}} built wynik funkcji build*
 * @returns {Promise<{blob: Blob, fileName: string, title: string}>}
 */
export async function workbookFile(built: Built) {
  const buffer = await built.workbook.xlsx.writeBuffer()
  return {
    blob: new Blob([buffer], { type: XLSX_MIME }),
    fileName: built.fileName,
    title: built.title,
  }
}

/** Zapisuje skoroszyt i uruchamia pobieranie pliku w przeglądarce. */
async function download(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: XLSX_MIME })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Zwolnienie po chwili — Safari potrzebuje, by URL żył w momencie kliknięcia.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------------------------------------------------------------------------
// Arkusz jednego pracownika
// ---------------------------------------------------------------------------

/**
 * Buduje arkusz z pełnym miesiącem jednego pracownika.
 * @param {object} sheet arkusz ExcelJS
 * @param {{id: string, name: string}} employee
 * @param {string} month YYYY-MM
 * @param {object} days mapa data -> wpis
 */
function buildEmployeeSheet(sheet: ExcelJS.Worksheet, employee: { id: string; name: string }, month: string, days: Record<string, H.StoredTimesheetEntry>) {
  const dates = monthDates(month)

  sheet.columns = [
    { key: 'date', width: 12 },
    { key: 'dow', width: 14 },
    { key: 'start', width: 12 },
    { key: 'end', width: 12 },
    { key: 'break', width: 12 },
    { key: 'hours', width: 10 },
    { key: 'note', width: 40 },
  ]

  // --- nagłówek dokumentu ---
  sheet.mergeCells('A1:G1')
  const title = sheet.getCell('A1')
  title.value = 'Ewidencja czasu pracy'
  title.font = { name: 'Calibri', size: 14, bold: true, color: { argb: INK } }
  title.alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 22

  sheet.mergeCells('A2:G2')
  sheet.getCell('A2').value = `Pracownik: ${employee.name}`
  sheet.getCell('A2').font = { bold: true, size: 11 }

  sheet.mergeCells('A3:G3')
  sheet.getCell('A3').value = `Identyfikator: ${formatId(employee.id)}`

  sheet.mergeCells('A4:G4')
  sheet.getCell('A4').value = `Miesiąc: ${formatMonth(month)}`

  sheet.addRow([])

  // --- nagłówek tabeli ---
  const headerRowIndex = 6
  const header = sheet.getRow(headerRowIndex)
  header.values = ['Data', 'Dzień tygodnia', 'Rozpoczęcie', 'Zakończenie', 'Przerwa (min)', 'Godziny', 'Uwagi']
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.alignment = { horizontal: 'center', vertical: 'middle' }
  header.height = 24
  header.eachCell((cell) => {
    fill(cell, INK)
    border(cell)
  })

  // --- dane ---
  const firstDataRow = headerRowIndex + 1
  for (const date of dates) {
    const entry = days?.[date] ?? null
    const weekend = isWeekend(date)
    const row = sheet.addRow([
      formatDatePL(date),
      DAY_NAMES[dayOfWeek(date)],
      entry?.start ?? '',
      entry?.end ?? '',
      entry?.breakMin ? entry.breakMin : '',
      entry && Number(entry.hours) ? roundHours(entry.hours) : '',
      entry?.note ?? '',
    ])

    row.eachCell({ includeEmpty: true }, (cell, col) => {
      border(cell)
      cell.alignment = col === 7 ? { horizontal: 'left', vertical: 'top', wrapText: true } : { horizontal: col === 2 ? 'left' : 'center', vertical: 'middle' }
      if (weekend) fill(cell, GREY_FILL)
    })
    row.getCell(6).numFmt = '0.00'
  }
  const lastDataRow = firstDataRow + dates.length - 1
  const hoursRange = `F${firstDataRow}:F${lastDataRow}`

  // --- podsumowanie (formuły + gotowy wynik) ---
  sheet.addRow([])
  const sumRow = sheet.addRow(['SUMA', '', '', '', '', null, ''])
  sumRow.getCell(1).font = { bold: true, color: { argb: INK } }
  sumRow.getCell(6).value = {
    formula: `SUM(${hoursRange})`,
    result: sumHours(days ?? {}),
  }
  sumRow.getCell(6).numFmt = '0.00'
  sumRow.getCell(6).font = { bold: true }
  for (const col of [1, 6]) {
    fill(sumRow.getCell(col), TOTAL_FILL)
    border(sumRow.getCell(col))
  }

  const daysRow = sheet.addRow(['Dni pracy', '', '', '', '', null, ''])
  daysRow.getCell(1).font = { bold: true, color: { argb: INK } }
  daysRow.getCell(6).value = {
    formula: `COUNTIF(${hoursRange},">0")`,
    result: countWorkedDays(days ?? {}),
  }
  daysRow.getCell(6).numFmt = '0'
  daysRow.getCell(6).font = { bold: true }
  for (const col of [1, 6]) {
    fill(daysRow.getCell(col), TOTAL_FILL)
    border(daysRow.getCell(col))
  }

  // --- widok ---
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }]
  sheet.pageSetup = {
    ...A4_PORTRAIT,
    printTitlesRow: `${headerRowIndex}:${headerRowIndex}`,
  }
  sheet.autoFilter = { from: `A${headerRowIndex}`, to: `G${headerRowIndex}` }
}

// ---------------------------------------------------------------------------
// Eksport: jeden pracownik
// ---------------------------------------------------------------------------

/**
 * Składa skoroszyt godzin jednego pracownika za dany miesiąc.
 * @param {{id:string,name:string,days:object}} employee
 * @param {string} month YYYY-MM
 * @returns {Promise<{workbook: object, fileName: string, title: string}>}
 */
export async function buildEmployeeWorkbook(employee: ReportEmployee, month: string): Promise<Built> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ewidencja czasu pracy'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(safeSheetName(employee.name))
  buildEmployeeSheet(sheet, employee, month, employee.days ?? {})

  return {
    workbook,
    fileName: `godziny_${safeFileName(employee.name, 'pracownik')}_${month}.xlsx`,
    title: `Godziny — ${employee.name} — ${formatMonth(month)}`,
  }
}

/** Pobiera plik godziny_{nazwisko}_{YYYY-MM}.xlsx dla jednego pracownika. */
export async function exportEmployeeWorkbook(employee: ReportEmployee, month: string) {
  const built = await buildEmployeeWorkbook(employee, month)
  await download(built.workbook, built.fileName)
}

// ---------------------------------------------------------------------------
// Eksport: zestawienie zbiorcze
// ---------------------------------------------------------------------------

/**
 * Pobiera plik zestawienie_godzin_{YYYY-MM}.xlsx:
 * arkusz „Zestawienie” + osobny arkusz dla każdego pracownika.
 * @param {Array<{id:string,name:string,days:object,total:number}>} employees
 * @param {string} month YYYY-MM
 */
export async function buildSummaryWorkbook(employees: ReportEmployee[], month: string): Promise<Built> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ewidencja czasu pracy'
  workbook.created = new Date()

  const dates = monthDates(month)
  const sheet = workbook.addWorksheet('Zestawienie')

  const FIRST_DAY_COL = 3 // A = Pracownik, B = ID, C = pierwszy dzień
  const totalCol = FIRST_DAY_COL + dates.length
  const totalLetter = columnLetter(totalCol)

  sheet.columns = [{ width: 26 }, { width: 12 }, ...dates.map(() => ({ width: 5.5 })), { width: 10 }]

  // --- nagłówek dokumentu ---
  sheet.mergeCells(1, 1, 1, totalCol)
  const title = sheet.getCell('A1')
  title.value = `Zestawienie godzin — ${formatMonth(month)}`
  title.font = { name: 'Calibri', size: 14, bold: true, color: { argb: INK } }
  sheet.getRow(1).height = 22
  sheet.addRow([])

  // --- nagłówek tabeli: numer dnia + skrót dnia tygodnia ---
  const headerRowIndex = 3
  const header = sheet.getRow(headerRowIndex)
  header.getCell(1).value = 'Pracownik'
  header.getCell(2).value = 'ID'
  dates.forEach((date, i) => {
    const cell = header.getCell(FIRST_DAY_COL + i)
    cell.value = `${Number(date.slice(8, 10))}\n${DAY_SHORT[dayOfWeek(date)]}`
  })
  header.getCell(totalCol).value = 'Suma'
  header.height = 30
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  header.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  }
  for (let col = 1; col <= totalCol; col++) {
    fill(header.getCell(col), INK)
    border(header.getCell(col))
  }
  header.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }

  // --- wiersze pracowników ---
  const firstDataRow = headerRowIndex + 1
  employees.forEach((employee) => {
    const row = sheet.addRow([])
    row.getCell(1).value = employee.name
    row.getCell(2).value = formatId(employee.id)
    dates.forEach((date, i) => {
      const entry = employee.days?.[date]
      const cell = row.getCell(FIRST_DAY_COL + i)
      cell.value = entry && Number(entry.hours) ? roundHours(entry.hours) : null
      cell.numFmt = '0.00'
      if (isWeekend(date)) fill(cell, GREY_FILL)
    })

    const rowNo = row.number
    const sumCell = row.getCell(totalCol)
    sumCell.value = {
      formula: `SUM(${columnLetter(FIRST_DAY_COL)}${rowNo}:${columnLetter(totalCol - 1)}${rowNo})`,
      result: roundHours(employee.total ?? sumHours(employee.days ?? {})),
    }
    sumCell.numFmt = '0.00'
    sumCell.font = { bold: true }
    fill(sumCell, TOTAL_FILL)

    row.alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' }
    for (let col = 1; col <= totalCol; col++) border(row.getCell(col))
  })
  const lastDataRow = firstDataRow + employees.length - 1

  // --- wiersz RAZEM ---
  const totalsRow = sheet.addRow([])
  totalsRow.getCell(1).value = 'RAZEM'
  totalsRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
  totalsRow.font = { bold: true, color: { argb: INK } }

  const hasRows = employees.length > 0
  dates.forEach((date, i) => {
    const col = FIRST_DAY_COL + i
    const letter = columnLetter(col)
    const dayTotal = roundHours(employees.reduce((sum, e) => sum + (Number(e.days?.[date]?.hours) || 0), 0))
    const cell = totalsRow.getCell(col)
    cell.value = hasRows
      ? {
          formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
          result: dayTotal,
        }
      : 0
    cell.numFmt = '0.00'
  })

  const grandTotal = roundHours(employees.reduce((sum, e) => sum + (Number(e.total) || 0), 0))
  const grandCell = totalsRow.getCell(totalCol)
  grandCell.value = hasRows
    ? {
        formula: `SUM(${totalLetter}${firstDataRow}:${totalLetter}${lastDataRow})`,
        result: grandTotal,
      }
    : 0
  grandCell.numFmt = '0.00'

  totalsRow.alignment = { horizontal: 'center', vertical: 'middle' }
  totalsRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
  for (let col = 1; col <= totalCol; col++) {
    fill(totalsRow.getCell(col), TOTAL_FILL)
    border(totalsRow.getCell(col))
  }

  // Zamrożone: nagłówek i dwie pierwsze kolumny.
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: headerRowIndex }]
  sheet.pageSetup = {
    ...A4_LANDSCAPE,
    printTitlesRow: `${headerRowIndex}:${headerRowIndex}`,
  }

  // --- osobny arkusz dla każdego pracownika ---
  const usedNames = ['Zestawienie']
  for (const employee of employees) {
    const name = safeSheetName(employee.name, usedNames)
    usedNames.push(name)
    buildEmployeeSheet(workbook.addWorksheet(name), employee, month, employee.days ?? {})
  }

  return {
    workbook,
    fileName: `zestawienie_godzin_${month}.xlsx`,
    title: `Zestawienie godzin — ${formatMonth(month)}`,
  }
}

/** Pobiera plik zestawienie_godzin_{YYYY-MM}.xlsx. */
export async function exportSummaryWorkbook(employees: ReportEmployee[], month: string) {
  const built = await buildSummaryWorkbook(employees, month)
  await download(built.workbook, built.fileName)
}

// ---------------------------------------------------------------------------
// Eksport: podsumowanie wszystkich pracowników za okres
// ---------------------------------------------------------------------------

/**
 * Pobiera plik podsumowanie_godzin_{okres}.xlsx.
 *
 * Układ: pracownicy w kolumnach, oś czasu w wierszach — dni miesiąca przy okresie
 * jednomiesięcznym, kolejne miesiące przy dłuższym. Taki arkusz da się wprost
 * porównywać między osobami i podpiąć pod wykres bez przestawiania danych.
 *
 * @param {{from:string,to:string,granularity:'day'|'month',buckets:string[],employees:Array}} data
 *        odpowiedź /api/admin/summary
 */
export async function buildOverviewWorkbook(data: TimesheetSummaryResponse): Promise<Built> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ewidencja czasu pracy'
  workbook.created = new Date()

  const { from, to, employees } = data
  const byDay = data.granularity === 'day'
  const buckets = data.buckets ?? []
  const sheet = workbook.addWorksheet('Podsumowanie')

  // Kolumny opisowe z lewej: przy dniach dochodzi nazwa dnia tygodnia.
  const labelCols = byDay ? 2 : 1
  const firstEmpCol = labelCols + 1
  const lastEmpCol = labelCols + employees.length
  const totalCol = lastEmpCol + 1

  sheet.columns = [...(byDay ? [{ width: 12 }, { width: 14 }] : [{ width: 18 }]), ...employees.map(() => ({ width: 14 })), { width: 12 }]

  // --- nagłówek dokumentu ---
  sheet.mergeCells(1, 1, 1, totalCol)
  const documentTitle = from === to ? `Podsumowanie godzin — ${formatMonth(from)}` : `Podsumowanie godzin — ${formatMonth(from)} – ${formatMonth(to)}`
  const title = sheet.getCell('A1')
  title.value = documentTitle
  title.font = { name: 'Calibri', size: 14, bold: true, color: { argb: INK } }
  sheet.getRow(1).height = 22
  sheet.addRow([])

  // --- nagłówek tabeli: pracownicy w kolumnach ---
  const headerRowIndex = 3
  const header = sheet.getRow(headerRowIndex)
  header.getCell(1).value = byDay ? 'Data' : 'Miesiąc'
  if (byDay) header.getCell(2).value = 'Dzień tygodnia'
  employees.forEach((employee, i) => {
    header.getCell(firstEmpCol + i).value = employee.name
  })
  header.getCell(totalCol).value = 'Razem'
  header.height = 34
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  header.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  }
  for (let col = 1; col <= totalCol; col++) {
    fill(header.getCell(col), INK)
    border(header.getCell(col))
  }
  header.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }

  // --- wiersz identyfikatorów, żeby dało się rozróżnić imienników ---
  const idRowIndex = headerRowIndex + 1
  const idRow = sheet.getRow(idRowIndex)
  idRow.getCell(1).value = 'ID'
  employees.forEach((employee, i) => {
    idRow.getCell(firstEmpCol + i).value = formatId(employee.id)
  })
  idRow.font = { size: 9, color: { argb: 'FF5D6470' } }
  idRow.alignment = { horizontal: 'center', vertical: 'middle' }
  idRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
  for (let col = 1; col <= totalCol; col++) {
    fill(idRow.getCell(col), TOTAL_FILL)
    border(idRow.getCell(col))
  }

  // --- wiersze osi czasu ---
  const firstDataRow = idRowIndex + 1
  buckets.forEach((bucket) => {
    const row = sheet.addRow([])
    const rowNo = row.number
    const weekend = byDay && isWeekend(bucket)

    row.getCell(1).value = byDay ? formatDatePL(bucket) : formatMonth(bucket)
    if (byDay) row.getCell(2).value = DAY_NAMES[dayOfWeek(bucket)]

    employees.forEach((employee, i) => {
      const hours = Number(employee.byBucket?.[bucket]) || 0
      const cell = row.getCell(firstEmpCol + i)
      cell.value = hours ? roundHours(hours) : null // pusto zamiast ściany zer
      cell.numFmt = '0.00'
    })

    const rowTotal = roundHours(employees.reduce((sum, e) => sum + (Number(e.byBucket?.[bucket]) || 0), 0))
    const totalCell = row.getCell(totalCol)
    totalCell.value = employees.length
      ? {
          formula: `SUM(${columnLetter(firstEmpCol)}${rowNo}:${columnLetter(lastEmpCol)}${rowNo})`,
          result: rowTotal,
        }
      : 0
    totalCell.numFmt = '0.00'
    totalCell.font = { bold: true }

    row.alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
    if (byDay) row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' }
    for (let col = 1; col <= totalCol; col++) {
      border(row.getCell(col))
      if (weekend) fill(row.getCell(col), GREY_FILL)
    }
    fill(totalCell, TOTAL_FILL)
  })
  const lastDataRow = firstDataRow + buckets.length - 1
  const hasRows = buckets.length > 0

  /**
   * Dokłada wiersz podsumowujący każdą kolumnę pracownika osobną formułą.
   * Komórka w kolumnie „Razem” sumuje ten sam wiersz w poprzek pracowników —
   * dla „Dni pracy” pionowy COUNTIF policzyłby co innego niż suma osób.
   */
  const addFooterRow = (
    label: string,
    formulaFor: (range: string) => string,
    resultFor: (e: TimesheetSummaryResponse['employees'][number]) => number,
    numFmt: string,
  ) => {
    const row = sheet.addRow([])
    const rowNo = row.number
    row.getCell(1).value = label
    employees.forEach((employee, i) => {
      const col = firstEmpCol + i
      const letter = columnLetter(col)
      const cell = row.getCell(col)
      cell.value = hasRows
        ? {
            formula: formulaFor(`${letter}${firstDataRow}:${letter}${lastDataRow}`),
            result: resultFor(employee),
          }
        : 0
      cell.numFmt = numFmt
    })

    const totalCell = row.getCell(totalCol)
    totalCell.value =
      hasRows && employees.length
        ? {
            formula: `SUM(${columnLetter(firstEmpCol)}${rowNo}:${columnLetter(lastEmpCol)}${rowNo})`,
            result: employees.reduce((sum, e) => sum + resultFor(e), 0),
          }
        : 0
    totalCell.numFmt = numFmt

    row.font = { bold: true, color: { argb: INK } }
    row.alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }
    for (let col = 1; col <= totalCol; col++) {
      fill(row.getCell(col), TOTAL_FILL)
      border(row.getCell(col))
    }
    return row
  }

  addFooterRow(
    'RAZEM',
    (range) => `SUM(${range})`,
    (employee) => roundHours(Number(employee.total) || 0),
    '0.00',
  )
  addFooterRow(
    'Dni pracy',
    (range) => `COUNTIF(${range},">0")`,
    (employee) => Number(employee.workedDays) || 0,
    '0',
  )

  sheet.views = [{ state: 'frozen', xSplit: labelCols, ySplit: idRowIndex }]
  sheet.pageSetup = {
    ...(employees.length > 5 ? A4_LANDSCAPE : A4_PORTRAIT),
    printTitlesRow: `${headerRowIndex}:${idRowIndex}`,
  }

  const period = from === to ? from : `${from}_${to}`
  return {
    workbook,
    fileName: `podsumowanie_godzin_${period}.xlsx`,
    title: documentTitle,
  }
}

/** Pobiera plik podsumowanie_godzin_{okres}.xlsx. */
export async function exportOverviewWorkbook(data: TimesheetSummaryResponse) {
  const built = await buildOverviewWorkbook(data)
  await download(built.workbook, built.fileName)
}
