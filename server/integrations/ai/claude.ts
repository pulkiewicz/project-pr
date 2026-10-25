import Anthropic from '@anthropic-ai/sdk'
import { AI_MODEL } from '#shared'
import { AiError, type AiClient, type AiContentBlock, type AiRequest, type AiResult } from './types.ts'

/**
 * Claude przez oficjalne SDK: adaptacyjne myślenie, structured outputs (JSON Schema),
 * serwerowy fallback przy odmowie (`fallbacks: "default"`), strumień dla długich dokumentów.
 * Materiały (PDF/obrazy) są cache'owane — kolejne operacje na tej samej wycenie czytają je taniej.
 */
export class ClaudeClient implements AiClient {
  readonly fake = false
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async run(req: AiRequest): Promise<AiResult> {
    const started = Date.now()
    const lastDoc = req.content.findLastIndex((b) => b.type !== 'text')
    const content = req.content.map((b, i) => toBlock(b, i === lastDoc))
    let message: Anthropic.Beta.BetaMessage
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
          messages: [{ role: 'user', content }],
        })
        .finalMessage()
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw new AiError('api_error', `Claude API ${e.status ?? ''}: ${e.message}`.slice(0, 500))
      throw e
    }
    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    }
    const partial = { model: message.model, usage, stopReason: message.stop_reason, durationMs: Date.now() - started }
    if (message.stop_reason === 'refusal') throw new AiError('refusal', `Model odmówił (${message.stop_details?.category ?? 'bez kategorii'})`, partial)
    if (message.stop_reason === 'max_tokens') throw new AiError('max_tokens', 'Odpowiedź przekroczyła limit tokenów', partial)
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
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
