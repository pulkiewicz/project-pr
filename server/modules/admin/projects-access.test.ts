import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and } from 'drizzle-orm'
import type { MeResponse, UserDto } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

/** Envcheck Hub R0: projekty per użytkownik i moduły sprzedaży zablokowane dla ról zewnętrznych. */
let h: Harness
let admin: TestUser
let staff: TestUser
let arsanit: TestUser
let outsider: TestUser
let otherProjectId: string
beforeAll(async () => {
  h = await startHarness()
  admin = await createUser(h, 'Admin')
  staff = await createUser(h, 'EnvcheckInternal')
  arsanit = await createUser(h, 'Arsanit')
  outsider = await createUser(h, 'Client', { projects: [] })
  const [p] = await h.db
    .insert(schema.projects)
    .values({ code: 'OF038', name: 'Komora testowa', client: 'Klient', contractNo: '-', procurementNo: '-', contractEndDate: '2027-01-31' })
    .returning()
  otherProjectId = p!.id
})
afterAll(() => h.stop())

const me = async (u: TestUser) => (await (await req(h, 'GET', '/api/me', u.headers)).json()) as MeResponse

describe('dostęp do projektów', () => {
  it('pracownik Envcheck widzi wszystkie projekty z kodem', async () => {
    for (const u of [admin, staff]) {
      const codes = (await me(u)).projects.map((p) => p.code).sort()
      expect(codes).toEqual(['OF038', 'OF14'])
    }
  })

  it('rola zewnętrzna widzi tylko przypisane projekty', async () => {
    expect((await me(arsanit)).projects.map((p) => p.code)).toEqual(['OF14'])
    expect((await me(outsider)).projects).toEqual([])
  })

  it('dane nieprzypisanego projektu → 404 (bez ujawniania istnienia)', async () => {
    expect((await req(h, 'GET', `/api/projects/${SEED_PROJECT_ID}/dashboard`, arsanit.headers)).status).toBe(200)
    expect((await req(h, 'GET', `/api/projects/${otherProjectId}/dashboard`, arsanit.headers)).status).toBe(404)
    const res = await req(h, 'GET', `/api/projects/${SEED_PROJECT_ID}/hrf/tasks`, outsider.headers)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'project_not_found' })
    expect((await req(h, 'GET', `/api/projects/${crypto.randomUUID()}/dashboard`, admin.headers)).status).toBe(404)
    expect((await req(h, 'GET', `/api/projects/${otherProjectId}/dashboard`, staff.headers)).status).toBe(200)
  })

  it('brak uprawnienia do modułu nadal daje 403, a nie 404', async () => {
    const res = await req(h, 'GET', `/api/projects/${otherProjectId}/purchases`, outsider.headers)
    expect(res.status).toBe(403)
  })
})

describe('moduły sprzedaży tylko dla pracowników Envcheck', () => {
  it('domyślnie: CRM i wyceny dla Admina i Envcheck, marża tylko Admin', async () => {
    expect((await me(admin)).permissions).toEqual(expect.arrayContaining(['crm:view', 'quotes:edit', 'quotesPricing:view', 'quoteKnowledge:edit']))
    const internal = (await me(staff)).permissions
    expect(internal).toEqual(expect.arrayContaining(['crm:view', 'crm:edit', 'quotes:create']))
    expect(internal).not.toContain('quotesPricing:view')
    expect((await me(arsanit)).permissions.some((p) => /^(crm|quotes|quotesPricing|quoteKnowledge):/.test(p))).toBe(false)
  })

  it('macierz uprawnień odrzuca nadanie modułu sprzedaży roli zewnętrznej', async () => {
    const res = await req(h, 'PUT', '/api/admin/permissions', admin.headers, { entries: [{ role: 'Arsanit', module: 'crm', action: 'view', allowed: true }] })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'staff_only_module' })
    const ok = await req(h, 'PUT', '/api/admin/permissions', admin.headers, { entries: [{ role: 'EnvcheckInternal', module: 'quotesPricing', action: 'view', allowed: true }] })
    expect(ok.status).toBe(200)
  })

  it('wpis dodany do tabeli permissions z pominięciem API nie daje dostępu', async () => {
    await h.db
      .update(schema.permissions)
      .set({ allowed: true })
      .where(and(eq(schema.permissions.role, 'Arsanit'), eq(schema.permissions.module, 'crm'), eq(schema.permissions.action, 'view')))
    expect((await me(arsanit)).permissions).not.toContain('crm:view')
  })
})

describe('przypisania w API użytkowników', () => {
  it('nowy użytkownik zewnętrzny dostaje wskazane projekty; pracownik — bez przypisań', async () => {
    const res = await req(h, 'POST', '/api/admin/users', admin.headers, { email: 'zew@x.test', name: 'Zew', role: 'Client', access: 'none', projectIds: [otherProjectId] })
    expect(res.status).toBe(201)
    const dto = (await res.json()) as UserDto
    expect(dto.projectIds).toEqual([otherProjectId])
    const emp = (await (await req(h, 'POST', '/api/admin/users', admin.headers, { email: 'pr@x.test', name: 'Pr', role: 'EnvcheckInternal', access: 'none', projectIds: [otherProjectId] })).json()) as UserDto
    expect(emp.projectIds).toEqual([])
  })

  it('zmiana przypisań i roli; nieznany projekt → 422; zmiany w audit logu', async () => {
    const created = (await (await req(h, 'POST', '/api/admin/users', admin.headers, { email: 'zmiana@x.test', name: 'Z', role: 'Arsanit', access: 'none', projectIds: [SEED_PROJECT_ID] })).json()) as UserDto
    const bad = await req(h, 'PATCH', `/api/admin/users/${created.id}`, admin.headers, { projectIds: [crypto.randomUUID()], version: created.version })
    expect(bad.status).toBe(422)
    const moved = (await (await req(h, 'PATCH', `/api/admin/users/${created.id}`, admin.headers, { projectIds: [otherProjectId], version: created.version })).json()) as UserDto
    expect(moved.projectIds).toEqual([otherProjectId])
    const kept = (await (await req(h, 'PATCH', `/api/admin/users/${created.id}`, admin.headers, { name: 'Z2', version: moved.version })).json()) as UserDto
    expect(kept.projectIds).toEqual([otherProjectId])
    const promoted = (await (await req(h, 'PATCH', `/api/admin/users/${created.id}`, admin.headers, { role: 'EnvcheckInternal', version: kept.version })).json()) as UserDto
    expect(promoted.projectIds).toEqual([])
    const audit = await h.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, created.id), eq(schema.auditLog.action, 'user.update')))
    expect(JSON.stringify(audit)).toContain('projectsAdded')
    const list = (await (await req(h, 'GET', '/api/admin/users', admin.headers)).json()) as UserDto[]
    expect(list.find((u) => u.email === 'zew@x.test')?.projectIds).toEqual([otherProjectId])
  })
})
