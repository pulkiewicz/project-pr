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
import { ACTIVITY_KINDS, AI_JOB_KINDS, AI_JOB_STATUSES, INPUT_KINDS, QUESTION_AUDIENCES, QUESTION_STATUSES, SUGGESTION_STATUSES, type SuggestionPayload, AVIZATION_STATUSES, CHECKLIST_STATUSES, COMPONENT_CATEGORIES, CONFIDENCES, type CalcInput, type SpecItemDef, type SpecValue, DEPENDENCY_TYPES, LINE_SOURCES, OPPORTUNITY_STAGES, OPPORTUNITY_TYPES, QUOTE_KINDS, QUOTE_STATUSES, type QuoteInfo, type QuoteParams, HRF_STATUSES, ID_DOC_TYPES, INVOICE_EVENT_KINDS, INVOICE_STATUSES, type InvoiceManual, PURCHASE_STATUSES, ROLES, VEHICLE_TYPES, WEEKLY_STATUSES, type ImportMapping } from '#shared'

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
  /** Kod w adresach aplikacji (`/projekty/{code}`), unikalny bez względu na wielkość liter. */
  code: text('code').notNull(),
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
}, (t) => [uniqueIndex('projects_code_uq').on(sql`lower(${t.code})`)])

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
    /** Hasło tymczasowe nadane przez Admina — do zmiany przy pierwszym logowaniu. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
)

/** Przypisanie użytkownika z rolą zewnętrzną do projektu (pracownicy Envcheck widzą wszystkie projekty). */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user_idx').on(t.userId)],
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
    /** Link do pliku (http/https) — np. dokument w Google Drive / SharePoint. */
    link: text('link'),
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

export const hrfBaselines = pgTable(
  'hrf_baselines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    name: text('name').notNull(),
    dayZeroDate: date('day_zero_date', { mode: 'string' }),
    /** Obowiązujący plan bazowy projektu (najwyżej jeden) — domyślne porównanie na Gantcie. */
    isCurrent: boolean('is_current').notNull().default(false),
    ...auditColumns,
  },
  (t) => [uniqueIndex('hrf_baselines_current_idx').on(t.projectId).where(sql`${t.isCurrent} AND ${t.deletedAt} IS NULL`)],
)

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

/** Zadania wewnętrzne — doprecyzowanie jednego zadania formalnego HRF (nie wpływają na harmonogram umowny). */
export const hrfInternalTasks = pgTable(
  'hrf_internal_tasks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    parentTaskId: uuid('parent_task_id').notNull().references(() => hrfTasks.id),
    name: text('name').notNull(),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    percentComplete: smallint('percent_complete').notNull().default(0),
    notes: text('notes'),
    link: text('link'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [index('hrf_internal_tasks_parent_idx').on(t.parentTaskId), index('hrf_internal_tasks_project_idx').on(t.projectId)],
)

export const hrfInternalTaskAssignees = pgTable(
  'hrf_internal_task_assignees',
  {
    taskId: uuid('task_id').notNull().references(() => hrfInternalTasks.id),
    userId: uuid('user_id').notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index('hrf_internal_task_assignees_user_idx').on(t.userId)],
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
    netAmount: numeric('net_amount', { precision: 14, scale: 2, mode: 'number' }),
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
// Moduł wycofany 25.10.2026 (zastąpiony linkami do plików w zadaniach HRF). Tabele i typy zostają
// w bazie z ewentualnymi danymi — nieużywane przez aplikację; definicje tu, by migracje ich nie usuwały.
export const docStatusEnum = pgEnum('doc_status', ['draft', 'review', 'approved', 'obsolete'])
export const aclLevelEnum = pgEnum('acl_level', ['none', 'read', 'write', 'manage'])
export const linkTargetEnum = pgEnum('link_target', ['hrf_task', 'purchase_item', 'avization', 'weekly_item'])

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

// ---------------- R1: CRM (Envcheck Hub) ----------------
export const opportunityStageEnum = pgEnum('opportunity_stage', OPPORTUNITY_STAGES)
export const opportunityTypeEnum = pgEnum('opportunity_type', OPPORTUNITY_TYPES)
export const crmActivityKindEnum = pgEnum('crm_activity_kind', ACTIVITY_KINDS)

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    /** Same cyfry (10), unikalny wśród nieusuniętych. */
    nip: text('nip'),
    regon: text('regon'),
    address: text('address'),
    website: text('website'),
    industry: text('industry'),
    notes: text('notes'),
    ownerId: uuid('owner_id').references(() => users.id),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [uniqueIndex('companies_nip_uq').on(t.nip).where(sql`${t.deletedAt} IS NULL AND ${t.nip} IS NOT NULL`), index('companies_name_idx').on(sql`lower(${t.name})`)],
)

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid('company_id').notNull().references(() => companies.id),
    name: text('name').notNull(),
    position: text('position'),
    email: text('email'),
    phone: text('phone'),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [index('contacts_company_idx').on(t.companyId)],
)

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Kod oferty (OF038, OG001; historyczne bez zmian, np. OF015_S) — unikalny bez względu na wielkość liter. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    stage: opportunityStageEnum('stage').notNull().default('new'),
    companyId: uuid('company_id').references(() => companies.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    ownerId: uuid('owner_id').references(() => users.id),
    type: opportunityTypeEnum('type'),
    source: text('source'),
    value: numeric('value', { precision: 14, scale: 2, mode: 'number' }),
    submissionDeadline: date('submission_deadline', { mode: 'string' }),
    decisionDate: date('decision_date', { mode: 'string' }),
    nextStep: text('next_step'),
    nextStepDate: date('next_step_date', { mode: 'string' }),
    link: text('link'),
    notes: text('notes'),
    lossReason: text('loss_reason'),
    projectId: uuid('project_id').references(() => projects.id),
    /** Folder szansy na Shared Drive (decyzja C4) — materiały wejściowe i oferty. */
    driveFolderId: text('drive_folder_id'),
    /** Wejście w bieżący etap; null = nieznane (import) — liczone jak dawno. */
    stageChangedAt: ts('stage_changed_at'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [
    uniqueIndex('opportunities_code_uq').on(sql`lower(${t.code})`),
    index('opportunities_stage_idx').on(t.stage),
    index('opportunities_company_idx').on(t.companyId),
  ],
)

export const crmActivities = pgTable(
  'crm_activities',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    kind: crmActivityKindEnum('kind').notNull(),
    body: text('body').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('crm_activities_opportunity_idx').on(t.opportunityId, t.occurredAt)],
)

/** Licznik kodów ofert per prefiks roku (OF, OG, …) — nadawanie atomowe przez UPSERT … RETURNING. */
export const opportunityCodeSeq = pgTable('opportunity_code_seq', {
  prefix: text('prefix').primaryKey(),
  last: integer('last').notNull(),
})

// ---------------- R2: Wyceny i profile wyceny ----------------
export const quoteKindEnum = pgEnum('quote_kind', QUOTE_KINDS)
export const quoteStatusEnum = pgEnum('quote_status', QUOTE_STATUSES)
export const quoteLineSourceEnum = pgEnum('quote_line_source', LINE_SOURCES)
export const confidenceEnum = pgEnum('confidence', CONFIDENCES)

/** Wycena (rewizja dla szansy) albo profil wyceny (kind = 'profile', bez szansy). */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    kind: quoteKindEnum('kind').notNull().default('quote'),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    /** Litera rewizji (A, B, …) w obrębie szansy. */
    revision: text('revision'),
    name: text('name'),
    description: text('description'),
    status: quoteStatusEnum('status').notNull().default('draft'),
    basedOnId: uuid('based_on_id'),
    basedOnLabel: text('based_on_label'),
    params: jsonb('params').$type<QuoteParams>().notNull(),
    info: jsonb('info').$type<QuoteInfo>().notNull().default({}),
    notes: text('notes'),
    /** Wersja listy specyfikacyjnej, wg której wypełniono checklistę (ustalana przy pierwszym zapisie). */
    specListVersionId: uuid('spec_list_version_id'),
    approvedAt: ts('approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [
    index('quotes_opportunity_idx').on(t.opportunityId),
    uniqueIndex('quotes_revision_uq').on(t.opportunityId, t.revision).where(sql`${t.deletedAt} IS NULL AND ${t.kind} = 'quote'`),
  ],
)

export const quoteDevices = pgTable(
  'quote_devices',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** Opcja / wariant wyceniany osobno (D6); `included` = wliczone do ceny łącznej. */
    isOption: boolean('is_option').notNull().default(false),
    included: boolean('included').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('quote_devices_quote_idx').on(t.quoteId)],
)

export const quoteSections = pgTable(
  'quote_sections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    deviceId: uuid('device_id').notNull().references(() => quoteDevices.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('quote_sections_device_idx').on(t.deviceId)],
)

export const quoteLines = pgTable(
  'quote_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sectionId: uuid('section_id').notNull().references(() => quoteSections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Grupa w sekcji, np. „Stopień 1”, „Komora 2”. */
    group: text('group'),
    quantity: numeric('quantity', { precision: 14, scale: 3, mode: 'number' }).notNull().default(1),
    unit: text('unit'),
    unitCost: numeric('unit_cost', { precision: 14, scale: 2, mode: 'number' }),
    laborHours: numeric('labor_hours', { precision: 10, scale: 2, mode: 'number' }),
    laborRate: numeric('labor_rate', { precision: 10, scale: 2, mode: 'number' }),
    justification: text('justification'),
    source: quoteLineSourceEnum('source').notNull().default('manual'),
    confidence: confidenceEnum('confidence'),
    approved: boolean('approved').notNull().default(false),
    componentId: uuid('component_id').references(() => components.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('quote_lines_section_idx').on(t.sectionId)],
)

// ---------------- R3: lista specyfikacyjna, checklista, kalkulator mocy, katalog ----------------
export const checklistStatusEnum = pgEnum('checklist_status', CHECKLIST_STATUSES)
export const componentCategoryEnum = pgEnum('component_category', COMPONENT_CATEGORIES)

/** Wersje standardowej listy specyfikacyjnej — edycja w Bazie wiedzy tworzy nową wersję. */
export const specListVersions = pgTable('spec_list_versions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  version: integer('version').notNull().unique(),
  items: jsonb('items').$type<SpecItemDef[]>().notNull(),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
})

/** Pozycja checklisty wyceny: klucz z listy albo `custom:<uuid>` (wymaganie spoza listy). */
export const quoteChecklistItems = pgTable(
  'quote_checklist_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** Tylko dla wymagań dodatkowych. */
    label: text('label'),
    group: text('group'),
    value: jsonb('value').$type<SpecValue>(),
    status: checklistStatusEnum('status').notNull().default('pending'),
    note: text('note'),
    sourceRef: text('source_ref'),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [uniqueIndex('quote_checklist_items_uq').on(t.quoteId, t.key)],
)

/** Kalkulacja mocy chłodniczej/grzewczej w wycenie (opcjonalnie dla urządzenia). */
export const quoteCalcs = pgTable(
  'quote_calcs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => quoteDevices.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    input: jsonb('input').$type<CalcInput>().notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [index('quote_calcs_quote_idx').on(t.quoteId)],
)

export const components = pgTable(
  'components',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    category: componentCategoryEnum('category').notNull(),
    name: text('name').notNull(),
    manufacturer: text('manufacturer'),
    partNo: text('part_no'),
    supplier: text('supplier'),
    unit: text('unit'),
    price: numeric('price', { precision: 14, scale: 2, mode: 'number' }),
    priceDate: date('price_date', { mode: 'string' }),
    capacityW: numeric('capacity_w', { precision: 12, scale: 1, mode: 'number' }),
    evapTempC: numeric('evap_temp_c', { precision: 6, scale: 1, mode: 'number' }),
    refrigerant: text('refrigerant'),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [index('components_category_idx').on(t.category)],
)

// ---------------- R4: materiały wejściowe, AI (zadania, log, sugestie), pytania ----------------
export const inputKindEnum = pgEnum('quote_input_kind', INPUT_KINDS)
export const aiJobKindEnum = pgEnum('ai_job_kind', AI_JOB_KINDS)
export const aiJobStatusEnum = pgEnum('ai_job_status', AI_JOB_STATUSES)
export const suggestionStatusEnum = pgEnum('ai_suggestion_status', SUGGESTION_STATUSES)
export const questionAudienceEnum = pgEnum('question_audience', QUESTION_AUDIENCES)
export const questionStatusEnum = pgEnum('question_status', QUESTION_STATUSES)

/** Materiał wejściowy wyceny (krok 2): plik na Drive (folder szansy) albo wklejony tekst (np. mail). */
export const quoteInputs = pgTable(
  'quote_inputs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
    kind: inputKindEnum('kind').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type'),
    size: integer('size'),
    driveFileId: text('drive_file_id'),
    /** Sesja resumable (hash URL) — do potwierdzenia zakończenia uploadu. */
    uploadSessionHash: text('upload_session_hash'),
    text: text('text'),
    ...auditColumns,
  },
  (t) => [index('quote_inputs_quote_idx').on(t.quoteId)],
)

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
    kind: aiJobKindEnum('kind').notNull(),
    status: aiJobStatusEnum('status').notNull().default('queued'),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    /** SHA-256 jednorazowego tokenu, którym funkcja w tle potwierdza zlecenie. */
    tokenHash: text('token_hash').notNull(),
    summary: text('summary'),
    error: text('error'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('ai_jobs_quote_idx').on(t.quoteId, t.createdAt)],
)

/** Każde wywołanie modelu: koszt i tokeny (licznik kosztów G6). Treści dokumentów nie są zapisywane. */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid('job_id').references(() => aiJobs.id, { onDelete: 'set null' }),
    quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4, mode: 'number' }),
    durationMs: integer('duration_ms'),
    stopReason: text('stop_reason'),
    error: text('error'),
    userId: uuid('user_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_calls_created_idx').on(t.createdAt), index('ai_calls_quote_idx').on(t.quoteId)],
)

/** Propozycja AI zmiany/dodania pozycji — do akceptacji przez człowieka (nie trafia do sumy sama). */
export const aiSuggestions = pgTable(
  'ai_suggestions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => aiJobs.id, { onDelete: 'set null' }),
    sectionId: uuid('section_id').notNull().references(() => quoteSections.id, { onDelete: 'cascade' }),
    lineId: uuid('line_id').references(() => quoteLines.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<SuggestionPayload>().notNull(),
    status: suggestionStatusEnum('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_suggestions_quote_idx').on(t.quoteId, t.status)],
)

/** Pytania doprecyzowujące (krok 6): do Kamila (wewnętrzne) albo do klienta. */
export const quoteQuestions = pgTable(
  'quote_questions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
    audience: questionAudienceEnum('audience').notNull(),
    text: text('text').notNull(),
    context: text('context'),
    checklistKey: text('checklist_key'),
    status: questionStatusEnum('status').notNull().default('open'),
    answer: text('answer'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    answeredBy: uuid('answered_by').references(() => users.id),
    answeredAt: ts('answered_at'),
    source: text('source').notNull().default('manual'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('quote_questions_quote_idx').on(t.quoteId), index('quote_questions_assignee_idx').on(t.assigneeId, t.status)],
)

// ---------------- Faktury kosztowe z inFakt → projekty ----------------

export const invoiceStatusEnum = pgEnum('cost_invoice_status', INVOICE_STATUSES)
export const invoiceEventKindEnum = pgEnum('cost_invoice_event_kind', INVOICE_EVENT_KINDS)

/** Dokument kosztowy z inFakt (kopia pól z API; kwoty w groszach) + stan przypisania i akceptacji. */
export const costInvoices = pgTable(
  'cost_invoices',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    infaktUuid: text('infakt_uuid').notNull(),
    kind: text('kind').notNull(),
    number: text('number'),
    sellerName: text('seller_name'),
    description: text('description'),
    category: text('category'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    currency: text('currency').notNull().default('PLN'),
    netPrice: bigint('net_price', { mode: 'number' }),
    grossPrice: bigint('gross_price', { mode: 'number' }),
    taxPrice: bigint('tax_price', { mode: 'number' }),
    paymentStatus: text('payment_status'),
    accountingStatus: text('accounting_status'),
    infaktCreatedAt: ts('infakt_created_at'),
    /** Dane uzupełnione ręcznie (pierwszeństwo przed inFakt, synchronizacja ich nie nadpisuje). */
    manual: jsonb('manual').$type<InvoiceManual>().notNull().default({}),
    status: invoiceStatusEnum('status').notNull().default('new'),
    note: text('note'),
    submittedBy: uuid('submitted_by').references(() => users.id),
    submittedAt: ts('submitted_at'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    syncedAt: ts('synced_at').notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [uniqueIndex('cost_invoices_infakt_uuid_uq').on(t.infaktUuid), index('cost_invoices_status_idx').on(t.status), index('cost_invoices_issue_date_idx').on(t.issueDate), index('cost_invoices_infakt_created_idx').on(t.infaktCreatedAt)],
)

/** Udział projektu w fakturze (%). Suma ≤ 100; reszta = koszty ogólne. */
export const costInvoiceAllocations = pgTable(
  'cost_invoice_allocations',
  {
    invoiceId: uuid('invoice_id').notNull().references(() => costInvoices.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    share: numeric('share', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    /** Opis kosztu w tym projekcie. */
    description: text('description'),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.projectId] }), index('cost_invoice_allocations_project_idx').on(t.projectId)],
)

/** Historia faktury (import, przypisanie, akceptacja, odrzucenie z komentarzem). */
export const costInvoiceEvents = pgTable(
  'cost_invoice_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    invoiceId: uuid('invoice_id').notNull().references(() => costInvoices.id, { onDelete: 'cascade' }),
    kind: invoiceEventKindEnum('kind').notNull(),
    comment: text('comment'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    userId: uuid('user_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('cost_invoice_events_invoice_idx').on(t.invoiceId, t.createdAt)],
)

// ---------------- Zarząd: pracownicy i ewidencja pojazdów (moduły `employees`, `fleet`) ----------------

/** Pracownik Envcheck. PESEL szyfrowany AES-256-GCM (jak dokumenty w awizacjach). */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    position: text('position'),
    email: text('email'),
    phone: text('phone'),
    birthDate: date('birth_date', { mode: 'string' }),
    peselEnc: text('pesel_enc'),
    address: text('address'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    contractType: text('contract_type'),
    contractStart: date('contract_start', { mode: 'string' }),
    contractEnd: date('contract_end', { mode: 'string' }),
    medicalExamValidUntil: date('medical_exam_valid_until', { mode: 'string' }),
    bhpTrainingValidUntil: date('bhp_training_valid_until', { mode: 'string' }),
    /** Konto w aplikacji — punkt styku z raportowaniem czasu pracy. */
    userId: uuid('user_id').references(() => users.id),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [index('employees_name_idx').on(t.lastName, t.firstName)],
)

/** Uprawnienia i certyfikaty pracownika (SEP, F-gaz, UDT…). */
export const employeeQualifications = pgTable(
  'employee_qualifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    number: text('number'),
    validUntil: date('valid_until', { mode: 'string' }),
    documentUrl: text('document_url'),
    notes: text('notes'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('employee_qualifications_employee_idx').on(t.employeeId)],
)

/** Pojazd firmowy (nazwa tabeli odróżnia od pojazdów z awizacji). */
export const fleetVehicles = pgTable(
  'fleet_vehicles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    registrationNumber: text('registration_number').notNull(),
    make: text('make'),
    model: text('model'),
    kind: text('kind').notNull(),
    vin: text('vin'),
    productionYear: integer('production_year'),
    ownership: text('ownership').notNull().default('owned'),
    financingCompany: text('financing_company'),
    financingEndDate: date('financing_end_date', { mode: 'string' }),
    assignedEmployeeId: uuid('assigned_employee_id').references(() => employees.id),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    ...auditColumns,
  },
  (t) => [uniqueIndex('fleet_vehicles_registration_uq').on(t.registrationNumber).where(sql`${t.deletedAt} IS NULL`)],
)

export const fleetInsurances = pgTable(
  'fleet_insurances',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    vehicleId: uuid('vehicle_id').notNull().references(() => fleetVehicles.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    insurer: text('insurer'),
    policyNumber: text('policy_number'),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }).notNull(),
    policyUrl: text('policy_url'),
    notes: text('notes'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('fleet_insurances_vehicle_idx').on(t.vehicleId)],
)

/** Badanie techniczne, UDT, przegląd serwisowy, tachograf. */
export const fleetInspections = pgTable(
  'fleet_inspections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    vehicleId: uuid('vehicle_id').notNull().references(() => fleetVehicles.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    performedDate: date('performed_date', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    documentUrl: text('document_url'),
    notes: text('notes'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('fleet_inspections_vehicle_idx').on(t.vehicleId)],
)
