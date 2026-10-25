import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and } from 'drizzle-orm'
import type { AiJobDto, AiStatusDto, AiSuggestionDto, ChecklistDto, DriveStatusDto, OpportunityDetailDto, QuestionDto, QuoteDto, QuoteInputDto } from '#shared'
import { AiError } from '../../integrations/ai/types.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'
import { runAiJob } from './ops.ts'

let h: Harness
let admin: TestUser
let kamil: TestUser
let opp: OpportunityDetailDto
let quote: QuoteDto
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  kamil = await createUser(h, 'EnvcheckInternal')
})
afterAll(() => h.stop())

const inputs = async (id = quote.id) => (await (await req(h, 'GET', `/api/quotes/${id}/inputs`, kamil.headers)).json()) as QuoteInputDto[]
const runJob = async (body: unknown, u: TestUser = kamil) => {
  const res = await req(h, 'POST', `/api/quotes/${quote.id}/ai/jobs`, u.headers, body)
  return { status: res.status, job: (await res.json()) as AiJobDto }
}
const checklist = async () => (await (await req(h, 'GET', `/api/quotes/${quote.id}/checklist`, kamil.headers)).json()) as ChecklistDto

describe('Google Drive i folder szansy', () => {
  it('konfiguracja dysku współdzielonego (tylko Admin), sprawdzenie dostępu', async () => {
    let s = (await (await req(h, 'GET', '/api/drive/status', kamil.headers)).json()) as DriveStatusDto
    expect(s).toMatchObject({ configured: false, available: true, fake: true })
    expect((await req(h, 'PUT', '/api/drive/settings', kamil.headers, { sharedDriveId: 'drive-1' })).status).toBe(403)
    expect((await req(h, 'PUT', '/api/drive/settings', admin.headers, { sharedDriveId: 'nie-ma-takiego' })).status).toBe(422)
    expect((await req(h, 'PUT', '/api/drive/settings', admin.headers, { sharedDriveId: 'drive-1' })).status).toBe(200)
    s = (await (await req(h, 'GET', '/api/drive/status', kamil.headers)).json()) as DriveStatusDto
    expect(s).toMatchObject({ configured: true, sharedDriveId: 'drive-1', driveName: 'Shared' })
  })

  it('nowa szansa dostaje folder „kod — nazwa” na dysku', async () => {
    opp = (await (await req(h, 'POST', '/api/crm/opportunities', kamil.headers, { name: 'Komora WB testowa' })).json()) as OpportunityDetailDto
    expect(opp.driveFolderId).toBeTruthy()
    expect(h.drive.items.get(opp.driveFolderId!)).toMatchObject({ name: `${opp.code} — Komora WB testowa`, parents: ['drive-1'] })
    quote = (await (await req(h, 'POST', '/api/quotes', kamil.headers, { opportunityId: opp.id })).json()) as QuoteDto
  })
})

describe('materiały wejściowe (krok 2)', () => {
  it('wklejony mail i plik do 4 MB przez serwer — w folderze szansy', async () => {
    const text = 'Komora grzewcza i chłodząca. Zakres temperatur minimum: +70℃ oraz -60℃. Gabaryt przestrzeni roboczej 500x500x1000 mm.'
    expect((await req(h, 'POST', `/api/quotes/${quote.id}/inputs/text`, kamil.headers, { name: 'Mail WB', text })).status).toBe(200)
    const form = new FormData()
    form.append('file', new File([new Uint8Array([37, 80, 68, 70, 45, 49])], 'SIWZ.pdf', { type: 'application/pdf' }))
    const res = await h.app.request(`/api/quotes/${quote.id}/inputs/file`, { method: 'POST', headers: kamil.headers, body: form })
    expect(res.status).toBe(200)
    const list = await inputs()
    expect(list.map((i) => [i.name, i.kind, i.status, i.aiReadable])).toEqual([
      ['Mail WB', 'text', 'ready', true],
      ['SIWZ.pdf', 'file', 'ready', true],
    ])
    expect(h.drive.items.get(list[1]!.driveFileId!)!.parents).toEqual([opp.driveFolderId])
  })

  it('duży plik: sesja resumable → potwierdzenie; plik spoza folderu odrzucony', async () => {
    const s = (await (await req(h, 'POST', `/api/quotes/${quote.id}/inputs/upload-session`, kamil.headers, { name: 'Rysunki.pdf', mimeType: 'application/pdf', size: 6 })).json()) as { inputId: string; uploadUrl: string }
    expect((await inputs()).find((i) => i.id === s.inputId)!.status).toBe('uploading')
    const stray = h.drive.externalAdd('drive-1', 'obcy.pdf', 'application/pdf', new Uint8Array(6))
    expect((await req(h, 'POST', `/api/quotes/${quote.id}/inputs/${s.inputId}/complete`, kamil.headers, { driveFileId: stray.id })).status).toBe(422)
    const file = h.drive.finishUpload(s.uploadUrl, new Uint8Array([37, 80, 68, 70, 45, 50]))
    expect((await req(h, 'POST', `/api/quotes/${quote.id}/inputs/${s.inputId}/complete`, kamil.headers, { driveFileId: file.id })).status).toBe(200)
    expect((await inputs()).find((i) => i.id === s.inputId)!.status).toBe('ready')
  })
})

describe('AI: checklista z materiałów (krok 3)', () => {
  it('wartości z cytatami jako „do potwierdzenia”, braki oznaczone, potwierdzone bez zmian; koszt w logu', async () => {
    await req(h, 'PUT', `/api/quotes/${quote.id}/checklist/chamber_type`, kamil.headers, { value: { v: 'komora temperaturowa' }, status: 'confirmed' })
    const { status, job } = await runJob({ kind: 'extract_checklist' })
    expect(status).toBe(200)
    expect(job).toMatchObject({ kind: 'extract_checklist', status: 'done', costUsd: 0.078 })
    expect(job.summary).toMatch(/Uzupełniono 2 parametrów/)
    const c = await checklist()
    expect(c.items.find((i) => i.key === 'temp_range')).toMatchObject({ value: { min: -60, max: 70 }, status: 'pending' })
    expect(c.items.find((i) => i.key === 'temp_range')!.sourceRef).toContain('°C')
    expect(c.items.find((i) => i.key === 'inner_dims')).toMatchObject({ value: { w: 500, h: 500, d: 1000 } })
    expect(c.items.find((i) => i.key === 'chamber_type')).toMatchObject({ value: { v: 'komora temperaturowa' }, status: 'confirmed' })
    expect(c.items.find((i) => i.key === 'humidity_range')).toMatchObject({ status: 'missing', note: 'AI: brak w materiałach' })
    expect(c.items.some((i) => i.custom && i.label.startsWith('Oferta z kartami'))).toBe(true)
    // Model dostał materiały: PDF-y jako dokumenty (cache), mail jako tekst.
    const call = h.ai.calls.at(-1)!
    expect(call.content.filter((b) => b.type === 'pdf')).toHaveLength(2)
    expect(call.content.some((b) => b.type === 'text' && b.text.includes('Mail WB'))).toBe(true)
  })

  it('odmowa modelu: zadanie z błędem, wywołanie zapisane w logu', async () => {
    h.ai.overrides.set('extract_checklist', () => {
      throw new AiError('refusal', 'Model odmówił (cyber)', { model: 'claude-opus-5-5', usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    })
    const { job } = await runJob({ kind: 'extract_checklist' })
    h.ai.overrides.clear()
    expect(job).toMatchObject({ status: 'error', error: 'Model odmówił (cyber)' })
    const calls = await h.db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.jobId, job.id)))
    expect(calls[0]).toMatchObject({ error: 'Model odmówił (cyber)', inputTokens: 100 })
  })

  it('zlecenie z błędnym tokenem nie jest wykonywane', async () => {
    const [j] = await h.db.insert(schema.aiJobs).values({ quoteId: quote.id, kind: 'questions', tokenHash: 'x', params: {} }).returning()
    expect(await runAiJob(h.deps, j!.id, 'zły-token')).toBe('rejected')
    await h.db.delete(schema.aiJobs).where(eq(schema.aiJobs.id, j!.id))
  })
})

describe('AI: propozycje pozycji (krok 5)', () => {
  let suggestions: AiSuggestionDto[]

  it('propozycje trafiają jako sugestie, suma wyceny bez zmian do akceptacji', async () => {
    const before = (await (await req(h, 'GET', `/api/quotes/${quote.id}`, kamil.headers)).json()) as QuoteDto
    const sec = before.devices[0]!.sections[0]!
    await req(h, 'POST', `/api/quotes/${quote.id}/sections/${sec.id}/lines`, kamil.headers, { name: 'Prefabrykacja blach' })
    await req(h, 'POST', `/api/quotes/${quote.id}/sections/${sec.id}/lines`, kamil.headers, { name: 'Spawanie' })
    const { job } = await runJob({ kind: 'propose_lines', hint: 'Komora 500×500×1000' })
    expect(job.status).toBe('done')
    suggestions = (await (await req(h, 'GET', `/api/quotes/${quote.id}/ai/suggestions`, kamil.headers)).json()) as AiSuggestionDto[]
    expect(suggestions).toHaveLength(2)
    expect(suggestions[0]).toMatchObject({ action: 'update', sectionName: 'Obudowa', cost: 1000, payload: { confidence: 'low' } })
    const after = (await (await req(h, 'GET', `/api/quotes/${quote.id}`, admin.headers)).json()) as QuoteDto
    expect(after.summary!.cost).toBe(0)
  })

  it('akceptacja zmienia pozycję (źródło „AI”, niezatwierdzona), odrzucenie usuwa sugestię', async () => {
    let res = await req(h, 'POST', `/api/quotes/${quote.id}/ai/suggestions/decide`, kamil.headers, { ids: [suggestions[0]!.id], accept: true })
    expect(((await res.json()) as AiSuggestionDto[]).map((s) => s.id)).toEqual([suggestions[1]!.id])
    res = await req(h, 'POST', `/api/quotes/${quote.id}/ai/suggestions/decide`, kamil.headers, { ids: 'all', accept: false })
    expect(await res.json()).toEqual([])
    const q = (await (await req(h, 'GET', `/api/quotes/${quote.id}`, admin.headers)).json()) as QuoteDto
    const line = q.devices[0]!.sections[0]!.lines.find((l) => l.id === suggestions[0]!.lineId)!
    expect(line).toMatchObject({ source: 'ai', approved: false, unitCost: 1000 })
    expect(q.summary!.cost).toBe(1000)
  })

  it('przeliczenie jednej pozycji z komentarzem', async () => {
    const { job } = await runJob({ kind: 'reestimate_line', lineId: suggestions[0]!.lineId, comment: 'Blacha 316 zamiast 304' })
    expect(job.status).toBe('done')
    const s = (await (await req(h, 'GET', `/api/quotes/${quote.id}/ai/suggestions`, kamil.headers)).json()) as AiSuggestionDto[]
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ lineId: suggestions[0]!.lineId, payload: { unitCost: 1100 }, current: { unitCost: 1000 } })
    expect(s[0]!.payload.justification).toContain('Blacha 316')
  })

  it('domyślna stawka robocizny trafia do modelu i uzupełnia robociznę bez stawki', async () => {
    const reserve = { low: 0.15, medium: 0.2, high: 0.3, perExtraYear: 0.5 }
    expect((await req(h, 'PUT', '/api/quotes/settings', admin.headers, { reserve, laborRate: 135 })).status).toBe(200)
    const sectionId = suggestions[0]!.sectionId
    h.ai.overrides.set('propose_lines', () => ({
      notes: '',
      suggestions: [{ action: 'add', lineId: null, sectionId, name: 'Montaż', group: null, quantity: 1, unit: null, unitCost: null, laborHours: 10, laborRate: null, justification: '10 h', confidence: 'medium' }],
    }))
    await runJob({ kind: 'propose_lines' })
    h.ai.overrides.clear()
    const prompt = h.ai.calls.at(-1)!.content.at(-1)!
    expect(prompt.type === 'text' && prompt.text).toContain('Stawka robocizny Envcheck: 135 PLN/h')
    const s = (await (await req(h, 'GET', `/api/quotes/${quote.id}/ai/suggestions`, kamil.headers)).json()) as AiSuggestionDto[]
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ payload: { laborHours: 10, laborRate: 135 }, cost: 1350 })
    await req(h, 'PUT', '/api/quotes/settings', admin.headers, { reserve, laborRate: null })
  })

  it('bez uprawnienia do kosztów nie można zlecić propozycji', async () => {
    await h.db.update(schema.permissions).set({ allowed: false }).where(and(eq(schema.permissions.role, 'EnvcheckInternal'), eq(schema.permissions.module, 'quotesCost')))
    expect((await runJob({ kind: 'propose_lines' })).status).toBe(403)
    await h.db.update(schema.permissions).set({ allowed: true }).where(and(eq(schema.permissions.role, 'EnvcheckInternal'), eq(schema.permissions.module, 'quotesCost'), eq(schema.permissions.action, 'edit')))
  })
})

describe('AI: pytania (krok 6) i koszty', () => {
  it('pytania do klienta z braków checklisty i do Kamila (przypisane w ustawieniach); odpowiedź', async () => {
    expect((await req(h, 'PUT', '/api/ai/settings', admin.headers, { monthlyWarnUsd: 0.1, questionsAssigneeId: kamil.id })).status).toBe(200)
    const { job } = await runJob({ kind: 'questions' })
    expect(job).toMatchObject({ status: 'done', summary: 'Pytania: 1 do Kamila, 3 do klienta.' })
    const qs = (await (await req(h, 'GET', `/api/quotes/${quote.id}/questions`, kamil.headers)).json()) as QuestionDto[]
    expect(qs.filter((q) => q.audience === 'client').every((q) => q.checklistKey)).toBe(true)
    const internal = qs.find((q) => q.audience === 'internal')!
    expect(internal).toMatchObject({ assigneeId: kamil.id, source: 'ai', status: 'open' })
    const mine = (await (await req(h, 'GET', '/api/questions/mine', kamil.headers)).json()) as QuestionDto[]
    expect(mine.map((q) => q.id)).toEqual([internal.id])
    const after = (await (await req(h, 'PATCH', `/api/questions/${internal.id}`, kamil.headers, { answer: 'Zapas 15%, kaskada R449A/R23.' })).json()) as QuestionDto[]
    expect(after.find((q) => q.id === internal.id)).toMatchObject({ status: 'answered', answeredByName: expect.any(String) })
    // Ponowne generowanie nie dubluje pytań.
    await runJob({ kind: 'questions' })
    const again = (await (await req(h, 'GET', `/api/quotes/${quote.id}/questions`, kamil.headers)).json()) as QuestionDto[]
    expect(again).toHaveLength(qs.length)
  })

  it('licznik kosztów w miesiącu i ostrzeżenie po przekroczeniu progu', async () => {
    const s = (await (await req(h, 'GET', '/api/ai/status', kamil.headers)).json()) as AiStatusDto
    expect(s).toMatchObject({ available: true, fake: true, model: 'claude-opus-5-5', warn: true })
    expect(s.monthUsd).toBeGreaterThan(0.1)
  })

  it('bez klucza AI zlecenie zwraca 503', async () => {
    const ai = h.deps.ai
    h.deps.ai = null
    expect((await runJob({ kind: 'questions' })).status).toBe(503)
    h.deps.ai = ai
  })
})
