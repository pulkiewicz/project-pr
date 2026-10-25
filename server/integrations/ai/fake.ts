import type { AiClient, AiRequest, AiResult } from './types.ts'

type Handler = (req: AiRequest) => unknown

/**
 * Atrapa AI (testy i lokalny dev bez klucza): deterministyczne odpowiedzi zgodne ze schematami operacji,
 * wyliczane z `req.context`. Pozwala zbudować i sprawdzić cały przepływ bez wywołań Claude.
 */
export class FakeAiClient implements AiClient {
  readonly fake = true
  calls: AiRequest[] = []
  /** Nadpisanie odpowiedzi dla danego celu (testy). */
  overrides = new Map<string, Handler>()

  async run(req: AiRequest): Promise<AiResult> {
    this.calls.push(req)
    const handler = this.overrides.get(req.purpose) ?? DEFAULTS[req.purpose]
    if (!handler) throw new Error(`FakeAiClient: brak odpowiedzi dla „${req.purpose}”`)
    return { json: handler(req), model: 'claude-opus-5-5', usage: { inputTokens: 12000, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: 'end_turn', durationMs: 5 }
  }
}

const EMPTY = { text: null, number: null, min: null, max: null, w: null, h: null, d: null, choice: null, bool: null }

const DEFAULTS: Record<string, Handler> = {
  /** Szuka w tekstach materiałów zakresu temperatur („-60 … +70”) i wymiarów („300x300x700”). */
  extract_checklist: (req) => {
    const ctx = req.context as { defs: { key: string }[]; materials: string[] }
    const text = ctx.materials.join('\n')
    const temps = [...text.matchAll(/([+-−]\s?\d{1,3})\s?(?:°C|℃|C\b)/g)].map((m) => Number(m[1]!.replace('−', '-').replace(/\s/g, '')))
    const dims = text.match(/(\d{3,4})\s?[x×]\s?(\d{3,4})\s?[x×]\s?(\d{3,4})/)
    return {
      items: ctx.defs.map((d) => {
        if (d.key === 'temp_range' && temps.length >= 2)
          return { key: d.key, found: true, value: { ...EMPTY, min: Math.min(...temps), max: Math.max(...temps) }, sourceRef: `„${temps.join(' / ')} °C” — materiały`, confidence: 'high' }
        if (d.key === 'inner_dims' && dims)
          return { key: d.key, found: true, value: { ...EMPTY, w: Number(dims[1]), h: Number(dims[2]), d: Number(dims[3]) }, sourceRef: `„${dims[0]}” — materiały`, confidence: 'medium' }
        return { key: d.key, found: false, value: EMPTY, sourceRef: null, confidence: 'low' }
      }),
      extra: text ? [{ label: 'Oferta z kartami katalogowymi i warunkami serwisu', value: 'wg zapytania', sourceRef: null }] : [],
    }
  },
  /** Pozycje bez kosztu dostają 1000 zł; przy przeliczeniu jednej pozycji — koszt +10%. */
  propose_lines: (req) => {
    const ctx = req.context as { structure: { sekcje: { sectionId: string; pozycje: { lineId: string; nazwa: string; ilosc: number; cenaJedn: number | null }[] }[] }[] }
    const suggestions = ctx.structure.flatMap((d) =>
      d.sekcje.flatMap((s) =>
        s.pozycje
          .filter((p) => p.cenaJedn == null)
          .map((p) => ({ action: 'update', lineId: p.lineId, sectionId: s.sectionId, name: p.nazwa, group: null, quantity: p.ilosc || 1, unit: null, unitCost: 1000, laborHours: null, laborRate: null, justification: 'Atrapa AI: szacunek 1000 zł (brak danych).', confidence: 'low' })),
      ),
    )
    return { suggestions, notes: 'Atrapa AI — wartości przykładowe.' }
  },
  reestimate_line: (req) => {
    const ctx = req.context as { single: { lineId: string; sectionId: string; nazwa: string; ilosc: number; cenaJedn: number | null }; comment: string }
    const s = ctx.single
    return {
      suggestions: [{ action: 'update', lineId: s.lineId, sectionId: s.sectionId, name: s.nazwa, group: null, quantity: s.ilosc || 1, unit: null, unitCost: Math.round((s.cenaJedn ?? 1000) * 1.1), laborHours: null, laborRate: null, justification: `Atrapa AI: +10% wg komentarza „${ctx.comment}”.`, confidence: 'medium' }],
      notes: 'Atrapa AI.',
    }
  },
  questions: (req) => {
    const ctx = req.context as { gaps: { key: string; label: string }[] }
    return {
      questions: [
        ...ctx.gaps.slice(0, 3).map((g) => ({ audience: 'client', text: `Prosimy o doprecyzowanie: ${g.label}.`, context: 'Brak w materiałach zapytania.', checklistKey: g.key })),
        { audience: 'internal', text: 'Jaki zapas mocy przyjmujemy przy doborze sprężarek dla tej komory?', context: 'Reguła doboru (E2).', checklistKey: null },
      ],
    }
  },
}
