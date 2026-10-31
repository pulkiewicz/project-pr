import { TIMESHEET_EXPORT_FORMAT } from '#shared'

/**
 * Skrypt do wklejenia w konsoli przeglądarki na stronie `/admin` starej aplikacji (time-tracking-envcheck),
 * po zalogowaniu. Używa jej sesji (ciasteczka Identity) i własnego API: lista pracowników + zestawienie każdego
 * miesiąca od założenia pierwszego pracownika. Pobiera plik JSON do wgrania w PMO — nic nie zmienia w starej aplikacji.
 */
export const TIMESHEET_EXPORT_SNIPPET = `(async () => {
  const get = async (p) => {
    const r = await fetch(p, { credentials: 'same-origin' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status))
    return d
  }
  const { employees } = await get('/api/admin/employees')
  const first = employees.map((e) => (e.createdAt || '').slice(0, 7)).filter(Boolean).sort()[0] || new Date().toISOString().slice(0, 7)
  const now = new Date().toISOString().slice(0, 7)
  const entries = []
  const totals = []
  for (let [y, m] = first.split('-').map(Number); y * 100 + m <= Number(now.replace('-', '')); m === 12 ? (y++, m = 1) : m++) {
    const month = y + '-' + String(m).padStart(2, '0')
    const report = await get('/api/admin/report?month=' + month)
    for (const e of report.employees) {
      for (const [date, x] of Object.entries(e.days)) entries.push({ employeeId: e.id, date, ...x })
      totals.push({ month, employeeId: e.id, total: e.total })
    }
    console.log(month + ': ' + report.employees.length + ' os., ' + report.total + ' h')
  }
  const file = { format: '${TIMESHEET_EXPORT_FORMAT}', exportedAt: new Date().toISOString(), employees, entries, totals }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
  a.download = 'ewidencja-czasu-' + new Date().toISOString().slice(0, 10) + '.json'
  a.click()
  console.log('Gotowe: ' + employees.length + ' pracowników, ' + entries.length + ' wpisów')
})()`
