import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AvizationDto, FileDto, FolderDto, HrfTasksResponse, PersonDto } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { runJob } from '../../jobs/runner.ts'
import { buildHrfFixture, FIXTURE_MAPPING } from '../../test/hrf-fixture.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
const u = {} as Record<'admin' | 'env' | 'ars' | 'client' | 'sub', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}`
const D = `${P}/documents`
let folders: FolderDto[]
const folder = (path: string) => folders.find((f) => f.path === path)!

beforeAll(async () => {
  h = await startHarness()
  h.clock.now = new Date('2026-10-05T08:00:00Z')
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.client = await createUser(h, 'Client')
  u.sub = await createUser(h, 'Subcontractor', { subcontractorId: '33333333-3333-4333-8333-333333333333' })
  // HRF potrzebny do dynamicznych podfolderów (Etap 1, punkty odbioru)
  const form = new FormData()
  form.set('file', new File([new Uint8Array(await buildHrfFixture())], 'HRF.xlsx'))
  form.set('mapping', JSON.stringify(FIXTURE_MAPPING))
  await h.app.request(`${P}/hrf/import/commit`, { method: 'POST', headers: u.admin.headers, body: form })
})
afterAll(() => h.stop())

const getJson = async <T>(user: TestUser, path: string) => (await (await req(h, 'GET', path, user.headers)).json()) as T

describe('M7 konfiguracja i struktura', () => {
  it('ustawienia: test połączenia z Shared Drive; zły ID → 422', async () => {
    expect((await req(h, 'PUT', `${D}/settings`, u.admin.headers, { sharedDriveId: 'nie-ma-takiego' })).status).toBe(422)
    const ok = await req(h, 'PUT', `${D}/settings`, u.admin.headers, { sharedDriveId: h.drive.driveId, googleDomain: 'example.test' })
    expect(ok.status).toBe(200)
    expect((await req(h, 'PUT', `${D}/settings`, u.env.headers, { sharedDriveId: h.drive.driveId })).status).toBe(403)
  })

  it('inicjalizacja tworzy strukturę z podfolderami z HRF; ponowne uruchomienie niczego nie dubluje', async () => {
    const r = (await (await req(h, 'POST', `${D}/initialize`, u.admin.headers)).json()) as { created: number }
    expect(r.created).toBeGreaterThan(30)
    const again = (await (await req(h, 'POST', `${D}/initialize`, u.admin.headers)).json()) as { created: number }
    expect(again.created).toBe(0)
    folders = await getJson<FolderDto[]>(u.admin, `${D}/folders`)
    expect(folder('/06_Protokoly_odbioru/1.10_Odbiór_projektów')).toBeTruthy()
    expect(folder('/03_Projekt_i_dokumentacja_techniczna/1.1_Projekt_A')).toBeTruthy()
    expect(folder('/10_BHP_i_awizacje/Listy_awizacyjne')).toBeTruthy()
  })

  it('widoczność folderów wg ról: Zamawiający bez korespondencji, zakupów i [W]; podwykonawca — nic', async () => {
    const paths = (fs: FolderDto[]) => fs.filter((f) => f.level !== 'none').map((f) => f.path)
    const client = paths(await getJson<FolderDto[]>(u.client, `${D}/folders`))
    expect(client).toContain('/02_HRF_i_harmonogramy')
    expect(client).toContain('/07_Spotkania/Wspolne_z_Zamawiajacym')
    expect(client).not.toContain('/05_Korespondencja_formalna')
    expect(client).not.toContain('/07_Spotkania/Wewnetrzne')
    expect(client.some((p) => p.startsWith('/99_') || p.startsWith('/01_'))).toBe(false)
    const ars = paths(await getJson<FolderDto[]>(u.ars, `${D}/folders`))
    expect(ars).toContain('/05_Korespondencja_formalna')
    expect(ars).not.toContain('/01_Umowa_i_aneksy')
    expect(await getJson<FolderDto[]>(u.sub, `${D}/folders`)).toEqual([])
  })
})

describe('M7 upload, pobieranie, synchronizacja', () => {
  let fileId: string

  it('upload: sesja tylko z prawem zapisu i dozwolonym typem; weryfikacja po zakończeniu', async () => {
    const target = folder('/04_Uzgodnienia_i_decyzje')
    const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251)
    expect((await req(h, 'POST', `${D}/upload-sessions`, u.client.headers, { folderId: target.id, name: 'a.pdf', size: 10, mimeType: 'application/pdf' })).status).toBe(403)
    expect((await req(h, 'POST', `${D}/upload-sessions`, u.ars.headers, { folderId: target.id, name: 'x.exe', size: 10, mimeType: 'application/x-msdownload' })).status).toBe(422)
    const s = (await (await req(h, 'POST', `${D}/upload-sessions`, u.ars.headers, { folderId: target.id, name: 'Uzgodnienie ppoż.pdf', size: big.length, mimeType: 'application/pdf' })).json()) as { pendingUploadId: string; uploadUrl: string }
    const item = h.drive.finishUpload(s.uploadUrl, big)
    const done = await req(h, 'POST', `${D}/upload-complete`, u.ars.headers, { pendingUploadId: s.pendingUploadId, driveFileId: item.id })
    expect(done.status).toBe(200)
    fileId = ((await done.json()) as { id: string }).id

    // Niezgodny rozmiar → plik usunięty z Drive
    const s2 = (await (await req(h, 'POST', `${D}/upload-sessions`, u.ars.headers, { folderId: target.id, name: 'b.pdf', size: 100, mimeType: 'application/pdf' })).json()) as { pendingUploadId: string; uploadUrl: string }
    const bad = h.drive.finishUpload(s2.uploadUrl, new Uint8Array(5))
    expect((await req(h, 'POST', `${D}/upload-complete`, u.ars.headers, { pendingUploadId: s2.pendingUploadId, driveFileId: bad.id })).status).toBe(422)
    expect(h.drive.items.get(bad.id)!.trashed).toBe(true)
  })

  it('pobieranie porcjami ≤ 4 MB (Range); audit tylko dla pierwszej porcji', async () => {
    const first = await req(h, 'GET', `${D}/files/${fileId}/content`, u.client.headers)
    expect(first.status).toBe(206)
    expect(first.headers.get('content-range')).toBe(`bytes 0-4194303/${9 * 1024 * 1024}`)
    expect((await first.arrayBuffer()).byteLength).toBe(4 * 1024 * 1024)
    const last = await h.app.request(`${D}/files/${fileId}/content`, { headers: { ...u.client.headers, range: 'bytes=8388608-' } })
    expect(last.headers.get('content-range')).toBe(`bytes 8388608-9437183/${9 * 1024 * 1024}`)
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'documents.download'))
    expect(audit.filter((a) => a.entityId === fileId)).toHaveLength(1)
    expect((await req(h, 'GET', `${D}/files/${fileId}/content`, u.sub.headers)).status).toBe(404)
  })

  it('plik dodany bezpośrednio na Drive pojawia się po synchronizacji (job), z ACL folderu', async () => {
    const corr = folder('/05_Korespondencja_formalna/Przychodzaca')
    const [row] = await h.db.select().from(schema.driveFolders).where(eq(schema.driveFolders.id, corr.id))
    h.drive.externalAdd(row!.driveFolderId, 'Pismo PIT-RADWAR 2026-10-01.pdf')
    const r1 = await runJob(h.deps, 'drive-sync', new Date('2026-10-05T08:03:00Z'))
    expect(r1.skipped).toBe(false)
    expect((await runJob(h.deps, 'drive-sync', new Date('2026-10-05T08:04:00Z'))).skipped).toBe(true) // to samo okno 5 min
    const forArs = await getJson<FileDto[]>(u.ars, `${D}/files?q=Pismo`)
    expect(forArs.map((f) => f.name)).toEqual(['Pismo PIT-RADWAR 2026-10-01.pdf'])
    expect(await getJson<FileDto[]>(u.client, `${D}/files?q=Pismo`)).toEqual([])
  })

  it('Dokumenty Google: eksport do PDF; „Otwórz w Docs” tylko dla Envcheck z domeny', async () => {
    const tplFolder = folder('/00_Szablony')
    const [row] = await h.db.select().from(schema.driveFolders).where(eq(schema.driveFolders.id, tplFolder.id))
    h.drive.externalAdd(row!.driveFolderId, 'Szablon notatki', 'application/vnd.google-apps.document')
    await runJob(h.deps, 'drive-sync', new Date('2026-10-05T08:10:00Z'))
    const templates = await getJson<{ id: string }[]>(u.env, `${D}/templates`)
    expect(templates).toHaveLength(1)
    const target = folder('/07_Spotkania/Wspolne_z_Zamawiajacym')
    const res = await req(h, 'POST', `${D}/from-template`, u.env.headers, { templateId: templates[0]!.id, folderId: target.id, name: 'Notatka 2026-10-05' })
    const dto = (await res.json()) as FileDto
    expect(dto).toMatchObject({ googleNative: true, folderPath: '/07_Spotkania/Wspolne_z_Zamawiajacym' })
    expect(dto.webViewLink).toMatch(/^https:\/\/docs\.google\.com/) // Envcheck z domeny example.test
    const forClient = await getJson<FileDto[]>(u.client, `${D}/files?q=Notatka`)
    expect(forClient[0]!.webViewLink).toBeNull() // Zamawiający — bez linku do Google
    const pdf = await req(h, 'GET', `${D}/files/${dto.id}/content?format=pdf`, u.client.headers)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    // Zamawiający nie widzi folderu szablonów — szablon „nie istnieje” (bez ujawniania struktury).
    expect((await req(h, 'POST', `${D}/from-template`, u.client.headers, { templateId: templates[0]!.id, folderId: target.id, name: 'x' })).status).toBe(404)
  })

  it('zmiana ACL folderu przez Admina działa od razu i trafia do audit logu', async () => {
    const f = folder('/04_Uzgodnienia_i_decyzje')
    await req(h, 'PUT', `${D}/acl/${f.id}`, u.admin.headers, { entries: [{ subject: 'role:EnvcheckInternal', level: 'write' }] })
    expect(await getJson<FileDto[]>(u.client, `${D}/files?folderId=${f.id}`)).toEqual([])
    await req(h, 'PUT', `${D}/acl/${f.id}`, u.admin.headers, { entries: null }) // powrót do dziedziczenia (z korzenia: read)
    expect((await getJson<FileDto[]>(u.client, `${D}/files?folderId=${f.id}`)).length).toBe(1)
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'documents.acl'))
    expect(audit).toHaveLength(2)
  })
})

describe('M7 automatyczna archiwizacja', () => {
  it('re-import HRF zapisuje plik w Rewizje_HRF', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(await buildHrfFixture())], 'HRF_rev11.xlsx'))
    form.set('mapping', JSON.stringify(FIXTURE_MAPPING))
    await h.app.request(`${P}/hrf/import/commit`, { method: 'POST', headers: u.admin.headers, body: form })
    const files = await getJson<FileDto[]>(u.client, `${D}/files?folderId=${folder('/02_HRF_i_harmonogramy/Rewizje_HRF').id}`)
    expect(files.map((f) => f.name)).toEqual(['2026-10-05_HRF_rev11.xlsx'])
  })

  it('akceptacja awizacji zapisuje listę PDF powiązaną z awizacją', async () => {
    const tasks = await getJson<HrfTasksResponse>(u.admin, `${P}/hrf/tasks`)
    void tasks
    const person = (await (await req(h, 'POST', `${P}/persons`, u.env.headers, { firstName: 'Jan', lastName: 'Testowy', idDocType: 'id_card', idDocNumber: 'ABC 123456', company: 'Envcheck' })).json()) as PersonDto
    let a = (await (await req(h, 'POST', `${P}/avizations`, u.env.headers, { dateFrom: '2026-10-07', dateTo: '2026-10-07', purpose: 'Test', personIds: [person.id] })).json()) as AvizationDto
    a = (await (await req(h, 'POST', `${P}/avizations/${a.id}/transition`, u.env.headers, { action: 'send', version: a.version })).json()) as AvizationDto
    await req(h, 'POST', `${P}/avizations/${a.id}/transition`, u.client.headers, { action: 'accept', version: a.version })
    const linked = await getJson<FileDto[]>(u.client, `${D}/files?targetType=avization&targetId=${a.id}`)
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({ name: 'AW-2026-001_2026-10-07.pdf', folderPath: '/10_BHP_i_awizacje/Listy_awizacyjne', status: 'approved' })
  })
})
