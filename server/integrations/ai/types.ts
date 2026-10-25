import type { AiUsage } from '#shared'

export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pdf'; title: string; data: string }
  | { type: 'image'; title: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string }

export interface AiRequest {
  /** Cel wywołania (log kosztów). */
  purpose: string
  system: string
  /** Materiały (PDF, obrazy) najpierw, potem tekst zadania. */
  content: AiContentBlock[]
  /** JSON Schema odpowiedzi (structured outputs: obiekty z additionalProperties: false). */
  schema: Record<string, unknown>
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high' | 'xhigh'
  /** Dane wejściowe w postaci obiektu — używa ich tylko atrapa (prawdziwy model dostaje je w treści). */
  context?: unknown
}

export interface AiResult {
  json: unknown
  model: string
  usage: AiUsage
  stopReason: string | null
  durationMs: number
}

export interface AiClient {
  readonly fake: boolean
  run(req: AiRequest): Promise<AiResult>
}

export class AiError extends Error {
  constructor(
    public readonly code: 'refusal' | 'max_tokens' | 'invalid_output' | 'api_error',
    message: string,
    public readonly partial?: Partial<AiResult>,
  ) {
    super(message)
  }
}
