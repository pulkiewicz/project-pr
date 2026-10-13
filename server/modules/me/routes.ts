import { z } from '@hono/zod-openapi'
import { eq, isNull, sql } from 'drizzle-orm'
import { changePasswordInput, type MeResponse, type Party, type PermissionSet } from '#shared'
import { IdentityError } from '../../auth/identity.ts'
import { projects, users } from '../../db/schema.ts'
import { HttpProblem } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'

export const meRouter = newRouter()

const meRoute = secureRoute(
  '',
  {
    method: 'get',
    path: '/me',
    responses: { 200: { description: 'Bieżący użytkownik, stan 2FA i uprawnienia', content: { 'application/json': { schema: z.any() } } } },
  },
  { permission: null, mfaExempt: true },
)

meRouter.openapi(meRoute, async (c) => {
  const user = c.get('user')
  const mfa = c.get('mfa')
  const perms = [...c.get('permissions')] as unknown as PermissionSet
  const fullAccess = (!mfa.required || mfa.verified) && !user.mustChangePassword
  const projectRows = fullAccess ? await c.get('deps').db.select().from(projects).where(isNull(projects.deletedAt)) : []
  const body: MeResponse = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, party: user.party as Party, mustChangePassword: user.mustChangePassword },
    mfa: { required: mfa.required, enrolled: user.totpEnabled, verified: mfa.verified },
    permissions: perms,
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      client: p.client,
      contractNo: p.contractNo,
      procurementNo: p.procurementNo,
      contractEndDate: p.contractEndDate,
      dayZeroDate: p.dayZeroDate,
    })),
  }
  return c.json(body, 200)
})

/**
 * Zmiana własnego hasła (obowiązkowa po haśle tymczasowym). Serwer wykonuje ją w GoTrue tokenem
 * użytkownika, więc flaga `mustChangePassword` jest zdejmowana dopiero po faktycznej zmianie.
 */
meRouter.openapi(
  secureRoute(
    '',
    {
      method: 'post',
      path: '/me/password',
      request: { body: { content: { 'application/json': { schema: changePasswordInput } }, required: true } },
      responses: { 200: { description: 'Hasło zmienione', content: { 'application/json': { schema: z.any() } } } },
    },
    { permission: null, mfaExempt: true },
  ),
  async (c) => {
    const user = c.get('user')
    const mfa = c.get('mfa')
    // Zwykła zmiana hasła wymaga pełnej sesji; wymuszona (hasło tymczasowe) — tylko zalogowania hasłem.
    if (!user.mustChangePassword && mfa.required && !mfa.verified) {
      throw new HttpProblem(401, user.totpEnabled ? 'mfa_required' : 'mfa_enrollment_required')
    }
    const { newPassword } = c.req.valid('json')
    const token = c.req.header('authorization')!.replace(/^Bearer\s+/i, '')
    try {
      await c.get('deps').identityAdmin.changeOwnPassword(token, newPassword, new URL(c.req.url).origin)
    } catch (e) {
      if (e instanceof IdentityError && e.status === 422) throw new HttpProblem(422, 'password_rejected', e.message.slice(0, 300))
      throw new HttpProblem(502, 'identity_password_failed', e instanceof Error ? e.message.slice(0, 300) : undefined)
    }
    await c
      .get('deps')
      .db.update(users)
      .set({ mustChangePassword: false, version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
      .where(eq(users.id, user.id))
    await writeAudit(c, { action: 'auth.password_changed', entity: 'users', entityId: user.id, changes: { forced: user.mustChangePassword } })
    return c.json({ ok: true }, 200)
  },
)
