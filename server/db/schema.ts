import { sql } from 'drizzle-orm'
import {
  bigint,
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
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { ACL_LEVELS, AVIZATION_STATUSES, DOC_STATUSES, LINK_TARGETS, DEPENDENCY_TYPES, HRF_STATUSES, ID_DOC_TYPES, PURCHASE_STATUSES, ROLES, VEHICLE_TYPES, WEEKLY_STATUSES, type ImportMapping } from '#shared'

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

// ---------------- E1: HRF ----------------

export const hrfStatusEnum = pgEnum('hrf_status', HRF_STATUSES)
export const dependencyTypeEnum = pgEnum('hrf_dependency_type', DEPENDENCY_TYPES)

export const hrfTasks = pgTable(
  'hrf_tasks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
    party: text('party').notNull(),
    responsibleUserId: uuid('responsible_user_id').references(() => users.id),
    startOffsetDays: integer('start_offset_days').notNull(),
    durationDays: integer('duration_days').notNull(),
    /** Wyliczane z dnia „0” + offset; null dopóki dzień „0” nieustawiony. */
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    actualStart: date('actual_start', { mode: 'string' }),
    actualEnd: date('actual_end', { mode: 'string' }),
    forecastEnd: date('forecast_end', { mode: 'string' }),
    percentComplete: numeric('percent_complete', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    status: hrfStatusEnum('status').notNull().default('not_started'),
    isMilestone: boolean('is_milestone').notNull().default(false),
    isAcceptancePoint: boolean('is_acceptance_point').notNull().default(false),
    postAcceptanceAllowed: boolean('post_acceptance_allowed').notNull().default(false),
    /** [W] wartość Etapu z umowy. */
    contractValue: numeric('contract_value', { precision: 14, scale: 2 }),
    isCriticalPath: boolean('is_critical_path').notNull().default(false),
    totalFloatDays: integer('total_float_days'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('hrf_tasks_project_code_idx').on(t.projectId, t.code).where(sql`${t.deletedAt} IS NULL`),
    index('hrf_tasks_parent_idx').on(t.parentId),
  ],
)

export const hrfDependencies = pgTable(
  'hrf_dependencies',
  {
    taskId: uuid('task_id').notNull().references(() => hrfTasks.id),
    predecessorId: uuid('predecessor_id').notNull().references(() => hrfTasks.id),
    type: dependencyTypeEnum('type').notNull().default('FS'),
    lagDays: integer('lag_days').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.predecessorId] }), index('hrf_dependencies_pred_idx').on(t.predecessorId)],
)

export const hrfBaselines = pgTable('hrf_baselines', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  dayZeroDate: date('day_zero_date', { mode: 'string' }),
  ...auditColumns,
})

export const hrfBaselineTasks = pgTable(
  'hrf_baseline_tasks',
  {
    baselineId: uuid('baseline_id').notNull().references(() => hrfBaselines.id),
    taskId: uuid('task_id').notNull().references(() => hrfTasks.id),
    start: date('start', { mode: 'string' }),
    end: date('end', { mode: 'string' }),
  },
  (t) => [primaryKey({ columns: [t.baselineId, t.taskId] })],
)

export const hrfImportProfiles = pgTable('hrf_import_profiles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  columnMapping: jsonb('column_mapping').$type<ImportMapping>().notNull(),
  ...auditColumns,
})

// ---------------- E3: Plan tygodniowy (M3) ----------------
export const weeklyStatusEnum = pgEnum('weekly_status', WEEKLY_STATUSES)

export const weeklyItems = pgTable(
  'weekly_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    isoWeek: text('iso_week').notNull(),
    hrfTaskId: uuid('hrf_task_id').references(() => hrfTasks.id),
    title: text('title').notNull(),
    description: text('description'),
    party: text('party').notNull(),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    /** Tabela podwykonawców dochodzi w E4 — wtedy FK. */
    assigneeSubcontractorId: uuid('assignee_subcontractor_id'),
    /** Maska dni (bit 0 = poniedziałek). */
    plannedDays: smallint('planned_days').notNull().default(0),
    status: weeklyStatusEnum('status').notNull().default('plan'),
    carryOverFromId: uuid('carry_over_from_id'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [index('weekly_items_week_idx').on(t.projectId, t.isoWeek), index('weekly_items_assignee_idx').on(t.assigneeUserId)],
)

// ---------------- E3: Plan zakupów (M4) — bez pól cenowych ----------------
export const purchaseStatusEnum = pgEnum('purchase_status', PURCHASE_STATUSES)

export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    name: text('name').notNull(),
    category: text('category'),
    manufacturer: text('manufacturer'),
    partNo: text('part_no'),
    quantity: numeric('quantity', { precision: 14, scale: 3, mode: 'number' }),
    unit: text('unit'),
    supplierName: text('supplier_name'),
    supplierContact: text('supplier_contact'),
    party: text('party').notNull(),
    hrfTaskId: uuid('hrf_task_id').references(() => hrfTasks.id),
    bufferDays: integer('buffer_days'),
    leadTimeWeeks: numeric('lead_time_weeks', { precision: 6, scale: 1, mode: 'number' }),
    inquiryDate: date('inquiry_date', { mode: 'string' }),
    orderDatePlanned: date('order_date_planned', { mode: 'string' }),
    orderDateActual: date('order_date_actual', { mode: 'string' }),
    orderRef: text('order_ref'),
    confirmedDeliveryDate: date('confirmed_delivery_date', { mode: 'string' }),
    actualDeliveryDate: date('actual_delivery_date', { mode: 'string' }),
    status: purchaseStatusEnum('status').notNull().default('to_inquire'),
    isCritical: boolean('is_critical').notNull().default(false),
    deliveryLocation: text('delivery_location'),
    requiresAvization: boolean('requires_avization').notNull().default(false),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [index('purchase_items_project_idx').on(t.projectId), index('purchase_items_task_idx').on(t.hrfTaskId)],
)

// ---------------- E3: Awizacje (M5) — dane osobowe ----------------
export const idDocTypeEnum = pgEnum('id_doc_type', ID_DOC_TYPES)
export const vehicleTypeEnum = pgEnum('vehicle_type', VEHICLE_TYPES)
export const avizationStatusEnum = pgEnum('avization_status', AVIZATION_STATUSES)

export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    idDocType: idDocTypeEnum('id_doc_type').notNull(),
    /** AES-256-GCM (osobny IV), format `<keyId>.<iv>.<tag>.<ct>`. */
    idDocNumberEnc: text('id_doc_number_enc').notNull(),
    idDocKeyId: text('id_doc_key_id').notNull(),
    /** HMAC-SHA256 znormalizowanego numeru — wykrywanie duplikatów bez odszyfrowania. */
    idDocNumberHmac: text('id_doc_number_hmac').notNull(),
    company: text('company').notNull(),
    subcontractorId: uuid('subcontractor_id'),
    phone: text('phone'),
    roleOnSite: text('role_on_site'),
    notes: text('notes'),
    party: text('party').notNull(),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [
    index('persons_project_idx').on(t.projectId),
    uniqueIndex('persons_doc_hmac_idx').on(t.projectId, t.idDocNumberHmac).where(sql`${t.deletedAt} IS NULL`),
  ],
)

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    registrationNumberEnc: text('registration_number_enc').notNull(),
    registrationNumberHmac: text('registration_number_hmac').notNull(),
    keyId: text('key_id').notNull(),
    makeModel: text('make_model'),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull().default('car'),
    company: text('company').notNull(),
    defaultDriverId: uuid('default_driver_id').references(() => persons.id),
    party: text('party').notNull(),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [uniqueIndex('vehicles_reg_hmac_idx').on(t.projectId, t.registrationNumberHmac).where(sql`${t.deletedAt} IS NULL`)],
)

export const entryPoints = pgTable('entry_points', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
})

export const avizations = pgTable(
  'avizations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    number: text('number').notNull(),
    dateFrom: date('date_from', { mode: 'string' }).notNull(),
    dateTo: date('date_to', { mode: 'string' }).notNull(),
    entryPointId: uuid('entry_point_id').references(() => entryPoints.id),
    purpose: text('purpose').notNull(),
    hrfTaskId: uuid('hrf_task_id').references(() => hrfTasks.id),
    weeklyItemId: uuid('weekly_item_id').references(() => weeklyItems.id),
    status: avizationStatusEnum('status').notNull().default('draft'),
    party: text('party').notNull(),
    requestedBy: uuid('requested_by').references(() => users.id),
    sentAt: ts('sent_at'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    rejectionReason: text('rejection_reason'),
    externalRef: text('external_ref'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [uniqueIndex('avizations_number_idx').on(t.projectId, t.number), index('avizations_dates_idx').on(t.projectId, t.dateFrom, t.dateTo)],
)

export const avizationPersons = pgTable(
  'avization_persons',
  {
    avizationId: uuid('avization_id').notNull().references(() => avizations.id),
    personId: uuid('person_id').notNull().references(() => persons.id),
  },
  (t) => [primaryKey({ columns: [t.avizationId, t.personId] }), index('avization_persons_person_idx').on(t.personId)],
)

export const avizationVehicles = pgTable(
  'avization_vehicles',
  {
    avizationId: uuid('avization_id').notNull().references(() => avizations.id),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
    driverPersonId: uuid('driver_person_id').references(() => persons.id),
  },
  (t) => [primaryKey({ columns: [t.avizationId, t.vehicleId] })],
)

// ---------------- M7: Repozytorium dokumentów (Google Shared Drive) ----------------
export const docStatusEnum = pgEnum('doc_status', DOC_STATUSES)
export const aclLevelEnum = pgEnum('acl_level', ACL_LEVELS)
export const linkTargetEnum = pgEnum('link_target', LINK_TARGETS)

export const driveFolders = pgTable(
  'drive_folders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    driveFolderId: text('drive_folder_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    path: text('path').notNull(),
    trashedAt: ts('trashed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('drive_folders_drive_id_idx').on(t.projectId, t.driveFolderId), index('drive_folders_parent_idx').on(t.parentId)],
)

export const driveFiles = pgTable(
  'drive_files',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    driveFileId: text('drive_file_id').notNull(),
    folderId: uuid('folder_id').notNull().references(() => driveFolders.id),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: bigint('size', { mode: 'number' }),
    driveVersion: text('drive_version'),
    md5: text('md5'),
    modifiedAt: ts('modified_at'),
    webViewLink: text('web_view_link'),
    category: text('category'),
    status: docStatusEnum('status').notNull().default('draft'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    syncedAt: ts('synced_at'),
    trashedAt: ts('trashed_at'),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('drive_files_drive_id_idx').on(t.projectId, t.driveFileId), index('drive_files_folder_idx').on(t.folderId)],
)

/** ACL folderu: brak wierszy = dziedziczenie; zestaw wierszy = jawne uprawnienia (brakujący podmiot = brak dostępu). */
export const folderAcl = pgTable(
  'folder_acl',
  {
    folderId: uuid('folder_id').notNull().references(() => driveFolders.id),
    /** `role:<Rola>` lub `party:Subcontractor:<id>`. */
    subject: text('subject').notNull(),
    level: aclLevelEnum('level').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.folderId, t.subject] })],
)

export const pendingUploads = pgTable('pending_uploads', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  folderId: uuid('folder_id').notNull().references(() => driveFolders.id),
  name: text('name').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  mimeType: text('mime_type').notNull(),
  sessionUriHash: text('session_uri_hash').notNull(),
  link: jsonb('link').$type<{ targetType: string; targetId: string } | null>(),
  completedAt: ts('completed_at'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export const driveSyncState = pgTable('drive_sync_state', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id),
  pageToken: text('page_token'),
  lastRunAt: ts('last_run_at'),
  lastError: text('last_error'),
})

export const recordLinks = pgTable(
  'record_links',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    fileId: uuid('file_id').notNull().references(() => driveFiles.id),
    targetType: linkTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [uniqueIndex('record_links_uniq_idx').on(t.fileId, t.targetType, t.targetId), index('record_links_target_idx').on(t.targetType, t.targetId)],
)

/** Spec. 3.4: idempotencja zadań cyklicznych. */
export const jobRuns = pgTable(
  'job_runs',
  {
    job: text('job').notNull(),
    runKey: text('run_key').notNull(),
    status: text('status').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    error: text('error'),
    details: jsonb('details'),
  },
  (t) => [primaryKey({ columns: [t.job, t.runKey] })],
)
