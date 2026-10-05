import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_LEVELS, ROLES, defaultPermissionEntries, type Role } from '#shared'
import { ROUTE_POLICIES } from './app.ts'
import { createUser, req, startHarness, type Harness, type TestUser } from './test/harness.ts'

/**
 * Test macierzy ról (sekcja 10): KAŻDY zarejestrowany endpoint × KAŻDA rola.
 * Oczekiwanie wyprowadzone z domyślnej macierzy: dozwolone → status ≠ 401/403, niedozwolone → 403.
 * Nowe trasy trafiają tu automatycznie przez `secureRoute`.
 */
let h: Harness
const users = {} as Record<Role, TestUser>
beforeAll(async () => {
  h = await startHarness()
  for (const role of ROLES) users[role] = await createUser(h, role)
})
afterAll(() => h.stop())

const allowed = new Set(defaultPermissionEntries().filter((e) => e.allowed).map((e) => `${e.role}|${e.module}|${e.action}`))

const policies = ROUTE_POLICIES.filter((p) => p.path !== '/api/health')

describe('macierz ról × endpointy', () => {
  it('rejestr tras nie jest pusty', () => {
    expect(policies.length).toBeGreaterThan(10)
    expect(Object.keys(DEFAULT_LEVELS).length).toBeGreaterThan(10)
  })

  for (const policy of policies) {
    for (const role of ROLES) {
      const expectAllowed = !policy.permission || allowed.has(`${role}|${policy.permission.module}|${policy.permission.action}`)
      it(`${policy.method} ${policy.path} — ${role} → ${expectAllowed ? 'dozwolone' : '403'}`, async () => {
        const path = policy.path.replace(/\{[^}]+\}/g, crypto.randomUUID())
        const body = ['POST', 'PUT', 'PATCH'].includes(policy.method) ? {} : undefined
        const res = await req(h, policy.method, path, users[role].headers, body)
        if (expectAllowed) expect([401, 403]).not.toContain(res.status)
        else expect(res.status).toBe(403)
      })
    }

    if (!policy.mfaExempt) {
      it(`${policy.method} ${policy.path} — bez sesji 2FA → 401`, async () => {
        const path = policy.path.replace(/\{[^}]+\}/g, crypto.randomUUID())
        const res = await req(h, policy.method, path, users.Admin.bareHeaders)
        expect(res.status).toBe(401)
      })
    }
  }
})
