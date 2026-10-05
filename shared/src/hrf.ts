import { z } from 'zod'
import { BASE_PARTIES } from './roles.ts'

/** Statusy zadań/Etapów (M1 kafel 3). Klucze techniczne; etykiety w i18n `hrf.status.*`. */
export const HRF_STATUSES = ['not_started', 'in_progress', 'at_risk', 'delayed', 'ready_for_acceptance', 'accepted'] as const
export type HrfStatus = (typeof HRF_STATUSES)[number]

export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF'] as const
export type DependencyType = (typeof DEPENDENCY_TYPES)[number]

/** Pola [W] w HRF widoczne tylko z uprawnieniem `penalties:view` (field-level authorization). */
export const HRF_INTERNAL_FIELDS = ['contractValue'] as const

export const hrfPartySchema = z.enum(BASE_PARTIES)
const isoDate = z.iso.date()

export interface HrfTaskDto {
  id: string
  code: string
  name: string
  parentId: string | null
  party: string
  responsibleUserId: string | null
  startOffsetDays: number
  durationDays: number
  plannedStart: string | null
  plannedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  forecastEnd: string | null
  percentComplete: number
  status: HrfStatus
  isMilestone: boolean
  isAcceptancePoint: boolean
  postAcceptanceAllowed: boolean
  isCriticalPath: boolean
  totalFloatDays: number | null
  notes: string | null
  sortOrder: number
  version: number
  /** [W] — obecne tylko dla uprawnionych. */
  contractValue?: string | null
  /** Czy bieżący użytkownik może edytować postęp tego zadania (party / przypisanie). */
  canEdit: boolean
}

export interface HrfDependencyDto {
  taskId: string
  predecessorId: string
  type: DependencyType
  lagDays: number
}

export interface HrfTasksResponse {
  dayZeroDate: string | null
  contractEndDate: string
  tasks: HrfTaskDto[]
  dependencies: HrfDependencyDto[]
  criticalPathComputed: boolean
}

/** Pola postępu — edytowalne przez strony z uprawnieniem `hrf:edit` dla własnych zadań. */
export const hrfProgressPatch = z.object({
  actualStart: isoDate.nullable().optional(),
  actualEnd: isoDate.nullable().optional(),
  forecastEnd: isoDate.nullable().optional(),
  percentComplete: z.number().min(0).max(100).optional(),
  status: z.enum(HRF_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
  responsibleUserId: z.uuid().nullable().optional(),
})

/** Pola struktury — wymagają `hrf:approve` (Admin). `contractValue` dodatkowo `penalties:edit`. */
export const hrfStructurePatch = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  party: hrfPartySchema.optional(),
  startOffsetDays: z.number().int().min(0).max(5000).optional(),
  durationDays: z.number().int().min(1).max(5000).optional(),
  isMilestone: z.boolean().optional(),
  isAcceptancePoint: z.boolean().optional(),
  postAcceptanceAllowed: z.boolean().optional(),
  contractValue: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).nullable().optional(),
})

export const hrfTaskPatch = hrfProgressPatch.extend(hrfStructurePatch.shape).extend({ version: z.number().int() })
export type HrfTaskPatch = z.infer<typeof hrfTaskPatch>
export const HRF_STRUCTURE_FIELDS = Object.keys(hrfStructurePatch.shape) as (keyof z.infer<typeof hrfStructurePatch>)[]

export const hrfTaskCreate = z.object({
  code: z.string().trim().regex(/^\d+(\.\d+)*$/, 'validation.hrfCode'),
  name: z.string().trim().min(1).max(500),
  party: hrfPartySchema,
  startOffsetDays: z.number().int().min(0),
  durationDays: z.number().int().min(1),
  isMilestone: z.boolean().default(false),
  isAcceptancePoint: z.boolean().default(false),
  postAcceptanceAllowed: z.boolean().default(false),
})

export const dependenciesInput = z.object({
  predecessors: z
    .array(z.object({ predecessorId: z.uuid(), type: z.enum(DEPENDENCY_TYPES), lagDays: z.number().int().min(-365).max(365) }))
    .max(50),
})

export const dayZeroInput = z.object({ date: isoDate, projectVersion: z.number().int() })

export interface DayZeroPreview {
  from: string | null
  to: string
  changes: { taskId: string; code: string; name: string; oldStart: string | null; oldEnd: string | null; newStart: string; newEnd: string }[]
  warnings: { code: string; message: string }[]
}

export const baselineCreateInput = z.object({ name: z.string().trim().min(1).max(200) })

export interface BaselineDto {
  id: string
  name: string
  createdAt: string
  dayZeroDate: string | null
  taskCount: number
}

export interface BaselineTasksDto {
  baseline: BaselineDto
  tasks: { taskId: string; start: string | null; end: string | null }[]
}

// --- Import XLSX ---

/** Pola HRF, na które mapuje się kolumny arkusza. */
export const IMPORT_FIELDS = ['code', 'name', 'weeks', 'party', 'notes'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const importMapping = z.object({
  sheet: z.string().min(1),
  /** Numer wiersza nagłówka (1-based); dane od następnego wiersza. */
  headerRow: z.number().int().min(1),
  /** Pole → litera kolumny (np. `A`). `code`, `name`, `weeks` wymagane. */
  columns: z.object({
    code: z.string().regex(/^[A-Z]{1,3}$/),
    name: z.string().regex(/^[A-Z]{1,3}$/),
    weeks: z.string().regex(/^[A-Z]{1,3}$/),
    party: z.string().regex(/^[A-Z]{1,3}$/).optional(),
    notes: z.string().regex(/^[A-Z]{1,3}$/).optional(),
  }),
  /** Wartość z kolumny strony → party + czy to punkt odbioru. Puste komórki → `emptyParty`. */
  partyValues: z.record(z.string(), z.object({ party: hrfPartySchema, acceptancePoint: z.boolean().default(false) })).default({}),
  emptyParty: hrfPartySchema.default('Konsorcjum'),
  /** Kody Etapów, których zadania są dopuszczone po odbiorze (§ 3 ust. 8). */
  postAcceptanceStageCodes: z.array(z.string()).default([]),
})
export type ImportMapping = z.infer<typeof importMapping>

export interface ImportInspectResponse {
  sheets: { name: string; rows: string[][] }[]
  suggested: Partial<ImportMapping> | null
  partyValuesFound: Record<string, string[]>
}

export interface ImportIssue {
  row: number
  code?: string
  severity: 'error' | 'warning'
  message: string
}

export interface ImportPreviewResponse {
  tasks: { row: number; code: string; name: string; parentCode: string | null; startOffsetDays: number; durationDays: number; party: string; isAcceptancePoint: boolean; postAcceptanceAllowed: boolean; plannedStart: string | null; plannedEnd: string | null }[]
  issues: ImportIssue[]
  diff: { created: string[]; updated: { code: string; fields: string[] }[]; unchanged: string[]; missingInFile: string[] }
  canCommit: boolean
}

export const importProfileInput = z.object({ name: z.string().trim().min(1).max(200), mapping: importMapping })

export interface ImportProfileDto {
  id: string
  name: string
  mapping: ImportMapping
}

// --- Dashboard ---

export interface DashboardResponse {
  today: string
  countdown: {
    contractEndDate: string
    calendarDays: number
    workingDays: number
    forecastEnd: string | null
    bufferDays: number | null
    color: 'green' | 'yellow' | 'red' | 'gray'
  }
  progress: { actualPercent: number; plannedPercent: number; deviationDays: number | null } | null
  stages: { id: string; code: string; name: string; percent: number; status: HrfStatus; plannedStart: string | null; plannedEnd: string | null }[]
  milestones: { id: string; code: string; name: string; date: string; isAcceptancePoint: boolean }[]
  alerts: { severity: 'yellow' | 'red'; module: string; message: string; entityId?: string }[]
  miniGantt: { from: string; to: string; tasks: { id: string; code: string; name: string; start: string; end: string; percent: number; status: HrfStatus; critical: boolean }[] }
  myTasks: { id: string; code: string; name: string; plannedEnd: string | null; status: HrfStatus; source: 'hrf' }[]
  dayZeroSet: boolean
}
