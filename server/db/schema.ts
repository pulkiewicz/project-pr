import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { ROLES } from '#shared'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

/** Kolumny wspólne dla encji biznesowych (sekcja 8). */
const auditColumns = {
  createdAt: ts('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  deletedAt: ts('deleted_at'),
  deletedBy: uuid('deleted_by'),
}

export const roleEnum = pgEnum('role', ROLES)

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  client: text('client').notNull(),
  contractNo: text('contract_no').notNull(),
  procurementNo: text('procurement_no').notNull(),
  contractValue: numeric('contract_value', { precision: 14, scale: 2 }),
  contractEndDate: date('contract_end_date', { mode: 'string' }).notNull(),
  dayZeroDate: date('day_zero_date', { mode: 'string' }),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  version: integer('version').notNull().default(1),
  ...auditColumns,
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** `sub` z JWT Identity; null do pierwszego logowania po zaproszeniu. */
    identitySub: text('identity_sub').unique(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    party: text('party').notNull(),
    role: roleEnum('role').notNull(),
    subcontractorId: uuid('subcontractor_id'),
    isActive: boolean('is_active').notNull().default(true),
    totpSecretEnc: text('totp_secret_enc'),
    totpPendingEnc: text('totp_pending_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    recoveryCodesHash: jsonb('recovery_codes_hash').$type<string[]>(),
    invitedAt: ts('invited_at'),
    lastLoginAt: ts('last_login_at'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
)

export const permissions = pgTable(
  'permissions',
  {
    role: roleEnum('role').notNull(),
    module: text('module').notNull(),
    action: text('action').notNull(),
    allowed: boolean('allowed').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.role, t.module, t.action] })],
)

/** Ustawienia globalne aplikacji (np. wymóg 2FA per rola). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
})

export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id'),
    kind: text('kind').notNull(),
    success: boolean('success').notNull(),
    ip: inet('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('auth_attempts_user_kind_idx').on(t.userId, t.kind, t.createdAt)],
)

/** Tylko dopisywanie — UPDATE/DELETE blokowane triggerem (migracja SQL). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: ts('ts').notNull().defaultNow(),
    userId: uuid('user_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    changes: jsonb('changes'),
    projectId: uuid('project_id'),
  },
  (t) => [
    index('audit_log_ts_idx').on(t.ts),
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_user_idx').on(t.userId, t.ts),
  ],
)
