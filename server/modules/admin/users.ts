import { z } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  defaultPartyForRole,
  isStaffRole,
  inviteUserInput,
  tempPasswordInput,
  updateUserInput,
  type InviteStatus,
  type Party,
  type Role,
  type TempPasswordResponse,
  type UserCreatedResponse,
  type UserDto,
} from '#shared'
import type { IdentityAdmin } from '../../auth/identity.ts'
import type { UserRow } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { projectMembers, projects, users } from '../../db/schema.ts'
import { generateTempPassword } from '../../lib/passwords.ts'
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

/** Konto Identity z hasłem tymczasowym (bez e-maila); błąd → status `failed`, rekord w aplikacji zostaje. */
async function trySetPassword(identityAdmin: IdentityAdmin, email: string, name: string, password: string) {
  try {
    return { status: 'password_set' as const, error: null, sub: await identityAdmin.upsertWithPassword(email, name, password) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[pmo] identity create user failed', message)
    return { status: 'failed' as const, error: message.slice(0, 300), sub: null }
  }
}

async function inviteOrFail(identityAdmin: { invite(email: string, name: string): Promise<void> }, email: string, name: string) {
  const r = await tryInvite(identityAdmin, email, name)
  if (r.status === 'failed') throw new HttpProblem(502, 'identity_invite_failed', r.error ?? undefined)
  return r
}

export function toUserDto(u: UserRow, projectIds: string[] = []): UserDto {
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
    mustChangePassword: u.mustChangePassword,
    taskReminders: u.taskReminders,
    projectIds,
    version: u.version,
  }
}

async function memberProjects(db: Database, userIds: string[]) {
  const map = new Map<string, string[]>()
  if (!userIds.length) return map
  const rows = await db.select().from(projectMembers).where(inArray(projectMembers.userId, userIds))
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r.projectId])
  return map
}

async function userDto(db: Database, u: UserRow) {
  return toUserDto(u, (await memberProjects(db, [u.id])).get(u.id) ?? [])
}

/**
 * Przypisania do projektów: role zewnętrzne — dokładnie wskazane projekty; pracownicy Envcheck widzą wszystkie,
 * więc ich przypisania są czyszczone. Zwraca różnicę do audytu albo null, gdy nic się nie zmieniło.
 */
async function setMemberships(tx: Database, userId: string, role: Role, projectIds: string[], actorId: string) {
  const wanted = isStaffRole(role) ? [] : [...new Set(projectIds)]
  if (wanted.length) {
    const found = await tx.select({ id: projects.id }).from(projects).where(and(inArray(projects.id, wanted), isNull(projects.deletedAt)))
    if (found.length !== wanted.length) throw new HttpProblem(422, 'unknown_project')
  }
  const current = (await memberProjects(tx, [userId])).get(userId) ?? []
  const added = wanted.filter((p) => !current.includes(p))
  const removed = current.filter((p) => !wanted.includes(p))
  if (removed.length) await tx.delete(projectMembers).where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, removed)))
  if (added.length) await tx.insert(projectMembers).values(added.map((projectId) => ({ projectId, userId, createdBy: actorId })))
  return added.length || removed.length ? { projectsAdded: added, projectsRemoved: removed } : null
}


adminUsersRouter.openapi(
  secureRoute('/admin', { method: 'get', path: '/users', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const db = c.get('deps').db
    const rows = await db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.name))
    const members = await memberProjects(db, rows.map((r) => r.id))
    return c.json(rows.map((u) => toUserDto(u, members.get(u.id) ?? [])), 200)
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
      const projectsChange = await setMemberships(tx, row!.id, input.role, input.projectIds, c.get('user').id)
      await writeAudit(c, { action: 'user.invite', entity: 'users', entityId: row!.id, changes: { email: input.email, role: input.role, ...projectsChange } }, tx)
      return row!
    })
    // Rekord w aplikacji powstaje niezależnie od Identity — konto wiąże się po e-mailu przy pierwszym logowaniu.
    let result: UserRow = created
    let invite: { status: InviteStatus; error: string | null }
    let initialPassword: string | null = null
    if (input.access === 'password') {
      const password = input.initialPassword ?? generateTempPassword()
      const r = await trySetPassword(deps.identityAdmin, input.email, input.name, password)
      invite = { status: r.status, error: r.error }
      if (r.sub) {
        initialPassword = password
        const [row] = await deps.db.update(users).set({ identitySub: r.sub, mustChangePassword: true }).where(eq(users.id, created.id)).returning()
        result = row!
      }
    } else if (input.access === 'invite') {
      invite = await tryInvite(deps.identityAdmin, input.email, input.name)
    } else {
      invite = { status: 'skipped', error: null }
    }
    await writeAudit(c, { action: 'user.invite_result', entity: 'users', entityId: created.id, changes: { access: input.access, ...invite } })
    return c.json({ ...(await userDto(deps.db, result)), inviteStatus: invite.status, inviteError: invite.error, initialPassword } satisfies UserCreatedResponse, 201)
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
    if (current.version !== input.version) throw conflict(await userDto(deps.db, current))
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
      taskReminders: input.taskReminders ?? current.taskReminders,
    }

    const updated = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ ...patch, version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: me.id })
        .where(and(eq(users.id, id), eq(users.version, input.version)))
        .returning()
      if (!row) return null
      // Zmiana roli na pracownika czyści przypisania; bez `projectIds` przypisania roli zewnętrznej zostają.
      const currentProjects = (await memberProjects(tx, [id])).get(id) ?? []
      const projectsChange = await setMemberships(tx, id, role, input.projectIds ?? currentProjects, me.id)
      await writeAudit(c, { action: 'user.update', entity: 'users', entityId: id, changes: { ...diffFields(current, patch, []), ...projectsChange } }, tx)
      return row
    })
    if (!updated) {
      const [fresh] = await deps.db.select().from(users).where(eq(users.id, id))
      throw conflict(fresh ? await userDto(deps.db, fresh) : null)
    }
    return c.json(await userDto(deps.db, updated), 200)
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
    return c.json(await userDto(deps.db, updated), 200)
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

adminUsersRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'post', path: '/users/{id}/temp-password', request: { params: idParam, body: body(tempPasswordInput) }, responses: ok },
    { permission: { module: 'admin', action: 'edit' } },
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const [user] = await deps.db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt)))
    if (!user) throw notFound()
    if (!user.isActive) throw new HttpProblem(422, 'target_user_inactive')
    const password = input.password ?? generateTempPassword()
    let sub: string
    try {
      sub = await deps.identityAdmin.upsertWithPassword(user.email, user.name, password)
    } catch (e) {
      throw new HttpProblem(502, 'identity_password_failed', e instanceof Error ? e.message.slice(0, 300) : undefined)
    }
    if (user.identitySub && user.identitySub !== sub) throw new HttpProblem(409, 'identity_mismatch')
    const updated = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ identitySub: sub, mustChangePassword: true, version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
        .where(eq(users.id, id))
        .returning()
      // Hasło nigdy nie trafia do audytu ani bazy.
      await writeAudit(c, { action: 'user.temp_password_set', entity: 'users', entityId: id }, tx)
      return row!
    })
    return c.json({ user: await userDto(deps.db, updated), password } satisfies TempPasswordResponse, 200)
  },
)
