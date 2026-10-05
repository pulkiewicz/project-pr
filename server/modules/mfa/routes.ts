import { z } from '@hono/zod-openapi'
import { eq, sql } from 'drizzle-orm'
import { mfaEnableInput, mfaVerifyInput } from '#shared'
import type { Context } from 'hono'
import type { AppEnv } from '../../context.ts'
import { users } from '../../db/schema.ts'
import { decryptField, encryptField } from '../../lib/field-crypto.ts'
import { HttpProblem } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { LOCK_MINUTES, lockedForSeconds, recordAttempt } from '../../auth/rate-limit.ts'
import { clearMfaCookieHeader, mfaCookieHeader, signMfaSession } from '../../auth/mfa-session.ts'
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  newTotpSecret,
  totpEnrollment,
  verifyTotp,
} from '../../auth/totp.ts'
import { requestMeta, writeAudit } from '../audit/service.ts'

export const mfaRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }

const now = (c: Context<AppEnv>) => c.get('deps').now?.() ?? new Date()

async function ensureNotLocked(c: Context<AppEnv>, kind: string) {
  const seconds = await lockedForSeconds(c.get('deps').db, c.get('user').id, kind, now(c))
  if (seconds > 0) {
    c.header('Retry-After', String(seconds))
    throw new HttpProblem(429, 'mfa_locked', `Zablokowano na ${LOCK_MINUTES} min po 5 nieudanych próbach`, { retryAfter: seconds })
  }
}

async function issueSession(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const nowSec = Math.floor(now(c).getTime() / 1000)
  const { token, maxAge } = await signMfaSession(deps.config.mfaSecret, c.get('identity').sub, nowSec, nowSec)
  c.header('Set-Cookie', mfaCookieHeader(token, maxAge, deps.config.secureCookies), { append: true })
  await deps.db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, c.get('user').id))
}

// --- konfiguracja TOTP (pierwsze logowanie) ---
const setupRoute = secureRoute(
  '/mfa',
  { method: 'post', path: '/setup', responses: ok },
  { permission: null, mfaExempt: true },
)
mfaRouter.openapi(setupRoute, async (c) => {
  const user = c.get('user')
  if (user.totpEnabled) throw new HttpProblem(409, 'mfa_already_enrolled')
  const deps = c.get('deps')
  const secret = newTotpSecret()
  await deps.db
    .update(users)
    .set({ totpPendingEnc: encryptField(deps.config.keyring, secret) })
    .where(eq(users.id, user.id))
  await writeAudit(c, { action: 'auth.mfa_setup_started', entity: 'users', entityId: user.id })
  return c.json(await totpEnrollment(secret, user.email), 200)
})

const enableRoute = secureRoute(
  '/mfa',
  { method: 'post', path: '/enable', request: { body: body(mfaEnableInput) }, responses: ok },
  { permission: null, mfaExempt: true },
)
mfaRouter.openapi(enableRoute, async (c) => {
  const user = c.get('user')
  const deps = c.get('deps')
  if (user.totpEnabled) throw new HttpProblem(409, 'mfa_already_enrolled')
  if (!user.totpPendingEnc) throw new HttpProblem(409, 'mfa_setup_not_started')
  await ensureNotLocked(c, 'mfa')
  const { code } = c.req.valid('json')
  const secret = decryptField(deps.config.keyring, user.totpPendingEnc)
  const valid = await verifyTotp(secret, code, now(c))
  await recordAttempt(deps.db, user.id, 'mfa', valid, requestMeta(c).ip)
  await writeAudit(c, { action: valid ? 'auth.mfa_enabled' : 'auth.mfa_enable_failed', entity: 'users', entityId: user.id })
  if (!valid) throw new HttpProblem(422, 'mfa_invalid_code')

  const recoveryCodes = generateRecoveryCodes()
  await deps.db
    .update(users)
    .set({
      totpSecretEnc: user.totpPendingEnc,
      totpPendingEnc: null,
      totpEnabled: true,
      recoveryCodesHash: recoveryCodes.map(hashRecoveryCode),
      version: sql`${users.version} + 1`,
    })
    .where(eq(users.id, user.id))
  await issueSession(c)
  return c.json({ recoveryCodes }, 200)
})

// --- weryfikacja przy logowaniu ---
const verifyRoute = secureRoute(
  '/mfa',
  { method: 'post', path: '/verify', request: { body: body(mfaVerifyInput) }, responses: ok },
  { permission: null, mfaExempt: true },
)
mfaRouter.openapi(verifyRoute, async (c) => {
  const user = c.get('user')
  const deps = c.get('deps')
  if (!user.totpEnabled || !user.totpSecretEnc) throw new HttpProblem(409, 'mfa_not_enrolled')
  await ensureNotLocked(c, 'mfa')
  const input = c.req.valid('json')

  let valid = false
  let method: 'totp' | 'recovery' = 'totp'
  if ('code' in input) {
    valid = await verifyTotp(decryptField(deps.config.keyring, user.totpSecretEnc), input.code, now(c))
  } else {
    method = 'recovery'
    const remaining = consumeRecoveryCode(user.recoveryCodesHash ?? [], input.recoveryCode)
    if (remaining) {
      valid = true
      await deps.db.update(users).set({ recoveryCodesHash: remaining }).where(eq(users.id, user.id))
    }
  }
  await recordAttempt(deps.db, user.id, 'mfa', valid, requestMeta(c).ip)
  await writeAudit(c, {
    action: valid ? 'auth.mfa_verify_success' : 'auth.mfa_verify_failure',
    entity: 'users',
    entityId: user.id,
    changes: { method },
  })
  if (!valid) throw new HttpProblem(422, 'mfa_invalid_code')
  await issueSession(c)
  return c.json({ ok: true, recoveryCodesLeft: method === 'recovery' ? undefined : (user.recoveryCodesHash ?? []).length }, 200)
})

const logoutRoute = secureRoute(
  '/mfa',
  { method: 'post', path: '/logout', responses: ok },
  { permission: null, mfaExempt: true },
)
mfaRouter.openapi(logoutRoute, async (c) => {
  c.header('Set-Cookie', clearMfaCookieHeader(c.get('deps').config.secureCookies), { append: true })
  await writeAudit(c, { action: 'auth.logout', entity: 'users', entityId: c.get('user').id })
  return c.json({ ok: true }, 200)
})
