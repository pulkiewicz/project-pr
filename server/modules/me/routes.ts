import { z } from '@hono/zod-openapi'
import { isNull } from 'drizzle-orm'
import type { MeResponse, Party, PermissionSet } from '#shared'
import { projects } from '../../db/schema.ts'
import { newRouter, secureRoute } from '../../routing.ts'

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
  const fullAccess = !mfa.required || mfa.verified
  const projectRows = fullAccess ? await c.get('deps').db.select().from(projects).where(isNull(projects.deletedAt)) : []
  const body: MeResponse = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, party: user.party as Party },
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
