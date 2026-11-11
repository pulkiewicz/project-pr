import Anthropic from '@anthropic-ai/sdk'
import { AI_MODEL, type AiUsage } from '#shared'
import { AiError, type AiClient, type AiContentBlock, type AiRequest, type AiResult } from './types.ts'

/** Wznowienia tury po `pause_turn` (długie wyszukiwanie w sieci). */
const MAX_CONTINUATIONS = 5

/**
 * Claude przez oficjalne SDK: adaptacyjne myślenie, structured outputs (JSON Schema),
 * serwerowy fallback przy odmowie (`fallbacks: "default"`), strumień dla długich dokumentów.
 * Materiały (PDF/obrazy) są cache'owane — kolejne operacje na tej samej wycenie czytają je taniej.
 * Opcjonalnie wyszukiwanie w sieci (narzędzie serwerowe web search) z wznawianiem `pause_turn`.
 */
export class ClaudeClient implements AiClient {
  readonly fake = false
  private readonly client: Anthropic

  /** `workspaceId` — wymagany przez API dla kluczy organizacji niezwiązanych z workspace'em (nagłówek `anthropic-workspace-id`). */
  constructor(apiKey: string, workspaceId?: string | null) {
    this.client = new Anthropic({ apiKey, defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined })
  }

  async run(req: AiRequest): Promise<AiResult> {
    const started = Date.now()
    const lastDoc = req.content.findLastIndex((b) => b.type !== 'text')
    const content = req.content.map((b, i) => toBlock(b, i === lastDoc))
    const tools: Anthropic.Beta.BetaToolUnion[] | undefined = req.webSearch ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: req.webSearch.maxUses }] : undefined
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }]
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 }
    let message: Anthropic.Beta.BetaMessage | null = null
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      try {
        message = await this.client.beta.messages
          .stream({
            model: AI_MODEL,
            max_tokens: req.maxTokens ?? 32000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: req.effort ?? 'high', format: { type: 'json_schema', schema: req.schema } },
            system: req.system,
            messages,
            ...(tools ? { tools } : {}),
          })
          .finalMessage()
      } catch (e) {
        if (e instanceof Anthropic.APIError) throw new AiError('api_error', `Claude API ${e.status ?? ''}: ${e.message}`.slice(0, 500), i > 0 ? { usage } : undefined)
        throw e
      }
      usage.inputTokens += message.usage.input_tokens
      usage.outputTokens += message.usage.output_tokens
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0
      usage.webSearches! += message.usage.server_tool_use?.web_search_requests ?? 0
      // Serwer przerwał długą turę (limit iteracji narzędzi) — wznowienie z dotychczasową odpowiedzią, bez dodatkowej wiadomości.
      if (message.stop_reason !== 'pause_turn') break
      const prev = messages[1]?.content
      const sofar = Array.isArray(prev) ? (prev as Anthropic.Beta.BetaContentBlockParam[]) : []
      messages.splice(1, messages.length - 1, { role: 'assistant', content: [...sofar, ...(message.content as Anthropic.Beta.BetaContentBlockParam[])] })
    }
    const m = message!
    const partial = { model: m.model, usage, stopReason: m.stop_reason, durationMs: Date.now() - started }
    if (m.stop_reason === 'refusal') throw new AiError('refusal', `Model odmówił (${m.stop_details?.category ?? 'bez kategorii'})`, partial)
    if (m.stop_reason === 'max_tokens') throw new AiError('max_tokens', 'Odpowiedź przekroczyła limit tokenów', partial)
    if (m.stop_reason === 'pause_turn') throw new AiError('api_error', 'Wyszukiwanie nie zakończyło się w limicie wznowień', partial)
    // Odpowiedź JSON to tekst po ostatnim wyniku narzędzia (wcześniejszy tekst to komentarze między wyszukiwaniami).
    const lastTool = m.content.findLastIndex((b) => b.type !== 'text' && b.type !== 'thinking' && b.type !== 'redacted_thinking')
    const text = m.content
      .slice(lastTool + 1)
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
    try {
      return { ...partial, json: JSON.parse(text) }
    } catch {
      throw new AiError('invalid_output', 'Odpowiedź modelu nie jest poprawnym JSON', partial)
    }
  }
}

function toBlock(b: AiContentBlock, cache: boolean): Anthropic.Beta.BetaContentBlockParam {
  const cacheControl = cache ? { cache_control: { type: 'ephemeral' as const } } : {}
  if (b.type === 'text') return { type: 'text', text: b.text }
  if (b.type === 'pdf') return { type: 'document', title: b.title, source: { type: 'base64', media_type: 'application/pdf', data: b.data }, ...cacheControl }
  return { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data }, ...cacheControl }
}
