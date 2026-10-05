import { z } from 'zod'
import { ISO_WEEK_RE } from './isoweek.ts'
import { BASE_PARTIES } from './roles.ts'

export const WEEKLY_STATUSES = ['plan', 'in_progress', 'done', 'moved', 'cancelled'] as const
export type WeeklyStatus = (typeof WEEKLY_STATUSES)[number]
/** Statusy „niewykonane” — kandydaci do przeniesienia przy zamknięciu tygodnia. */
export const WEEKLY_OPEN_STATUSES: readonly WeeklyStatus[] = ['plan', 'in_progress']

export const isoWeekSchema = z.string().regex(ISO_WEEK_RE, 'validation.isoWeek')

export const weeklyItemInput = z.object({
  isoWeek: isoWeekSchema,
  hrfTaskId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  party: z.enum(BASE_PARTIES),
  assigneeUserId: z.uuid().nullable().optional(),
  assigneeSubcontractorId: z.uuid().nullable().optional(),
  plannedDays: z.number().int().min(0).max(127).default(0),
  status: z.enum(WEEKLY_STATUSES).default('plan'),
})
export type WeeklyItemInput = z.infer<typeof weeklyItemInput>

export const weeklyItemPatch = weeklyItemInput.partial().extend({ version: z.number().int() })

export const weekCloseInput = z.object({
  /** Pozycje niewykonane do przeniesienia na następny tydzień; pozostałe otwarte zostają bez zmian. */
  carryItemIds: z.array(z.uuid()).max(500),
})

export interface WeeklyItemDto {
  id: string
  isoWeek: string
  hrfTaskId: string | null
  hrfTaskCode: string | null
  title: string
  description: string | null
  party: string
  assigneeUserId: string | null
  assigneeName: string | null
  assigneeSubcontractorId: string | null
  plannedDays: number
  status: WeeklyStatus
  carryOverFromId: string | null
  carriedOverFromWeek: string | null
  version: number
  canEdit: boolean
}

export interface WeekViewResponse {
  isoWeek: string
  start: string
  end: string
  items: WeeklyItemDto[]
  /** Zadania HRF aktywne w tygodniu (plan lub rzeczywistość) — tylko dla ról z `hrf:view`. */
  hrfTasks: { id: string; code: string; name: string; party: string; plannedStart: string | null; plannedEnd: string | null; percentComplete: number; status: string }[] | null
  stats: { total: number; done: number; moved: number; carriedIn: number }
}

export interface WeekMatrixResponse {
  weeks: { isoWeek: string; start: string; end: string }[]
  rows: {
    key: string
    kind: 'hrf' | 'party'
    label: string
    party: string
    cells: { hrfActive: boolean; items: number; done: number }[]
  }[]
}

export interface PersonOption {
  id: string
  name: string
  party: string
}
