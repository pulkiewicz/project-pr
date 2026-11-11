import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OpportunityDto, QuoteDto, RequiredDocDto } from '#shared'
import { createUser, req, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

/** Przepływ wyceny: krok 1 (przepięcie szansy), krok 3 (terminy, wymagane dokumenty), liczniki kroków. */
let h: Harness
let admin: TestUser
let staff: TestUser
let opps: OpportunityDto[]
let quote: QuoteDto
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  staff = await createUser(h, 'EnvcheckInternal')
  opps = (await (await req(h, 'GET', '/api/crm/opportunities', admin.headers)).json()) as OpportunityDto[]
  quote = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: opps.find((o) => o.code === 'OF36')!.id })).json()) as QuoteDto
})
afterAll(() => h.stop())

const get = async (id = quote.id) => (await (await req(h, 'GET', `/api/quotes/${id}`, staff.headers)).json()) as QuoteDto
const docsUrl = (id = quote.id) => `/api/quotes/${id}/required-docs`

describe('krok 1 — identyfikacja', () => {
  it('nowa wycena ma puste liczniki kroków', () => {
    expect(quote.workflow).toEqual({ inputs: 0, docs: { total: 0, ready: 0, todo: 0 }, questions: { total: 0, open: 0 }, calcs: 0 })
  })

  it('przepięcie na inną szansę nadaje rewizję w obrębie nowej szansy', async () => {
    const target = opps.find((o) => o.code !== 'OF36')!
    await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: target.id })
    const res = await req(h, 'PATCH', `/api/quotes/${quote.id}`, staff.headers, { opportunityId: target.id, version: quote.version })
    expect(res.status).toBe(200)
    const q = (await res.json()) as QuoteDto
    expect(q).toMatchObject({ opportunityId: target.id, opportunityCode: target.code, revision: 'B', companyId: target.companyId })
    expect((await req(h, 'PATCH', `/api/quotes/${quote.id}`, staff.headers, { opportunityId: crypto.randomUUID(), version: q.version })).status).toBe(422)
    quote = q
  })
})

describe('krok 3 — parametry formalne', () => {
  it('terminy złożenia i pytań w info; niepoprawny format odrzucony', async () => {
    const ok = await req(h, 'PATCH', `/api/quotes/${quote.id}`, staff.headers, { info: { submissionDeadline: '2026-12-01', submissionTime: '12:00', questionsDeadline: '2026-11-24' }, version: quote.version })
    expect(ok.status).toBe(200)
    quote = (await ok.json()) as QuoteDto
    expect(quote.info).toMatchObject({ submissionDeadline: '2026-12-01', submissionTime: '12:00', questionsDeadline: '2026-11-24' })
    expect((await req(h, 'PATCH', `/api/quotes/${quote.id}`, staff.headers, { info: { submissionDeadline: '01.12.2026' }, version: quote.version })).status).toBe(422)
  })

  it('wymagane dokumenty: dodanie, status, usunięcie; liczniki w wycenie', async () => {
    expect((await req(h, 'POST', docsUrl(), staff.headers, { name: 'Formularz ofertowy', note: 'Zał. 1' })).status).toBe(200)
    let docs = (await (await req(h, 'POST', docsUrl(), staff.headers, { name: 'Wadium' })).json()) as RequiredDocDto[]
    expect(docs.map((d) => [d.name, d.status, d.source, d.sortOrder])).toEqual([
      ['Formularz ofertowy', 'todo', 'manual', 0],
      ['Wadium', 'todo', 'manual', 1],
    ])
    docs = (await (await req(h, 'PATCH', `${docsUrl()}/${docs[0]!.id}`, staff.headers, { status: 'ready' })).json()) as RequiredDocDto[]
    expect(docs[0]!.status).toBe('ready')
    expect((await req(h, 'PATCH', `${docsUrl()}/${docs[0]!.id}`, staff.headers, { status: 'zle' })).status).toBe(422)
    expect((await get()).workflow!.docs).toEqual({ total: 2, ready: 1, todo: 1 })
    await req(h, 'PATCH', `${docsUrl()}/${docs[1]!.id}`, staff.headers, { status: 'na' })
    expect((await get()).workflow!.docs).toEqual({ total: 1, ready: 1, todo: 0 })
    docs = (await (await req(h, 'DELETE', `${docsUrl()}/${docs[1]!.id}`, staff.headers)).json()) as RequiredDocDto[]
    expect(docs).toHaveLength(1)
    expect((await req(h, 'DELETE', `${docsUrl()}/${crypto.randomUUID()}`, staff.headers)).status).toBe(404)
  })

  it('nowa rewizja kopiuje dokumenty i terminy; zatwierdzona wycena jest tylko do odczytu', async () => {
    const rev = (await (await req(h, 'POST', `/api/quotes/${quote.id}/revision`, staff.headers)).json()) as QuoteDto
    expect(rev.info).toMatchObject({ submissionDeadline: '2026-12-01' })
    const docs = (await (await req(h, 'GET', docsUrl(rev.id), staff.headers)).json()) as RequiredDocDto[]
    expect(docs.map((d) => [d.name, d.status])).toEqual([['Formularz ofertowy', 'ready']])
    const q = await get()
    await req(h, 'POST', `/api/quotes/${quote.id}/status`, admin.headers, { status: 'approved', version: q.version })
    expect((await req(h, 'POST', docsUrl(), staff.headers, { name: 'X' })).status).toBe(409)
  })
})

describe('nowa rewizja — pusta albo kopia', () => {
  it('pusta rewizja: ta sama szansa i kolejna litera, bez dokumentów, terminów i bazy', async () => {
    const src = await get()
    const rev = (await (await req(h, 'POST', `/api/quotes/${quote.id}/revision`, staff.headers, { mode: 'empty' })).json()) as QuoteDto
    expect(rev).toMatchObject({ opportunityId: src.opportunityId, status: 'draft', basedOnLabel: null, info: {} })
    expect(rev.revision).not.toBe(src.revision)
    expect(rev.workflow).toEqual({ inputs: 0, docs: { total: 0, ready: 0, todo: 0 }, questions: { total: 0, open: 0 }, calcs: 0 })
  })

  it('jawna kopia działa jak dotąd; nieznany tryb → 422', async () => {
    const rev = (await (await req(h, 'POST', `/api/quotes/${quote.id}/revision`, staff.headers, { mode: 'copy' })).json()) as QuoteDto
    expect(rev.basedOnLabel).toMatch(/rew\./)
    expect((await req(h, 'POST', `/api/quotes/${quote.id}/revision`, staff.headers, { mode: 'inna' })).status).toBe(422)
  })
})

describe('odrzucenie wyceny i zmiana profilu', () => {
  let q: QuoteDto
  let oppId: string
  let stageBefore: string
  const opp = async () => (await (await req(h, 'GET', `/api/crm/opportunities/${oppId}`, admin.headers)).json()) as OpportunityDto & { activities?: { kind: string; body: string }[] }
  beforeAll(async () => {
    const o = opps.find((x) => x.code !== 'OF36' && x.stage !== 'won')!
    oppId = o.id
    q = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: oppId })).json()) as QuoteDto
    stageBefore = (await opp()).stage
  })

  it('odrzucenie wymaga przyczyny; status „rejected”, szansa → „abandoned” z wpisem w historii', async () => {
    expect((await req(h, 'POST', `/api/quotes/${q.id}/reject`, staff.headers, { reason: ' ', version: q.version })).status).toBe(422)
    const res = await req(h, 'POST', `/api/quotes/${q.id}/reject`, staff.headers, { reason: 'Klient wybrał tańszą ofertę', version: q.version })
    expect(res.status).toBe(200)
    q = (await res.json()) as QuoteDto
    expect(q).toMatchObject({ status: 'rejected', rejectReason: 'Klient wybrał tańszą ofertę', canEdit: false })
    expect(q.rejectedAt).toBeTruthy()
    const o = await opp()
    expect(o.stage).toBe('abandoned')
    expect(JSON.stringify(o)).toContain('Klient wybrał tańszą ofertę')
    expect((await req(h, 'POST', `/api/quotes/${q.id}/reject`, staff.headers, { reason: 'jeszcze raz', version: q.version })).status).toBe(422)
  })

  it('przywrócenie: wycena robocza, szansa wraca do etapu sprzed odrzucenia', async () => {
    const res = await req(h, 'POST', `/api/quotes/${q.id}/reopen`, staff.headers, { version: q.version })
    q = (await res.json()) as QuoteDto
    expect(q).toMatchObject({ status: 'draft', rejectReason: null, canEdit: true })
    expect((await opp()).stage).toBe(stageBefore)
  })

  it('zatwierdzoną wycenę też można odrzucić', async () => {
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/status`, admin.headers, { status: 'approved', version: q.version })).json()) as QuoteDto
    const res = await req(h, 'POST', `/api/quotes/${q.id}/reject`, staff.headers, { reason: 'Zmiana zakresu', version: q.version })
    expect(((await res.json()) as QuoteDto).status).toBe('rejected')
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/reopen`, staff.headers, { version: (await get(q.id)).version })).json()) as QuoteDto
  })

  it('zmiana profilu zastępuje strukturę i parametry; nie-profil → 422', async () => {
    const profiles = (await (await req(h, 'GET', '/api/quotes?kind=profile', staff.headers)).json()) as { id: string; name: string }[]
    expect(profiles.length).toBeGreaterThan(0)
    const p = profiles[0]!
    const profile = (await (await req(h, 'GET', `/api/quotes/${p.id}`, staff.headers)).json()) as QuoteDto
    expect((await req(h, 'POST', `/api/quotes/${q.id}/apply-profile`, staff.headers, { profileId: quote.id, version: q.version })).status).toBe(422)
    const res = await req(h, 'POST', `/api/quotes/${q.id}/apply-profile`, staff.headers, { profileId: p.id, version: q.version })
    expect(res.status).toBe(200)
    const after = (await res.json()) as QuoteDto
    expect(after.basedOnLabel).toBe(`Profil: ${p.name}`)
    expect(after.devices.map((d) => [d.name, d.sections.length])).toEqual(profile.devices.map((d) => [d.name, d.sections.length]))
    expect(after.devices.flatMap((d) => d.sections.flatMap((s) => s.lines)).every((l) => l.source === 'profile')).toBe(true)
    expect(after.params.marginMultiplier).toBe(profile.params.marginMultiplier)
    expect((await req(h, 'POST', `/api/quotes/${q.id}/apply-profile`, staff.headers, { profileId: p.id, version: q.version })).status).toBe(409)
  })
})

describe('szansa: liczba wycen, najnowsza wycena, wartość z wyceny', () => {
  it('wartość szansy = netto ostatniej nieodrzuconej wyceny z ceną; bez niej — wartość ręczna', async () => {
    const fresh = (await (await req(h, 'POST', '/api/crm/opportunities', admin.headers, { name: 'Test wartości', stage: 'new', value: 12345 })).json()) as OpportunityDto
    expect(fresh).toMatchObject({ value: 12345, valueManual: 12345, quotes: { count: 0, latest: null, valueFrom: null } })
    const profiles = (await (await req(h, 'GET', '/api/quotes?kind=profile', staff.headers)).json()) as { id: string }[]
    const a = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: fresh.id, basedOnId: profiles[0]!.id })).json()) as QuoteDto
    const b = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: fresh.id })).json()) as QuoteDto
    const get = async () => (await (await req(h, 'GET', `/api/crm/opportunities/${fresh.id}`, admin.headers)).json()) as OpportunityDto
    let o = await get()
    expect(o.quotes.count).toBe(2)
    expect(o.quotes.latest).toMatchObject({ id: b.id, revision: 'B' })
    // Rew. B jest pusta (0 zł) — wartość z rew. A.
    expect(o.quotes.valueFrom).toMatchObject({ id: a.id, revision: 'A' })
    expect(o.value).toBe(o.quotes.valueFrom!.net)
    expect(o.value).toBeGreaterThan(0)
    expect(o.valueManual).toBe(12345)
    await req(h, 'POST', `/api/quotes/${a.id}/reject`, staff.headers, { reason: 'test odrzucenia', version: a.version })
    o = await get()
    expect(o.quotes.valueFrom).toBeNull()
    expect(o.value).toBe(12345)
  })
})
