import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  COMPETITION_MATCHES,
  DEFAULT_COMPETITION_GUIDELINES,
  formatProfileSpec,
  formatSpecValue,
  type CompetitionGuidelinesDto,
  type CompetitionResult,
} from '#shared'
import type { Database } from '../../db/client.ts'
import { appSettings, quoteDevices, quotes, users } from '../../db/schema.ts'
import { AiError } from '../../integrations/ai/types.ts'
import { getChecklist } from '../quotes/checklist.ts'
import { callAi, type JobCtx } from './ops.ts'

/** Wytyczne analizy konkurencji — jeden plik Markdown wspólny dla wszystkich wycen (`app_settings`). */
export const COMPETITION_GUIDELINES_KEY = 'quotes.competitionGuidelines'
const DEFAULT_FILE = 'wytyczne-konkurencja.md'

interface StoredGuidelines {
  markdown: string
  fileName: string
  updatedAt: string
  updatedBy: string | null
}

export async function loadGuidelines(db: Database): Promise<CompetitionGuidelinesDto> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, COMPETITION_GUIDELINES_KEY))
  const v = row?.value as StoredGuidelines | undefined
  if (!v?.markdown) return { markdown: DEFAULT_COMPETITION_GUIDELINES, fileName: DEFAULT_FILE, isDefault: true, updatedAt: null, updatedByName: null }
  const [u] = v.updatedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, v.updatedBy)) : []
  return { markdown: v.markdown, fileName: v.fileName, isDefault: false, updatedAt: v.updatedAt, updatedByName: u?.name ?? null }
}

export async function saveGuidelines(db: Database, input: { markdown: string; fileName: string }, userId: string) {
  const value: StoredGuidelines = { markdown: input.markdown, fileName: input.fileName, updatedAt: new Date().toISOString(), updatedBy: userId }
  await db
    .insert(appSettings)
    .values({ key: COMPETITION_GUIDELINES_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })

const productSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  url: z.string().nullable(),
  match: z.enum(COMPETITION_MATCHES),
  specs: z.string(),
  deviations: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  priceNet: z.boolean().nullable(),
  priceNote: z.string().nullable(),
  priceUrl: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
})
const outputSchema = z.object({ summary: z.string(), products: z.array(productSchema) })
const outputJsonSchema = obj({
  summary: { type: 'string' },
  products: {
    type: 'array',
    items: obj({
      manufacturer: { type: 'string' },
      model: { type: 'string' },
      url: nullable('string'),
      match: { type: 'string', enum: [...COMPETITION_MATCHES] },
      specs: { type: 'string' },
      deviations: nullable('string'),
      price: nullable('number'),
      currency: nullable('string'),
      priceNet: nullable('boolean'),
      priceNote: nullable('string'),
      priceUrl: nullable('string'),
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    }),
  },
})

const SYSTEM = `Jesteś analitykiem rynku w firmie Envcheck — polskim producencie komór klimatycznych, temperaturowych i walk-in. Szukasz w sieci produktów konkurencji, które spełniają podane kryteria techniczne, i ustalasz ich ceny. Piszesz po polsku, rzeczowo. Podajesz wyłącznie to, co znalazłeś w źródłach (z linkami); czego nie udało się ustalić, oznaczasz jako nieznane. Nie zmyślasz modeli ani cen.`

const MAX_SEARCHES = 15
const httpUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u.slice(0, 1000) : null)

/** Kryteria wyszukiwania: wartości z checklisty (krok 4) i parametry techniczne wyceny (krok 8). Bez danych klienta. */
async function buildCriteria(db: Database, quoteId: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.id, quoteId))
  const checklist = (await getChecklist(db, q!)).items
  const fromChecklist = checklist
    .filter((i) => i.value && i.status !== 'na' && i.group !== 'Ogólne')
    .map((i) => `${i.group} — ${i.label}: ${formatSpecValue(i.value, i.unit)}${i.status === 'confirmed' ? '' : ' (niepotwierdzone)'}`)
  const spec = formatProfileSpec(q!.profileSpec)
  const fromSpec = spec ? [`Parametry wyceny: ${spec}`] : []
  const s = q!.profileSpec ?? {}
  const outer = [s.outerWidth, s.outerHeight, s.outerDepth]
  if (outer.every((v) => v != null)) fromSpec.push(`Wymiary zewnętrzne (szer. × wys. × gł.): ${outer.join(' × ')} mm`)
  const devices = await db.select({ name: quoteDevices.name, quantity: quoteDevices.quantity }).from(quoteDevices).where(eq(quoteDevices.quoteId, quoteId))
  const count = checklist.find((i) => i.key === 'devices_count')?.value
  const type = checklist.find((i) => i.key === 'chamber_type')?.value
  const head = [
    type ? `Typ urządzenia: ${formatSpecValue(type)}` : null,
    devices.length ? `Urządzenia w wycenie: ${devices.map((d) => `${d.name}${d.quantity > 1 ? ` × ${d.quantity}` : ''}`).join('; ')}` : null,
    count ? `Liczba urządzeń: ${formatSpecValue(count, 'szt.')}` : null,
  ].filter((x): x is string => !!x)
  return { criteria: [...head, ...fromSpec, ...fromChecklist], hasTechnical: fromSpec.length + fromChecklist.length > 0 }
}

/** Krok 4a: wyszukiwanie w sieci produktów konkurencji spełniających kryteria wyceny, z cenami; wynik zastępuje poprzednią analizę. */
export async function analyzeCompetition(ctx: JobCtx, params: { hint?: string | null }) {
  const { deps, quoteId } = ctx
  const { criteria, hasTechnical } = await buildCriteria(deps.db, quoteId)
  if (!hasTechnical) throw new AiError('api_error', 'Brak parametrów do porównania — uzupełnij checklistę parametrów (krok 4) albo parametry techniczne w kroku 8')
  const guidelines = await loadGuidelines(deps.db)
  const result = await callAi(ctx, {
    purpose: 'competition',
    system: SYSTEM,
    content: [
      {
        type: 'text',
        text: `Wytyczne analizy konkurencji (plik „${guidelines.fileName}”, wspólny dla wszystkich wycen):
<wytyczne>
${guidelines.markdown}
</wytyczne>

Kryteria techniczne wycenianego urządzenia:
${criteria.map((c) => `- ${c}`).join('\n')}
${params.hint ? `\nDodatkowe wskazówki od osoby wyceniającej: ${params.hint}\n` : ''}
Wyszukaj w sieci produkty konkurencji spełniające te kryteria i ich ceny — zgodnie z wytycznymi.

Odpowiedź:
- "summary": 3–6 zdań — jak wygląda rynek dla tych parametrów, przedział cen, najbliższe odpowiedniki, czego nie udało się ustalić.
- "products": produkty od najlepiej dopasowanych. "match": "full" — spełnia wszystkie kluczowe kryteria, "partial" — część lub brak danych, "none" — nie spełnia (podaj tylko, gdy to najbliższy dostępny odpowiednik). "specs" — kluczowe parametry produktu wg źródła; "deviations" — czego nie spełnia lub nie potwierdzono; "url" — strona produktu.
- Cena: "price" liczba (bez separatorów), "currency" (PLN, EUR, USD…), "priceNet" — true netto / false brutto / null nieznane, "priceUrl" — źródło ceny, "priceNote" — skąd cena (sklep, cennik, przetarg z datą) i czy to szacunek. Brak ceny — wszystkie pola ceny null.
- "confidence" — pewność dopasowania i ceny.`,
      },
    ],
    schema: outputJsonSchema,
    maxTokens: 32000,
    effort: 'high',
    webSearch: { maxUses: MAX_SEARCHES },
    context: { criteria },
  })
  const parsed = outputSchema.safeParse(result.json)
  if (!parsed.success) throw new AiError('invalid_output', `Odpowiedź modelu niezgodna ze schematem: ${parsed.error.issues[0]?.message ?? ''}`)
  const out = parsed.data
  const competition: CompetitionResult = {
    criteria,
    summary: out.summary.slice(0, 5000),
    products: out.products.slice(0, 15).map((p) => ({
      manufacturer: p.manufacturer.slice(0, 200),
      model: p.model.slice(0, 300),
      url: httpUrl(p.url),
      match: p.match,
      specs: p.specs.slice(0, 2000),
      deviations: p.deviations?.slice(0, 2000) ?? null,
      price: p.price != null && p.price >= 0 ? p.price : null,
      currency: p.currency?.slice(0, 10) ?? null,
      priceNet: p.priceNet,
      priceNote: p.priceNote?.slice(0, 1000) ?? null,
      priceUrl: httpUrl(p.priceUrl),
      confidence: p.confidence,
    })),
    generatedAt: new Date().toISOString(),
    guidelinesFile: guidelines.fileName,
  }
  await deps.db.update(quotes).set({ competition }).where(eq(quotes.id, quoteId))
  const priced = competition.products.filter((p) => p.price != null).length
  const searches = result.usage.webSearches ? `, wyszukiwań: ${result.usage.webSearches}` : ''
  return `Produkty konkurencji: ${competition.products.length} (z ceną: ${priced})${searches}.`
}
