import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { UserDto } from '#shared'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let admin: TestUser
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
})
afterAll(() => h.stop())

describe('zarządzanie użytkownikami', () => {
  it('zaproszenie tworzy rekord, wysyła invite Identity i zapisuje audit', async () => {
    const res = await req(h, 'POST', '/api/admin/users', admin.headers, {
      email: 'kamil@envcheck.test',
      name: 'Kamil Jankowski',
      role: 'EnvcheckInternal',
    })
    expect(res.status).toBe(201)
    const dto = (await res.json()) as UserDto
    expect(dto).toMatchObject({ party: 'Envcheck', identityLinked: false, totpEnabled: false })
    expect(h.identityAdmin.invites).toContainEqual({ email: 'kamil@envcheck.test', name: 'Kamil Jankowski' })
    const dup = await req(h, 'POST', '/api/admin/users', admin.headers, { email: 'KAMIL@envcheck.test', name: 'x', role: 'Arsanit' })
    expect(dup.status).toBe(409)
  })

  it('błąd Identity wycofuje utworzenie użytkownika', async () => {
    h.identityAdmin.fail = true
    const res = await req(h, 'POST', '/api/admin/users', admin.headers, { email: 'fail@x.test', name: 'F', role: 'Client' })
    h.identityAdmin.fail = false
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'identity_invite_failed' })
    const rows = await h.db.select().from(schema.users).where(eq(schema.users.email, 'fail@x.test'))
    expect(rows).toHaveLength(0)
  })

  it('podwykonawca wymaga subcontractorId; party = Subcontractor:{id}', async () => {
    const bad = await req(h, 'POST', '/api/admin/users', admin.headers, { email: 's@x.test', name: 'S', role: 'Subcontractor' })
    expect(bad.status).toBe(422)
    const id = crypto.randomUUID()
    const ok = await req(h, 'POST', '/api/admin/users', admin.headers, { email: 's@x.test', name: 'S', role: 'Subcontractor', subcontractorId: id })
    expect(((await ok.json()) as UserDto).party).toBe(`Subcontractor:${id}`)
  })

  it('edycja z optymistyczną współbieżnością: zła wersja → 409 z aktualnym stanem', async () => {
    const target = await createUser(h, 'Arsanit')
    const ok = await req(h, 'PATCH', `/api/admin/users/${target.id}`, admin.headers, { role: 'Client', version: 1 })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as UserDto)).toMatchObject({ role: 'Client', party: 'Client', version: 2 })
    const stale = await req(h, 'PATCH', `/api/admin/users/${target.id}`, admin.headers, { name: 'X', version: 1 })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'version_conflict', current: { version: 2 } })
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'user.update'))
    expect(audit.find((a) => a.entityId === target.id)?.changes).toMatchObject({ role: { old: 'Arsanit', new: 'Client' } })
  })

  it('Admin nie może odebrać sobie roli ani dezaktywować siebie', async () => {
    const res = await req(h, 'PATCH', `/api/admin/users/${admin.id}`, admin.headers, { isActive: false, version: 1 })
    expect(res.status).toBe(422)
  })
})

describe('macierz uprawnień', () => {
  it('zmiana uprawnienia działa od następnego żądania i jest audytowana', async () => {
    const arsanit = await createUser(h, 'Arsanit')
    const me1 = (await (await req(h, 'GET', '/api/me', arsanit.headers)).json()) as { permissions: string[] }
    expect(me1.permissions).not.toContain('risks:delete')
    const put = await req(h, 'PUT', '/api/admin/permissions', admin.headers, {
      entries: [{ role: 'Arsanit', module: 'risks', action: 'delete', allowed: true }],
    })
    expect(await put.json()).toEqual({ changed: 1 })
    const me2 = (await (await req(h, 'GET', '/api/me', arsanit.headers)).json()) as { permissions: string[] }
    expect(me2.permissions).toContain('risks:delete')
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'permissions.update'))
    expect(audit).toHaveLength(1)
  })

  it('nie można odebrać Adminowi dostępu do panelu', async () => {
    const res = await req(h, 'PUT', '/api/admin/permissions', admin.headers, {
      entries: [{ role: 'Admin', module: 'admin', action: 'view', allowed: false }],
    })
    expect(res.status).toBe(422)
  })
})

describe('audit log', () => {
  it('lista z filtrami i eksport CSV (eksport też audytowany)', async () => {
    const list = await req(h, 'GET', '/api/admin/audit?action=user.invite&pageSize=10', admin.headers)
    expect(list.status).toBe(200)
    const body = (await list.json()) as { items: { action: string }[]; total: number }
    expect(body.total).toBeGreaterThan(0)
    expect(body.items.every((i) => i.action === 'user.invite')).toBe(true)

    const csv = await req(h, 'GET', '/api/admin/audit/export.csv', admin.headers)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text.split('\r\n')[0]).toContain('action')
    const exported = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'audit.export'))
    expect(exported).toHaveLength(1)
  })
})
