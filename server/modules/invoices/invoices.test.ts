import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shareAmount, type InvoiceDetailDto, type InvoiceListResponse, type InvoiceSyncResult, type MeResponse } from '#shared'
import { INVOICES_SETTING_KEY } from '../../auth/access.ts'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
let ania: TestUser
let kamil: TestUser
let outsider: TestUser
let project2: string

beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  ania = await createUser(h, 'EnvcheckInternal')
  kamil = await createUser(h, 'EnvcheckInternal')
  outsider = await createUser(h, 'EnvcheckInternal')
  const [p] = await h.db
    .insert(schema.projects)
    .values({ code: 'OF038', name: 'Komora WB', client: 'WB', contractNo: '-', procurementNo: '-', contractEndDate: '2027-06-30' })
    .returning({ id: schema.projects.id })
  project2 = p!.id
})
afterAll(() => h.stop())

const list = async (u: TestUser) => (await (await req(h, 'GET', '/api/invoices', u.headers)).json()) as InvoiceListResponse
const byNumber = async (n: string) => (await list(ania)).items.find((i) => i.number === n)!

describe('dostęp: lista osób w Ustawieniach', () => {
  it('bez wpisu na liście nawet Admin nie ma modułu (403, brak w /me)', async () => {
    expect((await req(h, 'GET', '/api/invoices', admin.headers)).status).toBe(403)
    const me = (await (await req(h, 'GET', '/api/me', admin.headers)).json()) as MeResponse
    expect(me.permissions).not.toContain('invoices:view')
  })

  it('Admin ustawia listę (tylko pracownicy Envcheck); osoby z listy widzą moduł, pozostali nie', async () => {
    const arsanit = await createUser(h, 'Arsanit')
    expect((await req(h, 'PUT', '/api/admin/settings/invoices', admin.headers, { userIds: [arsanit.id], syncFrom: '2026-01-01' })).status).toBe(422)
    expect((await req(h, 'PUT', '/api/admin/settings/invoices', ania.headers, { userIds: [ania.id], syncFrom: '2026-01-01' })).status).toBe(403)
    const res = await req(h, 'PUT', '/api/admin/settings/invoices', admin.headers, { userIds: [admin.id, ania.id, kamil.id], syncFrom: '2026-10-01' })
    expect(res.status).toBe(200)
    expect((await req(h, 'GET', '/api/invoices', ania.headers)).status).toBe(200)
    expect((await req(h, 'GET', '/api/invoices', outsider.headers)).status).toBe(403)
    const [row] = await h.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, INVOICES_SETTING_KEY))
    expect(row?.value).toMatchObject({ syncFrom: '2026-10-01' })
  })
})

describe('synchronizacja z inFakt', () => {
  it('pobiera pliki i koszty dodane od daty z ustawień (pliki nie mają daty wystawienia), pomija składki ZUS; bez duplikatów', async () => {
    const res = await req(h, 'POST', '/api/invoices/sync', ania.headers)
    expect(res.status).toBe(200)
    // 8 w atrapie: jeden dodany przed 01.10.2026 (poza zakresem), składka ZUS pominięta.
    expect((await res.json()) as InvoiceSyncResult).toMatchObject({ fetched: 7, created: 6, updated: 0, skipped: 1 })
    expect(h.infakt.calls).toContain('list:2026-10-01')
    const again = (await (await req(h, 'POST', '/api/invoices/sync', ania.headers)).json()) as InvoiceSyncResult
    expect(again).toMatchObject({ created: 0, updated: 0 })
    const l = await list(ania)
    expect(l.items).toHaveLength(6)
    expect(l.items.filter((i) => i.kind === 'document_scan')).toHaveLength(5)
    // Puste napisy z inFakt (prod 26.10.2026: "" w dacie → błąd Postgresa) zapisane jako null; kwota z tekstu.
    expect(l.items.find((i) => i.infaktUuid.endsWith('000000000008'))).toMatchObject({ number: null, sellerName: null, issueDate: null, dueDate: null, currency: 'PLN', netPrice: 12345 })
    expect(l.lastSync?.by).toBe('EnvcheckInternal 2')
    expect(l.items.every((i) => i.status === 'new')).toBe(true)
    const fv1 = l.items.find((i) => i.number === 'FV/1/10/2026')!
    expect(fv1).toMatchObject({ netPrice: 101234, currency: 'PLN', issueDate: null, infaktCreatedAt: expect.any(String), accountingStatus: 'cost_not_accounted', manualFields: [], allocatedShare: 0 })
  })

  it('błąd inFakt → 502, bez zmian w bazie', async () => {
    h.infakt.fail = true
    const res = await req(h, 'POST', '/api/invoices/sync', ania.headers)
    h.infakt.fail = false
    expect(res.status).toBe(502)
    expect((await list(ania)).items).toHaveLength(6)
  })
})

describe('przypisanie i akceptacja', () => {
  it('podział procentowy na projekty, reszta = koszty ogólne; kwoty udziałów z netto', async () => {
    const inv = await byNumber('FV/2/10/2026')
    const res = await req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, ania.headers, {
      allocations: [
        { projectId: SEED_PROJECT_ID, share: 60 },
        { projectId: project2, share: 25.5 },
      ],
      note: 'sprężarki',
      version: inv.version,
    })
    expect(res.status).toBe(200)
    const d = (await res.json()) as InvoiceDetailDto
    expect(d.allocatedShare).toBe(85.5)
    expect(d.allocations.find((a) => a.projectId === project2)).toMatchObject({ share: 25.5, netAmount: shareAmount(201234, 25.5) })
    expect(shareAmount(201234, 25.5)).toBe(51315)
    expect(d.events.map((e) => e.kind)).toEqual(['allocated', 'imported'])
  })

  it('walidacja: suma > 100%, duplikat projektu, nieistniejący projekt, stara wersja', async () => {
    const inv = await byNumber('FV/2/10/2026')
    const put = (body: unknown) => req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, ania.headers, body)
    expect((await put({ allocations: [{ projectId: SEED_PROJECT_ID, share: 80 }, { projectId: project2, share: 30 }], version: inv.version })).status).toBe(422)
    expect((await put({ allocations: [{ projectId: project2, share: 10 }, { projectId: project2, share: 10 }], version: inv.version })).status).toBe(422)
    expect((await put({ allocations: [{ projectId: crypto.randomUUID(), share: 10 }], version: inv.version })).status).toBe(422)
    expect((await put({ allocations: [], version: inv.version - 1 })).status).toBe(409)
  })

  it('wysyłający nie może sam zaakceptować; akceptuje inna osoba z listy', async () => {
    const inv = await byNumber('FV/2/10/2026')
    const sub = await req(h, 'POST', `/api/invoices/${inv.id}/submit`, ania.headers, { version: inv.version })
    expect(sub.status).toBe(200)
    const pending = (await sub.json()) as InvoiceDetailDto
    expect(pending).toMatchObject({ status: 'pending', submittedBy: ania.id })
    // W trakcie akceptacji przypisania nie można zmieniać.
    expect((await req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, kamil.headers, { allocations: [], version: pending.version })).status).toBe(409)
    const self = await req(h, 'POST', `/api/invoices/${inv.id}/approve`, ania.headers, { version: pending.version })
    expect(self.status).toBe(403)
    expect(((await self.json()) as { code: string }).code).toBe('invoice_self_approval')
    const ok = await req(h, 'POST', `/api/invoices/${inv.id}/approve`, kamil.headers, { version: pending.version })
    expect(ok.status).toBe(200)
    expect((await ok.json()) as InvoiceDetailDto).toMatchObject({ status: 'approved', decidedByName: 'EnvcheckInternal 3' })
  })

  it('odrzucenie wymaga komentarza; odrzucona wraca do poprawy i ponownej wysyłki', async () => {
    const inv = await byNumber('FV/1/10/2026')
    const sub = (await (await req(h, 'POST', `/api/invoices/${inv.id}/submit`, kamil.headers, { version: inv.version })).json()) as InvoiceDetailDto
    expect((await req(h, 'POST', `/api/invoices/${inv.id}/reject`, admin.headers, { version: sub.version, comment: '' })).status).toBe(422)
    const rej = (await (await req(h, 'POST', `/api/invoices/${inv.id}/reject`, admin.headers, { version: sub.version, comment: 'to koszt OF038' })).json()) as InvoiceDetailDto
    expect(rej.status).toBe('rejected')
    expect(rej.events[0]).toMatchObject({ kind: 'rejected', comment: 'to koszt OF038' })
    const fixed = await req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, kamil.headers, { allocations: [{ projectId: project2, share: 100 }], version: rej.version })
    expect(fixed.status).toBe(200)
    const again = await req(h, 'POST', `/api/invoices/${inv.id}/submit`, kamil.headers, { version: ((await fixed.json()) as InvoiceDetailDto).version })
    expect(((await again.json()) as InvoiceDetailDto).status).toBe('pending')
  })

  it('zmiana kwoty w inFakt cofa zaakceptowaną fakturę do przypisania (udziały zostają)', async () => {
    const approved = await byNumber('FV/2/10/2026')
    expect(approved.status).toBe('approved')
    h.infakt.costs[1]!.net_price = 300000
    const r = (await (await req(h, 'POST', '/api/invoices/sync', ania.headers)).json()) as InvoiceSyncResult
    expect(r.updated).toBe(1)
    const d = (await (await req(h, 'GET', `/api/invoices/${approved.id}`, ania.headers)).json()) as InvoiceDetailDto
    expect(d).toMatchObject({ status: 'new', netPrice: 300000, allocatedShare: 85.5 })
    expect(d.events[0]).toMatchObject({ kind: 'changed_in_infakt', meta: { netPrice: { old: 201234, new: 300000 } } })
  })

  it('cofnięcie akceptacji / wycofanie z akceptacji → „do przypisania”', async () => {
    const pending = await byNumber('FV/1/10/2026')
    const res = await req(h, 'POST', `/api/invoices/${pending.id}/reopen`, kamil.headers, { version: pending.version, comment: 'jednak podział' })
    expect(((await res.json()) as InvoiceDetailDto).status).toBe('new')
  })

  it('plik bez odczytanych kwot: nie można wysłać, dopóki nie uzupełni się netto; dane ręczne wygrywają z synchronizacją', async () => {
    const scan = (await list(ania)).items.find((i) => i.infaktUuid.endsWith('000000000003'))!
    expect(scan).toMatchObject({ number: null, netPrice: null })
    const noAmount = await req(h, 'POST', `/api/invoices/${scan.id}/submit`, ania.headers, { version: scan.version })
    expect(noAmount.status).toBe(422)
    expect(((await noAmount.json()) as { code: string }).code).toBe('invoice_amount_missing')

    const res = await req(h, 'PATCH', `/api/invoices/${scan.id}/details`, ania.headers, { number: 'FV 77/2026', sellerName: 'Danfoss', issueDate: '2026-10-03', netPrice: 50000, taxPrice: 11500, grossPrice: 61500, version: scan.version })
    expect(res.status).toBe(200)
    const d = (await res.json()) as InvoiceDetailDto
    expect(d).toMatchObject({ number: 'FV 77/2026', sellerName: 'Danfoss', netPrice: 50000, issueDate: '2026-10-03' })
    expect(d.manualFields).toEqual(expect.arrayContaining(['number', 'sellerName', 'issueDate', 'netPrice', 'taxPrice', 'grossPrice']))
    expect(d.events[0]).toMatchObject({ kind: 'edited' })

    // inFakt odczytał potem inne kwoty — wartość ręczna zostaje, a zmiana nie cofa statusu.
    const sub = (await (await req(h, 'POST', `/api/invoices/${scan.id}/submit`, ania.headers, { version: d.version })).json()) as InvoiceDetailDto
    expect(sub.status).toBe('pending')
    h.infakt.costs[2]!.net_price = 99900
    await req(h, 'POST', '/api/invoices/sync', ania.headers)
    const after = (await (await req(h, 'GET', `/api/invoices/${scan.id}`, ania.headers)).json()) as InvoiceDetailDto
    expect(after).toMatchObject({ status: 'pending', netPrice: 50000 })
    // W trakcie akceptacji danych nie można zmieniać.
    expect((await req(h, 'PATCH', `/api/invoices/${scan.id}/details`, ania.headers, { netPrice: 1, version: after.version })).status).toBe(409)

    // Po wycofaniu: null przywraca wartość z inFakt.
    const back = (await (await req(h, 'POST', `/api/invoices/${scan.id}/reopen`, ania.headers, { version: after.version })).json()) as InvoiceDetailDto
    const restored = (await (await req(h, 'PATCH', `/api/invoices/${scan.id}/details`, ania.headers, { netPrice: null, version: back.version })).json()) as InvoiceDetailDto
    expect(restored.netPrice).toBe(99900)
    expect(restored.manualFields).not.toContain('netPrice')
  })

  it('eksport XLSX i załączniki z inFakt', async () => {
    const x = await req(h, 'GET', '/api/invoices/export.xlsx', ania.headers)
    expect(x.status).toBe(200)
    expect(x.headers.get('content-type')).toContain('spreadsheetml')
    const inv = await byNumber('FV/1/10/2026')
    const a = await req(h, 'GET', `/api/invoices/${inv.id}/attachments`, ania.headers)
    expect(((await a.json()) as { url: string }[])[0]?.url).toContain('app.infakt.pl')
  })
})
