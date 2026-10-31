import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TimesheetImportInput, TimesheetImportResult } from '#shared'
import { TIMESHEET_EXPORT_SNIPPET } from '../../../app/src/features/timesheets/exportSnippet.ts'
import { createUser, req, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

/**
 * Skrypt eksportu (wklejany w konsoli panelu workload-calendar) wykonany na atrapie API starej aplikacji —
 * dokładnie te odpowiedzi, jakie zwraca jej `/api/admin/employees` i `/api/admin/report` — a wynik wgrany do PMO.
 */
const OLD_EMPLOYEES = [
  { id: 'KMNP2345', name: 'Kamil Jankowski', active: true, createdAt: '2026-09-29T10:00:00.000Z' },
  { id: 'QRST6789', name: 'Michał Kruk', active: false, createdAt: '2026-09-29T10:05:00.000Z' },
]
const OLD_REPORTS: Record<string, unknown> = {
  '2026-09': {
    month: '2026-09',
    employees: [
      {
        id: 'KMNP2345',
        name: 'Kamil Jankowski',
        active: true,
        days: { '2026-09-30': { mode: 'range', start: '08:00', end: '16:30', breakMin: 30, hours: 8, note: '', updatedAt: '2026-09-30T17:00:00.000Z' } },
        total: 8,
      },
    ],
    total: 8,
  },
  '2026-10': {
    month: '2026-10',
    employees: [
      {
        id: 'KMNP2345',
        name: 'Kamil Jankowski',
        active: true,
        days: {
          '2026-10-01': { mode: 'range', start: '22:00', end: '06:00', breakMin: 0, hours: 8, note: 'noc', updatedAt: '2026-10-02T07:00:00.000Z' },
          '2026-10-02': { mode: 'total', start: null, end: null, breakMin: 0, hours: 6.5, note: '', updatedAt: '2026-10-02T18:00:00.000Z' },
        },
        total: 14.5,
      },
      {
        id: 'QRST6789',
        name: 'Michał Kruk',
        active: false,
        days: { '2026-10-05': { mode: 'range', start: '07:00', end: '15:15', breakMin: 15, hours: 8, note: '', updatedAt: '2026-10-05T16:00:00.000Z' } },
        total: 8,
      },
    ],
    total: 22.5,
  },
}

let h: Harness
let admin: TestUser
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
})
afterAll(() => {
  vi.unstubAllGlobals()
  return h.stop()
})

async function runSnippet(): Promise<TimesheetImportInput> {
  let blob: Blob | null = null
  vi.stubGlobal('fetch', async (path: string) => {
    const url = new URL(path, 'https://time-tracking-envcheck.netlify.app')
    const body = url.pathname === '/api/admin/employees' ? { employees: OLD_EMPLOYEES } : (OLD_REPORTS[url.searchParams.get('month')!] ?? { employees: [], total: 0 })
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => ((blob = b), 'blob:x') }))
  vi.stubGlobal('document', { createElement: () => ({ click: () => {} }) })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await (0, eval)(TIMESHEET_EXPORT_SNIPPET)
  expect(blob).not.toBeNull()
  return JSON.parse(await blob!.text()) as TimesheetImportInput
}

describe('skrypt eksportu z workload-calendar → import w PMO', () => {
  it('eksportuje pracowników, wpisy i sumy miesięcy od założenia pierwszego pracownika', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-31T12:00:00Z'), toFake: ['Date'] })
    const file = await runSnippet()
    vi.useRealTimers()
    expect(file.format).toBe('workload-calendar-export')
    expect(file.employees).toHaveLength(2)
    expect(file.entries.map((e) => `${e.employeeId}:${e.date}`)).toEqual(['KMNP2345:2026-09-30', 'KMNP2345:2026-10-01', 'KMNP2345:2026-10-02', 'QRST6789:2026-10-05'])
    expect(file.totals).toEqual([
      { month: '2026-09', employeeId: 'KMNP2345', total: 8 },
      { month: '2026-10', employeeId: 'KMNP2345', total: 14.5 },
      { month: '2026-10', employeeId: 'QRST6789', total: 8 },
    ])

    const res = await req(h, 'POST', '/api/admin/timesheets/import', admin.headers, file)
    expect(res.status).toBe(200)
    const result = (await res.json()) as TimesheetImportResult
    expect(result).toMatchObject({ employeesCreated: 2, entriesCreated: 4, rejected: [], comparison: { checked: 3, mismatches: [] } })
  })
})
