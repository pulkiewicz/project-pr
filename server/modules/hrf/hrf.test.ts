import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HrfTaskDto, HrfTasksResponse, ImportPreviewResponse } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { buildHrfFixture, FIXTURE_MAPPING } from '../../test/hrf-fixture.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
const u = {} as Record<'admin' | 'env' | 'ars' | 'client' | 'sub', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}`

beforeAll(async () => {
  h = await startHarness()
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.client = await createUser(h, 'Client')
  u.sub = await createUser(h, 'Subcontractor')
})
afterAll(() => h.stop())

async function upload(path: string, user: TestUser, mapping?: object, file?: ArrayBuffer) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(file ?? (await buildHrfFixture()))], 'HRF.xlsx'))
  if (mapping) form.set('mapping', JSON.stringify(mapping))
  return h.app.request(`${P}/hrf${path}`, { method: 'POST', headers: user.headers, body: form })
}

const tasksOf = async (user: TestUser) => (await (await req(h, 'GET', `${P}/hrf/tasks`, user.headers)).json()) as HrfTasksResponse
const byCode = (r: HrfTasksResponse, code: string) => r.tasks.find((t) => t.code === code)!

describe('import HRF przez API', () => {
  it('inspect → preview → commit; daty puste do ustawienia dnia „0”', async () => {
    const inspect = await upload('/import/inspect', u.admin)
    expect(inspect.status).toBe(200)
    expect(((await inspect.json()) as { suggested: unknown }).suggested).toMatchObject({ headerRow: 5 })

    const preview = (await (await upload('/import/preview', u.admin, FIXTURE_MAPPING)).json()) as ImportPreviewResponse
    expect(preview.canCommit).toBe(true)
    expect(preview.diff.created).toHaveLength(9)

    const commit = await upload('/import/commit', u.admin, FIXTURE_MAPPING)
    expect(commit.status).toBe(200)
    expect(await commit.json()).toMatchObject({ created: 9, updated: 0 })

    const r = await tasksOf(u.admin)
    expect(r.tasks).toHaveLength(9)
    expect(r.dayZeroDate).toBeNull()
    expect(byCode(r, '1.1')).toMatchObject({ party: 'Konsorcjum', plannedStart: null, parentId: byCode(r, '1').id })
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'hrf.import'))
    expect(audit).toHaveLength(1)
  })

  it('import wymaga hrf:approve — EnvcheckInternal i Arsanit dostają 403', async () => {
    expect((await upload('/import/commit', u.env, FIXTURE_MAPPING)).status).toBe(403)
    expect((await upload('/import/commit', u.ars, FIXTURE_MAPPING)).status).toBe(403)
  })

  it('plik z błędami nie jest importowany', async () => {
    const res = await upload('/import/commit', u.admin, { ...FIXTURE_MAPPING, partyValues: {} })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'import_has_errors' })
  })
})

describe('dzień „0”', () => {
  it('podgląd różnic, a potem przeliczenie w transakcji z wpisem w audit log', async () => {
    const preview = await req(h, 'GET', `${P}/hrf/day-zero/preview?date=2026-09-21`, u.admin.headers)
    const body = (await preview.json()) as { changes: { code: string; newStart: string; newEnd: string }[] }
    expect(body.changes.find((ch) => ch.code === '1.10')).toMatchObject({ newStart: '2026-11-23', newEnd: '2026-11-29' })

    const project = (await (await req(h, 'GET', P, u.admin.headers)).json()) as { version: number }
    const put = await req(h, 'PUT', `${P}/hrf/day-zero`, u.admin.headers, { date: '2026-09-21', projectVersion: project.version })
    expect(put.status).toBe(200)
    const r = await tasksOf(u.admin)
    expect(r.dayZeroDate).toBe('2026-09-21')
    expect(byCode(r, '2.2')).toMatchObject({ plannedStart: '2027-11-01', plannedEnd: '2027-11-14' })

    // Przesunięcie o tydzień przesuwa wszystko.
    const stale = await req(h, 'PUT', `${P}/hrf/day-zero`, u.admin.headers, { date: '2026-09-28', projectVersion: project.version })
    expect(stale.status).toBe(409)
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'hrf.recalculate'))
    expect(audit[0]!.changes).toMatchObject({ dayZero: { old: null, new: '2026-09-21' } })
  })
})

describe('edycja zadań — polityka stron i pól', () => {
  const patch = (user: TestUser, t: HrfTaskDto, body: object) => req(h, 'PATCH', `${P}/hrf/tasks/${t.id}`, user.headers, { version: t.version, ...body })

  it('Arsanit edytuje postęp zadań Konsorcjum, ale nie odbiorów Zamawiającego', async () => {
    const r = await tasksOf(u.ars)
    expect(byCode(r, '1.1').canEdit).toBe(true)
    expect(byCode(r, '1.10').canEdit).toBe(false)
    expect((await patch(u.ars, byCode(r, '1.1'), { percentComplete: 50, status: 'in_progress' })).status).toBe(200)
    const denied = await patch(u.ars, byCode(r, '1.10'), { percentComplete: 10 })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'not_own_task' })
  })

  it('Client tylko odczyt; EnvcheckInternal edytuje postęp, ale nie strukturę', async () => {
    const r = await tasksOf(u.env)
    expect((await patch(u.client, byCode(r, '1.2'), { percentComplete: 5 })).status).toBe(403)
    expect((await patch(u.env, byCode(r, '1.10'), { status: 'ready_for_acceptance' })).status).toBe(200)
    const s = await patch(u.env, byCode(r, '1.2'), { durationDays: 14 })
    expect(s.status).toBe(403)
    expect(await s.json()).toMatchObject({ code: 'structure_edit_denied' })
  })

  it('konflikt wersji → 409 z aktualnym stanem', async () => {
    const t = byCode(await tasksOf(u.admin), '1.2')
    expect((await patch(u.admin, t, { notes: 'a' })).status).toBe(200)
    const stale = await patch(u.admin, t, { notes: 'b' })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'version_conflict', current: { notes: 'a' } })
  })

  it('Admin zmienia czas trwania — daty planowane przeliczone', async () => {
    const t = byCode(await tasksOf(u.admin), '1.2')
    const res = await patch(u.admin, t, { durationDays: 14 })
    expect(((await res.json()) as HrfTaskDto)).toMatchObject({ plannedStart: '2026-09-21', plannedEnd: '2026-10-04' })
  })
})

describe('pola [W] — contract_value', () => {
  it('Admin ustawia wartość; widzą ją tylko role z penalties:view (API i eksport XLSX)', async () => {
    const t = byCode(await tasksOf(u.admin), '1')
    const res = await req(h, 'PATCH', `${P}/hrf/tasks/${t.id}`, u.admin.headers, { version: t.version, contractValue: '1803106.00' })
    expect(res.status).toBe(200)

    expect(byCode(await tasksOf(u.admin), '1').contractValue).toBe('1803106.00')
    expect(byCode(await tasksOf(u.env), '1').contractValue).toBe('1803106.00')
    for (const user of [u.ars, u.client]) {
      const r = await tasksOf(user)
      expect(r.tasks.every((x) => !('contractValue' in x))).toBe(true)
      const raw = await (await req(h, 'GET', `${P}/hrf/tasks`, user.headers)).text()
      expect(raw).not.toContain('1803106')

      const xlsx = await req(h, 'GET', `${P}/hrf/export.xlsx`, user.headers)
      expect(xlsx.status).toBe(200)
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await xlsx.arrayBuffer())
      const header = (wb.worksheets[0]!.getRow(3).values as unknown[]).join('|')
      expect(header).not.toContain('[W]')
      let found = false
      wb.worksheets[0]!.eachRow((row) => row.eachCell((cell) => (found ||= String(cell.value).includes('1803106'))))
      expect(found).toBe(false)
    }
  })

  it('EnvcheckInternal (penalties:view, bez edit) nie może zmienić wartości [W]', async () => {
    const t = byCode(await tasksOf(u.env), '1')
    const res = await req(h, 'PATCH', `${P}/hrf/tasks/${t.id}`, u.env.headers, { version: t.version, contractValue: '1.00' })
    expect(res.status).toBe(403)
  })
})

describe('zależności i ścieżka krytyczna', () => {
  it('bez zależności ścieżka nie jest liczona; po dodaniu — CPM oznacza zadania krytyczne', async () => {
    let r = await tasksOf(u.admin)
    expect(r.criticalPathComputed).toBe(false)
    const put = await req(h, 'PUT', `${P}/hrf/tasks/${byCode(r, '2.1').id}/dependencies`, u.admin.headers, {
      predecessors: [{ predecessorId: byCode(r, '1.10').id, type: 'FS', lagDays: 0 }],
    })
    expect(put.status).toBe(200)
    await req(h, 'PUT', `${P}/hrf/tasks/${byCode(r, '2.2').id}/dependencies`, u.admin.headers, {
      predecessors: [{ predecessorId: byCode(r, '2.1').id, type: 'FS', lagDays: 0 }],
    })
    r = await tasksOf(u.admin)
    expect(r.criticalPathComputed).toBe(true)
    expect(byCode(r, '2.2').isCriticalPath).toBe(true)
    expect(byCode(r, '2').isCriticalPath).toBe(true) // Etap dziedziczy po zadaniach
    expect(byCode(r, '1.1').isCriticalPath).toBe(false)
  })

  it('cykl i zależność od Etapu są odrzucane', async () => {
    const r = await tasksOf(u.admin)
    const cycle = await req(h, 'PUT', `${P}/hrf/tasks/${byCode(r, '1.10').id}/dependencies`, u.admin.headers, {
      predecessors: [{ predecessorId: byCode(r, '2.2').id, type: 'FS', lagDays: 0 }],
    })
    expect(cycle.status).toBe(422)
    expect(await cycle.json()).toMatchObject({ code: 'hrf_dependency_cycle' })
    const stage = await req(h, 'PUT', `${P}/hrf/tasks/${byCode(r, '2.1').id}/dependencies`, u.admin.headers, {
      predecessors: [{ predecessorId: byCode(r, '1').id, type: 'FS', lagDays: 0 }],
    })
    expect(await stage.json()).toMatchObject({ code: 'hrf_dependency_on_stage' })
  })
})

describe('re-import i plan bazowy', () => {
  it('re-import nie nadpisuje postępu ani strony', async () => {
    const before = byCode(await tasksOf(u.admin), '1.1')
    expect(before.percentComplete).toBe(50)
    const res = await upload('/import/commit', u.admin, FIXTURE_MAPPING)
    expect(res.status).toBe(200)
    const after = byCode(await tasksOf(u.admin), '1.1')
    expect(after).toMatchObject({ percentComplete: 50, status: 'in_progress', party: 'Konsorcjum' })
    // 1.2: czas trwania zmieniony w aplikacji → plik przywraca wartość strukturalną
    expect(((await res.json()) as { diff: { updated: { code: string }[] } }).diff.updated.map((x) => x.code)).toContain('1.2')
  })

  it('zamrożenie planu bazowego zapisuje daty wszystkich zadań', async () => {
    const res = await req(h, 'POST', `${P}/hrf/baselines`, u.admin.headers, { name: 'Umowny' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const detail = (await (await req(h, 'GET', `${P}/hrf/baselines/${id}`, u.client.headers)).json()) as { tasks: unknown[] }
    expect(detail.tasks).toHaveLength(9)
    expect((await req(h, 'POST', `${P}/hrf/baselines`, u.env.headers, { name: 'x' })).status).toBe(403)
  })
})

describe('eksport PDF i dashboard', () => {
  it('PDF Gantta (A3) generuje się z polskimi znakami', async () => {
    const res = await req(h, 'GET', `${P}/hrf/export.pdf`, u.client.headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(5000)
  })

  it('dashboard: kafle 1–7 dla Client; brak dla Subcontractor', async () => {
    h.clock.now = new Date('2026-10-05T08:00:00Z')
    const res = await req(h, 'GET', `${P}/dashboard`, u.client.headers)
    expect(res.status).toBe(200)
    const d = (await res.json()) as { countdown: { calendarDays: number }; stages: unknown[]; milestones: { code: string }[] }
    expect(d.countdown.calendarDays).toBe(406)
    expect(d.stages).toHaveLength(3)
    expect(d.milestones[0]!.code).toBe('1.10')
    expect((await req(h, 'GET', `${P}/dashboard`, u.sub.headers)).status).toBe(403)
    h.clock.now = new Date()
  })
})
