import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DashboardResponse, HrfInternalAssigneeOption, HrfInternalTaskDto, HrfTasksResponse } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { buildHrfFixture, FIXTURE_MAPPING } from '../../test/hrf-fixture.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
const u = {} as Record<'admin' | 'env' | 'env2' | 'ars' | 'client', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}`
const I = `${P}/hrf/internal-tasks`
let leafId: string
let otherLeafId: string

beforeAll(async () => {
  h = await startHarness()
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.env2 = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.client = await createUser(h, 'Client')
  const form = new FormData()
  form.set('file', new File([new Uint8Array(await buildHrfFixture())], 'HRF.xlsx'))
  form.set('mapping', JSON.stringify(FIXTURE_MAPPING))
  await h.app.request(`${P}/hrf/import/commit`, { method: 'POST', headers: u.admin.headers, body: form })
  const tasks = (await (await req(h, 'GET', `${P}/hrf/tasks`, u.admin.headers)).json()) as HrfTasksResponse
  leafId = tasks.tasks.find((t) => t.code === '1.1')!.id
  otherLeafId = tasks.tasks.find((t) => t.code === '1.2')!.id
})
afterAll(() => h.stop())

describe('zadania wewnętrzne HRF', () => {
  it('Envcheck tworzy, edytuje i usuwa zadanie wewnętrzne przypięte do zadania formalnego', async () => {
    const created = await req(h, 'POST', I, u.env.headers, {
      parentTaskId: leafId,
      name: 'Uzgodnić projekt fundamentów z konstruktorem',
      assigneeIds: [u.env.id, u.env2.id],
      startDate: '2026-11-02',
      endDate: '2026-11-13',
      percentComplete: 20,
      notes: 'Wersja robocza',
      link: 'https://example.test/dokument',
    })
    expect(created.status).toBe(201)
    const dto = (await created.json()) as HrfInternalTaskDto
    expect(dto).toMatchObject({ parentTaskId: leafId, percentComplete: 20, link: 'https://example.test/dokument', version: 1 })
    expect(dto.assignees.map((a) => a.id).sort()).toEqual([u.env.id, u.env2.id].sort())

    const patched = await req(h, 'PATCH', `${I}/${dto.id}`, u.env.headers, { percentComplete: 60, assigneeIds: [u.env2.id], parentTaskId: otherLeafId, version: 1 })
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({ percentComplete: 60, parentTaskId: otherLeafId, assignees: [{ id: u.env2.id }], version: 2 })

    const stale = await req(h, 'PATCH', `${I}/${dto.id}`, u.env.headers, { name: 'x', version: 1 })
    expect(stale.status).toBe(409)

    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, dto.id))
    expect(audit.map((a) => a.action).sort()).toEqual(['hrf.internal_create', 'hrf.internal_update'])

    const del = await req(h, 'DELETE', `${I}/${dto.id}`, u.env.headers)
    expect(del.status).toBe(200)
    const list = (await (await req(h, 'GET', I, u.env.headers)).json()) as HrfInternalTaskDto[]
    expect(list.find((x) => x.id === dto.id)).toBeUndefined()
  })

  it('walidacja: zadanie formalne z projektu, kolejność dat, link http(s), osoby z dostępem do modułu', async () => {
    const base = { parentTaskId: leafId, name: 'Test' }
    expect((await req(h, 'POST', I, u.env.headers, { ...base, parentTaskId: crypto.randomUUID() })).status).toBe(422)
    expect((await req(h, 'POST', I, u.env.headers, { ...base, startDate: '2026-11-10', endDate: '2026-11-01' })).status).toBe(422)
    expect((await req(h, 'POST', I, u.env.headers, { ...base, link: 'javascript:alert(1)' })).status).toBe(422)
    const clientAssigned = await req(h, 'POST', I, u.env.headers, { ...base, assigneeIds: [u.client.id] })
    expect(clientAssigned.status).toBe(422)
    expect(await clientAssigned.json()).toMatchObject({ code: 'assignee_not_allowed' })

    const options = (await (await req(h, 'GET', `${I}/assignees`, u.env.headers)).json()) as HrfInternalAssigneeOption[]
    const ids = options.map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining([u.admin.id, u.env.id, u.env2.id]))
    expect(ids).not.toContain(u.client.id)
    expect(ids).not.toContain(u.ars.id)
  })

  it('Zamawiający i Arsanit (domyślna macierz) nie widzą zadań wewnętrznych', async () => {
    expect((await req(h, 'GET', I, u.client.headers)).status).toBe(403)
    expect((await req(h, 'GET', I, u.ars.headers)).status).toBe(403)
    expect((await req(h, 'POST', I, u.client.headers, { parentTaskId: leafId, name: 'x' })).status).toBe(403)
  })

  it('przypisane zadanie trafia do „Moich zadań” na dashboardzie; po terminie jako opóźnione', async () => {
    const r = await req(h, 'POST', I, u.env.headers, { parentTaskId: leafId, name: 'Zamówić geodetę', assigneeIds: [u.env2.id], endDate: '2026-01-20' })
    const dto = (await r.json()) as HrfInternalTaskDto
    expect(dto.overdue).toBe(true)
    const dash = (await (await req(h, 'GET', `${P}/dashboard`, u.env2.headers)).json()) as DashboardResponse
    expect(dash.myTasks).toContainEqual(expect.objectContaining({ id: dto.id, source: 'internal', status: 'delayed', plannedEnd: '2026-01-20' }))
    const other = (await (await req(h, 'GET', `${P}/dashboard`, u.env.headers)).json()) as DashboardResponse
    expect(other.myTasks.find((m) => m.id === dto.id)).toBeUndefined()
  })
})
