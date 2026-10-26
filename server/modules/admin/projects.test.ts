import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MeResponse, ProjectAdminDto } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { createUser, req, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
let staff: TestUser
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  staff = await createUser(h, 'EnvcheckInternal')
})
afterAll(() => h.stop())

const meProjects = async (u: TestUser) => ((await (await req(h, 'GET', '/api/me', u.headers)).json()) as MeResponse).projects.map((p) => p.code)

describe('Administracja → Projekty', () => {
  it('lista zawiera projekt z CRM z kodem oferty', async () => {
    const list = (await (await req(h, 'GET', '/api/admin/projects', admin.headers)).json()) as ProjectAdminDto[]
    expect(list.find((p) => p.id === SEED_PROJECT_ID)).toMatchObject({ code: 'OF14', opportunityCode: 'OF14', archived: false })
    expect((await req(h, 'GET', '/api/admin/projects', staff.headers)).status).toBe(403)
  })

  it('nowy projekt wewnętrzny bez CRM: widoczny w menu; kod unikalny bez względu na wielkość liter', async () => {
    const body = { code: 'WEW-BIURO', name: 'Koszty biura', client: 'Envcheck', contractEndDate: '2026-12-31' }
    const r = await req(h, 'POST', '/api/admin/projects', admin.headers, body)
    expect(r.status).toBe(201)
    expect(await r.json()).toMatchObject({ code: 'WEW-BIURO', contractNo: '-', procurementNo: '-', opportunityCode: null })
    expect((await req(h, 'POST', '/api/admin/projects', admin.headers, { ...body, code: 'wew-biuro' })).status).toBe(409)
    expect((await req(h, 'POST', '/api/admin/projects', admin.headers, { ...body, code: 'zły kod' })).status).toBe(422)
    expect(await meProjects(staff)).toContain('WEW-BIURO')
  })

  it('edycja z kontrolą wersji; archiwizacja ukrywa projekt, przywrócenie go wraca', async () => {
    const list = (await (await req(h, 'GET', '/api/admin/projects', admin.headers)).json()) as ProjectAdminDto[]
    const p = list.find((x) => x.code === 'WEW-BIURO')!
    const e = await req(h, 'PATCH', `/api/admin/projects/${p.id}`, admin.headers, { name: 'Biuro i administracja', contractValue: 1000, version: p.version })
    expect(e.status).toBe(200)
    const edited = (await e.json()) as ProjectAdminDto
    expect(edited).toMatchObject({ name: 'Biuro i administracja', contractValue: 1000, code: 'WEW-BIURO' })
    expect((await req(h, 'PATCH', `/api/admin/projects/${p.id}`, admin.headers, { name: 'x', version: p.version })).status).toBe(409)

    expect(((await (await req(h, 'POST', `/api/admin/projects/${p.id}/archive`, admin.headers)).json()) as ProjectAdminDto).archived).toBe(true)
    expect(await meProjects(staff)).not.toContain('WEW-BIURO')
    expect((await req(h, 'POST', `/api/admin/projects/${p.id}/archive`, admin.headers)).status).toBe(404)
    expect(((await (await req(h, 'POST', `/api/admin/projects/${p.id}/restore`, admin.headers)).json()) as ProjectAdminDto).archived).toBe(false)
    expect(await meProjects(staff)).toContain('WEW-BIURO')
  })
})
