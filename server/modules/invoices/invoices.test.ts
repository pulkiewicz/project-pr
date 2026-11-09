import { and } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shareAmount, type CostCategoryDto, type InvoiceBulkResult, type InvoiceDetailDto, type InvoiceListResponse, type InvoiceSettings, type InvoiceSyncResult, type MeResponse } from '#shared'
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
        { projectId: project2, share: 25.5, description: '  sprężarki do komory  ' },
      ],
      note: 'sprężarki',
      version: inv.version,
    })
    expect(res.status).toBe(200)
    const d = (await res.json()) as InvoiceDetailDto
    expect(d.allocatedShare).toBe(85.5)
    expect(d.allocations.find((a) => a.projectId === project2)).toMatchObject({ share: 25.5, netAmount: shareAmount(201234, 25.5), description: 'sprężarki do komory' })
    expect(d.allocations.find((a) => a.projectId === SEED_PROJECT_ID)?.description).toBeNull()
    expect(shareAmount(201234, 25.5)).toBe(51315)
    expect(d.events.map((e) => e.kind)).toEqual(['allocated', 'imported'])
  })

  it('walidacja: suma > 100%, duplikat projektu, nieistniejący projekt, stara wersja', async () => {
    const inv = await byNumber('FV/2/10/2026')
    const put = (body: unknown) => req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, ania.headers, body)
    expect((await put({ allocations: [{ projectId: SEED_PROJECT_ID, share: 80 }, { projectId: project2, share: 30 }], version: inv.version })).status).toBe(422)
    expect((await put({ allocations: [{ projectId: project2, share: 10 }, { projectId: project2, share: 10 }], version: inv.version })).status).toBe(422)
    expect((await put({ allocations: [{ projectId: crypto.randomUUID(), share: 10 }], version: inv.version })).status).toBe(422)
    expect((await put({ allocations: [{ projectId: project2, share: 10, description: 'x'.repeat(501) }], version: inv.version })).status).toBe(422)
    expect((await put({ allocations: [], version: inv.version - 1 })).status).toBe(409)
  })

  it('lista akceptujących: osoby z listy z prawem akceptacji, bez mnie', async () => {
    const res = await req(h, 'GET', '/api/invoices/approvers', ania.headers)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { id: string }[]).map((a) => a.id).sort()).toEqual([admin.id, kamil.id].sort())
    expect((await req(h, 'GET', '/api/invoices/approvers', outsider.headers)).status).toBe(403)
  })

  it('wysłanie wymaga wskazania akceptującego z listy (nie siebie)', async () => {
    const inv = await byNumber('FV/2/10/2026')
    const submit = (body: object) => req(h, 'POST', `/api/invoices/${inv.id}/submit`, ania.headers, { version: inv.version, ...body })
    expect((await submit({})).status).toBe(422)
    const self = await submit({ approverId: ania.id })
    expect(self.status).toBe(403)
    expect(((await self.json()) as { code: string }).code).toBe('invoice_self_approval')
    const notOnList = await submit({ approverId: outsider.id })
    expect(notOnList.status).toBe(422)
    expect(((await notOnList.json()) as { code: string }).code).toBe('invoice_approver_invalid')
    expect((await byNumber('FV/2/10/2026')).status).toBe('new')
  })

  it('wysyłający nie może sam zaakceptować; akceptuje wskazana osoba', async () => {
    const inv = await byNumber('FV/2/10/2026')
    const sub = await req(h, 'POST', `/api/invoices/${inv.id}/submit`, ania.headers, { version: inv.version, approverId: kamil.id })
    expect(sub.status).toBe(200)
    const pending = (await sub.json()) as InvoiceDetailDto
    expect(pending).toMatchObject({ status: 'pending', submittedBy: ania.id, approverId: kamil.id, approverName: 'EnvcheckInternal 3' })
    expect(pending.events[0]).toMatchObject({ kind: 'submitted', meta: { approverId: kamil.id, approverName: 'EnvcheckInternal 3' } })
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
    const sub = (await (await req(h, 'POST', `/api/invoices/${inv.id}/submit`, kamil.headers, { version: inv.version, approverId: admin.id })).json()) as InvoiceDetailDto
    // Decyzję podejmuje wskazana osoba — inny akceptujący (nie Admin) nie może.
    const other = await req(h, 'POST', `/api/invoices/${inv.id}/reject`, ania.headers, { version: sub.version, comment: 'nie' })
    expect(other.status).toBe(403)
    expect(((await other.json()) as { code: string }).code).toBe('invoice_not_approver')
    expect((await req(h, 'POST', `/api/invoices/${inv.id}/reject`, admin.headers, { version: sub.version, comment: '' })).status).toBe(422)
    const rej = (await (await req(h, 'POST', `/api/invoices/${inv.id}/reject`, admin.headers, { version: sub.version, comment: 'to koszt OF038' })).json()) as InvoiceDetailDto
    expect(rej.status).toBe('rejected')
    expect(rej.events[0]).toMatchObject({ kind: 'rejected', comment: 'to koszt OF038' })
    const fixed = await req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, kamil.headers, { allocations: [{ projectId: project2, share: 100 }], version: rej.version })
    expect(fixed.status).toBe(200)
    const again = await req(h, 'POST', `/api/invoices/${inv.id}/submit`, kamil.headers, { version: ((await fixed.json()) as InvoiceDetailDto).version, approverId: admin.id })
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
    expect((await res.json()) as InvoiceDetailDto).toMatchObject({ status: 'new', approverId: null })
  })

  it('plik bez odczytanych kwot: nie można wysłać, dopóki nie uzupełni się netto; dane ręczne wygrywają z synchronizacją', async () => {
    const scan = (await list(ania)).items.find((i) => i.infaktUuid.endsWith('000000000003'))!
    expect(scan).toMatchObject({ number: null, netPrice: null })
    const noAmount = await req(h, 'POST', `/api/invoices/${scan.id}/submit`, ania.headers, { version: scan.version, approverId: kamil.id })
    expect(noAmount.status).toBe(422)
    expect(((await noAmount.json()) as { code: string }).code).toBe('invoice_amount_missing')

    const res = await req(h, 'PATCH', `/api/invoices/${scan.id}/details`, ania.headers, { number: 'FV 77/2026', sellerName: 'Danfoss', issueDate: '2026-10-03', netPrice: 50000, taxPrice: 11500, grossPrice: 61500, version: scan.version })
    expect(res.status).toBe(200)
    const d = (await res.json()) as InvoiceDetailDto
    expect(d).toMatchObject({ number: 'FV 77/2026', sellerName: 'Danfoss', netPrice: 50000, issueDate: '2026-10-03' })
    expect(d.manualFields).toEqual(expect.arrayContaining(['number', 'sellerName', 'issueDate', 'netPrice', 'taxPrice', 'grossPrice']))
    expect(d.events[0]).toMatchObject({ kind: 'edited' })

    // inFakt odczytał potem inne kwoty — wartość ręczna zostaje, a zmiana nie cofa statusu.
    const sub = (await (await req(h, 'POST', `/api/invoices/${scan.id}/submit`, ania.headers, { version: d.version, approverId: kamil.id })).json()) as InvoiceDetailDto
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

  it('zbiorcza zmiana przypisania: tylko faktury do przypisania / odrzucone, opis zachowany lub nowy, null = ogólne', async () => {
    const toSubmit = (await list(ania)).items.find((i) => i.status === 'new' && i.netPrice != null)!
    await req(h, 'POST', `/api/invoices/${toSubmit.id}/submit`, ania.headers, { version: toSubmit.version, approverId: kamil.id })
    const items = (await list(ania)).items
    const pending = items.find((i) => i.id === toSubmit.id && i.status === 'pending')!
    const editable = items.filter((i) => i.status === 'new' || i.status === 'rejected')
    const ids = [...editable.map((i) => i.id), pending.id]
    const r = await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids, projectId: project2, description: 'zakupy OF038' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ updated: editable.length, skipped: 1 })
    const after = (await list(ania)).items
    for (const e of editable) expect(after.find((i) => i.id === e.id)).toMatchObject({ allocatedShare: 100, allocations: [{ projectId: project2, share: 100, description: 'zakupy OF038' }] })
    expect(after.find((i) => i.id === pending.id)?.allocations).toEqual(pending.allocations)
    // Bez opisu w żądaniu — opis zostaje.
    await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids: [editable[0]!.id], projectId: SEED_PROJECT_ID })
    const kept = (await (await req(h, 'GET', `/api/invoices/${editable[0]!.id}`, ania.headers)).json()) as InvoiceDetailDto
    expect(kept.allocations).toMatchObject([{ projectId: SEED_PROJECT_ID, description: 'zakupy OF038' }])
    expect(kept.events[0]).toMatchObject({ kind: 'allocated', meta: { bulk: true } })
    // null = koszty ogólne.
    await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids: [editable[0]!.id], projectId: null })
    const general = (await (await req(h, 'GET', `/api/invoices/${editable[0]!.id}`, ania.headers)).json()) as InvoiceDetailDto
    expect(general).toMatchObject({ allocations: [], general: true })
    expect((await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids, projectId: crypto.randomUUID() })).status).toBe(422)
    expect((await req(h, 'POST', '/api/invoices/bulk-allocation', outsider.headers, { ids, projectId: null })).status).toBe(403)
  })

  it('koszty ogólne w wierszu: odróżnione od nieprzypisanej; przypisanie projektu zdejmuje znacznik', async () => {
    const inv = (await list(ania)).items.find((i) => i.status === 'new')!
    const put = async (body: object) => {
      const cur = (await (await req(h, 'GET', `/api/invoices/${inv.id}`, ania.headers)).json()) as InvoiceDetailDto
      return (await (await req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, ania.headers, { ...body, version: cur.version })).json()) as InvoiceDetailDto
    }
    expect(await put({ allocations: [], general: true })).toMatchObject({ allocations: [], general: true, allocatedShare: 0 })
    expect(await put({ allocations: [] })).toMatchObject({ allocations: [], general: false })
    expect(await put({ allocations: [], general: true })).toMatchObject({ general: true })
    expect(await put({ allocations: [{ projectId: project2, share: 100 }], general: true })).toMatchObject({ general: false, allocatedShare: 100 })
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

describe('kategorie kosztów', () => {
  const cats = async (u: TestUser) => (await (await req(h, 'GET', '/api/invoices/categories', u.headers)).json()) as CostCategoryDto[]

  it('słownik z domyślnymi kategoriami; zarządza Admin w Ustawieniach', async () => {
    const list0 = await cats(ania)
    expect(list0.map((k) => k.name)).toEqual(expect.arrayContaining(['Paliwo', 'Wynajem', 'Pensje', 'Inne']))
    expect((await req(h, 'POST', '/api/admin/settings/cost-categories', ania.headers, { name: 'Leasing' })).status).toBe(403)
    const added = (await (await req(h, 'POST', '/api/admin/settings/cost-categories', admin.headers, { name: ' Leasing ' })).json()) as CostCategoryDto[]
    expect(added.some((k) => k.name === 'Leasing' && k.active)).toBe(true)
    expect((await req(h, 'POST', '/api/admin/settings/cost-categories', admin.headers, { name: 'leasing' })).status).toBe(409)
  })

  it('kategoria na fakturze (w każdym statusie), zbiorczo; używanej nie można usunąć, wyłączonej nie można przypisać', async () => {
    const all = await cats(ania)
    const fuel = all.find((k) => k.name === 'Paliwo')!
    const rent = all.find((k) => k.name === 'Wynajem')!
    const inv = (await list(ania)).items.find((i) => i.status === 'pending')!
    const r = await req(h, 'PATCH', `/api/invoices/${inv.id}/category`, ania.headers, { costCategoryId: fuel.id, version: inv.version })
    expect(r.status).toBe(200)
    const d = (await r.json()) as InvoiceDetailDto
    expect(d).toMatchObject({ costCategoryId: fuel.id, costCategoryName: 'Paliwo' })
    expect(d.events[0]).toMatchObject({ kind: 'edited', meta: { costCategoryId: { old: null, new: fuel.id } } })
    expect((await req(h, 'PATCH', `/api/invoices/${inv.id}/category`, ania.headers, { costCategoryId: rent.id, version: inv.version })).status).toBe(409)
    // Bez wersji (wybór w wierszu listy) — zapis niezależny od równoległych zmian przypisania.
    expect(((await (await req(h, 'PATCH', `/api/invoices/${inv.id}/category`, ania.headers, { costCategoryId: rent.id })).json()) as InvoiceDetailDto).costCategoryName).toBe('Wynajem')

    const ids = (await list(ania)).items.slice(0, 3).map((i) => i.id)
    const bulk = (await (await req(h, 'POST', '/api/invoices/bulk-category', kamil.headers, { ids, costCategoryId: rent.id })).json()) as InvoiceBulkResult
    // Faktura, która ma już „Wynajem”, jest pomijana.
    expect(bulk.updated + bulk.skipped).toBe(3)
    expect((await list(ania)).items.filter((i) => ids.includes(i.id)).every((i) => i.costCategoryName === 'Wynajem')).toBe(true)

    expect((await req(h, 'DELETE', `/api/admin/settings/cost-categories/${rent.id}`, admin.headers)).status).toBe(409)
    await req(h, 'PATCH', `/api/admin/settings/cost-categories/${rent.id}`, admin.headers, { active: false })
    const other = (await list(ania)).items.find((i) => !ids.includes(i.id))!
    expect((await req(h, 'PATCH', `/api/invoices/${other.id}/category`, ania.headers, { costCategoryId: rent.id, version: other.version })).status).toBe(422)
    // Wyłączona zostaje na fakturach, które ją mają.
    expect((await list(ania)).items.find((i) => i.id === ids[0])?.costCategoryName).toBe('Wynajem')
    const leasing = (await cats(ania)).find((k) => k.name === 'Leasing')!
    expect((await req(h, 'DELETE', `/api/admin/settings/cost-categories/${leasing.id}`, admin.headers)).status).toBe(200)
    expect((await req(h, 'POST', '/api/invoices/bulk-category', outsider.headers, { ids, costCategoryId: null })).status).toBe(403)
  })
})

describe('uwagi z 02.11.2026: zbiorcze wysyłanie, licznik akceptacji, podgląd, eksport za okres, księgowość', () => {
  const count = async (u: TestUser) => ((await (await req(h, 'GET', '/api/invoices/awaiting-approval', u.headers)).json()) as { count: number }).count

  it('zbiorcze wysłanie do akceptacji: tylko przypisane z kwotą, do wskazanej osoby; licznik — tylko czekające na mnie', async () => {
    const editable = (await list(ania)).items.filter((i) => i.status === 'new' || i.status === 'rejected')
    const target = editable.find((i) => i.netPrice != null)!
    const unassigned = editable.find((i) => i.id !== target.id)!
    await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids: [target.id], projectId: project2 })
    await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids: [unassigned.id], projectId: project2 })
    await req(h, 'PUT', `/api/invoices/${unassigned.id}/allocation`, kamil.headers, { allocations: [], general: false, version: (await byId(unassigned.id)).version })
    const before = await count(ania)
    expect((await req(h, 'POST', '/api/invoices/bulk-submit', kamil.headers, { ids: [target.id] })).status).toBe(422)
    const res = await req(h, 'POST', '/api/invoices/bulk-submit', kamil.headers, { ids: [target.id, unassigned.id], approverId: ania.id })
    expect(res.status).toBe(200)
    expect((await res.json()) as InvoiceBulkResult).toEqual({ updated: 1, skipped: 1 })
    const d = await byId(target.id)
    expect(d).toMatchObject({ status: 'pending', submittedBy: kamil.id, approverId: ania.id })
    expect(d.events[0]).toMatchObject({ kind: 'submitted', meta: { bulk: true, approverId: ania.id } })
    expect((await byId(unassigned.id)).status).not.toBe('pending')
    expect(await count(ania)).toBe(before + 1)
    // Licznik: wskazane mnie (a bez wskazania — wysłane przez kogoś innego).
    const awaits = (u: TestUser) => (i: { status: string; approverId: string | null; submittedBy: string | null }) =>
      i.status === 'pending' && (i.approverId ? i.approverId === u.id : i.submittedBy !== u.id)
    const items = (await list(ania)).items
    for (const u of [admin, ania, kamil]) expect(await count(u)).toBe(items.filter(awaits(u)).length)
    expect((await req(h, 'POST', '/api/invoices/bulk-submit', outsider.headers, { ids: [target.id], approverId: ania.id })).status).toBe(403)
  })

  it('podgląd pliku inline (PDF przez serwer)', async () => {
    const inv = await byNumber('FV/1/10/2026')
    const res = await req(h, 'GET', `/api/invoices/${inv.id}/attachments/0/file`, ania.headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
    expect((await req(h, 'GET', `/api/invoices/${inv.id}/attachments/5/file`, ania.headers)).status).toBe(404)
  })

  it('eksport za okres: filtr po dacie kosztu, błędny zakres odrzucony', async () => {
    const ExcelJS = (await import('exceljs')).default
    const rows = async (q: string) => {
      const res = await req(h, 'GET', `/api/invoices/export.xlsx${q}`, ania.headers)
      expect(res.status).toBe(200)
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await res.arrayBuffer())
      return wb.worksheets[0]!.rowCount - 1
    }
    expect(await rows('')).toBeGreaterThan(0)
    expect(await rows('?from=2000-01-01&to=2000-01-31')).toBe(0)
    expect(await rows('?from=2000-01-01')).toBe(await rows(''))
    expect((await req(h, 'GET', '/api/invoices/export.xlsx?from=2026-02-01&to=2026-01-01', ania.headers)).status).toBeGreaterThanOrEqual(400)
  })

  it('rola Księgowość: dostęp z tabeli uprawnień (bez list w Ustawieniach) — odczyt i eksport, bez edycji i akceptacji', async () => {
    const accountant = await createUser(h, 'Accounting')
    // Bez wpisu na listach dostępu (Koszty, Zarząd, Czas pracy) — o dostępie decyduje sama rola.
    expect((await req(h, 'GET', '/api/invoices', accountant.headers)).status).toBe(200)
    expect((await req(h, 'GET', '/api/invoices/export.xlsx', accountant.headers)).status).toBe(200)
    expect(await count(accountant)).toBe(0)
    const inv = (await list(ania)).items[0]!
    expect((await req(h, 'PATCH', `/api/invoices/${inv.id}/category`, accountant.headers, { costCategoryId: null })).status).toBe(403)
    expect((await req(h, 'POST', '/api/invoices/bulk-submit', accountant.headers, { ids: [inv.id], approverId: ania.id })).status).toBe(403)
    // Księgowość nie ma prawa akceptacji — nie ma jej na liście akceptujących.
    expect(((await (await req(h, 'GET', '/api/invoices/approvers', ania.headers)).json()) as { id: string }[]).map((a) => a.id)).not.toContain(accountant.id)
    const me = (await (await req(h, 'GET', '/api/me', accountant.headers)).json()) as MeResponse
    expect(me.permissions).toEqual(expect.arrayContaining(['invoices:view', 'invoices:export', 'employees:view', 'employees:export', 'timesheets:view', 'timesheets:export']))
    expect(me.permissions).not.toContain('crm:view')
    expect(me.permissions).not.toContain('invoices:edit')
    // Zmiana w tabeli uprawnień od razu działa dla Księgowości (np. Pojazdy).
    expect(me.permissions).not.toContain('fleet:view')
    await h.db.insert(schema.permissions).values({ role: 'Accounting', module: 'fleet', action: 'view', allowed: true }).onConflictDoUpdate({ target: [schema.permissions.role, schema.permissions.module, schema.permissions.action], set: { allowed: true } })
    const me2 = (await (await req(h, 'GET', '/api/me', accountant.headers)).json()) as MeResponse
    expect(me2.permissions).toContain('fleet:view')
    await h.db.delete(schema.permissions).where(and(eq(schema.permissions.role, 'Accounting'), eq(schema.permissions.module, 'fleet')))
  })
})

const byId = async (id: string) => (await (await req(h, 'GET', `/api/invoices/${id}`, ania.headers)).json()) as InvoiceDetailDto

describe('powiadomienia e-mail o akceptacji', () => {
  const settings = async () => ((await (await req(h, 'GET', '/api/admin/settings/invoices', admin.headers)).json()) as { settings: InvoiceSettings; mailConfigured: boolean })
  const setNotify = async (notifyApprovers: boolean) => {
    const s = (await settings()).settings
    expect((await req(h, 'PUT', '/api/admin/settings/invoices', admin.headers, { ...s, notifyApprovers })).status).toBe(200)
  }
  /** Faktura gotowa do wysłania: przypisana do projektu, z kwotą netto, nie w akceptacji. */
  const ready = async () => {
    const inv = (await list(ania)).items.find((i) => (i.status === 'new' || i.status === 'rejected') && i.netPrice != null && i.number)!
    await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids: [inv.id], projectId: project2 })
    return byId(inv.id)
  }
  const reopenAll = async () => {
    for (const i of (await list(ania)).items.filter((x) => x.status === 'pending' || x.status === 'approved')) {
      await req(h, 'POST', `/api/invoices/${i.id}/reopen`, admin.headers, { version: i.version })
    }
  }

  it('domyślnie wyłączone: wysłanie do akceptacji nie wysyła e-maili', async () => {
    const s = await settings()
    expect(s.settings.notifyApprovers).toBe(false)
    expect(s.mailConfigured).toBe(true)
    h.mailer.sent = []
    const inv = await ready()
    expect((await req(h, 'POST', `/api/invoices/${inv.id}/submit`, ania.headers, { version: inv.version, approverId: kamil.id })).status).toBe(200)
    expect(h.mailer.sent).toHaveLength(0)
  })

  it('po włączeniu: e-mail tylko do wskazanego akceptującego', async () => {
    await reopenAll()
    await setNotify(true)
    h.mailer.sent = []
    const inv = await ready()
    expect((await req(h, 'POST', `/api/invoices/${inv.id}/submit`, ania.headers, { version: inv.version, approverId: kamil.id })).status).toBe(200)
    expect(h.mailer.sent).toHaveLength(1)
    const mail = h.mailer.sent[0]!
    // Tylko Kamil (wskazany) — nie Admin, choć też akceptuje.
    expect(mail.to).toEqual([kamil.email])
    expect(mail.subject).toBe('Do akceptacji: 1 faktura kosztowa')
    expect(mail.text).toContain(inv.number!)
    expect(mail.text).toContain('http://localhost/akceptacja')
  })

  it('zbiorcze wysłanie = jeden zbiorczy e-mail do wskazanego; nieaktywnego nie można wskazać; błąd poczty nie blokuje wysłania', async () => {
    await reopenAll()
    const a = await ready()
    const b = (await list(ania)).items.find((i) => i.id !== a.id && (i.status === 'new' || i.status === 'rejected') && i.netPrice != null)!
    await req(h, 'POST', '/api/invoices/bulk-allocation', kamil.headers, { ids: [b.id], projectId: project2 })
    await h.db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, admin.id))
    h.mailer.sent = []
    const inactive = await req(h, 'POST', '/api/invoices/bulk-submit', kamil.headers, { ids: [a.id, b.id], approverId: admin.id })
    await h.db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, admin.id))
    expect(inactive.status).toBe(422)
    const res = await req(h, 'POST', '/api/invoices/bulk-submit', kamil.headers, { ids: [a.id, b.id], approverId: ania.id })
    expect((await res.json()) as InvoiceBulkResult).toEqual({ updated: 2, skipped: 0 })
    expect(h.mailer.sent).toHaveLength(1)
    expect(h.mailer.sent[0]).toMatchObject({ to: [ania.email], subject: 'Do akceptacji: 2 faktury kosztowe' })
    expect(h.mailer.sent[0]!.text).toContain('EnvcheckInternal 3 wysłał(a) Ci do akceptacji 2 faktury kosztowe')

    h.mailer.fail = true
    const c = await ready()
    const sub = await req(h, 'POST', `/api/invoices/${c.id}/submit`, ania.headers, { version: c.version, approverId: kamil.id })
    h.mailer.fail = false
    expect(sub.status).toBe(200)
    expect((await byId(c.id)).status).toBe('pending')
  })

  it('poranne przypomnienie: każdy akceptujący dostaje listę czekających na niego (wskazanych jemu); wyłączone — nic', async () => {
    const { sendApprovalDigest } = await import('./notify.ts')
    // Czekają: dwie wysłane przez Kamila do Ani i jedna przez Anię do Kamila; jedną zamieniamy na wysłaną sprzed wyboru akceptującego.
    const legacy = (await list(ania)).items.find((i) => i.status === 'pending' && i.submittedBy === kamil.id)!
    await h.db.update(schema.costInvoices).set({ approverId: null }).where(eq(schema.costInvoices.id, legacy.id))
    const pending = (await list(ania)).items.filter((i) => i.status === 'pending')
    expect(new Set(pending.map((i) => i.submittedBy))).toEqual(new Set([kamil.id, ania.id]))
    h.mailer.sent = []
    const forUser = (u: TestUser) => h.mailer.sent.find((m) => m.to.length === 1 && m.to[0] === u.email)
    const waiting = (u: TestUser) => pending.filter((i) => (i.approverId ? i.approverId === u.id : i.submittedBy !== u.id)).length
    // Admin: tylko faktura bez wskazania; Ania: wskazane jej + bez wskazania; Kamil: wskazana jemu.
    expect(waiting(admin)).toBe(1)
    expect(await sendApprovalDigest(h.db, h.mailer, 'https://hub.envcheck.test/')).toEqual({ sent: 3 })
    for (const u of [admin, ania, kamil]) {
      expect(forUser(u)?.subject).toMatch(new RegExp(`^Przypomnienie: ${waiting(u)} `))
      expect(forUser(u)?.text).toContain('https://hub.envcheck.test/akceptacja')
    }
    await setNotify(false)
    h.mailer.sent = []
    expect(await sendApprovalDigest(h.db, h.mailer, 'https://hub.envcheck.test')).toEqual({ sent: 0 })
    expect(h.mailer.sent).toHaveLength(0)
  })
})

describe('zbiorcza akceptacja (strona „Do akceptacji”)', () => {
  const pendingNow = async () => (await list(ania)).items.filter((i) => i.status === 'pending')

  it('akceptuje tylko faktury czekające na mnie (bez własnych); reszta pominięta', async () => {
    const pending = await pendingNow()
    const ids = pending.map((i) => i.id)
    const mine = pending.filter((i) => i.submittedBy !== kamil.id && (i.approverId ? i.approverId === kamil.id : true))
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.length).toBeLessThan(pending.length)
    expect((await req(h, 'POST', '/api/invoices/bulk-approve', outsider.headers, { ids })).status).toBe(403)
    const res = await req(h, 'POST', '/api/invoices/bulk-approve', kamil.headers, { ids, comment: 'OK zbiorczo' })
    expect(res.status).toBe(200)
    expect((await res.json()) as InvoiceBulkResult).toEqual({ updated: mine.length, skipped: ids.length - mine.length })
    for (const i of mine) {
      const d = await byId(i.id)
      expect(d).toMatchObject({ status: 'approved', decidedByName: 'EnvcheckInternal 3' })
      expect(d.events[0]).toMatchObject({ kind: 'approved', comment: 'OK zbiorczo', meta: { bulk: true } })
    }
    expect((await pendingNow()).map((i) => i.id).sort()).toEqual(ids.filter((id) => !mine.some((m) => m.id === id)).sort())
  })

  it('Admin akceptuje zbiorczo także za wskazaną osobę; ponowna akceptacja nic nie zmienia', async () => {
    const pending = await pendingNow()
    const ids = pending.map((i) => i.id)
    const res = (await (await req(h, 'POST', '/api/invoices/bulk-approve', admin.headers, { ids })).json()) as InvoiceBulkResult
    expect(res).toEqual({ updated: pending.filter((i) => i.submittedBy !== admin.id).length, skipped: pending.filter((i) => i.submittedBy === admin.id).length })
    expect(await (await req(h, 'POST', '/api/invoices/bulk-approve', admin.headers, { ids })).json()).toEqual({ updated: 0, skipped: ids.length })
  })
})

describe('osobne wiersze uprawnień: „Do akceptacji” i „Plan finansowy”', () => {
  const setPerm = (module: string, action: string, allowed: boolean) =>
    h.db
      .update(schema.permissions)
      .set({ allowed })
      .where(and(eq(schema.permissions.role, 'EnvcheckInternal'), eq(schema.permissions.module, module), eq(schema.permissions.action, action)))
  const perms = async (u: TestUser) => ((await (await req(h, 'GET', '/api/me', u.headers)).json()) as MeResponse).permissions

  it('migracja: nowe wiersze mają te same wpisy co Koszty', async () => {
    const rows = await h.db.select().from(schema.permissions)
    const of = (m: string) => rows.filter((r) => r.module === m).map((r) => `${r.role}|${r.action}|${r.allowed}`).sort()
    expect(of('invoiceApprovals')).toEqual(of('invoices'))
    expect(of('financePlan')).toEqual(of('invoices'))
  })

  it('„Do akceptacji” bez Kosztów: zakładka i karta faktury działają, lista tylko faktur w akceptacji', async () => {
    await setPerm('invoices', 'view', false)
    try {
      expect(await perms(ania)).toEqual(expect.arrayContaining(['invoiceApprovals:view']))
      expect(await perms(ania)).not.toContain('invoices:view')
      const res = await req(h, 'GET', '/api/invoices', ania.headers)
      expect(res.status).toBe(200)
      const items = ((await res.json()) as InvoiceListResponse).items
      expect(items.every((i) => i.status === 'pending')).toBe(true)
      if (items[0]) expect((await req(h, 'GET', `/api/invoices/${items[0].id}`, ania.headers)).status).toBe(200)
    } finally {
      await setPerm('invoices', 'view', true)
    }
  })

  it('akceptacja wymaga „Do akceptacji: akceptacja” — nie wiersza Koszty', async () => {
    await setPerm('invoiceApprovals', 'approve', false)
    try {
      expect(await perms(kamil)).toContain('invoices:approve')
      expect((await req(h, 'POST', '/api/invoices/bulk-approve', kamil.headers, { ids: [crypto.randomUUID()] })).status).toBe(403)
      expect(((await (await req(h, 'GET', '/api/invoices/awaiting-approval', kamil.headers)).json()) as { count: number }).count).toBe(0)
      // Bez prawa akceptacji nie ma kogo wskazać jako akceptującego.
      expect(((await (await req(h, 'GET', '/api/invoices/approvers', ania.headers)).json()) as { id: string }[]).map((a) => a.id)).not.toContain(kamil.id)
    } finally {
      await setPerm('invoiceApprovals', 'approve', true)
    }
    expect((await req(h, 'POST', '/api/invoices/bulk-approve', kamil.headers, { ids: [crypto.randomUUID()] })).status).toBe(200)
  })

  it('Plan finansowy niezależnie od Kosztów', async () => {
    expect((await req(h, 'GET', '/api/finance/plan?month=2026-10', ania.headers)).status).toBe(200)
    await setPerm('financePlan', 'view', false)
    try {
      expect((await req(h, 'GET', '/api/finance/plan?month=2026-10', ania.headers)).status).toBe(403)
      expect((await req(h, 'GET', '/api/invoices', ania.headers)).status).toBe(200)
    } finally {
      await setPerm('financePlan', 'view', true)
    }
  })
})
