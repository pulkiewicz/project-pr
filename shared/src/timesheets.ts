import { z } from 'zod'
import type { EntryMode, StoredTimesheetEntry } from './timesheets/hours.ts'

/**
 * Ewidencja czasu pracy (moduł `timesheets`, przeniesiony z workload-calendar).
 * Logika dat i godzin: `hours` (namespace z `./timesheets/hours.ts`).
 */

/** Dostęp do panelu: osoby z listy — `viewerIds` (podgląd + eksport), `editorIds` (także zarządzanie pracownikami). */
export interface TimesheetSettings {
  viewerIds: string[]
  editorIds: string[]
}
export const timesheetSettingsInput = z.object({ viewerIds: z.array(z.uuid()).max(50), editorIds: z.array(z.uuid()).max(50) })

/** Limity jak w starej aplikacji. */
export const TIMESHEET_MAX_RANGE_DAYS = 62
export const TIMESHEET_MAX_WRITE_DAYS = 31
export const TIMESHEET_MAX_NAME_LENGTH = 120
export const TIMESHEET_MAX_SUMMARY_MONTHS = 24

export interface TimesheetEmployeeDto {
  id: string
  name: string
  active: boolean
  createdAt: string
}

export const timesheetEmployeeInput = z.object({ name: z.string().max(500) })
export const timesheetEmployeePatch = z.object({ name: z.string().max(500).optional(), active: z.boolean().optional() })

/** Zapis tygodnia przez pracownika: data → wpis albo null (dzień do usunięcia). */
export const timesheetEntriesPut = z.object({ id: z.string().max(20), entries: z.record(z.string(), z.unknown()) })

export interface TimesheetMeResponse {
  id: string
  name: string
}

export interface TimesheetEntriesResponse {
  id: string
  name: string
  from: string
  to: string
  entries: Record<string, StoredTimesheetEntry>
  total: number
}

export interface TimesheetSaveResponse {
  ok: true
  saved: Record<string, StoredTimesheetEntry>
  savedAt: string
}

export interface TimesheetReportResponse {
  month: string
  days: string[]
  employees: { id: string; name: string; active: boolean; days: Record<string, StoredTimesheetEntry>; total: number }[]
  total: number
}

export interface TimesheetSummaryResponse {
  from: string
  to: string
  months: string[]
  granularity: 'day' | 'month'
  buckets: string[]
  employees: { id: string; name: string; active: boolean; byBucket: Record<string, number>; total: number; workedDays: number; average: number }[]
  total: number
  workedDays: number
}

// ---------------- Import z workload-calendar ----------------

export const TIMESHEET_EXPORT_FORMAT = 'workload-calendar-export'

/** Plik z eksportu starej aplikacji (skrypt w panelu jej administratora). Godziny są przeliczane przy imporcie. */
export const timesheetImportInput = z.object({
  format: z.literal(TIMESHEET_EXPORT_FORMAT),
  exportedAt: z.string().max(40),
  employees: z
    .array(z.object({ id: z.string().max(20), name: z.string().max(500), active: z.boolean(), createdAt: z.string().max(40).nullish() }))
    .max(1000),
  entries: z
    .array(
      z.object({
        employeeId: z.string().max(20),
        date: z.string().max(10),
        mode: z.enum(['range', 'total'] satisfies EntryMode[]),
        start: z.string().max(5).nullish(),
        end: z.string().max(5).nullish(),
        breakMin: z.number().nullish(),
        hours: z.number().nullish(),
        note: z.string().max(1000).nullish(),
        updatedAt: z.string().max(40).nullish(),
      }),
    )
    .max(200_000),
})
export type TimesheetImportInput = z.infer<typeof timesheetImportInput>

export interface TimesheetImportResult {
  employeesCreated: number
  employeesUpdated: number
  entriesCreated: number
  entriesUpdated: number
  /** Wpisy w PMO nowsze niż w pliku (np. zapisane po przełączeniu) — zostawione bez zmian. */
  entriesSkippedNewer: number
  /** Wpisy odrzucone przez walidację (z powodem). */
  rejected: { employeeId: string; date: string; error: string }[]
}
