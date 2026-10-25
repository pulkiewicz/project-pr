import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and } from 'drizzle-orm'
import type { CompanyDetailDto, CompanyDto, ContactDto, MeResponse, OpportunityDetailDto, OpportunityDto } from '#shared'
import { formatOpportunityCode, normalizeNip, opportunityCodePrefix } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { nextOpportunityCode } from './service.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
let staff: TestUser
let arsanit: TestUser
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  staff = await createUser(h, 'EnvcheckInternal')
  arsanit = await createUser(h, 'Arsanit')
})
afterAll(() => h.stop())

const list = async () => (await (await req(h, 'GET', '/api/crm/opportunities', staff.headers)).json()) as OpportunityDto[]
const byCode = async (code: string) => (await list()).find((o) => o.code === code)!

describe('kody i NIP', () => {
  it('prefiks roku: 2026 = OF, 2027 = OG; numer min. 3 cyfry', () => {
    expect(opportunityCodePrefix(2026)).toBe('OF')
    expect(opportunityCodePrefix(2027)).toBe('OG')
    expect(opportunityCodePrefix(2028)).toBe('OH')
    expect(formatOpportunityCode('OF', 38)).toBe('OF038')
    expect(formatOpportunityCode('OG', 1234)).toBe('OG1234')
  })

  it('NIP z sumą kontrolną, zapis z kreskami i prefiksem PL', () => {
    expect(normalizeNip('PL 951-259-15-69')).toBe('9512591569')
    expect(normalizeNip('9512591568')).toBeNull()
    expect(normalizeNip('123')).toBeNull()
  })
})

describe('import arkusza CRM', () => {
  it('24 oferty z kodami bez zmian, etapy wg mapowania, OF14 = projekt PIT-RADWAR', async () => {
    const all = await list()
    expect(all).toHaveLength(24)
    const stage = Object.fromEntries(all.map((o) => [o.code, o.stage]))
    expect(stage).toMatchObject({ OF14: 'won', OF015_S: 'submitted', OF018: 'lost', OF020: 'submitted', OF027: 'new', OF029: 'quoting', OF33: 'quoting', OF34: 'on_hold', OF37: 'submitted' })
    const of14 = all.find((o) => o.code === 'OF14')!
    expect(of14).toMatchObject({ projectId: SEED_PROJECT_ID, projectCode: 'OF14', companyName: 'PIT-RADWAR S.A.' })
    expect(all.find((o) => o.code === 'OF37')).toMatchObject({ value: 257000, nextStep: 'zaproponowałem 257k netto' })
  })

  it('„brak odpowiedzi” od razu dla złożonych bez odzewu, nie dla „czekamy na wynik”', async () => {
    expect((await byCode('OF015_S')).noResponse).toBe(true)
    expect((await byCode('OF020')).noResponse).toBe(false)
  })

  it('firmy zdeduplikowane (RADWAR / PIT-Radwar → jedna firma z 5 szansami)', async () => {
    const companies = (await (await req(h, 'GET', '/api/crm/companies', staff.headers)).json()) as CompanyDto[]
    expect(companies).toHaveLength(18)
    expect(companies.find((c) => c.name === 'PIT-RADWAR S.A.')).toMatchObject({ opportunityCount: 5, openOpportunityCount: 2 })
  })
})

describe('szanse', () => {
  let company: CompanyDto
  let contact: ContactDto
  let opp: OpportunityDetailDto

  it('firma z NIP; duplikat NIP → 409, błędny NIP → 422', async () => {
    const res = await req(h, 'POST', '/api/crm/companies', staff.headers, { name: 'Envcheck Test', nip: 'PL951-259-15-69' })
    expect(res.status).toBe(201)
    company = (await res.json()) as CompanyDto
    expect(company.nip).toBe('9512591569')
    expect((await req(h, 'POST', '/api/crm/companies', staff.headers, { name: 'Dup', nip: '9512591569' })).status).toBe(409)
    expect((await req(h, 'POST', '/api/crm/companies', staff.headers, { name: 'Zły', nip: '9512591568' })).status).toBe(422)
  })

  it('kontakt w firmie; szansa dostaje kolejny kod OF038, opiekun = autor', async () => {
    contact = (await (await req(h, 'POST', `/api/crm/companies/${company.id}/contacts`, staff.headers, { name: 'Jan Kowalski', email: 'jan@x.test' })).json()) as ContactDto
    const res = await req(h, 'POST', '/api/crm/opportunities', staff.headers, { name: 'Komora 1 m³', companyId: company.id, contactId: contact.id, type: 'private_inquiry', value: 250000 })
    expect(res.status).toBe(201)
    opp = (await res.json()) as OpportunityDetailDto
    expect(opp).toMatchObject({ code: 'OF038', stage: 'new', ownerId: staff.id, companyName: 'Envcheck Test', contactName: 'Jan Kowalski' })
    const next = (await (await req(h, 'POST', '/api/crm/opportunities', staff.headers, { name: 'Druga' })).json()) as OpportunityDto
    expect(next.code).toBe('OF039')
  })

  it('w 2027 numeracja od OG001; licznik nie cofa się poniżej istniejących kodów', async () => {
    expect(await nextOpportunityCode(h.db, 2027)).toBe('OG001')
    expect(await nextOpportunityCode(h.db, 2027)).toBe('OG002')
    await h.db.update(schema.opportunityCodeSeq).set({ last: 1 }).where(eq(schema.opportunityCodeSeq.prefix, 'OF'))
    expect(await nextOpportunityCode(h.db, 2026)).toBe('OF040')
  })

  it('kontakt spoza firmy → 422; opiekun spoza Envcheck → 422', async () => {
    const other = (await (await req(h, 'POST', '/api/crm/companies', staff.headers, { name: 'Inna' })).json()) as CompanyDto
    expect((await req(h, 'PATCH', `/api/crm/opportunities/${opp.id}`, staff.headers, { companyId: other.id, contactId: contact.id, version: opp.version })).status).toBe(422)
    expect((await req(h, 'PATCH', `/api/crm/opportunities/${opp.id}`, staff.headers, { ownerId: arsanit.id, version: opp.version })).status).toBe(422)
  })

  it('zmiana etapu zapisuje aktywność; przegrana wymaga powodu; konflikt wersji → 409', async () => {
    expect((await req(h, 'POST', `/api/crm/opportunities/${opp.id}/stage`, staff.headers, { stage: 'lost', version: opp.version })).status).toBe(422)
    const res = await req(h, 'POST', `/api/crm/opportunities/${opp.id}/stage`, staff.headers, { stage: 'submitted', version: opp.version })
    expect(res.status).toBe(200)
    const after = (await res.json()) as OpportunityDetailDto
    expect(after.stage).toBe('submitted')
    expect(after.activities[0]).toMatchObject({ kind: 'stage_change', meta: { from: 'new', to: 'submitted' } })
    expect((await req(h, 'POST', `/api/crm/opportunities/${opp.id}/stage`, staff.headers, { stage: 'won', version: opp.version })).status).toBe(409)
    opp = after
  })

  it('„brak odpowiedzi” po 14 dniach bez aktywności; notatka zeruje licznik', async () => {
    expect((await byCode('OF038')).noResponse).toBe(false)
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString()
    await h.db.update(schema.opportunities).set({ stageChangedAt: old }).where(eq(schema.opportunities.id, opp.id))
    expect((await byCode('OF038')).noResponse).toBe(true)
    await req(h, 'POST', `/api/crm/opportunities/${opp.id}/activities`, staff.headers, { kind: 'call', body: 'Klient analizuje ofertę' })
    expect((await byCode('OF038')).noResponse).toBe(false)
  })

  it('karta firmy: kontakty i szanse', async () => {
    const d = (await (await req(h, 'GET', `/api/crm/companies/${company.id}`, staff.headers)).json()) as CompanyDetailDto
    expect(d.contacts.map((c) => c.name)).toEqual(['Jan Kowalski'])
    expect(d.opportunities.map((o) => o.code)).toEqual(['OF038'])
    expect((await req(h, 'DELETE', `/api/crm/companies/${company.id}`, admin.headers)).status).toBe(409)
  })

  it('wygrana → projekt z kodem oferty (tylko Admin); drugi raz → 409', async () => {
    const fresh = (await (await req(h, 'GET', `/api/crm/opportunities/${opp.id}`, staff.headers)).json()) as OpportunityDetailDto
    const project = { name: 'Komora 1 m³ — realizacja', client: 'Envcheck Test', contractNo: 'U/1/2026', contractEndDate: '2027-06-30' }
    expect((await req(h, 'POST', `/api/crm/opportunities/${opp.id}/project`, admin.headers, project)).status).toBe(422)
    const won = (await (await req(h, 'POST', `/api/crm/opportunities/${opp.id}/stage`, staff.headers, { stage: 'won', version: fresh.version })).json()) as OpportunityDetailDto
    expect((await req(h, 'POST', `/api/crm/opportunities/${opp.id}/project`, staff.headers, project)).status).toBe(403)
    const res = await req(h, 'POST', `/api/crm/opportunities/${opp.id}/project`, admin.headers, project)
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ code: 'OF038', opportunity: { projectCode: 'OF038', version: won.version + 1 } })
    const me = (await (await req(h, 'GET', '/api/me', admin.headers)).json()) as MeResponse
    expect(me.projects.map((p) => p.code).sort()).toEqual(['OF038', 'OF14'])
    expect((await req(h, 'POST', `/api/crm/opportunities/${opp.id}/project`, admin.headers, project)).status).toBe(409)
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'project.create_from_opportunity'))
    expect(audit).toHaveLength(1)
  })
})

describe('NIP z białej listy VAT', () => {
  it('dane firmy i informacja o istniejącej firmie; brak w wykazie → 404; awaria → 502', async () => {
    const calls: string[] = []
    h.deps.fetch = (async (url: string) => {
      calls.push(url)
      if (url.includes('5260250995')) return new Response(JSON.stringify({ result: { subject: null } }), { status: 200 })
      if (url.includes('7740001454')) return new Response('down', { status: 500 })
      return new Response(JSON.stringify({ result: { subject: { name: 'ENVCHECK SP. Z O.O.', nip: '9512591569', regon: '123', statusVat: 'Czynny', workingAddress: 'ul. Testowa 1, 00-001 Warszawa' } } }), { status: 200 })
    }) as typeof fetch
    const ok = await req(h, 'GET', '/api/crm/nip/951-259-15-69', staff.headers)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ nip: '9512591569', name: 'ENVCHECK SP. Z O.O.', address: 'ul. Testowa 1, 00-001 Warszawa', vatStatus: 'Czynny' })
    expect(calls[0]).toMatch(/^https:\/\/wl-api\.mf\.gov\.pl\/api\/search\/nip\/9512591569\?date=\d{4}-\d{2}-\d{2}$/)
    expect((await req(h, 'GET', '/api/crm/nip/5260250995', staff.headers)).status).toBe(404)
    expect((await req(h, 'GET', '/api/crm/nip/7740001454', staff.headers)).status).toBe(502)
    expect((await req(h, 'GET', '/api/crm/nip/123', staff.headers)).status).toBe(422)
    h.deps.fetch = undefined
  })
})

describe('dostęp', () => {
  it('rola zewnętrzna nie ma dostępu do CRM', async () => {
    expect((await req(h, 'GET', '/api/crm/opportunities', arsanit.headers)).status).toBe(403)
  })

  it('eksport XLSX z wpisem w audit logu', async () => {
    const res = await req(h, 'GET', '/api/crm/opportunities/export.xlsx', staff.headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    const audit = await h.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'crm.export'), eq(schema.auditLog.userId, staff.id)))
    expect(audit).toHaveLength(1)
  })
})
