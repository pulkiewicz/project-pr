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
