import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MeResponse, TimesheetEmployeeDto, TimesheetEntriesResponse, TimesheetImportInput, TimesheetImportResult, TimesheetReportResponse, TimesheetSummaryResponse } from '#shared'
import { TIMESHEETS_SETTING_KEY } from '../../auth/access.ts'
import { createUser, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
let editor: TestUser
let viewer: TestUser
let outsider: TestUser
const pub = (path: string, init?: RequestInit) => h.app.request(`/api/public/czas${path}`, init)
const put = (body: unknown) => pub('/entries', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const detail = async (res: Response) => ((await res.json()) as { detail?: string }).detail

beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  editor = await createUser(h, 'EnvcheckInternal')
  viewer = await createUser(h, 'EnvcheckInternal')
  outsider = await createUser(h, 'EnvcheckInternal')
  await h.db.insert(schema.appSettings).values({ key: TIMESHEETS_SETTING_KEY, value: { viewerIds: [viewer.id], editorIds: [editor.id] } })
})
afterAll(() => h.stop())

const addEmployee = async (name: string) => ((await (await req(h, 'POST', '/api/timesheets/employees', editor.headers, { name })).json()) as { employee: TimesheetEmployeeDto }).employee

describe('Czas pracy — dostęp do panelu', () => {
  it('tylko osoby z listy; podgląd bez zmian, edycja z zarządzaniem pracownikami', async () => {
    const perms = async (u: TestUser) => ((await (await req(h, 'GET', '/api/me', u.headers)).json()) as MeResponse).permissions.filter((p) => p.startsWith('timesheets:'))
    expect(await perms(outsider)).toEqual([])
    expect(await perms(admin)).toEqual([])
    expect((await perms(viewer)).sort()).toEqual(['timesheets:export', 'timesheets:view'])
    expect(await perms(editor)).toContain('timesheets:delete')
    expect((await req(h, 'GET', '/api/timesheets/employees', outsider.headers)).status).toBe(403)
    expect((await req(h, 'GET', '/api/timesheets/employees', viewer.headers)).status).toBe(200)
    expect((await req(h, 'POST', '/api/timesheets/employees', viewer.headers, { name: 'X' })).status).toBe(403)
  })

  it('Admin ustawia listę; osoba w obu listach ma edycję', async () => {
    const res = await req(h, 'PUT', '/api/admin/settings/timesheets', admin.headers, { viewerIds: [viewer.id, editor.id], editorIds: [editor.id] })
    expect(await res.json()).toEqual({ editorIds: [editor.id], viewerIds: [viewer.id] })
    expect((await req(h, 'PUT', '/api/admin/settings/timesheets', editor.headers, { viewerIds: [], editorIds: [] })).status).toBe(403)
  })
})

describe('Czas pracy — ekran pracownika (bez konta)', () => {
  it('logowanie ID: format XXXX-XXXX, małe litery; błędne i nieaktywne ID odrzucone', async () => {
    const e = await addEmployee('  Jan   Kowalski ')
    expect(e).toMatchObject({ name: 'Jan Kowalski', active: true })
    expect(e.id).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    const formatted = `${e.id.slice(0, 4)}-${e.id.slice(4)}`.toLowerCase()
    expect(await (await pub(`/me?id=${formatted}`)).json()).toEqual({ id: e.id, name: 'Jan Kowalski' })
    const bad = await pub('/me?id=ABC')
    expect(bad.status).toBe(400)
    expect(await detail(bad)).toBe('Niepoprawny identyfikator.')
    expect((await pub('/me?id=AAAA-AAAA')).status).toBe(404)
    await req(h, 'PATCH', `/api/timesheets/employees/${e.id}`, editor.headers, { active: false })
    expect(await detail(await pub(`/me?id=${e.id}`))).toBe('To konto jest nieaktywne. Skontaktuj się z administratorem.')
  })

  it('zapis tygodnia przez dwa miesiące: godziny liczy serwer, pusty dzień usuwa wpis', async () => {
    const e = await addEmployee('Anna Nowak')
    const res = await put({
      id: e.id,
      entries: {
        '2026-09-29': { mode: 'range', start: '08:00', end: '16:30', breakMin: 30, note: '' },
        '2026-09-30': { mode: 'range', start: '22:00', end: '06:00', breakMin: 0, hours: 99 },
        '2026-10-01': { mode: 'range', start: '07:07', end: '15:53', breakMin: 22 },
        '2026-10-02': null,
      },
    })
    expect(res.status).toBe(200)
    const read = (await (await pub(`/entries?id=${e.id}&from=2026-09-28&to=2026-10-04`)).json()) as TimesheetEntriesResponse
    expect(Object.keys(read.entries)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
    expect(read.entries['2026-09-30']).toMatchObject({ hours: 8 })
    expect(read.entries['2026-10-01']).toMatchObject({ start: '07:00', end: '16:00', breakMin: 15, hours: 8.75 })
    expect(read.total).toBe(24.75)
    await put({ id: e.id, entries: { '2026-09-29': { mode: 'range', start: '', end: '', note: '' } } })
    const after = (await (await pub(`/entries?id=${e.id}&from=2026-09-28&to=2026-10-04`)).json()) as TimesheetEntriesResponse
    expect(after.entries['2026-09-29']).toBeUndefined()
  })

  it('walidacja: albo wszystko, albo nic; zakresy jak w starej aplikacji', async () => {
    const e = await addEmployee('Piotr Wiśniewski')
    const bad = await put({ id: e.id, entries: { '2026-10-05': { mode: 'range', start: '08:00', end: '16:00' }, '2026-10-06': { mode: 'range', start: '08:00', end: '08:30', breakMin: 60 } } })
    expect(bad.status).toBe(400)
    expect(await detail(bad)).toBe('2026-10-06: Przerwa jest dłuższa niż czas pracy.')
    const read = (await (await pub(`/entries?id=${e.id}&from=2026-10-05&to=2026-10-11`)).json()) as TimesheetEntriesResponse
    expect(read.entries).toEqual({})
    expect(await detail(await pub(`/entries?id=${e.id}&from=2026-01-01&to=2026-12-31`))).toBe('Zakres nie może przekraczać 62 dni.')
  })

  it('nie wymaga logowania, ale nie daje dostępu do niczego innego', async () => {
    expect((await h.app.request('/api/timesheets/employees')).status).toBe(401)
    expect((await h.app.request('/api/public/czas/../timesheets/employees')).status).not.toBe(200)
  })
})

describe('Czas pracy — panel', () => {
  it('zestawienie i podsumowanie: te same sumy co u pracownika; nieaktywni tylko z godzinami', async () => {
    const report = (await (await req(h, 'GET', '/api/timesheets/report?month=2026-10', viewer.headers)).json()) as TimesheetReportResponse
    expect(report.days).toHaveLength(31)
    const anna = report.employees.find((r) => r.name === 'Anna Nowak')!
    expect(anna.total).toBe(8.75)
    expect(report.employees.some((r) => r.name === 'Jan Kowalski')).toBe(false)
    const summary = (await (await req(h, 'GET', '/api/timesheets/summary?from=2026-09&to=2026-10', viewer.headers)).json()) as TimesheetSummaryResponse
    expect(summary.granularity).toBe('month')
    expect(summary.employees.find((r) => r.name === 'Anna Nowak')).toMatchObject({ byBucket: { '2026-09': 8, '2026-10': 8.75 }, total: 16.75, workedDays: 2, average: 8.38 })
  })

  it('usunięcie pracownika kasuje jego godziny', async () => {
    const e = await addEmployee('Do usunięcia')
    await put({ id: e.id, entries: { '2026-10-07': { mode: 'range', start: '08:00', end: '12:00' } } })
    expect(await (await req(h, 'DELETE', `/api/timesheets/employees/${e.id}`, editor.headers)).json()).toEqual({ ok: true, deletedEntries: 1 })
    expect((await pub(`/me?id=${e.id}`)).status).toBe(404)
  })
})

describe('Czas pracy — import z workload-calendar', () => {
  const file = (over: Partial<TimesheetImportInput> = {}): TimesheetImportInput => ({
    format: 'workload-calendar-export',
    exportedAt: '2026-10-31T12:00:00.000Z',
    employees: [
      { id: 'KMNP-2345', name: 'Kamil Jankowski', active: true, createdAt: '2026-09-29T10:00:00.000Z' },
      { id: 'QRST-6789', name: 'Michał Kruk', active: false, createdAt: '2026-09-29T10:00:00.000Z' },
    ],
    entries: [
      { employeeId: 'KMNP2345', date: '2026-09-30', mode: 'range', start: '08:00', end: '16:00', breakMin: 30, hours: 7.5, note: 'montaż bramy', updatedAt: '2026-09-30T18:00:00.000Z' },
      { employeeId: 'KMNP2345', date: '2026-10-01', mode: 'total', start: null, end: null, breakMin: 0, hours: 6, note: '', updatedAt: '2026-10-01T18:00:00.000Z' },
      { employeeId: 'QRST6789', date: '2026-10-01', mode: 'range', start: '22:00', end: '06:00', breakMin: 0, hours: 8, note: '', updatedAt: '2026-10-01T18:00:00.000Z' },
      { employeeId: 'ZZZZZZZZ', date: '2026-10-01', mode: 'range', start: '08:00', end: '09:00', breakMin: 0, hours: 1, note: '', updatedAt: null },
    ],
    ...over,
  })
  const run = async (body: TimesheetImportInput, u = admin) => req(h, 'POST', '/api/admin/timesheets/import', u.headers, body)

  it('przenosi pracowników z tymi samymi ID i wpisy z przeliczonymi godzinami', async () => {
    const res = await run(file())
    expect(res.status).toBe(200)
    const r = (await res.json()) as TimesheetImportResult
    expect(r).toMatchObject({ employeesCreated: 2, entriesCreated: 3, entriesUpdated: 0, rejected: [{ employeeId: 'ZZZZZZZZ', error: 'Pracownik spoza pliku.' }] })
    const read = (await (await pub('/entries?id=KMNP-2345&from=2026-09-28&to=2026-10-04')).json()) as TimesheetEntriesResponse
    expect(read).toMatchObject({ name: 'Kamil Jankowski', total: 13.5 })
    expect(read.entries['2026-09-30']).toMatchObject({ start: '08:00', end: '16:00', breakMin: 30, note: 'montaż bramy', updatedAt: '2026-09-30T18:00:00.000Z' })
    // Nieaktywny z pliku zostaje nieaktywny, ale jego godziny są w raporcie.
    expect((await pub('/me?id=QRST6789')).status).toBe(403)
    const report = (await (await req(h, 'GET', '/api/timesheets/report?month=2026-10', viewer.headers)).json()) as TimesheetReportResponse
    expect(report.employees.find((e) => e.id === 'QRST6789')?.total).toBe(8)
  })

  it('ponowny import: bez duplikatów; nowsze wpisy z PMO nie są nadpisywane', async () => {
    await put({ id: 'KMNP2345', entries: { '2026-10-01': { mode: 'range', start: '07:00', end: '15:00' } } })
    const r = (await (await run(file({ exportedAt: '2026-10-31T13:00:00.000Z' }))).json()) as TimesheetImportResult
    expect(r).toMatchObject({ employeesCreated: 0, employeesUpdated: 0, entriesCreated: 0, entriesUpdated: 2, entriesSkippedNewer: 1 })
    const read = (await (await pub('/entries?id=KMNP2345&from=2026-10-01&to=2026-10-01')).json()) as TimesheetEntriesResponse
    expect(read.entries['2026-10-01']).toMatchObject({ start: '07:00', hours: 8 })
  })

  it('tylko Admin; zły format pliku odrzucony', async () => {
    expect((await run(file(), editor)).status).toBe(403)
    expect((await req(h, 'POST', '/api/admin/timesheets/import', admin.headers, { format: 'inny' })).status).toBe(422)
  })
})
