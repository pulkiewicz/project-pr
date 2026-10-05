import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { MeResponse } from '#shared'
import { MFA_COOKIE } from './mfa-session.ts'
import { createUser, eq, req, schema, setCookieValue, startHarness, totpNow, type Harness } from '../test/harness.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(() => h.stop())
beforeEach(() => {
  h.clock.now = new Date()
})

const bearer = (sub: string, email: string) => ({ authorization: `Bearer test:${sub}:${email}` })

describe('uwierzytelnianie', () => {
  it('bez tokenu → 401 problem+json', async () => {
    const res = await req(h, 'GET', '/api/me', {})
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect(await res.json()).toMatchObject({ status: 401, code: 'missing_token' })
  })

  it('nieprawidłowy token → 401', async () => {
    const res = await req(h, 'GET', '/api/me', { authorization: 'Bearer garbage' })
    expect(res.status).toBe(401)
  })

  it('użytkownik Identity bez rekordu w users → 403', async () => {
    const res = await req(h, 'GET', '/api/me', bearer('stranger', 'stranger@example.test'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'user_not_registered' })
  })

  it('nieaktywny użytkownik → 403', async () => {
    const u = await createUser(h, 'Arsanit', { active: false })
    const res = await req(h, 'GET', '/api/me', u.headers)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'user_inactive' })
  })

  it('bootstrap: pierwszy Admin tworzony dla BOOTSTRAP_ADMIN_EMAIL, tylko gdy brak Admina', async () => {
    const res = await req(h, 'GET', '/api/me', bearer('boot-sub', 'Krzysztof@envcheck.test'))
    expect(res.status).toBe(200)
    const me = (await res.json()) as MeResponse
    expect(me.user.role).toBe('Admin')
    expect(me.user.party).toBe('Envcheck')
    expect(me.mfa).toEqual({ required: true, enrolled: false, verified: false })
    expect(me.permissions).toEqual([]) // brak uprawnień przed 2FA
    expect(me.projects).toEqual([])

    // Drugi raz z innym sub — Admin już istnieje, więc brak bootstrapu.
    const again = await req(h, 'GET', '/api/me', bearer('other-sub', 'krzysztof@envcheck.test'))
    expect(again.status).toBe(403)
  })

  it('zaproszony użytkownik jest wiązany z Identity po e-mailu przy pierwszym żądaniu', async () => {
    const [row] = await h.db
      .insert(schema.users)
      .values({ email: 'Kamil@Envcheck.test', name: 'Kamil', role: 'EnvcheckInternal', party: 'Envcheck' })
      .returning()
    const res = await req(h, 'GET', '/api/me', bearer('kamil-sub', 'kamil@envcheck.test'))
    expect(res.status).toBe(200)
    const [linked] = await h.db.select().from(schema.users).where(eq(schema.users.id, row!.id))
    expect(linked!.identitySub).toBe('kamil-sub')
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'user.identity_linked'))
    expect(audit.some((a) => a.entityId === row!.id)).toBe(true)
  })
})

describe('2FA TOTP', () => {
  it('endpoint chroniony bez sesji 2FA → 401 mfa_required', async () => {
    const admin = await createUser(h, 'Admin')
    const res = await req(h, 'GET', '/api/admin/users', admin.bareHeaders)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'mfa_required' })
  })

  it('pełny przebieg: setup → enable → kody zapasowe → dostęp', async () => {
    const [row] = await h.db
      .insert(schema.users)
      .values({ identitySub: 'new-admin', email: 'na@example.test', name: 'NA', role: 'Admin', party: 'Envcheck' })
      .returning()
    const headers = bearer('new-admin', 'na@example.test')

    const blocked = await req(h, 'GET', '/api/admin/users', headers)
    expect(await blocked.json()).toMatchObject({ code: 'mfa_enrollment_required' })

    const setup = await req(h, 'POST', '/api/mfa/setup', headers)
    expect(setup.status).toBe(200)
    const { qrDataUrl, manualKey } = (await setup.json()) as { qrDataUrl: string; manualKey: string }
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/)
    const secret = manualKey.replace(/\s/g, '')

    const bad = await req(h, 'POST', '/api/mfa/enable', headers, { code: '000000' })
    expect(bad.status).toBe(422)

    const code = await totpNow(secret, h.clock.now)
    const enable = await req(h, 'POST', '/api/mfa/enable', headers, { code })
    expect(enable.status).toBe(200)
    const { recoveryCodes } = (await enable.json()) as { recoveryCodes: string[] }
    expect(recoveryCodes).toHaveLength(10)
    const cookie = setCookieValue(enable, MFA_COOKIE)
    expect(cookie).toBeTruthy()
    const setCookie = enable.headers.getSetCookie().join(';')
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/SameSite=Strict/)
    expect(setCookie).toMatch(/Secure/)

    const [stored] = await h.db.select().from(schema.users).where(eq(schema.users.id, row!.id))
    expect(stored!.totpSecretEnc).not.toContain(secret) // sekret zaszyfrowany
    expect(stored!.recoveryCodesHash).not.toContain(recoveryCodes[0])

    const ok = await req(h, 'GET', '/api/admin/users', { ...headers, cookie: `${MFA_COOKIE}=${cookie}` })
    expect(ok.status).toBe(200)
  })

  it('cookie 2FA innego użytkownika (inny sub) nie działa', async () => {
    const a = await createUser(h, 'Admin')
    const b = await createUser(h, 'Admin')
    const res = await req(h, 'GET', '/api/admin/users', { authorization: a.bareHeaders.authorization!, cookie: b.headers.cookie! })
    expect(res.status).toBe(401)
  })

  it('cookie 2FA wygasa po 12 h nawet przy aktywności', async () => {
    const a = await createUser(h, 'Admin')
    h.clock.now = new Date(h.clock.now.getTime() + 12 * 3600_000 + 1000)
    const res = await req(h, 'GET', '/api/admin/users', a.headers)
    expect(res.status).toBe(401)
  })

  it('weryfikacja kodem TOTP i kodem zapasowym (jednorazowym)', async () => {
    const u = await createUser(h, 'Arsanit')
    const res = await req(h, 'POST', '/api/mfa/verify', u.bareHeaders, { code: await totpNow(u.totpSecret, h.clock.now) })
    expect(res.status).toBe(200)
    expect(setCookieValue(res, MFA_COOKIE)).toBeTruthy()

    // Ustaw kody zapasowe i zużyj jeden.
    const { generateRecoveryCodes, hashRecoveryCode } = await import('./totp.ts')
    const codes = generateRecoveryCodes()
    await h.db.update(schema.users).set({ recoveryCodesHash: codes.map(hashRecoveryCode) }).where(eq(schema.users.id, u.id))
    const r1 = await req(h, 'POST', '/api/mfa/verify', u.bareHeaders, { recoveryCode: codes[0] })
    expect(r1.status).toBe(200)
    const r2 = await req(h, 'POST', '/api/mfa/verify', u.bareHeaders, { recoveryCode: codes[0] })
    expect(r2.status).toBe(422)
  })

  it('blokada po 5 nieudanych próbach na 15 min', async () => {
    const u = await createUser(h, 'Client')
    for (let i = 0; i < 5; i++) {
      const r = await req(h, 'POST', '/api/mfa/verify', u.bareHeaders, { code: '000000' })
      expect(r.status).toBe(422)
    }
    const good = await totpNow(u.totpSecret, h.clock.now)
    const locked = await req(h, 'POST', '/api/mfa/verify', u.bareHeaders, { code: good })
    expect(locked.status).toBe(429)
    expect(locked.headers.get('retry-after')).toBeTruthy()

    h.clock.now = new Date(h.clock.now.getTime() + 15 * 60_000 + 1000)
    const after = await req(h, 'POST', '/api/mfa/verify', u.bareHeaders, { code: await totpNow(u.totpSecret, h.clock.now) })
    expect(after.status).toBe(200)

    const failures = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'auth.mfa_verify_failure'))
    expect(failures.filter((f) => f.userId === u.id)).toHaveLength(5)
  })

  it('wymóg 2FA konfigurowalny per rola', async () => {
    const admin = await createUser(h, 'Admin')
    const client = await createUser(h, 'Client')
    const off = await req(h, 'PUT', '/api/admin/settings/mfa', admin.headers, {
      requiredRoles: ['Admin', 'EnvcheckInternal', 'Arsanit', 'Subcontractor'],
    })
    expect(off.status).toBe(200)
    const me = (await (await req(h, 'GET', '/api/me', client.bareHeaders)).json()) as MeResponse
    expect(me.mfa.required).toBe(false)
    expect(me.permissions).toContain('dashboard:view')
    // przywróć domyślne
    await req(h, 'PUT', '/api/admin/settings/mfa', admin.headers, {
      requiredRoles: ['Admin', 'EnvcheckInternal', 'Arsanit', 'Client', 'Subcontractor'],
    })
  })

  it('reset 2FA przez Admina trafia do audit log', async () => {
    const admin = await createUser(h, 'Admin')
    const victim = await createUser(h, 'Arsanit')
    const res = await req(h, 'POST', `/api/admin/users/${victim.id}/reset-mfa`, admin.headers)
    expect(res.status).toBe(200)
    const [u] = await h.db.select().from(schema.users).where(eq(schema.users.id, victim.id))
    expect(u!.totpEnabled).toBe(false)
    const audit = await h.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'auth.mfa_reset'))
    expect(audit.some((a) => a.entityId === victim.id && a.userId === admin.id)).toBe(true)
  })
})
