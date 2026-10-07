import { z } from '@hono/zod-openapi'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { defaultPartyForRole, inviteUserInput, updateUserInput, type InviteStatus, type Party, type UserCreatedResponse, type UserDto } from '#shared'
import type { UserRow } from '../../context.ts'
import { users } from '../../db/schema.ts'
import { HttpProblem, conflict, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'

export const adminUsersRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })

const ALREADY_REGISTERED = /already (been )?registered|already exists|422/i

/** Zaproszenie Identity: „konto już istnieje” = sukces (osoba loguje się swoim hasłem, wiązanie po e-mailu). */
async function tryInvite(identityAdmin: { invite(email: string, name: string): Promise<void> }, email: string, name: string): Promise<{ status: InviteStatus; error: string | null }> {
  try {
    await identityAdmin.invite(email, name)
    return { status: 'sent', error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (ALREADY_REGISTERED.test(message)) return { status: 'exists', error: null }
    console.error('[pmo] identity invite failed', message)
    return { status: 'failed', error: message.slice(0, 300) }
  }
}

async function inviteOrFail(identityAdmin: { invite(email: string, name: string): Promise<void> }, email: string, name: string) {
  const r = await tryInvite(identityAdmin, email, name)
  if (r.status === 'failed') throw new HttpProblem(502, 'identity_invite_failed', r.error ?? undefined)
  return r
}

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    party: u.party as Party,
    subcontractorId: u.subcontractorId,
    isActive: u.isActive,
    totpEnabled: u.totpEnabled,
    invitedAt: u.invitedAt,
    lastLoginAt: u.lastLoginAt,
    identityLinked: !!u.identitySub,
    version: u.version,
  }
}


adminUsersRouter.openapi(
  secureRoute('/admin', { method: 'get', path: '/users', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const rows = await c.get('deps').db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.name))
    return c.json(rows.map(toUserDto), 200)
  },
)

adminUsersRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'post', path: '/users', request: { body: body(inviteUserInput) }, responses: { 201: { description: 'Zaproszono', ...json(z.any()) } } },
    { permission: { module: 'admin', action: 'create' } },
  ),
  async (c) => {
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const [existing] = await deps.db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${input.email})`, isNull(users.deletedAt)))
    if (existing) throw new HttpProblem(409, 'user_exists')

    const created = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          role: input.role,
          party: defaultPartyForRole(input.role, input.subcontractorId),
          subcontractorId: input.subcontractorId ?? null,
          invitedAt: sql`now()`,
          createdBy: c.get('user').id,
          updatedBy: c.get('user').id,
        })
        .returning()
      await writeAudit(c, { action: 'user.invite', entity: 'users', entityId: row!.id, changes: { email: input.email, role: input.role } }, tx)
      return row!
    })
    // Rekord w aplikacji powstaje niezależnie od wysyłki zaproszenia — konto wiąże się po e-mailu przy pierwszym logowaniu.
    const invite = input.sendInvite ? await tryInvite(deps.identityAdmin, input.email, input.name) : { status: 'skipped' as const, error: null }
    await writeAudit(c, { action: 'user.invite_result', entity: 'users', entityId: created.id, changes: invite })
    return c.json({ ...toUserDto(created), inviteStatus: invite.status, inviteError: invite.error } satisfies UserCreatedResponse, 201)
  },
)

adminUsersRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'patch', path: '/users/{id}', request: { params: idParam, body: body(updateUserInput) }, responses: ok },
    { permission: { module: 'admin', action: 'edit' } },
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const me = c.get('user')
    const [current] = await deps.db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt)))
    if (!current) throw notFound()
    if (current.version !== input.version) throw conflict(toUserDto(current))
    if (id === me.id && ((input.role && input.role !== 'Admin') || input.isActive === false)) {
      throw new HttpProblem(422, 'cannot_demote_self')
    }

    const role = input.role ?? current.role
    const subcontractorId = input.subcontractorId !== undefined ? input.subcontractorId : current.subcontractorId
    if (role === 'Subcontractor' && !subcontractorId) throw new HttpProblem(422, 'validation.subcontractorRequired')
    const patch = {
      name: input.name ?? current.name,
      role,
      subcontractorId: role === 'Subcontractor' ? subcontractorId : null,
      party: defaultPartyForRole(role, subcontractorId),
      isActive: input.isActive ?? current.isActive,
    }

    const updated = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ ...patch, version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: me.id })
        .where(and(eq(users.id, id), eq(users.version, input.version)))
        .returning()
      if (!row) return null
      await writeAudit(c, { action: 'user.update', entity: 'users', entityId: id, changes: diffFields(current, patch, []) }, tx)
      return row
    })
    if (!updated) {
      const [fresh] = await deps.db.select().from(users).where(eq(users.id, id))
      throw conflict(fresh ? toUserDto(fresh) : null)
    }
    return c.json(toUserDto(updated), 200)
  },
)

adminUsersRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'post', path: '/users/{id}/reset-mfa', request: { params: idParam }, responses: ok },
    { permission: { module: 'admin', action: 'edit' } },
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const deps = c.get('deps')
    const updated = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          totpSecretEnc: null,
          totpPendingEnc: null,
          totpEnabled: false,
          recoveryCodesHash: null,
          version: sql`${users.version} + 1`,
          updatedAt: sql`now()`,
          updatedBy: c.get('user').id,
        })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning()
      if (row) await writeAudit(c, { action: 'auth.mfa_reset', entity: 'users', entityId: id }, tx)
      return row
    })
    if (!updated) throw notFound()
    return c.json(toUserDto(updated), 200)
  },
)

adminUsersRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'post', path: '/users/{id}/resend-invite', request: { params: idParam }, responses: ok },
    { permission: { module: 'admin', action: 'create' } },
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const deps = c.get('deps')
    const [user] = await deps.db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt)))
    if (!user) throw notFound()
    if (user.identitySub) throw new HttpProblem(409, 'user_already_linked')
    const r = await inviteOrFail(deps.identityAdmin, user.email, user.name)
    await deps.db.update(users).set({ invitedAt: sql`now()` }).where(eq(users.id, id))
    await writeAudit(c, { action: 'user.invite_resent', entity: 'users', entityId: id, changes: r })
    return c.json({ ok: true, inviteStatus: r.status }, 200)
  },
)
