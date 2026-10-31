import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { birthDateFromPesel, deadlineStatus, isValidPesel, type EmployeeDto, type FleetVehicleDto, type MeResponse } from '#shared'
import { createUser, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
let ania: TestUser
let outsider: TestUser

beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  ania = await createUser(h, 'EnvcheckInternal')
  outsider = await createUser(h, 'EnvcheckInternal')
})
afterAll(() => h.stop())

const PESEL = '90010112318' // poprawna suma kontrolna, ur. 01.01.1990

describe('PESEL i terminy', () => {
  it('walidacja PESEL i data urodzenia (także XXI w.)', () => {
    expect(isValidPesel(PESEL)).toBe(true)
    expect(isValidPesel('90010112319')).toBe(false)
    expect(birthDateFromPesel(PESEL)).toBe('1990-01-01')
    expect(birthDateFromPesel('02270803624')).toBe('2002-07-08')
  })

  it('status terminu: po terminie / w ciągu 30 dni / ok', () => {
    expect(deadlineStatus(null, '2026-10-31')).toBe('none')
    expect(deadlineStatus('2026-10-30', '2026-10-31')).toBe('expired')
    expect(deadlineStatus('2026-10-31', '2026-10-31')).toBe('soon')
    expect(deadlineStatus('2026-11-30', '2026-10-31')).toBe('soon')
    expect(deadlineStatus('2026-12-01', '2026-10-31')).toBe('ok')
  })
})

describe('Zarząd: dostęp z listy osób w Ustawieniach', () => {
  it('bez wpisu na liście nawet Admin nie ma modułów (403, brak w /me)', async () => {
    expect((await req(h, 'GET', '/api/fleet', admin.headers)).status).toBe(403)
    expect((await req(h, 'GET', '/api/employees', admin.headers)).status).toBe(403)
    const me = (await (await req(h, 'GET', '/api/me', admin.headers)).json()) as MeResponse
    expect(me.permissions).not.toContain('employees:view')
  })

  it('Admin ustawia listę (tylko pracownicy Envcheck); osoby z listy mają dostęp, pozostali nie', async () => {
    const arsanit = await createUser(h, 'Arsanit')
    expect((await req(h, 'PUT', '/api/admin/settings/management', admin.headers, { userIds: [arsanit.id] })).status).toBe(422)
    expect((await req(h, 'PUT', '/api/admin/settings/management', ania.headers, { userIds: [ania.id] })).status).toBe(403)
    expect((await req(h, 'PUT', '/api/admin/settings/management', admin.headers, { userIds: [admin.id, ania.id] })).status).toBe(200)
    expect((await req(h, 'GET', '/api/fleet', ania.headers)).status).toBe(200)
    expect((await req(h, 'GET', '/api/employees', admin.headers)).status).toBe(200)
    expect((await req(h, 'GET', '/api/employees', outsider.headers)).status).toBe(403)
    expect((await req(h, 'GET', '/api/fleet', arsanit.headers)).status).toBe(403)
  })
})

describe('Pracownicy', () => {
  let emp: EmployeeDto

  it('tworzy pracownika: PESEL szyfrowany, w odpowiedzi tylko maska, data urodzenia z PESEL', async () => {
    const res = await req(h, 'POST', '/api/employees', ania.headers, {
      firstName: 'Jan',
      lastName: 'Kowalski',
      position: 'Monter',
      pesel: PESEL,
      contractType: 'employment',
      contractStart: '2026-01-01',
      medicalExamValidUntil: '2026-11-15',
      qualifications: [{ name: 'Certyfikat F-gazowy', validUntil: '2028-05-01' }],
    })
    expect(res.status).toBe(201)
    emp = (await res.json()) as EmployeeDto
    expect(emp).toMatchObject({ peselMasked: '•••••••2318', birthDate: '1990-01-01', qualifications: [{ name: 'Certyfikat F-gazowy' }] })
    expect(JSON.stringify(emp)).not.toContain(PESEL)
    const [row] = await h.db.select().from(schema.employees)
    expect(row!.peselEnc).not.toContain(PESEL)
    expect((await req(h, 'POST', '/api/employees', ania.headers, { firstName: 'X', lastName: 'Y', pesel: '12345678901' })).status).toBe(422)
  })

  it('pełny PESEL tylko na żądanie, z wpisem w audit logu; audit zmian bez danych osobowych', async () => {
    const r = (await (await req(h, 'GET', `/api/employees/${emp.id}/pesel`, ania.headers)).json()) as { pesel: string }
    expect(r.pesel).toBe(PESEL)
    const patch = await req(h, 'PATCH', `/api/employees/${emp.id}`, ania.headers, { version: emp.version, address: 'ul. Tajna 1', qualifications: [] })
    expect(patch.status).toBe(200)
    expect(((await patch.json()) as EmployeeDto).qualifications).toEqual([])
    const audit = await h.db.select().from(schema.auditLog)
    expect(audit.map((a) => a.action)).toContain('employees.view_pesel')
    expect(JSON.stringify(audit)).not.toContain('Tajna')
    expect(JSON.stringify(audit)).not.toContain(PESEL)
  })

  it('konflikt wersji → 409', async () => {
    expect((await req(h, 'PATCH', `/api/employees/${emp.id}`, ania.headers, { version: emp.version, notes: 'x' })).status).toBe(409)
  })
})

describe('Pojazdy', () => {
  it('pojazd z polisami i przeglądami; numer rejestracyjny unikalny; przypisany pracownik', async () => {
    const [e] = (await (await req(h, 'GET', '/api/fleet/employee-options', ania.headers)).json()) as { id: string; name: string }[]
    const res = await req(h, 'POST', '/api/fleet', ania.headers, {
      registrationNumber: 'wx 12345',
      make: 'Ford',
      model: 'Transit',
      kind: 'van',
      assignedEmployeeId: e!.id,
      insurances: [{ type: 'OC', insurer: 'PZU', validFrom: '2026-01-01', validTo: '2026-12-31', policyUrl: 'https://drive.google.com/file/d/abc' }],
      inspections: [{ kind: 'technical', performedDate: '2026-03-01', validUntil: '2027-03-01' }],
    })
    expect(res.status).toBe(201)
    const v = (await res.json()) as FleetVehicleDto
    expect(v).toMatchObject({ registrationNumber: 'WX 12345', assignedEmployeeName: 'Jan Kowalski', insurances: [{ type: 'OC', validTo: '2026-12-31' }], inspections: [{ kind: 'technical' }] })
    expect((await req(h, 'POST', '/api/fleet', ania.headers, { registrationNumber: 'WX 12345', kind: 'car' })).status).toBe(409)
    expect((await req(h, 'POST', '/api/fleet', ania.headers, { registrationNumber: 'A1', kind: 'car', insurances: [{ type: 'OC', validTo: '2026-01-01', policyUrl: 'javascript:alert(1)' }] })).status).toBe(422)

    const upd = await req(h, 'PATCH', `/api/fleet/${v.id}`, ania.headers, { version: v.version, inspections: [{ kind: 'udt', validUntil: '2026-11-20' }] })
    expect(upd.status).toBe(200)
    expect((await upd.json()) as FleetVehicleDto).toMatchObject({ insurances: [{ type: 'OC' }], inspections: [{ kind: 'udt', validUntil: '2026-11-20' }] })
  })

  it('usunięcie pracownika zdejmuje przypisanie z pojazdu', async () => {
    const [v] = (await (await req(h, 'GET', '/api/fleet', ania.headers)).json()) as FleetVehicleDto[]
    expect((await req(h, 'DELETE', `/api/employees/${v!.assignedEmployeeId}`, ania.headers)).status).toBe(200)
    const [after] = (await (await req(h, 'GET', '/api/fleet', ania.headers)).json()) as FleetVehicleDto[]
    expect(after!.assignedEmployeeId).toBeNull()
  })
})
