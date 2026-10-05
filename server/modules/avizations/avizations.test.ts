import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AvizationDto, OnSiteResponse, PeopleImportRow, PersonDto, VehicleDto } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

// Wszystkie dane osobowe w tym pliku są fikcyjne.
let h: Harness
const u = {} as Record<'admin' | 'env' | 'ars' | 'client' | 'sub', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}`
const SUB_ID = '22222222-2222-4222-8222-222222222222'
let jan: PersonDto
let anna: PersonDto
let car: VehicleDto

beforeAll(async () => {
  h = await startHarness()
  h.clock.now = new Date('2026-10-05T08:00:00Z') // poniedziałek
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.client = await createUser(h, 'Client')
  u.sub = await createUser(h, 'Subcontractor', { subcontractorId: SUB_ID })
})
afterAll(() => h.stop())

const post = <T>(user: TestUser, path: string, body: object) => req(h, 'POST', `${P}${path}`, user.headers, body).then(async (r) => ({ status: r.status, body: (await r.json()) as T }))
const transition = (user: TestUser, a: AvizationDto, body: object) => post<AvizationDto>(user, `/avizations/${a.id}/transition`, { version: a.version, ...body })

describe('M5 słowniki — szyfrowanie i maskowanie', () => {
  it('numer dokumentu i rejestracja zaszyfrowane w bazie; lista pokazuje maskę', async () => {
    jan = (await post<PersonDto>(u.env, '/persons', { firstName: 'Jan', lastName: 'Testowy', idDocType: 'id_card', idDocNumber: 'ABC 123456', company: 'Envcheck' })).body
    anna = (await post<PersonDto>(u.env, '/persons', { firstName: 'Anna', lastName: 'Próbna', idDocType: 'passport', idDocNumber: 'FT123456', company: 'Envcheck' })).body
    car = (await post<VehicleDto>(u.env, '/vehicles', { registrationNumber: 'ww 111aa', makeModel: 'Skoda', company: 'Envcheck', defaultDriverId: jan.id })).body
    expect(jan).toMatchObject({ idDocNumberMasked: 'ABC •••456', party: 'Envcheck' })
    expect(car.registrationNumber).toBe('WW 111AA')

    const rawP = await h.pg.query<Record<string, unknown>>('select * from persons')
    const rawV = await h.pg.query<Record<string, unknown>>('select * from vehicles')
    const dump = JSON.stringify([rawP.rows, rawV.rows])
    expect(dump).not.toContain('123456')
    expect(dump).not.toContain('111AA')

    const list = await (await req(h, 'GET', `${P}/persons`, u.client.headers)).text()
    expect(list).not.toContain('123456')
  })

  it('duplikat dokumentu (po HMAC, niezależnie od spacji) → 409', async () => {
    const r = await post(u.env, '/persons', { firstName: 'X', lastName: 'Y', idDocType: 'id_card', idDocNumber: 'abc123456', company: 'Envcheck' })
    expect(r.status).toBe(409)
  })

  it('pełny numer tylko przez endpoint odczytu, z wpisem w audit log', async () => {
    const r = await req(h, 'GET', `${P}/persons/${jan.id}/document`, u.client.headers)
    expect(await r.json()).toEqual({ idDocNumber: 'ABC 123456' })
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'persons.decrypt_read'))
    expect(audit.some((a) => a.entityId === jan.id && a.userId === u.client.id)).toBe(true)
    // audit nie zawiera samego numeru
    expect(JSON.stringify(audit)).not.toContain('123456')
  })

  it('wyszukiwanie pojazdu po numerze rejestracyjnym (HMAC)', async () => {
    const r = (await (await req(h, 'GET', `${P}/vehicles?registration=WW111AA`, u.ars.headers)).json()) as VehicleDto[]
    expect(r.map((v) => v.id)).toEqual([car.id])
  })

  it('Arsanit nie edytuje osób Envcheck; podwykonawca widzi tylko swoje wpisy', async () => {
    expect((await req(h, 'PATCH', `${P}/persons/${jan.id}`, u.ars.headers, { version: jan.version, phone: '1' })).status).toBe(403)
    const own = await post<PersonDto>(u.sub, '/persons', { firstName: 'Piotr', lastName: 'Podwykonawca', idDocType: 'id_card', idDocNumber: 'XYZ 654321', company: 'Firma Sp. z o.o.' })
    expect(own.body.party).toBe(`Subcontractor:${SUB_ID}`)
    const visible = (await (await req(h, 'GET', `${P}/persons`, u.sub.headers)).json()) as PersonDto[]
    expect(visible.map((p) => p.lastName)).toEqual(['Podwykonawca'])
    expect((await req(h, 'GET', `${P}/persons/${jan.id}/document`, u.sub.headers)).status).toBe(404)
  })
})

describe('M5 awizacje — workflow', () => {
  let a: AvizationDto

  it('szkic: numer AW/rrrr/nnn, osoby i pojazd z kierowcą; Zamawiający nie widzi szkiców', async () => {
    const r = await post<AvizationDto>(u.env, '/avizations', { dateFrom: '2026-10-07', dateTo: '2026-10-09', purpose: 'Prace adaptacyjne', personIds: [jan.id, anna.id], vehicles: [{ vehicleId: car.id, driverPersonId: jan.id }] })
    expect(r.status).toBe(201)
    a = r.body
    expect(a).toMatchObject({ number: 'AW/2026/001', status: 'draft', warnings: [] })
    expect(a.vehicles[0]).toMatchObject({ registrationNumber: 'WW 111AA', driverName: 'Jan Testowy' })
    const forClient = (await (await req(h, 'GET', `${P}/avizations`, u.client.headers)).json()) as AvizationDto[]
    expect(forClient).toHaveLength(0)
  })

  it('ta sama osoba nie może mieć nakładających się awizacji', async () => {
    const r = await post<{ code: string; overlaps: string[] }>(u.env, '/avizations', { dateFrom: '2026-10-09', dateTo: '2026-10-10', purpose: 'Inne', personIds: [jan.id] })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'avization_person_overlap', overlaps: ['Jan Testowy (AW/2026/001)'] })
  })

  it('ostrzeżenie o krótkim wyprzedzeniu (domyślnie 1 dzień roboczy) — bez blokady', async () => {
    const r = await post<AvizationDto>(u.env, '/avizations', { dateFrom: '2026-10-05', dateTo: '2026-10-05', purpose: 'Pilne', personIds: [anna.id].filter(() => false), vehicles: [] })
    expect(r.status).toBe(201)
    expect(r.body.warnings[0]?.code).toBe('short_notice')
  })

  it('wysłanie → Zamawiający widzi i akceptuje; Arsanit nie może akceptować', async () => {
    a = (await transition(u.env, a, { action: 'send' })).body
    expect(a.status).toBe('sent')
    expect((await transition(u.ars, a, { action: 'accept' })).status).toBe(403)
    const list = (await (await req(h, 'GET', `${P}/avizations`, u.client.headers)).json()) as AvizationDto[]
    expect(list.map((x) => x.number)).toEqual(['AW/2026/001'])
    expect(list[0]!.canDecide).toBe(true)
    a = (await transition(u.client, a, { action: 'accept' })).body
    expect(a).toMatchObject({ status: 'accepted', decidedByName: expect.any(String) })
    expect((await req(h, 'PATCH', `${P}/avizations/${a.id}`, u.env.headers, { version: a.version, purpose: 'x' })).status).toBe(422)
  })

  it('odrzucenie wymaga powodu; akceptacja poza systemem tylko Admin', async () => {
    let b = (await post<AvizationDto>(u.env, '/avizations', { dateFrom: '2026-10-12', dateTo: '2026-10-12', purpose: 'Dostawa', personIds: [anna.id] })).body
    b = (await transition(u.env, b, { action: 'send' })).body
    expect((await transition(u.client, b, { action: 'reject' })).status).toBe(422)
    b = (await transition(u.client, b, { action: 'reject', reason: 'Brak szkolenia BHP' })).body
    expect(b).toMatchObject({ status: 'rejected', rejectionReason: 'Brak szkolenia BHP' })

    let c = (await post<AvizationDto>(u.env, '/avizations', { dateFrom: '2026-10-13', dateTo: '2026-10-13', purpose: 'Pomiar', personIds: [anna.id] })).body
    expect((await transition(u.env, c, { action: 'accept_external', externalRef: 'e-mail' })).status).toBe(403)
    c = (await transition(u.admin, c, { action: 'accept_external', externalRef: 'e-mail ochrony 05.10' })).body
    expect(c).toMatchObject({ status: 'accepted', externalRef: 'e-mail ochrony 05.10' })
  })

  it('kto jest dziś na obiekcie', async () => {
    const r = (await (await req(h, 'GET', `${P}/avizations/on-site?date=2026-10-08`, u.client.headers)).json()) as OnSiteResponse
    expect(r.persons.map((p) => p.name).sort()).toEqual(['Anna Próbna', 'Jan Testowy'])
    expect(r.vehicles[0]).toMatchObject({ registrationNumber: 'WW 111AA', driverName: 'Jan Testowy' })
  })

  it('eksport XLSX w formacie listy ochrony + audit; podwykonawca nie widzi cudzych awizacji', async () => {
    const res = await req(h, 'GET', `${P}/avizations/${a.id}/export/xlsx`, u.client.headers)
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.worksheets[0]!
    const values: string[][] = []
    ws.eachRow((row) => values.push((row.values as unknown[]).slice(1).map((v) => String(v ?? ''))))
    const header = values.findIndex((r) => r[0] === 'Lp')
    expect(values[header]).toEqual(['Lp', 'Nazwisko i imię, nr dokumentu', 'Marka i nr rejestracyjny auta', 'Firma'])
    expect(values[header + 1]).toEqual(['1', 'Anna Próbna, FT123456', '', 'Envcheck'])
    expect(values[header + 2]).toEqual(['2', 'Jan Testowy, ABC 123456', 'Skoda, WW 111AA', 'Envcheck'])
    expect(values.length - header - 1).toBe(20)
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'avizations.export_xlsx'))
    expect(audit).toHaveLength(1)

    const pdf = await req(h, 'GET', `${P}/avizations/day/2026-10-08/export/pdf`, u.env.headers)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect((await req(h, 'GET', `${P}/avizations/${a.id}`, u.sub.headers)).status).toBe(404)
  })
})

describe('M5 import listy osób', () => {
  it('podgląd z pliku w formacie ochrony, potem import z pominięciem duplikatów', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Lista')
    ws.addRow(['Lp', 'Nazwisko i imię, nr dokumentu', 'Marka i nr rejestracyjny auta', 'Firma'])
    ws.addRow([1, 'Jan Testowy, ABC 123456', 'Skoda, WW 111AA', 'Envcheck'])
    ws.addRow([2, 'Ewa Nowa: QWE 112233,', 'Ford, WX 22222', 'Envcheck'])
    ws.addRow([3, 'Olena Testenko, FT765432', '', 'Envcheck'])
    ws.addRow([4, '', '', ''])
    const form = new FormData()
    form.set('file', new File([new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer)], 'lista.xlsx'))
    const prev = await h.app.request(`${P}/people/import/preview`, { method: 'POST', headers: u.env.headers, body: form })
    const { rows } = (await prev.json()) as { rows: PeopleImportRow[] }
    expect(rows).toHaveLength(3)
    expect(rows[0]!.duplicate).toBe(true)
    expect(rows[1]).toMatchObject({ firstName: 'Ewa', lastName: 'Nowa', idDocNumber: 'QWE 112233', idDocType: 'id_card', vehicle: { makeModel: 'Ford', registrationNumber: 'WX 22222' } })
    expect(rows[2]).toMatchObject({ idDocType: 'passport', vehicle: null })

    const commit = await post<{ personsCreated: number; vehiclesCreated: number; skipped: number }>(u.env, '/people/import/commit', {
      rows: rows.map(({ firstName, lastName, idDocType, idDocNumber, company, vehicle }) => ({ firstName, lastName, idDocType, idDocNumber, company, vehicle })),
    })
    expect(commit.body).toEqual({ personsCreated: 2, vehiclesCreated: 1, skipped: 1 })
  })
})
