import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HrfInternalTaskDto, HrfTasksResponse, ProjectAdminDto } from '#shared'
import { MIGRATIONS_DIR, createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

/** Migracja `oe10_import` w testach jest pusta (brak OE10 w bazie testowej) — tu uruchamiana po założeniu projektu. */
let h: Harness
let admin: TestUser
let kruk: TestUser
let jankowski: TestUser
let P: string
const runImport = () => h.db.execute(sql.raw(readFileSync(`${MIGRATIONS_DIR}/20261031113844_oe10_import/migration.sql`, 'utf8')))

beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  kruk = await createUser(h, 'EnvcheckInternal')
  jankowski = await createUser(h, 'EnvcheckInternal')
  await h.db.update(schema.users).set({ name: 'Michał Kruk' }).where(eq(schema.users.id, kruk.id))
  await h.db.update(schema.users).set({ name: 'Kamil Jankowski' }).where(eq(schema.users.id, jankowski.id))
  const res = await req(h, 'POST', '/api/admin/projects', admin.headers, { code: 'OE10', name: 'WITPiS — komora klimatyczna', client: 'WITPiS', contractEndDate: '2027-03-31' })
  P = `/api/projects/${((await res.json()) as ProjectAdminDto).id}`
  await runImport()
})
afterAll(() => h.stop())

const tasks = async () => (await (await req(h, 'GET', `${P}/hrf/tasks`, admin.headers)).json()) as HrfTasksResponse
const internal = async () => (await (await req(h, 'GET', `${P}/hrf/internal-tasks`, admin.headers)).json()) as HrfInternalTaskDto[]

describe('import OE10 (HRF WITPiS + notatki Kamila)', () => {
  it('HRF: struktura, terminy z miesięcy, wartości Etapów sumują się do kwoty umowy', async () => {
    const r = await tasks()
    expect(r.dayZeroDate).toBe('2025-09-01')
    expect(r.tasks).toHaveLength(87)
    const byCode = new Map(r.tasks.map((t) => [t.code, t]))
    expect(byCode.get('2.1.1.1.21')).toMatchObject({ name: '[26] Montaż bramy', plannedStart: '2026-10-01', plannedEnd: '2026-10-31', contractValue: '130000.00', party: 'Envcheck' })
    expect(byCode.get('2.1.1.1.21')!.parentId).toBe(byCode.get('2.1.1.1')!.id)
    expect(byCode.get('2.1.5.14')).toMatchObject({ plannedEnd: '2027-03-31', isAcceptancePoint: true, party: 'Client' })
    expect(byCode.get('2.6.6')!.parentId).toBe(byCode.get('2')!.id)
    expect(byCode.get('2.1.1.0')!.name).toMatch(/^\[09\]/)
    const total = r.tasks.reduce((s, t) => s + Number(t.contractValue ?? 0), 0)
    expect(total).toBe(6225000)
  })

  it('zadania wewnętrzne pod zadaniami HRF, z terminem zadania nadrzędnego i osobami MK/KJ', async () => {
    const list = await internal()
    expect(list).toHaveLength(148)
    expect(list.filter((i) => i.percentComplete === 100)).toHaveLength(27)
    const byCode = new Map((await tasks()).tasks.map((t) => [t.id, t]))
    const test = list.find((i) => i.name === 'Brama: test szczelności')!
    expect(byCode.get(test.parentTaskId)!.code).toBe('2.1.1.1.21')
    expect(test).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-31', percentComplete: 0, assignees: [{ id: jankowski.id }] })
    const both = list.find((i) => i.name === 'Brama: montaż końcowy mechaniczny')!
    expect(both.assignees.map((a) => a.id).sort()).toEqual([kruk.id, jankowski.id].sort())
    expect(list.find((i) => i.name === 'Brama: montaż napędu, rolek i wsporników')).toMatchObject({ percentComplete: 50, notes: 'W trakcie (wg notatek).' })
  })

  it('ponowne uruchomienie niczego nie dubluje', async () => {
    await runImport()
    expect((await tasks()).tasks).toHaveLength(87)
    expect(await internal()).toHaveLength(148)
  })
})
