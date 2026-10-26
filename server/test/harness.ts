import { randomBytes } from 'node:crypto'
import { NetlifyDB } from '@netlify/database-dev'
import { drizzle } from 'drizzle-orm/netlify-db'
import { eq } from 'drizzle-orm'
import { generate } from 'otplib'
import { defaultPartyForRole, isStaffRole, type Role } from '#shared'
import { createApp } from '../app.ts'
import { FakeAiClient } from '../integrations/ai/fake.ts'
import { FakeDrive } from '../integrations/drive/fake.ts'
import { FakeInfaktClient } from '../integrations/infakt/fake.ts'
import { runAiJob } from '../modules/ai/ops.ts'
import { signMfaSession, MFA_COOKIE } from '../auth/mfa-session.ts'
import { IdentityError, type IdentityAdmin, type IdentityVerifier } from '../auth/identity.ts'
import type { AppDeps } from '../context.ts'
import type { Database } from '../db/client.ts'
import * as schema from '../db/schema.ts'
import { SEED_PROJECT_ID } from '../db/seed-sql.ts'
import { encryptField, parseKeyring } from '../lib/field-crypto.ts'
import { newTotpSecret } from '../auth/totp.ts'

export const MIGRATIONS_DIR = new URL('../../netlify/database/migrations', import.meta.url).pathname

/** Token testowy: `test:<sub>:<email>` — fałszywy weryfikator Identity. */
export const fakeIdentity: IdentityVerifier = {
  async verify(token) {
    const m = token.match(/^test:([^:]+):(.+)$/)
    return m ? { sub: m[1]!, email: m[2]! } : null
  },
}

export class FakeIdentityAdmin implements IdentityAdmin {
  invites: { email: string; name: string }[] = []
  /** e-mail → { sub, password } — konta „Identity” z hasłem. */
  accounts = new Map<string, { sub: string; password: string }>()
  passwordChanges: { token: string; password: string }[] = []
  fail = false
  failWith: string | null = null
  async invite(email: string, name: string) {
    if (this.fail) throw new Error('identity down')
    if (this.failWith) throw new Error(this.failWith)
    this.invites.push({ email, name })
  }
  async upsertWithPassword(email: string, _name: string, password: string) {
    if (this.fail) throw new Error('identity down')
    const key = email.toLowerCase()
    const sub = this.accounts.get(key)?.sub ?? `sub-${key}`
    this.accounts.set(key, { sub, password })
    return sub
  }
  async changeOwnPassword(token: string, password: string) {
    if (this.fail) throw new IdentityError(422, 'Identity password change failed (422): weak')
    this.passwordChanges.push({ token, password })
  }
}

export interface Harness {
  pg: NetlifyDB
  drive: FakeDrive
  ai: FakeAiClient
  infakt: FakeInfaktClient
  db: Database
  deps: AppDeps
  app: ReturnType<typeof createApp>
  identityAdmin: FakeIdentityAdmin
  clock: { now: Date }
  stop(): Promise<void>
}

export async function startHarness(): Promise<Harness> {
  const pg = new NetlifyDB({ logger: () => {} })
  const connectionString = await pg.start()
  await pg.applyMigrations(MIGRATIONS_DIR)
  process.env.NETLIFY_DB_URL = connectionString
  process.env.NETLIFY_DB_DRIVER = 'server'
  const db = drizzle({ schema }) as unknown as Database
  const identityAdmin = new FakeIdentityAdmin()
  const clock = { now: new Date() }
  const deps: AppDeps = {
    db,
    identity: fakeIdentity,
    identityAdmin,
    config: {
      mfaSecret: randomBytes(32),
      keyring: parseKeyring(`k1:${randomBytes(32).toString('base64')}`),
      hmacKey: randomBytes(32),
      bootstrapAdminEmail: 'krzysztof@envcheck.test',
      secureCookies: true,
    },
    now: () => clock.now,
    drive: new FakeDrive(),
    ai: new FakeAiClient(),
    infakt: new FakeInfaktClient(),
  }
  // Zadania AI wykonywane od razu (bez funkcji w tle).
  deps.dispatchJob = async (jobId, token) => {
    await runAiJob(deps, jobId, token)
  }
  const app = createApp(deps)
  return {
    pg,
    drive: deps.drive as FakeDrive,
    ai: deps.ai as FakeAiClient,
    infakt: deps.infakt as FakeInfaktClient,
    db,
    deps,
    app,
    identityAdmin,
    clock,
    async stop() {
      const client = (db as unknown as { $client: { end?: () => Promise<void> } }).$client
      await client.end?.()
      await pg.stop()
    },
  }
}

export interface TestUser {
  id: string
  sub: string
  email: string
  role: Role
  totpSecret: string
  token: string
  /** Nagłówki z ważną sesją 2FA. */
  headers: Record<string, string>
  /** Nagłówki bez cookie 2FA. */
  bareHeaders: Record<string, string>
}

let seq = 0

/**
 * Użytkownik testowy. Role zewnętrzne są domyślnie przypisane do projektu z seeda (jak po migracji hub_projects);
 * `projects: []` — bez przypisań.
 */
export async function createUser(h: Harness, role: Role, opts: { subcontractorId?: string; active?: boolean; projects?: string[] } = {}): Promise<TestUser> {
  seq += 1
  const sub = `sub-${role}-${seq}`
  const email = `${role.toLowerCase()}${seq}@example.test`
  const totpSecret = newTotpSecret()
  const subcontractorId = role === 'Subcontractor' ? (opts.subcontractorId ?? crypto.randomUUID()) : null
  const [row] = await h.db
    .insert(schema.users)
    .values({
      identitySub: sub,
      email,
      name: `${role} ${seq}`,
      role,
      party: defaultPartyForRole(role, subcontractorId),
      subcontractorId,
      isActive: opts.active ?? true,
      totpEnabled: true,
      totpSecretEnc: encryptField(h.deps.config.keyring, totpSecret),
    })
    .returning()
  if (!isStaffRole(role)) {
    const projectIds = opts.projects ?? [SEED_PROJECT_ID]
    if (projectIds.length) await h.db.insert(schema.projectMembers).values(projectIds.map((projectId) => ({ projectId, userId: row!.id })))
  }
  const token = `test:${sub}:${email}`
  const nowSec = Math.floor(h.clock.now.getTime() / 1000)
  const { token: mfa } = await signMfaSession(h.deps.config.mfaSecret, sub, nowSec, nowSec)
  return {
    id: row!.id,
    sub,
    email,
    role,
    totpSecret,
    token,
    headers: { authorization: `Bearer ${token}`, cookie: `${MFA_COOKIE}=${mfa}` },
    bareHeaders: { authorization: `Bearer ${token}` },
  }
}

export async function totpNow(secret: string, at: Date) {
  return generate({ secret, epoch: Math.floor(at.getTime() / 1000) })
}

export function req(h: Harness, method: string, path: string, headers: Record<string, string>, body?: unknown) {
  return h.app.request(path, {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export function setCookieValue(res: Response, name: string): string | null {
  for (const v of res.headers.getSetCookie()) {
    const m = v.match(new RegExp(`^${name}=([^;]*)`))
    if (m) return m[1] ?? null
  }
  return null
}

export { eq, schema }
