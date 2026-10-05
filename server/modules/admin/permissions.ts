import { z } from '@hono/zod-openapi'
import { and, eq, sql } from 'drizzle-orm'
import { ROLES, mfaPolicyInput, permissionsUpdateInput, type Role } from '#shared'
import { appSettings, permissions } from '../../db/schema.ts'
import { HttpProblem } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { MFA_SETTING_KEY, mfaRequiredRoles } from '../../auth/access.ts'
import { writeAudit } from '../audit/service.ts'

export const adminPermissionsRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }

/** Uprawnienia, których Admin nie może sobie odebrać (ochrona przed zablokowaniem panelu). */
const ADMIN_LOCKED = new Set(['admin:view', 'admin:edit'])

adminPermissionsRouter.openapi(
  secureRoute('/admin', { method: 'get', path: '/permissions', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const rows = await c.get('deps').db.select().from(permissions)
    return c.json(rows.map(({ role, module, action, allowed }) => ({ role, module, action, allowed })), 200)
  },
)

adminPermissionsRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'put', path: '/permissions', request: { body: body(permissionsUpdateInput) }, responses: ok },
    { permission: { module: 'admin', action: 'edit' } },
  ),
  async (c) => {
    const { entries } = c.req.valid('json')
    for (const e of entries) {
      if (e.role === 'Admin' && !e.allowed && ADMIN_LOCKED.has(`${e.module}:${e.action}`)) {
        throw new HttpProblem(422, 'cannot_revoke_admin_core', `${e.module}:${e.action}`)
      }
    }
    const deps = c.get('deps')
    const me = c.get('user').id
    const changes = await deps.db.transaction(async (tx) => {
      const diff: { role: Role; module: string; action: string; old: boolean | null; new: boolean }[] = []
      for (const e of entries) {
        const [prev] = await tx
          .select({ allowed: permissions.allowed })
          .from(permissions)
          .where(and(eq(permissions.role, e.role), eq(permissions.module, e.module), eq(permissions.action, e.action)))
        if (prev?.allowed === e.allowed) continue
        await tx
          .insert(permissions)
          .values({ ...e, updatedBy: me })
          .onConflictDoUpdate({
            target: [permissions.role, permissions.module, permissions.action],
            set: { allowed: e.allowed, updatedBy: me, updatedAt: sql`now()` },
          })
        diff.push({ role: e.role, module: e.module, action: e.action, old: prev?.allowed ?? null, new: e.allowed })
      }
      if (diff.length) await writeAudit(c, { action: 'permissions.update', entity: 'permissions', changes: diff }, tx)
      return diff
    })
    return c.json({ changed: changes.length }, 200)
  },
)

adminPermissionsRouter.openapi(
  secureRoute('/admin', { method: 'get', path: '/settings/mfa', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => c.json({ requiredRoles: await mfaRequiredRoles(c.get('deps').db), allRoles: ROLES }, 200),
)

adminPermissionsRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'put', path: '/settings/mfa', request: { body: body(mfaPolicyInput) }, responses: ok },
    { permission: { module: 'admin', action: 'edit' } },
  ),
  async (c) => {
    const { requiredRoles } = c.req.valid('json')
    const deps = c.get('deps')
    const before = await mfaRequiredRoles(deps.db)
    const value = [...new Set(requiredRoles)]
    await deps.db.transaction(async (tx) => {
      await tx
        .insert(appSettings)
        .values({ key: MFA_SETTING_KEY, value, updatedBy: c.get('user').id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: c.get('user').id } })
      await writeAudit(c, { action: 'settings.mfa_policy', entity: 'app_settings', entityId: MFA_SETTING_KEY, changes: { old: before, new: value } }, tx)
    })
    return c.json({ requiredRoles: value }, 200)
  },
)
