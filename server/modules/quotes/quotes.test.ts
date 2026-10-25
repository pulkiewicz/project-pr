import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { DEFAULT_PARAMS, computeSummary, nextRevision, reservePct, type OpportunityDto, type QuoteDto, type QuoteListItemDto } from '#shared'
import { and, inArray } from 'drizzle-orm'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
let staff: TestUser
let arsanit: TestUser
let opps: OpportunityDto[]
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  staff = await createUser(h, 'EnvcheckInternal')
  arsanit = await createUser(h, 'Arsanit')
  opps = (await (await req(h, 'GET', '/api/crm/opportunities', admin.headers)).json()) as OpportunityDto[]
})
afterAll(() => h.stop())

const oppId = (code: string) => opps.find((o) => o.code === code)!.id
const get = async (u: TestUser, id: string) => (await (await req(h, 'GET', `/api/quotes/${id}`, u.headers)).json()) as QuoteDto
const list = async (u: TestUser, kind: 'quote' | 'profile' = 'quote') => (await (await req(h, 'GET', `/api/quotes?kind=${kind}`, u.headers)).json()) as QuoteListItemDto[]
const firstLine = (q: QuoteDto) => q.devices[0]!.sections[0]!.lines[0]!

describe('wyliczenia', () => {
  it('rezerwa: baza wg złożoności × (1 + 0,5 × (lata − 1)); nadpisanie ma pierwszeństwo', () => {
    expect(reservePct({ complexity: 'medium', warrantyMonths: 12, reservePctOverride: null })).toBe(0.2)
    expect(reservePct({ complexity: 'high', warrantyMonths: 36, reservePctOverride: null })).toBe(0.6)
    expect(reservePct({ complexity: 'low', warrantyMonths: 24, reservePctOverride: null })).toBe(0.225)
    expect(reservePct({ complexity: 'high', warrantyMonths: 36, reservePctOverride: 0.1 })).toBe(0.1)
  })

  it('opcje poza ceną łączną, ilość urządzeń mnoży koszt, ryzyko jako % kosztu', () => {
    const line = (cost: number) => ({ id: 'l', name: 'x', group: null, quantity: 1, unit: null, unitCost: cost, laborHours: 2, laborRate: 50, cost: null, justification: null, source: 'manual' as const, confidence: null, approved: true, componentId: null, sortOrder: 0 })
    const dev = (id: string, cost: number, quantity: number, isOption = false) => ({ id, name: id, quantity, isOption, included: true, sortOrder: 0, cost: null, sections: [{ id: 's', name: 'Obudowa', sortOrder: 0, cost: null, lines: [line(cost)] }] })
    const s = computeSummary([dev('a', 900, 2), dev('opt', 400, 1, true)], { ...DEFAULT_PARAMS, riskPct: 0.1 })
    expect(s.cost).toBe(2000)
    expect(s).toMatchObject({ marginValue: 2000, reserveValue: 400, riskValue: 200, net: 4600, gross: 5658 })
    expect(s.devices.find((d) => d.id === 'opt')!.price.cost).toBe(500)
    expect(s.sections).toEqual([{ name: 'Obudowa', cost: 2000 }])
  })

  it('rewizje A → B, Z → AA', () => {
    expect(nextRevision([])).toBe('A')
    expect(nextRevision(['A', 'B'])).toBe('C')
    expect(nextRevision(['Z'])).toBe('AA')
  })
})

describe('import OF033 i OF036 — sumy jak w arkuszach', () => {
  it('OF036: koszt 170 800 → netto 375 760 → brutto 462 184,80', async () => {
    const item = (await list(admin)).find((q) => q.opportunityCode === 'OF36')!
    const q = await get(admin, item.id)
    expect(q).toMatchObject({ status: 'imported', revision: 'A', canEdit: false })
    expect(q.summary).toMatchObject({ cost: 170800, marginValue: 170800, reservePct: 0.2, reserveValue: 34160, net: 375760, gross: 462184.8 })
    expect(q.summary!.sections.map((s) => [s.name, s.cost])).toEqual([
      ['Obudowa', 45000],
      ['Układ chłodzenia', 28400],
      ['Automatyka i sterowanie', 43000],
      ['Układy dodatkowe', 20400],
      ['Wyposażenie dodatkowe', 5000],
      ['Koszty inne', 29000],
    ])
  })

  it('OF033: koszt 1 192 900 → netto 2 743 670 → brutto 3 374 714,10', async () => {
    const item = (await list(admin)).find((q) => q.opportunityCode === 'OF33')!
    const q = await get(admin, item.id)
    expect(q.summary).toMatchObject({ cost: 1192900, reserveValue: 357870, net: 2743670, gross: 3374714.1 })
    expect(q.summary!.sections.find((s) => s.name === 'Układ chłodzenia')!.cost).toBe(302000)
  })

  it('5 profili z bazy wiedzy', async () => {
    const names = (await list(admin, 'profile')).map((p) => p.name).sort()
    expect(names).toEqual(['Komora grzewcza', 'Mała / kaskada', 'Mała / standard', 'Walk-in / custom duża', 'Średnia / standard'])
  })

  it('wycena historyczna jest tylko do odczytu', async () => {
    const q = (await list(admin)).find((x) => x.opportunityCode === 'OF33')!
    const res = await req(h, 'PATCH', `/api/quotes/${q.id}`, admin.headers, { notes: 'x', version: (await get(admin, q.id)).version })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'quote_locked' })
  })
})

describe('nowa wycena', () => {
  let quote: QuoteDto

  it('z profilu: rewizja A, pozycje źródło „profil”, niezatwierdzone, parametry profilu', async () => {
    const profile = (await list(admin, 'profile')).find((p) => p.name === 'Walk-in / custom duża')!
    const res = await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: oppId('OF029'), basedOnId: profile.id })
    expect(res.status).toBe(201)
    quote = (await res.json()) as QuoteDto
    expect(quote).toMatchObject({ revision: 'A', status: 'draft', basedOnLabel: 'Profil: Walk-in / custom duża', canEdit: true, opportunityCode: 'OF029' })
    expect(quote.params.complexity).toBe('high')
    expect(firstLine(quote)).toMatchObject({ source: 'profile', approved: false })
  })

  it('Envcheck wewnętrzny widzi i edytuje koszty, ale nie marżę, rezerwę ani cenę (uprawnienia rozdzielone)', async () => {
    expect(quote).toMatchObject({ canSeeCosts: true, canEditCosts: true, canSeePricing: false, summary: null })
    expect(quote.costSummary!.cost).toBe(1192900)
    expect(quote.params).toMatchObject({ marginMultiplier: null, reservePctOverride: null, riskPct: null, vatPct: null, complexity: 'high', warrantyMonths: 12 })
    expect(firstLine(quote).unitCost).toBe(158000)
    const line = firstLine(quote)
    const ok = await req(h, 'PATCH', `/api/quotes/${quote.id}/lines/${line.id}`, staff.headers, { justification: 'Wg rysunku', approved: true, unitCost: 158000 })
    expect(ok.status).toBe(200)
    expect(firstLine((await ok.json()) as QuoteDto)).toMatchObject({ justification: 'Wg rysunku', approved: true, source: 'profile', quantity: 1 })
    const list = (await (await req(h, 'GET', '/api/quotes', staff.headers)).json()) as QuoteListItemDto[]
    expect(list.find((x) => x.id === quote.id)).toMatchObject({ cost: 1192900, net: null })
    expect((await req(h, 'PATCH', `/api/quotes/${quote.id}`, staff.headers, { params: { marginMultiplier: 3 }, version: (await get(staff, quote.id)).version })).status).toBe(403)
    const warranty = await req(h, 'PATCH', `/api/quotes/${quote.id}`, staff.headers, { params: { warrantyMonths: 24 }, version: (await get(staff, quote.id)).version })
    expect(warranty.status).toBe(200)
    expect(((await warranty.json()) as QuoteDto).params.warrantyMonths).toBe(24)
    await req(h, 'PATCH', `/api/quotes/${quote.id}`, staff.headers, { params: { warrantyMonths: 12 }, version: (await get(staff, quote.id)).version })
    expect((await req(h, 'GET', `/api/quotes/${quote.id}/export.xlsx`, staff.headers)).status).toBe(403)
  })

  it('bez uprawnienia do kosztów pola kosztowe są ukryte, a ich zmiana odrzucona', async () => {
    await h.db.update(schema.permissions).set({ allowed: false }).where(and(eq(schema.permissions.role, 'EnvcheckInternal'), eq(schema.permissions.module, 'quotesCost')))
    const q = await get(staff, quote.id)
    expect(q).toMatchObject({ canSeeCosts: false, costSummary: null })
    expect(firstLine(q)).toMatchObject({ unitCost: null, cost: null })
    expect((await req(h, 'PATCH', `/api/quotes/${quote.id}/lines/${firstLine(q).id}`, staff.headers, { unitCost: 1 })).status).toBe(403)
    await h.db.update(schema.permissions).set({ allowed: true }).where(and(eq(schema.permissions.role, 'EnvcheckInternal'), eq(schema.permissions.module, 'quotesCost'), inArray(schema.permissions.action, ['view', 'create', 'edit', 'export'])))
  })

  it('Admin: koszt z profilu, zmiana ceny pozycji i parametrów przelicza podsumowanie', async () => {
    let q = await get(admin, quote.id)
    expect(q.summary!.cost).toBe(1192900)
    const line = firstLine(q)
    q = (await (await req(h, 'PATCH', `/api/quotes/${q.id}/lines/${line.id}`, admin.headers, { unitCost: 158000 + 100, laborHours: 10, laborRate: 150 })).json()) as QuoteDto
    expect(q.summary!.cost).toBe(1192900 + 100 + 1500)
    q = (await (await req(h, 'PATCH', `/api/quotes/${q.id}`, admin.headers, { params: { warrantyMonths: 36, riskPct: 0.05 }, info: { deliveryTerm: '10 miesięcy' }, version: q.version })).json()) as QuoteDto
    expect(q.summary!.reservePct).toBe(0.6)
    expect(q.summary!.riskValue).toBe(Math.round(1194500 * 0.05 * 100) / 100)
    expect(q.info.deliveryTerm).toBe('10 miesięcy')
  })

  it('sekcje edytowalne; pozycja przenoszona między sekcjami; opcja liczona osobno', async () => {
    let q = await get(admin, quote.id)
    const dev = q.devices[0]!
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/devices/${dev.id}/sections`, admin.headers, { name: 'Montaż na miejscu' })).json()) as QuoteDto
    const sec = q.devices[0]!.sections.at(-1)!
    expect(sec.name).toBe('Montaż na miejscu')
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/sections/${sec.id}/lines`, admin.headers, { name: 'Ekipa montażowa', quantity: 2, unit: 'tydz.', unitCost: 12000 })).json()) as QuoteDto
    const before = q.summary!.cost
    q = (await (await req(h, 'PATCH', `/api/quotes/${q.id}/sections/${sec.id}`, admin.headers, { name: 'Montaż' })).json()) as QuoteDto
    expect(q.devices[0]!.sections.at(-1)!.name).toBe('Montaż')
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/devices`, admin.headers, { name: 'Chiller (opcja)', isOption: true, withDefaultSections: false })).json()) as QuoteDto
    expect(q.devices).toHaveLength(2)
    expect(q.summary!.cost).toBe(before)
    const optSecQ = (await (await req(h, 'POST', `/api/quotes/${q.id}/devices/${q.devices[1]!.id}/sections`, admin.headers, { name: 'Układ chłodzenia' })).json()) as QuoteDto
    const optSec = optSecQ.devices[1]!.sections[0]!
    const moved = q.devices[0]!.sections.at(-1)!.lines[0]!
    q = (await (await req(h, 'PATCH', `/api/quotes/${q.id}/lines/${moved.id}`, admin.headers, { sectionId: optSec.id })).json()) as QuoteDto
    expect(q.summary!.cost).toBe(before - 24000)
    expect(q.summary!.devices.find((d) => d.isOption)!.price.cost).toBe(24000)
    expect((await req(h, 'DELETE', `/api/quotes/${q.id}/sections/${q.devices[0]!.sections.at(-1)!.id}`, admin.headers)).status).toBe(200)
  })

  it('z poprzedniej wyceny: etykieta źródła, bez nadpisania rezerwy z importu', async () => {
    const of33 = (await list(admin)).find((x) => x.opportunityCode === 'OF33')!
    const q = (await (await req(h, 'POST', '/api/quotes', admin.headers, { opportunityId: oppId('OF029'), basedOnId: of33.id })).json()) as QuoteDto
    expect(q).toMatchObject({ revision: 'B', basedOnLabel: 'Wycena OF33 rew. A' })
    expect(q.params.reservePctOverride).toBeNull()
    expect(firstLine(q).source).toBe('previous')
  })

  it('pusta wycena: jedno urządzenie z 6 domyślnymi sekcjami', async () => {
    const q = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: oppId('OF35') })).json()) as QuoteDto
    expect(q.devices).toHaveLength(1)
    expect(q.devices[0]!.sections.map((s) => s.name)).toEqual(['Obudowa', 'Układ chłodzenia', 'Automatyka i sterowanie', 'Układy dodatkowe', 'Wyposażenie dodatkowe', 'Koszty inne'])
    expect((await req(h, 'POST', '/api/quotes', staff.headers, {})).status).toBe(422)
  })

  it('zatwierdzenie blokuje edycję; nowa rewizja to kopia robocza', async () => {
    let q = await get(admin, quote.id)
    expect((await req(h, 'POST', `/api/quotes/${q.id}/status`, staff.headers, { status: 'approved', version: q.version })).status).toBe(403)
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/status`, admin.headers, { status: 'approved', version: q.version })).json()) as QuoteDto
    expect(q).toMatchObject({ status: 'approved', canEdit: false })
    expect((await req(h, 'PATCH', `/api/quotes/${q.id}/lines/${firstLine(q).id}`, admin.headers, { name: 'x' })).status).toBe(409)
    expect((await req(h, 'POST', `/api/quotes/${q.id}/status`, admin.headers, { status: 'sent', version: q.version })).status).toBe(200)
    const rev = (await (await req(h, 'POST', `/api/quotes/${q.id}/revision`, staff.headers)).json()) as QuoteDto
    expect(rev).toMatchObject({ revision: 'C', status: 'draft', basedOnLabel: 'Wycena OF029 rew. A' })
    expect(rev.params.warrantyMonths).toBe(36)
  })

  it('zapis jako profil (baza wiedzy) i eksport XLSX w układzie arkusza', async () => {
    const res = await req(h, 'POST', `/api/quotes/${quote.id}/save-as-profile`, admin.headers, { name: 'Walk-in z montażem', description: 'Z OF029' })
    expect(res.status).toBe(201)
    expect(((await res.json()) as QuoteDto).kind).toBe('profile')
    const x = await req(h, 'GET', `/api/quotes/${quote.id}/export.xlsx`, admin.headers)
    expect(x.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await x.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name).slice(0, 3)).toEqual(['PODSUMOWANIE', 'OBUDOWA', 'UKŁAD CHŁODZENIA'])
  })
})

describe('ustawienia i dostęp', () => {
  it('zmiana bazy rezerwy w ustawieniach zmienia podsumowanie wycen bez nadpisania', async () => {
    const q = (await (await req(h, 'POST', '/api/quotes', admin.headers, { opportunityId: oppId('OF35') })).json()) as QuoteDto
    expect((await req(h, 'PUT', '/api/quotes/settings', staff.headers, { reserve: { low: 0.1, medium: 0.25, high: 0.3, perExtraYear: 0.5 }, laborRate: 120 })).status).toBe(403)
    expect((await req(h, 'PUT', '/api/quotes/settings', admin.headers, { reserve: { low: 0.1, medium: 0.25, high: 0.3, perExtraYear: 0.5 }, laborRate: 120 })).status).toBe(200)
    expect((await get(admin, q.id)).summary!.reservePct).toBe(0.25)
    const of36 = (await list(admin)).find((x) => x.opportunityCode === 'OF36')!
    expect((await get(admin, of36.id)).summary!.reservePct).toBe(0.2)
  })

  it('rola zewnętrzna nie ma dostępu do wycen', async () => {
    expect((await req(h, 'GET', '/api/quotes', arsanit.headers)).status).toBe(403)
  })
})
