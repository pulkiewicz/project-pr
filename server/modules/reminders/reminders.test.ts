import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { HrfResponsibleOption, HrfTasksResponse, UserDto } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { buildHrfFixture, FIXTURE_MAPPING } from '../../test/hrf-fixture.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'
import { collectReminders, isReminderHour, reminderEmail, sendTaskReminders } from './service.ts'

let h: Harness
const u = {} as Record<'admin' | 'env' | 'env2' | 'ars' | 'outsider' | 'off', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}`
// Wtorek 03.11.2026, 7:00 w Warszawie (CET).
const NOW = new Date('2026-11-03T06:00:00Z')
const TODAY = '2026-11-03'
const APP = 'https://pmo.example.test'
let byCode: Map<string, string>
let projectCode: string

const setTask = (code: string, v: Partial<typeof schema.hrfTasks.$inferInsert>) => {
  const id = byCode.get(code)
  if (!id) throw new Error(`brak zadania ${code} w fixture`)
  return h.db.update(schema.hrfTasks).set(v).where(eq(schema.hrfTasks.id, id))
}

async function internalTask(name: string, parent: string, endDate: string, assignees: string[], percentComplete = 0) {
  const [row] = await h.db
    .insert(schema.hrfInternalTasks)
    .values({ projectId: SEED_PROJECT_ID, parentTaskId: byCode.get(parent)!, name, endDate, percentComplete })
    .returning()
  await h.db.insert(schema.hrfInternalTaskAssignees).values(assignees.map((userId) => ({ taskId: row!.id, userId })))
}

beforeAll(async () => {
  h = await startHarness()
  h.clock.now = NOW
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.env2 = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.outsider = await createUser(h, 'Arsanit', { projects: [] })
  u.off = await createUser(h, 'EnvcheckInternal')
  await h.db.update(schema.users).set({ taskReminders: false }).where(eq(schema.users.id, u.off.id))

  const form = new FormData()
  form.set('file', new File([new Uint8Array(await buildHrfFixture())], 'HRF.xlsx'))
  form.set('mapping', JSON.stringify(FIXTURE_MAPPING))
  await h.app.request(`${P}/hrf/import/commit`, { method: 'POST', headers: u.admin.headers, body: form })
  const tasks = (await (await req(h, 'GET', `${P}/hrf/tasks`, u.admin.headers)).json()) as HrfTasksResponse
  byCode = new Map(tasks.tasks.map((t) => [t.code, t.id]))
  projectCode = (await h.db.select().from(schema.projects).where(eq(schema.projects.id, SEED_PROJECT_ID)))[0]!.code

  await setTask('1.1', { responsibleUserId: u.env.id, plannedEnd: '2026-10-30', status: 'in_progress' }) // po terminie
  await setTask('1.2', { responsibleUserId: u.env.id, plannedEnd: '2026-11-20' }) // poza horyzontem 7 dni
  await setTask('1.10', { responsibleUserId: u.env.id, plannedEnd: '2026-11-05', status: 'accepted' }) // odebrane
  await setTask('2.1', { responsibleUserId: u.ars.id, plannedEnd: '2026-11-10' }) // ostatni dzień horyzontu
  await setTask('2.2', { responsibleUserId: u.outsider.id, plannedEnd: '2026-11-04' }) // bez dostępu do projektu
  await setTask('3.1', { responsibleUserId: u.off.id, plannedEnd: '2026-11-04' }) // przypomnienia wyłączone
  await internalTask('Uzgodnić <fundamenty> z konstruktorem', '1.1', '2026-11-03', [u.env.id, u.env2.id])
  await internalTask('Zrobione', '1.1', '2026-11-03', [u.env.id], 100)
  await internalTask('Bez dostępu do zadań wewnętrznych', '1.1', '2026-11-03', [u.ars.id])
})
afterAll(() => h.stop())
beforeEach(async () => {
  h.email.sent = []
  h.email.failFor.clear()
  await h.db.update(schema.users).set({ taskRemindersSentOn: null })
})

describe('przypomnienia e-mail o zadaniach', () => {
  it('zbiera zadania po terminie i z terminem w ciągu 7 dni, z uwzględnieniem uprawnień i dostępu do projektu', async () => {
    const recipients = await collectReminders(h.db, TODAY)
    const of = (user: TestUser) => recipients.find((r) => r.id === user.id)?.items.map((i) => `${i.kind}:${i.code}:${i.overdue}`)
    expect(of(u.env)).toEqual(['hrf:1.1:true', 'internal:1.1:false'])
    expect(of(u.env2)).toEqual(['internal:1.1:false'])
    // Arsanit: zadanie formalne tak, wewnętrzne nie (brak hrfInternal:view).
    expect(of(u.ars)).toEqual(['hrf:2.1:false'])
    expect(of(u.outsider)).toBeUndefined()
    expect(of(u.off)).toBeUndefined()
    expect(of(u.admin)).toBeUndefined()
  })

  it('treść: link do HRF projektu, termin, escapowanie HTML', async () => {
    const env = (await collectReminders(h.db, TODAY)).find((r) => r.id === u.env.id)!
    const m = reminderEmail(env, TODAY, `${APP}/`)
    expect(m.to).toBe(u.env.email)
    expect(m.subject).toBe('Przypomnienie: 2 zadania (1 po terminie)')
    expect(m.html).toContain(`href="${APP}/projekty/${projectCode}/hrf"`)
    expect(m.html).toContain('Uzgodnić &lt;fundamenty&gt; z konstruktorem')
    expect(m.html).not.toContain('<fundamenty>')
    expect(m.text).toContain('po terminie od 30.10.2026')
    expect(m.text).toContain('termin dzisiaj')
  })

  it('wysyła raz dziennie; ponowne uruchomienie tego dnia nic nie wysyła', async () => {
    expect(await sendTaskReminders(h.deps, NOW, APP)).toEqual({ sent: 3, failed: 0 })
    expect(h.email.sent.map((m) => m.to).sort()).toEqual([u.env.email, u.env2.email, u.ars.email].sort())
    expect(await sendTaskReminders(h.deps, NOW, APP)).toEqual({ sent: 0, failed: 0 })
    expect(h.email.sent).toHaveLength(3)
    // Następny dzień roboczy — znowu.
    expect((await sendTaskReminders(h.deps, new Date('2026-11-04T06:00:00Z'), APP)).sent).toBe(3)
  })

  it('błąd wysyłki cofa rezerwację dnia — kolejne uruchomienie ponawia', async () => {
    h.email.failFor.add(u.env2.email)
    expect(await sendTaskReminders(h.deps, NOW, APP)).toEqual({ sent: 2, failed: 1 })
    h.email.failFor.clear()
    expect(await sendTaskReminders(h.deps, NOW, APP)).toEqual({ sent: 1, failed: 0 })
    expect(h.email.sent.at(-1)!.to).toBe(u.env2.email)
  })

  it('weekend, święto i brak dostawcy — bez wysyłki', async () => {
    expect((await sendTaskReminders(h.deps, new Date('2026-11-07T06:00:00Z'), APP)).skipped).toBe('non_working_day')
    expect((await sendTaskReminders(h.deps, new Date('2026-11-11T06:00:00Z'), APP)).skipped).toBe('non_working_day')
    expect((await sendTaskReminders({ db: h.db, email: null }, NOW, APP)).skipped).toBe('email_disabled')
    expect(h.email.sent).toHaveLength(0)
  })

  it('godzina wysyłki: 7:00 w Warszawie w czasie zimowym i letnim', () => {
    expect(isReminderHour(new Date('2026-11-03T06:00:00Z'))).toBe(true)
    expect(isReminderHour(new Date('2026-11-03T05:00:00Z'))).toBe(false)
    expect(isReminderHour(new Date('2026-07-01T05:00:00Z'))).toBe(true)
    expect(isReminderHour(new Date('2026-07-01T06:00:00Z'))).toBe(false)
  })
})

describe('osoba odpowiedzialna za zadanie formalne', () => {
  it('lista kandydatów: aktywni z dostępem do HRF i projektu', async () => {
    const res = await req(h, 'GET', `${P}/hrf/responsible-options`, u.env.headers)
    expect(res.status).toBe(200)
    const ids = ((await res.json()) as HrfResponsibleOption[]).map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining([u.admin.id, u.env.id, u.ars.id]))
    expect(ids).not.toContain(u.outsider.id)
  })

  it('zapis: osoba spoza listy → 422, z listy → zapisana', async () => {
    const task = async () =>
      ((await (await req(h, 'GET', `${P}/hrf/tasks`, u.admin.headers)).json()) as HrfTasksResponse).tasks.find((t) => t.code === '1.2')!
    const bad = await req(h, 'PATCH', `${P}/hrf/tasks/${byCode.get('1.2')}`, u.admin.headers, { version: (await task()).version, responsibleUserId: u.outsider.id })
    expect(bad.status).toBe(422)
    const ok = await req(h, 'PATCH', `${P}/hrf/tasks/${byCode.get('1.2')}`, u.admin.headers, { version: (await task()).version, responsibleUserId: u.env2.id })
    expect(ok.status).toBe(200)
    expect((await task()).responsibleUserId).toBe(u.env2.id)
  })
})

describe('Administracja: przełącznik przypomnień', () => {
  it('Admin wyłącza i włącza przypomnienia osobie', async () => {
    const list = (await (await req(h, 'GET', '/api/admin/users', u.admin.headers)).json()) as UserDto[]
    const env2 = list.find((x) => x.id === u.env2.id)!
    expect(env2.taskReminders).toBe(true)
    const res = await req(h, 'PATCH', `/api/admin/users/${u.env2.id}`, u.admin.headers, { taskReminders: false, version: env2.version })
    expect(res.status).toBe(200)
    expect(((await res.json()) as UserDto).taskReminders).toBe(false)
    expect((await collectReminders(h.db, TODAY)).some((r) => r.id === u.env2.id)).toBe(false)
  })
})
