import { and, eq, isNull, sql } from 'drizzle-orm'
import { ROLES, defaultPartyForRole, isStaffOnlyModule, isStaffRole, type Action, type ModuleKey, type Role } from '#shared'
import type { Database } from '../db/client.ts'
import { appSettings, auditLog, permissions, projectMembers, projects, users } from '../db/schema.ts'
import type { IdentityClaims } from './identity.ts'
import type { UserRow } from '../context.ts'

export async function loadPermissions(db: Database, role: Role) {
  const rows = await db
    .select({ module: permissions.module, action: permissions.action })
    .from(permissions)
    .where(and(eq(permissions.role, role), eq(permissions.allowed, true)))
  // Moduły sprzedaży nigdy dla ról zewnętrznych — także przy ręcznie zmienionej tabeli `permissions`.
  const staff = isStaffRole(role)
  return new Set(
    rows.filter((r) => staff || !isStaffOnlyModule(r.module as ModuleKey)).map((r) => `${r.module}:${r.action}` as `${ModuleKey}:${Action}`),
  )
}

/** Projekty widoczne dla użytkownika: pracownicy Envcheck — wszystkie, role zewnętrzne — przypisane (`project_members`). */
export async function accessibleProjects(db: Database, user: Pick<UserRow, 'id' | 'role'>) {
  const active = isNull(projects.deletedAt)
  if (isStaffRole(user.role)) return db.select().from(projects).where(active).orderBy(projects.name)
  return db
    .select({ project: projects })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)))
    .where(active)
    .orderBy(projects.name)
    .then((rows) => rows.map((r) => r.project))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function canAccessProject(db: Database, user: Pick<UserRow, 'id' | 'role'>, projectId: string): Promise<boolean> {
  if (!UUID_RE.test(projectId)) return false
  const active = and(eq(projects.id, projectId), isNull(projects.deletedAt))
  if (isStaffRole(user.role)) {
    const [row] = await db.select({ id: projects.id }).from(projects).where(active)
    return !!row
  }
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)))
    .where(active)
  return !!row
}

export const MFA_SETTING_KEY = 'mfa.requiredRoles'

export async function mfaRequiredRoles(db: Database): Promise<Role[]> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, MFA_SETTING_KEY))
  // Brak ustawienia = bezpieczny domyślny: 2FA wymagane dla wszystkich ról.
  if (!row || !Array.isArray(row.value)) return [...ROLES]
  return (row.value as string[]).filter((r): r is Role => (ROLES as readonly string[]).includes(r))
}

export type ResolveResult =
  | { kind: 'ok'; user: UserRow; linked: boolean; bootstrapped: boolean }
  | { kind: 'not_registered' }
  | { kind: 'inactive' }

/**
 * Mapowanie `sub` Identity → rekord `users` (źródło prawdy o roli i party).
 * - zaproszony użytkownik (identity_sub = null) jest wiązany po e-mailu przy pierwszym żądaniu,
 * - bootstrap: pierwszy Admin tworzony dla BOOTSTRAP_ADMIN_EMAIL, tylko gdy w bazie nie ma żadnego Admina.
 */
export async function resolveUser(
  db: Database,
  claims: IdentityClaims,
  bootstrapAdminEmail?: string,
): Promise<ResolveResult> {
  const notDeleted = isNull(users.deletedAt)
  let [user] = await db.select().from(users).where(and(eq(users.identitySub, claims.sub), notDeleted))
  let linked = false
  let bootstrapped = false

  if (!user) {
    const [invited] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${claims.email})`, isNull(users.identitySub), notDeleted))
    if (invited) {
      ;[user] = await db
        .update(users)
        .set({ identitySub: claims.sub, updatedAt: sql`now()` })
        .where(and(eq(users.id, invited.id), isNull(users.identitySub)))
        .returning()
      linked = !!user
    }
  }

  if (!user && bootstrapAdminEmail && bootstrapAdminEmail.toLowerCase() === claims.email.toLowerCase()) {
    const [anyAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'Admin')).limit(1)
    if (!anyAdmin) {
      ;[user] = await db
        .insert(users)
        .values({
          identitySub: claims.sub,
          email: claims.email,
          name: claims.email,
          role: 'Admin',
          party: defaultPartyForRole('Admin'),
        })
        .onConflictDoNothing()
        .returning()
      if (user) {
        bootstrapped = true
        await db.insert(auditLog).values({ userId: user.id, action: 'user.bootstrap_admin', entity: 'users', entityId: user.id })
      }
    }
  }

  if (!user) return { kind: 'not_registered' }
  if (!user.isActive) return { kind: 'inactive' }
  return { kind: 'ok', user, linked, bootstrapped }
}
