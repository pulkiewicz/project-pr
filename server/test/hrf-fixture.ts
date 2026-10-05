import ExcelJS from 'exceljs'
import type { ImportMapping } from '#shared'

/** Syntetyczny HRF o układzie jak rev.10 (bez danych z prawdziwego pliku). */
export async function buildHrfFixture(rows?: [string, string, string, string][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('HRF test')
  ws.getCell('A1').value = 'HARMONOGRAM — TEST'
  ws.getCell('A2').value = 'Dzień „0”:'
  ws.getCell('B2').value = new Date(Date.UTC(2026, 8, 21))
  ws.getRow(5).values = ['L.p.', 'Etap / rodzaj prac', 'Termin (tydzień)', 'Wykonawca', 'Data startu', 'Data końca']
  const data = rows ?? [
    ['1', 'Projekty', '1-10', ''],
    ['1.1', 'Projekt A', '1-2', 'Envcheck / Arsanit'],
    ['1.2', 'Projekt B', '1-9', 'Envcheck / Arsanit'],
    ['1.10', 'Odbiór projektów (odbiór częściowy 1/2)', '10', 'Zamawiający'],
    ['2', 'Roboty', '11-60', ''],
    ['2.1', 'Roboty X', '11-58', 'Envcheck / Arsanit'],
    ['2.2', 'Odbiór końcowy', '59-60', 'Zamawiający'],
    ['3', 'Po odbiorze (§ 3 ust. 8)', '61-70', ''],
    ['3.1', 'Kalibracja', '61-64', 'Envcheck / Arsanit'],
  ]
  data.forEach((r, i) => {
    const row = ws.getRow(6 + i)
    row.getCell(1).value = r[0]
    row.getCell(2).value = r[1]
    row.getCell(3).value = r[2]
    if (r[3]) row.getCell(4).value = r[3]
    row.getCell(5).value = { formula: '$B$2', result: new Date(Date.UTC(2026, 8, 21)) }
  })
  ws.getCell(`A${8 + data.length}`).value = 'Legenda:'
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

export const FIXTURE_MAPPING: ImportMapping = {
  sheet: 'HRF test',
  headerRow: 5,
  columns: { code: 'A', name: 'B', weeks: 'C', party: 'D' },
  partyValues: {
    'Envcheck / Arsanit': { party: 'Konsorcjum', acceptancePoint: false },
    Zamawiający: { party: 'Client', acceptancePoint: true },
  },
  emptyParty: 'Konsorcjum',
  postAcceptanceStageCodes: ['3'],
}
