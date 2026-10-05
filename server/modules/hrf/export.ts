import ExcelJS from 'exceljs'
import i18nPl from '../../../shared/i18n/pl.json' with { type: 'json' }
import type { HrfTaskDto } from '#shared'

const STATUS = i18nPl.hrf.status as Record<string, string>
const PARTY = i18nPl.parties as Record<string, string>

const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null)

function level(code: string) {
  return code.split('.').length - 1
}

/** Eksport listy HRF do XLSX — pola [W] tylko gdy obecne w DTO (już przefiltrowane politykami). */
export async function hrfToXlsx(tasks: HrfTaskDto[], meta: { projectName: string; dayZero: string | null }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Envcheck PMO'
  const ws = wb.addWorksheet('HRF', { views: [{ state: 'frozen', ySplit: 3 }] })
  const internal = tasks.some((t) => 'contractValue' in t)
  ws.getCell('A1').value = meta.projectName
  ws.getCell('A1').font = { bold: true, size: 13 }
  ws.getCell('A2').value = `Dzień „0”: ${meta.dayZero ? meta.dayZero.split('-').reverse().join('.') : '—'}`

  const columns: { header: string; key: string; width: number; date?: boolean }[] = [
    { header: 'Kod', key: 'code', width: 8 },
    { header: 'Nazwa', key: 'name', width: 70 },
    { header: 'Strona', key: 'party', width: 18 },
    { header: 'Start plan.', key: 'plannedStart', width: 12, date: true },
    { header: 'Koniec plan.', key: 'plannedEnd', width: 12, date: true },
    { header: 'Start rzecz.', key: 'actualStart', width: 12, date: true },
    { header: 'Koniec rzecz.', key: 'actualEnd', width: 12, date: true },
    { header: 'Prognoza końca', key: 'forecastEnd', width: 14, date: true },
    { header: '% wykonania', key: 'percentComplete', width: 12 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Punkt odbioru', key: 'isAcceptancePoint', width: 13 },
    { header: 'Ścieżka krytyczna', key: 'isCriticalPath', width: 16 },
    ...(internal ? [{ header: 'Wartość Etapu [W]', key: 'contractValue', width: 18 }] : []),
  ]
  const header = ws.getRow(3)
  columns.forEach((col, i) => {
    header.getCell(i + 1).value = col.header
    ws.getColumn(i + 1).width = col.width
  })
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }

  tasks.forEach((t, idx) => {
    const row = ws.getRow(4 + idx)
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1)
      const raw = (t as unknown as Record<string, unknown>)[col.key]
      if (col.date) {
        cell.value = toDate(raw as string | null)
        cell.numFmt = 'dd.mm.yyyy'
      } else if (col.key === 'status') cell.value = STATUS[t.status] ?? t.status
      else if (col.key === 'party') cell.value = PARTY[t.party] ?? t.party
      else if (col.key === 'percentComplete') {
        cell.value = t.percentComplete / 100
        cell.numFmt = '0%'
      } else if (typeof raw === 'boolean') cell.value = raw ? 'tak' : ''
      else if (col.key === 'contractValue') {
        cell.value = raw ? Number(raw) : null
        cell.numFmt = '#,##0.00 "zł"'
      } else cell.value = raw as string
    })
    row.getCell(2).alignment = { indent: level(t.code) * 2 }
    if (!t.parentId) row.font = { bold: true }
  })
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
