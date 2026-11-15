import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BomRuleDto, OpportunityDto, QuoteDto, RequiredDocDto } from '#shared'
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

  it('krok 8: cena wpisana ręcznie zastępuje wyliczoną i jest wartością szansy; parametry techniczne wyceny', async () => {
    const opp = (await (await req(h, 'POST', '/api/crm/opportunities', admin.headers, { name: 'Wycena spoza kalkulatora', stage: 'new', value: 1000 })).json()) as OpportunityDto
    const q = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: opp.id })).json()) as QuoteDto
    expect(q.manualNet).toBeNull()
    // Cena ręczna wymaga uprawnienia do cen (Envcheck wewnętrzny go nie ma).
    expect((await req(h, 'PATCH', `/api/quotes/${q.id}`, staff.headers, { manualNet: 50000, version: q.version })).status).toBe(403)
    const res = await req(h, 'PATCH', `/api/quotes/${q.id}`, admin.headers, { manualNet: 87500.5, profileSpec: { innerWidth: 600, tempMin: -70, tempMax: 180 }, version: q.version })
    expect(res.status).toBe(200)
    const saved = (await res.json()) as QuoteDto
    expect(saved).toMatchObject({ manualNet: 87500.5, net: 87500.5, profileSpec: { innerWidth: 600, tempMin: -70, tempMax: 180 } })
    expect(saved.summary!.net).toBe(0)
    const o = (await (await req(h, 'GET', `/api/crm/opportunities/${opp.id}`, admin.headers)).json()) as OpportunityDto
    expect(o.quotes.valueFrom).toMatchObject({ id: q.id, net: 87500.5 })
    expect(o.value).toBe(87500.5)
    // Bez uprawnień do cen kwota jest ukryta.
    expect(((await (await req(h, 'GET', `/api/quotes/${q.id}`, staff.headers)).json()) as QuoteDto).manualNet).toBeNull()
    // Nowa rewizja (kopia) przejmuje cenę i parametry.
    const rev = (await (await req(h, 'POST', `/api/quotes/${q.id}/revision`, admin.headers)).json()) as QuoteDto
    expect(rev).toMatchObject({ revision: 'B', manualNet: 87500.5, profileSpec: saved.profileSpec })
    // Usunięcie ceny ręcznej — wartość wraca do wyliczonej (tu 0 zł → wartość ręczna szansy).
    await req(h, 'PATCH', `/api/quotes/${rev.id}`, admin.headers, { manualNet: null, version: rev.version })
    await req(h, 'PATCH', `/api/quotes/${q.id}`, admin.headers, { manualNet: null, version: saved.version })
    expect(((await (await req(h, 'GET', `/api/crm/opportunities/${opp.id}`, admin.headers)).json()) as OpportunityDto).value).toBe(1000)
    // Profil nie ma ceny ręcznej.
    const profiles = (await (await req(h, 'GET', '/api/quotes?kind=profile', admin.headers)).json()) as QuoteDto[]
    const p = (await (await req(h, 'GET', `/api/quotes/${profiles[0]!.id}`, admin.headers)).json()) as QuoteDto
    expect((await req(h, 'PATCH', `/api/quotes/${p.id}`, admin.headers, { manualNet: 1, version: p.version })).status).toBe(422)
  })
})

describe('W3: kompletność kosztorysu', () => {
  it('reguły startowe w Bazie wiedzy; edycja tylko z uprawnieniem', async () => {
    const rules = (await (await req(h, 'GET', '/api/quote-bom-rules', staff.headers)).json()) as BomRuleDto[]
    expect(rules.map((r) => r.name)).toEqual(expect.arrayContaining(['Skraplanie wodne → chiller / dry-cooler', 'Shelter / przestrzeń robocza zewnętrzna → moduł sheltera']))
    const created = await req(h, 'POST', '/api/quote-bom-rules', admin.headers, { name: 'Test reguły', when: [{ kind: 'flag', flag: 'Flaga testowa' }], require: { keywords: ['pozycja testowa'] } })
    expect(created.status).toBe(200)
    const id = ((await created.json()) as BomRuleDto[]).find((r) => r.name === 'Test reguły')!.id
    expect((await req(h, 'PATCH', `/api/quote-bom-rules/${id}`, admin.headers, { active: false })).status).toBe(200)
    expect((await req(h, 'DELETE', `/api/quote-bom-rules/${id}`, admin.headers)).status).toBe(200)
  })

  it('flaga → alert blokuje zatwierdzenie; pozycja albo akceptacja go zamyka; rewizja kopiuje flagi i akceptacje', async () => {
    const o = opps.find((x) => x.code !== 'OF36' && x.stage !== 'won')!
    let q = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: o.id })).json()) as QuoteDto
    const sec = q.devices[0]!.sections.find((s) => s.name === 'Wyposażenie dodatkowe')!
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/sections/${sec.id}/lines`, staff.headers, { name: 'Podstawa', unitCost: 20000 })).json()) as QuoteDto
    expect(q.bom).toMatchObject({ open: 0 })
    expect(q.bom!.availableFlags).toEqual(expect.arrayContaining(['Skraplanie wodne', 'Shelter / przestrzeń robocza zewnętrzna']))

    q = (await (await req(h, 'PUT', `/api/quotes/${q.id}/bom/flags`, staff.headers, { flags: ['Skraplanie wodne', 'Shelter / przestrzeń robocza zewnętrzna'] })).json()) as QuoteDto
    expect(q.bom!.issues.map((i) => i.title)).toEqual(['Skraplanie wodne → chiller / dry-cooler', 'Shelter / przestrzeń robocza zewnętrzna → moduł sheltera'])
    const res = await req(h, 'POST', `/api/quotes/${q.id}/status`, admin.headers, { status: 'approved', version: q.version })
    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toContain('bom_incomplete')

    // Chiller w kosztorysie spełnia regułę 1; shelter — akceptacja z uzasadnieniem.
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/sections/${sec.id}/lines`, staff.headers, { name: 'Chiller (praca do +45°C)', unitCost: 85000 })).json()) as QuoteDto
    const shelter = q.bom!.issues.find((i) => i.title.startsWith('Shelter'))!
    expect(q.bom!.open).toBe(1)
    expect((await req(h, 'POST', `/api/quotes/${q.id}/bom/acks`, staff.headers, { issueKey: shelter.key, reason: '' })).status).toBe(422)
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/bom/acks`, staff.headers, { issueKey: shelter.key, reason: 'Shelter dostarcza zamawiający' })).json()) as QuoteDto
    expect(q.bom!.open).toBe(0)
    expect(q.bom!.issues[0]!.ack).toMatchObject({ reason: 'Shelter dostarcza zamawiający' })

    const rev = (await (await req(h, 'POST', `/api/quotes/${q.id}/revision`, staff.headers, { mode: 'copy' })).json()) as QuoteDto
    expect(rev.bom).toMatchObject({ flags: ['Skraplanie wodne', 'Shelter / przestrzeń robocza zewnętrzna'], open: 0 })

    q = (await (await req(h, 'DELETE', `/api/quotes/${q.id}/bom/acks/${encodeURIComponent(shelter.key)}`, staff.headers)).json()) as QuoteDto
    expect(q.bom!.open).toBe(1)
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/bom/acks`, staff.headers, { issueKey: shelter.key, reason: 'Shelter dostarcza zamawiający' })).json()) as QuoteDto
    expect((await req(h, 'POST', `/api/quotes/${q.id}/status`, admin.headers, { status: 'approved', version: q.version })).status).toBe(200)
  })

  it('warunek z checklisty: wzorcowanie akredytowane → pozycja wzorcowania', async () => {
    const o = opps.find((x) => x.code !== 'OF36' && x.stage !== 'won')!
    const q = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: o.id })).json()) as QuoteDto
    expect((await req(h, 'PUT', `/api/quotes/${q.id}/checklist/accredited_calibration`, staff.headers, { value: { b: true }, status: 'confirmed' })).status).toBe(200)
    const after = await get(q.id)
    expect(after.bom!.issues.find((i) => i.title.startsWith('Wzorcowanie'))).toMatchObject({ section: 'Koszty inne', triggers: [expect.stringContaining('Wzorcowanie akredytowane')] })
  })
})

describe('Wyceny v2: walidatory SWZ, ryzyko PZP, pytania krytyczne', () => {
  it('zasilanie → alert w kroku 3; pytanie krytyczne blokuje zatwierdzenie do odpowiedzi; bufor kar i serwis w cenie', async () => {
    const o = opps.find((x) => x.code !== 'OF36' && x.stage !== 'won')!
    let q = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: o.id })).json()) as QuoteDto
    const sec = q.devices[0]!.sections[0]!
    q = (await (await req(h, 'POST', `/api/quotes/${q.id}/sections/${sec.id}/lines`, admin.headers, { name: 'Konstrukcja', unitCost: 100000 })).json()) as QuoteDto

    q = (await (await req(h, 'PATCH', `/api/quotes/${q.id}`, staff.headers, { info: { powerLimitA: 29, machinePowerKw: 40, penaltyPctPerDay: 0.002, penaltyBase: 'gross', tenderMode: 'pzp' }, version: q.version })).json()) as QuoteDto
    const power = q.bom!.issues.find((i) => i.key === 'check:power')!
    expect(power).toMatchObject({ step: 'formal', severity: 'error' })
    expect(q.bom!.issues.find((i) => i.key === 'check:penalty_buffer')).toMatchObject({ severity: 'warning' })

    // Bufor kar i gwarancja serwisowa w cenie (uprawnienie do ceny — admin).
    // Parametry ryzyka wymagają uprawnienia do ceny.
    expect((await req(h, 'PATCH', `/api/quotes/${q.id}`, staff.headers, { params: { delayDays: 14 }, version: q.version })).status).toBe(403)
    const priced = (await (await req(h, 'PATCH', `/api/quotes/${q.id}`, admin.headers, { params: { delayDays: 14, serviceInspections: 4, serviceInspectionCost: 5000 }, version: (await get(q.id)).version })).json()) as QuoteDto
    expect(priced.summary).toMatchObject({ serviceValue: 20000 })
    expect(priced.summary!.penaltyValue).toBeGreaterThan(0)
    expect(priced.bom!.issues.some((i) => i.key === 'check:penalty_buffer')).toBe(false)

    // Pytanie z alertu (krytyczne) → błąd w kroku 5; odpowiedź zamyka alert.
    const qs = (await (await req(h, 'POST', `/api/quotes/${q.id}/questions`, staff.headers, { audience: 'client', text: power.question, critical: true })).json()) as { id: string; critical: boolean }[]
    expect(qs[0]!.critical).toBe(true)
    let cur = await get(q.id)
    expect(cur.bom!.issues.find((i) => i.key === 'check:critical_questions')).toMatchObject({ step: 'questions', severity: 'error' })
    // Akceptacja zasilania; krytyczne pytanie nadal blokuje.
    cur = (await (await req(h, 'POST', `/api/quotes/${q.id}/bom/acks`, staff.headers, { issueKey: 'check:power', reason: 'Zamawiający potwierdził 63 A' })).json()) as QuoteDto
    for (const i of cur.bom!.issues.filter((x) => !x.ack && x.severity === 'error' && x.key !== 'check:critical_questions'))
      cur = (await (await req(h, 'POST', `/api/quotes/${q.id}/bom/acks`, staff.headers, { issueKey: i.key, reason: 'test' })).json()) as QuoteDto
    expect(cur.bom!.open).toBe(1)
    expect((await req(h, 'POST', `/api/quotes/${q.id}/status`, admin.headers, { status: 'approved', version: cur.version })).status).toBe(422)
    await req(h, 'PATCH', `/api/questions/${qs[0]!.id}`, staff.headers, { answer: 'Tak, przyłącze 63 A' })
    cur = await get(q.id)
    expect(cur.bom!.open).toBe(0)
    expect((await req(h, 'POST', `/api/quotes/${q.id}/status`, admin.headers, { status: 'approved', version: cur.version })).status).toBe(200)
  })

  it('ustawienia: wzór rezerwy „za rok”, zablokowane certyfikaty, termin standardowy', async () => {
    const s = (await (await req(h, 'GET', '/api/quotes/settings', admin.headers)).json()) as { reserve: Record<string, unknown>; blockedCerts: string[] }
    expect(s.blockedCerts).toEqual(['ATEX', 'FDA'])
    const res = await req(h, 'PUT', '/api/quotes/settings', admin.headers, { ...s, reserve: { ...s.reserve, formula: 'perYear', baseYears: 2, perYear: 0.05 }, standardLeadDays: 150, customMarginMin: 2 })
    expect(res.status).toBe(200)
    const o = opps.find((x) => x.code !== 'OF36' && x.stage !== 'won')!
    let q = (await (await req(h, 'POST', '/api/quotes', staff.headers, { opportunityId: o.id })).json()) as QuoteDto
    q = (await (await req(h, 'PATCH', `/api/quotes/${q.id}`, staff.headers, { info: { requiredCerts: ['atex'], deliveryDays: 100 }, version: q.version })).json()) as QuoteDto
    expect(q.bom!.issues.filter((i) => i.step === 'formal').map((i) => i.key)).toEqual(['check:certs', 'check:lead_time'])
    q = (await (await req(h, 'PATCH', `/api/quotes/${q.id}`, admin.headers, { params: { warrantyMonths: 60, complexity: 'medium' }, version: q.version })).json()) as QuoteDto
    expect(q.summary?.reservePct).toBe(0.35)
    await req(h, 'PUT', '/api/quotes/settings', admin.headers, s)
  })
})
