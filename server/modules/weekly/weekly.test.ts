import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HrfTasksResponse, PurchasesResponse, WeekMatrixResponse, WeekViewResponse, WeeklyItemDto } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { buildHrfFixture, FIXTURE_MAPPING } from '../../test/hrf-fixture.ts'
import { createUser, req, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
const u = {} as Record<'admin' | 'env' | 'ars' | 'client' | 'sub', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}`
const SUB_ID = '11111111-1111-4111-8111-111111111111'
let tasks: HrfTasksResponse

beforeAll(async () => {
  h = await startHarness()
  h.clock.now = new Date('2026-10-06T08:00:00Z') // 2026-W41
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.client = await createUser(h, 'Client')
  u.sub = await createUser(h, 'Subcontractor', { subcontractorId: SUB_ID })
  const form = new FormData()
  form.set('file', new File([new Uint8Array(await buildHrfFixture())], 'HRF.xlsx'))
  form.set('mapping', JSON.stringify(FIXTURE_MAPPING))
  await h.app.request(`${P}/hrf/import/commit`, { method: 'POST', headers: u.admin.headers, body: form })
  const project = (await (await req(h, 'GET', P, u.admin.headers)).json()) as { version: number }
  await req(h, 'PUT', `${P}/hrf/day-zero`, u.admin.headers, { date: '2026-09-21', projectVersion: project.version })
  tasks = (await (await req(h, 'GET', `${P}/hrf/tasks`, u.admin.headers)).json()) as HrfTasksResponse
})
afterAll(() => h.stop())

const task = (code: string) => tasks.tasks.find((t) => t.code === code)!
const create = (user: TestUser, body: object) => req(h, 'POST', `${P}/weekly-items`, user.headers, { isoWeek: '2026-W41', ...body })

describe('M3 plan tygodniowy', () => {
  it('widok tygodnia pokazuje zadania HRF aktywne w tygodniu (planowo)', async () => {
    const r = (await (await req(h, 'GET', `${P}/weekly/2026-W41`, u.env.headers)).json()) as WeekViewResponse
    expect(r).toMatchObject({ start: '2026-10-05', end: '2026-10-11' })
    // 1.2 (tyg. 1–9) aktywne; 1.1 (tyg. 1–2) skończone 04.10
    expect(r.hrfTasks!.map((t) => t.code)).toContain('1.2')
    expect(r.hrfTasks!.map((t) => t.code)).not.toContain('1.1')
  })

  it('strony tworzą pozycje tylko dla siebie; Client tylko odczyt', async () => {
    expect((await create(u.ars, { title: 'Montaż A', party: 'Arsanit', hrfTaskId: task('1.2').id, plannedDays: 0b11 })).status).toBe(201)
    expect((await create(u.ars, { title: 'Cudze', party: 'Envcheck' })).status).toBe(403)
    expect((await create(u.env, { title: 'Koordynacja', party: 'Konsorcjum', assigneeUserId: u.ars.id })).status).toBe(201)
    expect((await create(u.client, { title: 'x', party: 'Client' })).status).toBe(403)
    expect((await create(u.admin, { title: 'Dla podwykonawcy', party: 'Envcheck', assigneeSubcontractorId: SUB_ID })).status).toBe(201)
  })

  it('podwykonawca widzi wyłącznie pozycje przypisane do swojej firmy (i bez HRF)', async () => {
    const r = (await (await req(h, 'GET', `${P}/weekly/2026-W41`, u.sub.headers)).json()) as WeekViewResponse
    expect(r.items.map((i) => i.title)).toEqual(['Dla podwykonawcy'])
    expect(r.hrfTasks).toBeNull()
    expect(r.items[0]!.canEdit).toBe(false)
  })

  it('przypisany wykonawca może edytować pozycję innej strony; konflikt wersji → 409', async () => {
    const r = (await (await req(h, 'GET', `${P}/weekly/2026-W41`, u.ars.headers)).json()) as WeekViewResponse
    const coord = r.items.find((i) => i.title === 'Koordynacja')!
    expect(coord.canEdit).toBe(true) // Konsorcjum + przypisany
    const ok = await req(h, 'PATCH', `${P}/weekly-items/${coord.id}`, u.ars.headers, { version: coord.version, status: 'done' })
    expect(ok.status).toBe(200)
    const stale = await req(h, 'PATCH', `${P}/weekly-items/${coord.id}`, u.ars.headers, { version: coord.version, status: 'plan' })
    expect(stale.status).toBe(409)
    const own = r.items.find((i) => i.title === 'Dla podwykonawcy')!
    expect((await req(h, 'PATCH', `${P}/weekly-items/${own.id}`, u.ars.headers, { version: own.version, title: 'x' })).status).toBe(403)
  })

  it('zamknięcie tygodnia przenosi wybrane niewykonane pozycje na następny tydzień', async () => {
    const r = (await (await req(h, 'GET', `${P}/weekly/2026-W41`, u.admin.headers)).json()) as WeekViewResponse
    const montaz = r.items.find((i) => i.title === 'Montaż A')!
    const done = r.items.find((i) => i.title === 'Koordynacja')!
    const bad = await req(h, 'POST', `${P}/weekly/2026-W41/close`, u.admin.headers, { carryItemIds: [done.id] })
    expect(bad.status).toBe(422)
    const res = await req(h, 'POST', `${P}/weekly/2026-W41/close`, u.admin.headers, { carryItemIds: [montaz.id] })
    expect(await res.json()).toEqual({ carried: 1, nextWeek: '2026-W42' })

    const w41 = (await (await req(h, 'GET', `${P}/weekly/2026-W41`, u.admin.headers)).json()) as WeekViewResponse
    expect(w41.items.find((i) => i.id === montaz.id)!.status).toBe('moved')
    expect(w41.stats).toMatchObject({ total: 3, done: 1, moved: 1 })
    const w42 = (await (await req(h, 'GET', `${P}/weekly/2026-W42`, u.admin.headers)).json()) as WeekViewResponse
    const copy = w42.items[0] as WeeklyItemDto
    expect(copy).toMatchObject({ title: 'Montaż A', status: 'plan', carryOverFromId: montaz.id, carriedOverFromWeek: '2026-W41', plannedDays: 0b11 })
    expect(w42.stats.carriedIn).toBe(1)
  })

  it('macierz 8 tygodni: wiersze HRF z aktywnością i liczbą pozycji', async () => {
    const m = (await (await req(h, 'GET', `${P}/weekly-matrix?from=2026-W41&weeks=8`, u.client.headers)).json()) as WeekMatrixResponse
    expect(m.weeks).toHaveLength(8)
    const row = m.rows.find((r) => r.label.startsWith('1.2 '))!
    expect(row.cells[0]).toMatchObject({ hrfActive: true, items: 1 })
    expect(row.cells[1]).toMatchObject({ hrfActive: true, items: 1 })
    expect(m.rows.some((r) => r.kind === 'party')).toBe(true)
  })

  it('dashboard: moje zadania zawierają pozycje bieżącego tygodnia', async () => {
    const d = (await (await req(h, 'GET', `${P}/dashboard`, u.ars.headers)).json()) as { myTasks: { source: string }[] }
    // „Koordynacja” jest wykonana → nie ma jej w moich zadaniach
    expect(d.myTasks.filter((t) => t.source === 'weekly')).toHaveLength(0)
  })
})

describe('M4 plan zakupów', () => {
  const add = (user: TestUser, body: object) => req(h, 'POST', `${P}/purchases`, user.headers, body)

  it('wylicza datę potrzeby i termin zamówienia z HRF; alert dostawy po dacie potrzeby', async () => {
    // 2.1 start: tydz. 11 → 30.11.2026; − 5 dni roboczych = 23.11.2026; − 8 tyg. = 28.09.2026 (minął)
    const res = await add(u.ars, { name: 'Sprężarka W75-240Y', party: 'Arsanit', hrfTaskId: task('2.1').id, leadTimeWeeks: 8, isCritical: true })
    expect(res.status).toBe(201)
    const item = (await res.json()) as PurchasesResponse['items'][number]
    expect(item).toMatchObject({ needDate: '2026-11-23', orderByDate: '2026-09-28', hrfTaskCode: '2.1' })
    expect(item.alerts).toEqual([{ code: 'order_overdue', severity: 'red', days: 8 }])

    const late = await req(h, 'PATCH', `${P}/purchases/${item.id}`, u.ars.headers, {
      version: item.version, status: 'confirmed', orderDateActual: '2026-10-01', confirmedDeliveryDate: '2026-12-01',
    })
    expect(((await late.json()) as typeof item).alerts).toEqual([{ code: 'delivery_after_need', severity: 'red', days: 8 }])
  })

  it('Arsanit tylko pozycje Arsanit; Envcheck tylko Envcheck; Admin wszystko', async () => {
    expect((await add(u.ars, { name: 'X', party: 'Envcheck' })).status).toBe(403)
    expect((await add(u.env, { name: 'Wymiennik płytowy', party: 'Envcheck' })).status).toBe(201)
    const list = (await (await req(h, 'GET', `${P}/purchases`, u.env.headers)).json()) as PurchasesResponse
    const spr = list.items.find((i) => i.name.startsWith('Sprężarka'))!
    expect(spr.canEdit).toBe(false)
    expect((await req(h, 'PATCH', `${P}/purchases/${spr.id}`, u.env.headers, { version: spr.version, notes: 'x' })).status).toBe(403)
  })

  it('Client i Subcontractor nie mają dostępu do planu zakupów — ani w API, ani w alertach dashboardu', async () => {
    expect((await req(h, 'GET', `${P}/purchases`, u.client.headers)).status).toBe(403)
    expect((await req(h, 'GET', `${P}/purchases`, u.sub.headers)).status).toBe(403)
    const dc = await (await req(h, 'GET', `${P}/dashboard`, u.client.headers)).text()
    expect(dc).not.toContain('Sprężarka')
    const da = await (await req(h, 'GET', `${P}/dashboard`, u.admin.headers)).text()
    expect(da).toContain('Sprężarka W75-240Y: dostawa 8 dni po dacie potrzeby')
  })

  it('brak pól cenowych w API', async () => {
    const raw = await (await req(h, 'GET', `${P}/purchases`, u.admin.headers)).text()
    expect(raw).not.toMatch(/price|cost|cena|koszt/i)
  })

  it('eksport XLSX', async () => {
    const res = await req(h, 'GET', `${P}/purchases/export.xlsx`, u.ars.headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
  })
})
