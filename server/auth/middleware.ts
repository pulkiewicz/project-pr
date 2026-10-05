import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Action, ModuleKey } from '#shared'
import type { AppEnv } from '../context.ts'
import { HttpProblem, forbidden, unauthorized } from '../lib/problem.ts'
import { writeAudit } from '../modules/audit/service.ts'
import { loadPermissions, mfaRequiredRoles, resolveUser } from './access.ts'
import { MFA_COOKIE, mfaCookieHeader, shouldRefresh, signMfaSession, verifyMfaSession } from './mfa-session.ts'

const nowSec = (c: Parameters<MiddlewareHandler<AppEnv>>[0]) =>
  Math.floor((c.get('deps').now?.() ?? new Date()).getTime() / 1000)

/**
 * Warstwa 1: JWT Identity (Bearer) → aktywny użytkownik w `users` → stan 2FA → uprawnienia roli.
 * Wymagany nagłówek Authorization jest jednocześnie ochroną CSRF dla cookie `pmo_mfa`.
 */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get('deps')
  const header = c.req.header('authorization')
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw unauthorized('missing_token')
  const claims = await deps.identity.verify(token, new URL(c.req.url).origin)
  if (!claims) throw unauthorized('invalid_token')
  c.set('identity', claims)

  const resolved = await resolveUser(deps.db, claims, deps.config.bootstrapAdminEmail)
  if (resolved.kind === 'not_registered') throw forbidden('user_not_registered')
  if (resolved.kind === 'inactive') throw forbidden('user_inactive')
  const user = resolved.user
  c.set('user', user)
  if (resolved.linked) await writeAudit(c, { action: 'user.identity_linked', entity: 'users', entityId: user.id })

  // Równolegle: polityka 2FA i uprawnienia roli (uprawnienia odrzucane, jeśli sesja 2FA nie jest ważna).
  const [requiredRoles, rolePermissions] = await Promise.all([mfaRequiredRoles(deps.db), loadPermissions(deps.db, user.role)])
  const required = requiredRoles.includes(user.role)
  let verified = false
  const cookie = getCookie(c, MFA_COOKIE)
  if (cookie) {
    const now = nowSec(c)
    const session = await verifyMfaSession(deps.config.mfaSecret, cookie, now)
    if (session && session.sub === claims.sub) {
      verified = true
      if (shouldRefresh(session, now)) {
        const { token: fresh, maxAge } = await signMfaSession(deps.config.mfaSecret, claims.sub, session.authTime, now)
        c.header('Set-Cookie', mfaCookieHeader(fresh, maxAge, deps.config.secureCookies), { append: true })
      }
    }
  }
  c.set('mfa', { required, verified })
  c.set('permissions', !required || verified ? rolePermissions : new Set())
  await next()
}

/** Warstwa 2: ważna sesja 2FA (dla ról, które jej wymagają). */
export const requireMfa: MiddlewareHandler<AppEnv> = async (c, next) => {
  const mfa = c.get('mfa')
  if (mfa.required && !mfa.verified) {
    throw new HttpProblem(401, c.get('user').totpEnabled ? 'mfa_required' : 'mfa_enrollment_required')
  }
  await next()
}

/** Warstwa 3: rola × moduł × akcja z tabeli `permissions`. */
export function requirePermission(module: ModuleKey, action: Action): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get('permissions').has(`${module}:${action}`)) throw forbidden('permission_denied', `${module}:${action}`)
    await next()
  }
}

export function can(c: { get(k: 'permissions'): Set<string> }, module: ModuleKey, action: Action) {
  return c.get('permissions').has(`${module}:${action}`)
}
