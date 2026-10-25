import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_SPEC_ITEMS,
  EMPTY_CALC,
  OF022_EXAMPLE,
  computeCalc,
  isPriceStale,
  surfaceAreaM2,
  type ChecklistDto,
  type ComponentDto,
  type OpportunityDto,
  type QuoteCalcDto,
  type QuoteDto,
  type SpecListDto,
} from '#shared'
import { and } from 'drizzle-orm'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
let staff: TestUser
let quote: QuoteDto
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  staff = await createUser(h, 'EnvcheckInternal')
  const opps = (await (await req(h, 'GET', '/api/crm/opportunities', admin.headers)).json()) as OpportunityDto[]
  quote = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: opps.find((o) => o.code === 'OF36')!.id })).json()) as QuoteDto
})
afterAll(() => h.stop())

const checklist = async (u: TestUser = staff, id = quote.id) => (await (await req(h, 'GET', `/api/quotes/${id}/checklist`, u.headers)).json()) as ChecklistDto
const put = (key: string, body: unknown, u: TestUser = staff) => req(h, 'PUT', `/api/quotes/${quote.id}/checklist/${encodeURIComponent(key)}`, u.headers, body)

describe('kalkulator mocy (OF022)', () => {
  it('odtwarza arkusz OF022: masy 7 220 W, razem 12 870 W', () => {
    const r = computeCalc(OF022_EXAMPLE)
    expect(r.masses.map((m) => m.watts)).toEqual([230, 1380, 420, 975, 600, 3615])
    expect(r.massesW).toBe(7220)
    expect(r.totalW).toBe(12870)
    expect(r.totalKw).toBe(12.87)
  })

  it('przenikanie U × A × ΔT z wymiarów; nadpisanie ma pierwszeństwo; zapas mnoży wynik', () => {
    expect(surfaceAreaM2({ w: 3000, h: 3000, d: 3000 })).toBe(54)
    const input = { ...EMPTY_CALC, transmission: { uValue: 0.3, areaM2: null, dimsMm: { w: 3000, h: 3000, d: 3000 }, deltaT: 90, overrideW: null }, safetyFactor: 1.2 }
    const r = computeCalc(input)
    expect(r.transmissionW).toBe(1458)
    expect(r.requiredKw).toBe(1.75)
    expect(computeCalc({ ...input, transmission: { ...input.transmission, overrideW: 500 } }).transmissionW).toBe(500)
  })

  it('kalkulacja zapisana w wycenie liczy wynik po stronie serwera', async () => {
    const res = await req(h, 'POST', `/api/quotes/${quote.id}/calcs`, staff.headers, { name: 'Komora 1', deviceId: quote.devices[0]!.id, input: OF022_EXAMPLE })
    expect(res.status).toBe(200)
    const calcs = (await res.json()) as QuoteCalcDto[]
    expect(calcs[0]).toMatchObject({ name: 'Komora 1', deviceId: quote.devices[0]!.id, result: { totalW: 12870 } })
  })
})

describe('checklista specyfikacyjna (krok 3)', () => {
  it('pozycje listy v1, wszystkie „do uzupełnienia”', async () => {
    const c = await checklist()
    expect(c.specVersion).toBe(1)
    expect(c.items).toHaveLength(DEFAULT_SPEC_ITEMS.length)
    expect(c.progress).toMatchObject({ confirmed: 0, pending: DEFAULT_SPEC_ITEMS.length })
  })

  it('wartość wg typu, potwierdzenie (OK), brak w materiałach, nie dotyczy', async () => {
    expect((await put('temp_range', { value: { min: -60, max: 70 }, status: 'confirmed' })).status).toBe(200)
    expect((await put('inner_dims', { value: { w: 500, h: 500, d: 1000 } })).status).toBe(200)
    expect((await put('temp_range', { value: { t: 'x' } })).status).toBe(422)
    expect((await put('chamber_type', { value: { v: 'rakieta' } })).status).toBe(422)
    expect((await put('nieistniejace', { status: 'confirmed' })).status).toBe(404)
    await put('rate', { status: 'missing', note: 'Brak w zapytaniu WB' })
    await put('li_ion', { value: { b: false }, status: 'na' })
    const c = await checklist()
    expect(c.items.find((i) => i.key === 'temp_range')).toMatchObject({ value: { min: -60, max: 70 }, status: 'confirmed' })
    expect(c.items.find((i) => i.key === 'inner_dims')).toMatchObject({ value: { w: 500, h: 500, d: 1000 }, status: 'pending' })
    expect(c.progress).toMatchObject({ confirmed: 1, missing: 1, na: 1 })
    expect(((await (await req(h, 'GET', `/api/quotes/${quote.id}`, staff.headers)).json()) as QuoteDto).checklistProgress).toEqual({ confirmed: 1, total: DEFAULT_SPEC_ITEMS.length })
  })

  it('wymagania spoza listy: dodanie, edycja, usunięcie', async () => {
    let c = (await (await req(h, 'POST', `/api/quotes/${quote.id}/checklist/custom`, staff.headers, { label: 'Oferta ma zawierać karty katalogowe', value: 'z zapytania' })).json()) as ChecklistDto
    const custom = c.items.find((i) => i.custom)!
    expect(custom).toMatchObject({ label: 'Oferta ma zawierać karty katalogowe', group: 'Wymagania dodatkowe', value: { t: 'z zapytania' } })
    expect((await put(custom.key, { status: 'confirmed' })).status).toBe(200)
    expect((await req(h, 'DELETE', `/api/quotes/${quote.id}/checklist/temp_range`, staff.headers)).status).toBe(422)
    c = (await (await req(h, 'DELETE', `/api/quotes/${quote.id}/checklist/${encodeURIComponent(custom.key)}`, staff.headers)).json()) as ChecklistDto
    expect(c.items.some((i) => i.custom)).toBe(false)
  })

  it('nowa wersja listy nie zmienia checklisty rozpoczętej wyceny; nowe wyceny dostają nową wersję', async () => {
    const v1 = ((await (await req(h, 'GET', '/api/spec-list', staff.headers)).json()) as SpecListDto[])[0]!
    const items = [...v1.items, { key: 'noise_level', group: 'Ogólne', label: 'Poziom hałasu', type: 'number' as const, unit: 'dB(A)' }]
    const res = await req(h, 'POST', '/api/spec-list', staff.headers, { items, notes: 'Dodany hałas' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as SpecListDto).version).toBe(2)
    expect((await req(h, 'POST', '/api/spec-list', staff.headers, { items: [...items, items[0]] })).status).toBe(422)
    const c = await checklist()
    expect(c.specVersion).toBe(1)
    expect(c.items.some((i) => i.key === 'noise_level')).toBe(false)
    const opps = (await (await req(h, 'GET', '/api/crm/opportunities', admin.headers)).json()) as OpportunityDto[]
    const fresh = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: opps.find((o) => o.code === 'OF35')!.id })).json()) as QuoteDto
    expect((await checklist(staff, fresh.id)).specVersion).toBe(2)
  })

  it('nowa rewizja przejmuje checklistę i kalkulacje', async () => {
    const rev = (await (await req(h, 'POST', `/api/quotes/${quote.id}/revision`, staff.headers)).json()) as QuoteDto
    const c = await checklist(staff, rev.id)
    expect(c.specVersion).toBe(1)
    expect(c.items.find((i) => i.key === 'temp_range')!.status).toBe('confirmed')
    const calcs = (await (await req(h, 'GET', `/api/quotes/${rev.id}/calcs`, staff.headers)).json()) as QuoteCalcDto[]
    expect(calcs[0]).toMatchObject({ name: 'Komora 1', deviceId: rev.devices[0]!.id })
  })
})

describe('katalog komponentów', () => {
  let comp: ComponentDto

  it('pozycja z ceną i wydajnością; cena ukryta bez uprawnienia do kosztów', async () => {
    const res = await req(h, 'POST', '/api/components', staff.headers, { category: 'compressor', name: 'Bitzer 4FES-5Y', capacityW: 9800, evapTempC: -35, refrigerant: 'R452A', price: 14500, priceDate: '2026-10-01' })
    expect(res.status).toBe(201)
    comp = (await res.json()) as ComponentDto
    expect(comp).toMatchObject({ price: 14500, priceStale: false, capacityW: 9800 })
    await h.db.update(schema.permissions).set({ allowed: false }).where(and(eq(schema.permissions.role, 'EnvcheckInternal'), eq(schema.permissions.module, 'quotesCost')))
    const hidden = ((await (await req(h, 'GET', '/api/components?category=compressor', staff.headers)).json()) as ComponentDto[])[0]!
    expect(hidden.price).toBeNull()
    expect((await req(h, 'PATCH', `/api/components/${comp.id}`, staff.headers, { price: 1, version: comp.version })).status).toBe(403)
    expect((await req(h, 'PATCH', `/api/components/${comp.id}`, staff.headers, { notes: 'OK', version: comp.version })).status).toBe(200)
  })

  it('cena starsza niż próg z ustawień jest oznaczona', () => {
    expect(isPriceStale('2025-09-30', '2026-10-25', 12)).toBe(true)
    expect(isPriceStale('2025-10-26', '2026-10-25', 12)).toBe(false)
    expect(isPriceStale(null, '2026-10-25', 12)).toBe(true)
  })

  it('pozycja wyceny z katalogu: źródło „katalog” i powiązanie z komponentem', async () => {
    const q = (await (await req(h, 'GET', `/api/quotes/${quote.id}`, admin.headers)).json()) as QuoteDto
    const sec = q.devices[0]!.sections.find((s) => s.name === 'Układ chłodzenia')!
    const res = await req(h, 'POST', `/api/quotes/${q.id}/sections/${sec.id}/lines`, admin.headers, { name: comp.name, unitCost: 14500, source: 'catalog', componentId: comp.id, justification: 'Dobór na 9,8 kW @ −35 °C (kalkulator)' })
    expect(res.status).toBe(200)
    const line = ((await res.json()) as QuoteDto).devices[0]!.sections.find((s) => s.id === sec.id)!.lines.at(-1)!
    expect(line).toMatchObject({ source: 'catalog', componentId: comp.id, cost: 14500 })
  })
})
