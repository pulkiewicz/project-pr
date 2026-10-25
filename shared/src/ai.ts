import { z } from 'zod'

/** Model Claude dla wycen (decyzja G1: własny klucz Anthropic). */
export const AI_MODEL = 'claude-opus-5-5'

/** Cennik [USD / 1M tokenów] do licznika kosztów (G6); nieznany model → koszt nieznany (null). */
export const AI_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export function aiCostUsd(model: string, u: AiUsage): number | null {
  const p = AI_PRICING[model]
  if (!p) return null
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000
  return Math.round(usd * 10000) / 10000
}

/** Operacje AI na wycenie (zadania w tle). */
export const AI_JOB_KINDS = ['extract_checklist', 'propose_lines', 'reestimate_line', 'questions'] as const
export type AiJobKind = (typeof AI_JOB_KINDS)[number]
export const AI_JOB_STATUSES = ['queued', 'running', 'done', 'error'] as const
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number]

export const aiJobInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('extract_checklist') }),
  z.object({ kind: z.literal('propose_lines'), hint: z.string().trim().max(5000).nullable().optional() }),
  z.object({ kind: z.literal('reestimate_line'), lineId: z.uuid(), comment: z.string().trim().min(1).max(5000) }),
  z.object({ kind: z.literal('questions') }),
])
export type AiJobInput = z.input<typeof aiJobInput>

export interface AiJobDto {
  id: string
  kind: AiJobKind
  status: AiJobStatus
  /** Krótki opis wyniku (np. „uzupełniono 23 parametry, 5 brakuje”). */
  summary: string | null
  error: string | null
  costUsd: number | null
  createdAt: string
  finishedAt: string | null
  createdByName: string | null
}

// ---------------- Materiały wejściowe (krok 2) ----------------

export const INPUT_KINDS = ['file', 'text'] as const
export type InputKind = (typeof INPUT_KINDS)[number]

/** Pliki do tego rozmiaru idą przez serwer; większe — bezpośrednio do Google (sesja resumable). */
export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024
export const INPUT_MAX_BYTES = 30 * 1024 * 1024
/** Typy, które AI czyta bezpośrednio (PDF, obrazy, tekst); inne zapisujemy, ale AI je pomija. */
export const AI_READABLE_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/markdown', 'message/rfc822', 'text/csv', 'application/vnd.google-apps.document']

export const textInput = z.object({ name: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(200_000) })
export const uploadSessionInput = z.object({ name: z.string().trim().min(1).max(300), mimeType: z.string().min(1).max(200), size: z.number().int().min(1).max(INPUT_MAX_BYTES) })

export interface QuoteInputDto {
  id: string
  kind: InputKind
  name: string
  mimeType: string | null
  size: number | null
  driveFileId: string | null
  webViewLink: string | null
  /** Podgląd treści (wklejony tekst). */
  textPreview: string | null
  aiReadable: boolean
  status: 'uploading' | 'ready'
  createdAt: string
  createdByName: string | null
}

// ---------------- Sugestie AI (krok 5) ----------------

export const SUGGESTION_STATUSES = ['pending', 'accepted', 'rejected'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

export interface SuggestionPayload {
  name: string
  group: string | null
  quantity: number
  unit: string | null
  unitCost: number | null
  laborHours: number | null
  laborRate: number | null
  justification: string
  confidence: 'low' | 'medium' | 'high'
}

export interface AiSuggestionDto {
  id: string
  action: 'add' | 'update'
  sectionId: string
  sectionName: string
  deviceName: string
  lineId: string | null
  /** Bieżąca pozycja (dla „update”) — do porównania. */
  current: { name: string; quantity: number; unitCost: number | null; cost: number | null } | null
  payload: SuggestionPayload
  /** Koszt proponowany; null bez `quotesCost:view`. */
  cost: number | null
  status: SuggestionStatus
  jobId: string | null
  createdAt: string
}

// ---------------- Pytania (krok 6) ----------------

export const QUESTION_AUDIENCES = ['internal', 'client'] as const
export type QuestionAudience = (typeof QUESTION_AUDIENCES)[number]
export const QUESTION_STATUSES = ['open', 'answered', 'dismissed'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const questionInput = z.object({
  audience: z.enum(QUESTION_AUDIENCES),
  text: z.string().trim().min(1).max(5000),
  context: z.string().trim().max(5000).nullable().optional(),
  checklistKey: z.string().max(100).nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
})
export const questionPatch = z.object({
  text: z.string().trim().min(1).max(5000).optional(),
  answer: z.string().trim().max(10000).nullable().optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
  assigneeId: z.uuid().nullable().optional(),
})

export interface QuestionDto {
  id: string
  quoteId: string
  quoteLabel: string
  audience: QuestionAudience
  text: string
  context: string | null
  checklistKey: string | null
  status: QuestionStatus
  answer: string | null
  assigneeId: string | null
  assigneeName: string | null
  answeredByName: string | null
  answeredAt: string | null
  source: 'ai' | 'manual'
  createdAt: string
}

// ---------------- Ustawienia AI i Drive ----------------

export interface AiSettings {
  /** Próg ostrzeżenia o kosztach AI w miesiącu [USD] (G6 — bez blokady). */
  monthlyWarnUsd: number | null
  /** Domyślny adresat pytań technicznych (Kamil, B2). */
  questionsAssigneeId: string | null
}
export const aiSettingsInput = z.object({ monthlyWarnUsd: z.number().min(0).max(1e6).nullable(), questionsAssigneeId: z.uuid().nullable() })

export interface AiStatusDto {
  /** Klucz API skonfigurowany (lub atrapa w dev). */
  available: boolean
  fake: boolean
  model: string
  monthUsd: number
  monthCalls: number
  warn: boolean
  settings: AiSettings
}

export const driveSettingsInput = z.object({ sharedDriveId: z.string().trim().min(5).max(200) })
export interface DriveStatusDto {
  configured: boolean
  /** Klient Drive dostępny (konto serwisowe lub atrapa). */
  available: boolean
  fake: boolean
  sharedDriveId: string | null
  driveName: string | null
}
