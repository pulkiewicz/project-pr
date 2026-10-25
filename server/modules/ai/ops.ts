import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  AI_READABLE_MIME,
  aiCostUsd,
  computeCalc,
  formatSpecValue,
  type Action,
  type AiUsage,
  type ModuleKey,
  type ChecklistItemDto,
  type SpecItemDef,
  type SpecValue,
  type SuggestionPayload,
} from '#shared'
import type { AppDeps } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import {
  aiCalls,
  aiJobs,
  aiSuggestions,
  appSettings,
  auditLog,
  components,
  quoteCalcs,
  quoteChecklistItems,
  quoteInputs,
  quoteQuestions,
  quotes,
} from '../../db/schema.ts'
import { AiError, type AiContentBlock, type AiRequest, type AiResult } from '../../integrations/ai/types.ts'
import { CUSTOM_PREFIX, getChecklist, pinSpecList, specListFor } from '../quotes/checklist.ts'
import { getQuote, loadSettings, touch } from '../quotes/service.ts'

export const AI_SETTINGS_KEY = 'ai.settings'
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const CONFIDENCE = { type: 'string', enum: ['low', 'medium', 'high'] }

const ROLE = `Jesteś inżynierem ofertowym firmy Envcheck — polskiego producenta komór klimatycznych, temperaturowych i walk-in (obudowy ze stali nierdzewnej, układy chłodnicze jedno- i dwustopniowe/kaskadowe, automatyka PLC/HMI, nawilżanie, systemy bezpieczeństwa). Piszesz po polsku, rzeczowo, z liczbami. Opierasz się wyłącznie na dostarczonych materiałach i danych; jeśli czegoś nie wiesz, mówisz to wprost.`

// ---------------- Materiały (krok 2) jako treść dla modelu ----------------

/** Pliki z Drive (PDF, obrazy, tekst) i wklejone teksty; pozostałe typy są pomijane z informacją. */
export async function buildMaterials(deps: AppDeps, quoteId: string): Promise<{ blocks: AiContentBlock[]; skipped: string[]; names: string[] }> {
  const rows = await deps.db
    .select()
    .from(quoteInputs)
    .where(and(eq(quoteInputs.quoteId, quoteId), isNull(quoteInputs.deletedAt), isNull(quoteInputs.uploadSessionHash)))
    .orderBy(asc(quoteInputs.createdAt))
  const blocks: AiContentBlock[] = []
  const texts: AiContentBlock[] = []
  const skipped: string[] = []
  const names: string[] = []
  for (const r of rows) {
    if (r.kind === 'text') {
      texts.push({ type: 'text', text: `=== Materiał: ${r.name} (tekst wklejony) ===\n${r.text ?? ''}` })
      names.push(r.name)
      continue
    }
    if (!r.driveFileId || !deps.drive || !AI_READABLE_MIME.includes(r.mimeType ?? '')) {
      skipped.push(r.name)
      continue
    }
    const res = r.mimeType === 'application/vnd.google-apps.document' ? await deps.drive.exportFile(r.driveFileId, 'application/pdf') : await deps.drive.download(r.driveFileId)
    const bytes = Buffer.from(await res.arrayBuffer())
    const mime = r.mimeType === 'application/vnd.google-apps.document' ? 'application/pdf' : r.mimeType!
    if (mime === 'application/pdf') blocks.push({ type: 'pdf', title: r.name, data: bytes.toString('base64') })
    else if (mime.startsWith('image/')) blocks.push({ type: 'image', title: r.name, mediaType: mime as 'image/png', data: bytes.toString('base64') })
    else texts.push({ type: 'text', text: `=== Materiał: ${r.name} ===\n${bytes.toString('utf8')}` })
    names.push(r.name)
  }
  const total = blocks.reduce((a, b) => a + ('data' in b ? b.data.length : 0), 0)
  if (total > 30 * 1024 * 1024) throw new AiError('api_error', 'Materiały przekraczają 30 MB — usuń część plików lub podziel SIWZ')
  return { blocks: [...blocks, ...texts], skipped, names }
}

// ---------------- Log wywołań ----------------

export interface JobCtx {
  deps: AppDeps
  jobId: string
  quoteId: string
  userId: string | null
}

/** Wywołanie modelu z zapisem tokenów i kosztu (także przy błędzie, jeśli znane jest zużycie). */
export async function callAi(ctx: JobCtx, req: AiRequest): Promise<AiResult> {
  const ai = ctx.deps.ai
  if (!ai) throw new AiError('api_error', 'AI nie jest skonfigurowane (brak ANTHROPIC_API_KEY)')
  const log = async (model: string, usage: AiUsage | undefined, extra: { durationMs?: number; stopReason?: string | null; error?: string }) =>
    ctx.deps.db.insert(aiCalls).values({
      jobId: ctx.jobId,
      quoteId: ctx.quoteId,
      purpose: req.purpose,
      model,
      ...(usage ?? {}),
      costUsd: usage ? aiCostUsd(model, usage) : null,
      durationMs: extra.durationMs ?? null,
      stopReason: extra.stopReason ?? null,
      error: extra.error ?? null,
      userId: ctx.userId,
    })
  try {
    const r = await ai.run(req)
    await log(r.model, r.usage, { durationMs: r.durationMs, stopReason: r.stopReason })
    return r
  } catch (e) {
    const partial = e instanceof AiError ? e.partial : undefined
    await log(partial?.model ?? 'unknown', partial?.usage, { durationMs: partial?.durationMs, stopReason: partial?.stopReason, error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
    throw e
  }
}

function parse<T>(schema: z.ZodType<T>, json: unknown): T {
  const r = schema.safeParse(json)
  if (!r.success) throw new AiError('invalid_output', `Odpowiedź modelu niezgodna ze schematem: ${r.error.issues[0]?.message ?? ''}`)
  return r.data
}

// ---------------- 1. Checklista z materiałów (krok 3) ----------------

const extractSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      found: z.boolean(),
      value: z.object({
        text: z.string().nullable(),
        number: z.number().nullable(),
        min: z.number().nullable(),
        max: z.number().nullable(),
        w: z.number().nullable(),
        h: z.number().nullable(),
        d: z.number().nullable(),
        choice: z.string().nullable(),
        bool: z.boolean().nullable(),
      }),
      sourceRef: z.string().nullable(),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  ),
  extra: z.array(z.object({ label: z.string(), value: z.string(), sourceRef: z.string().nullable() })),
})
export type ExtractOutput = z.infer<typeof extractSchema>

function extractJsonSchema(keys: string[]) {
  return obj({
    items: {
      type: 'array',
      items: obj({
        key: { type: 'string', enum: keys },
        found: { type: 'boolean' },
        value: obj({
          text: nullable('string'),
          number: nullable('number'),
          min: nullable('number'),
          max: nullable('number'),
          w: nullable('number'),
          h: nullable('number'),
          d: nullable('number'),
          choice: nullable('string'),
          bool: nullable('boolean'),
        }),
        sourceRef: nullable('string'),
        confidence: CONFIDENCE,
      }),
    },
    extra: { type: 'array', items: obj({ label: { type: 'string' }, value: { type: 'string' }, sourceRef: nullable('string') }) },
  })
}

/** Wartość z odpowiedzi modelu → wartość wg typu parametru; null, gdy brak lub niezgodna. */
export function toSpecValue(def: SpecItemDef, v: ExtractOutput['items'][number]['value']): SpecValue | null {
  switch (def.type) {
    case 'number':
      return v.number != null ? { n: v.number } : null
    case 'range':
      return v.min != null || v.max != null ? { min: v.min, max: v.max } : null
    case 'dims':
      return v.w && v.h && v.d ? { w: v.w, h: v.h, d: v.d } : null
    case 'choice':
      return v.choice && (!def.options?.length || def.options.includes(v.choice)) ? { v: v.choice } : null
    case 'bool':
      return v.bool != null ? { b: v.bool } : null
    default:
      return v.text ? { t: v.text } : null
  }
}

async function extractChecklist(ctx: JobCtx) {
  const { deps, quoteId } = ctx
  const [q] = await deps.db.select().from(quotes).where(eq(quotes.id, quoteId))
  const spec = await specListFor(deps.db, q!)
  const materials = await buildMaterials(deps, quoteId)
  if (!materials.names.length) throw new AiError('api_error', 'Brak materiałów do analizy — dodaj SIWZ, zapytanie lub mail w kroku „Materiały”')
  const defs = spec.items.map(({ key, group, label, type, unit, options, help }) => ({ key, group, label, type, unit, options, help }))
  const result = await callAi(ctx, {
    purpose: 'extract_checklist',
    system: ROLE,
    content: [
      ...materials.blocks,
      {
        type: 'text',
        text: `Powyżej są materiały zapytania ofertowego (${materials.names.join(', ')}). Przypisz wymagania z materiałów do standardowej listy specyfikacyjnej Envcheck.

Zasady:
- Dla KAŻDEGO parametru z listy zwróć element w "items" (found=false, gdy materiały go nie określają — nie zgaduj).
- Wartość wpisz w pole właściwe dla typu: text→text, number→number, range→min/max, dims→w/h/d [mm, szerokość×wysokość×głębokość], choice→choice (dokładnie jedna z opcji), bool→bool. Pozostałe pola null.
- Temperatury w °C, wilgotność w %RH, prędkość zmian w K/min (°C/min = K/min). Jeśli podano wartość minimalną i rekomendowaną, użyj odpowiednich parametrów listy.
- "sourceRef": krótki dosłowny cytat z materiału (do 200 znaków) i miejsce, np. „„Zakres temperatur: -60…+70 °C” — Opis komory, str. 2”.
- "confidence": high — wprost w materiałach; medium — wymaga interpretacji; low — wniosek pośredni.
- "extra": wymagania istotne dla wyceny, których nie ma na liście (np. dokumenty do oferty, warunki serwisu, nietypowe wyposażenie).

Lista parametrów (JSON):
${JSON.stringify(defs)}`,
      },
    ],
    schema: extractJsonSchema(defs.map((d) => d.key)),
    maxTokens: 32000,
    effort: 'high',
    context: { defs, materials: materials.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text) },
  })
  const out = parse(extractSchema, result.json)
  const existing = new Map((await getChecklist(deps.db, q!)).items.map((i) => [i.key, i]))
  let filled = 0
  let missing = 0
  let extra = 0
  await deps.db.transaction(async (tx) => {
    await pinSpecList(tx, q!)
    for (const item of out.items) {
      const def = spec.items.find((d) => d.key === item.key)
      const cur = existing.get(item.key)
      // Pozycji potwierdzonych przez człowieka i „nie dotyczy” AI nie zmienia.
      if (!def || (cur && (cur.status === 'confirmed' || cur.status === 'na'))) continue
      const value = item.found ? toSpecValue(def, item.value) : null
      if (value) {
        filled++
        await upsertItem(tx, quoteId, def.key, spec.items.indexOf(def), { value, status: 'pending', sourceRef: item.sourceRef, note: `AI — pewność: ${item.confidence}` }, ctx.userId)
      } else if (!cur?.value) {
        missing++
        await upsertItem(tx, quoteId, def.key, spec.items.indexOf(def), { value: null, status: 'missing', sourceRef: null, note: 'AI: brak w materiałach' }, ctx.userId)
      }
    }
    const labels = new Set([...existing.values()].filter((i) => i.custom).map((i) => i.label.toLowerCase()))
    for (const e of out.extra) {
      if (labels.has(e.label.toLowerCase())) continue
      extra++
      await tx.insert(quoteChecklistItems).values({
        quoteId,
        key: `${CUSTOM_PREFIX}${crypto.randomUUID()}`,
        label: e.label.slice(0, 500),
        group: 'Wymagania dodatkowe',
        value: { t: e.value.slice(0, 5000) },
        sourceRef: e.sourceRef?.slice(0, 2000) ?? null,
        note: 'AI',
        sortOrder: 1000,
        updatedBy: ctx.userId,
      })
    }
    await touch(tx, quoteId, ctx.userId)
  })
  const skippedNote = materials.skipped.length ? ` Pominięte (format nieobsługiwany): ${materials.skipped.join(', ')}.` : ''
  return `Uzupełniono ${filled} parametrów, brak w materiałach: ${missing}, wymagania dodatkowe: ${extra}.${skippedNote}`
}

async function upsertItem(
  tx: Database,
  quoteId: string,
  key: string,
  sortOrder: number,
  v: { value: SpecValue | null; status: 'pending' | 'missing'; sourceRef: string | null; note: string },
  userId: string | null,
) {
  const values = { value: v.value, status: v.status, sourceRef: v.sourceRef?.slice(0, 2000) ?? null, note: v.note, updatedAt: sql`now()`, updatedBy: userId }
  await tx
    .insert(quoteChecklistItems)
    .values({ quoteId, key, sortOrder, ...values })
    .onConflictDoUpdate({ target: [quoteChecklistItems.quoteId, quoteChecklistItems.key], set: values })
}

// ---------------- 2. Propozycja pozycji / przeliczenie pozycji (krok 5) ----------------

const suggestionSchema = z.object({
  action: z.enum(['add', 'update']),
  lineId: z.string().nullable(),
  sectionId: z.string(),
  name: z.string().min(1),
  group: z.string().nullable(),
  quantity: z.number().min(0),
  unit: z.string().nullable(),
  unitCost: z.number().min(0).nullable(),
  laborHours: z.number().min(0).nullable(),
  laborRate: z.number().min(0).nullable(),
  justification: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
})
const proposeSchema = z.object({ suggestions: z.array(suggestionSchema), notes: z.string() })
export type ProposeOutput = z.infer<typeof proposeSchema>

const proposeJsonSchema = obj({
  suggestions: {
    type: 'array',
    items: obj({
      action: { type: 'string', enum: ['add', 'update'] },
      lineId: nullable('string'),
      sectionId: { type: 'string' },
      name: { type: 'string' },
      group: nullable('string'),
      quantity: { type: 'number' },
      unit: nullable('string'),
      unitCost: nullable('number'),
      laborHours: nullable('number'),
      laborRate: nullable('number'),
      justification: { type: 'string' },
      confidence: CONFIDENCE,
    }),
  },
  notes: { type: 'string' },
})

/** Kontekst wyceny dla modelu: checklista, struktura z kosztami, kalkulacje, katalog, inne wyceny, odpowiedzi na pytania. */
async function quoteContext(deps: AppDeps, quoteId: string) {
  const db = deps.db
  // Kontekst dla modelu zawsze z kosztami — uprawnienie do uruchomienia sprawdza API przy tworzeniu zadania.
  const allPerms = new Set<`${ModuleKey}:${Action}`>(['quotes:view', 'quoteKnowledge:view', 'quotesCost:view', 'quotesPricing:view'])
  const q = await getQuote(db, allPerms, quoteId)
  const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteId))
  const checklist = (await getChecklist(db, row!)).items
    .filter((i) => i.value || i.status === 'missing')
    .map((i: ChecklistItemDto) => ({ parametr: i.label, wartosc: formatSpecValue(i.value, i.unit) || null, status: i.status }))
  const structure = q.devices.map((d) => ({
    urzadzenie: d.name,
    ilosc: d.quantity,
    opcja: d.isOption,
    sekcje: d.sections.map((s) => ({
      sectionId: s.id,
      sekcja: s.name,
      pozycje: s.lines.map((l) => ({ lineId: l.id, nazwa: l.name, grupa: l.group, ilosc: l.quantity, jm: l.unit, cenaJedn: l.unitCost, roboczogodziny: l.laborHours, stawka: l.laborRate, koszt: l.cost, uzasadnienie: l.justification, zrodlo: l.source, zatwierdzona: l.approved })),
    })),
  }))
  const calcs = (await db.select().from(quoteCalcs).where(eq(quoteCalcs.quoteId, quoteId))).map((k) => {
    const r = computeCalc(k.input)
    return { kalkulacja: k.name, tryb: k.input.mode, mocKw: r.totalKw, wymaganaKw: r.requiredKw }
  })
  const catalog = (await db.select().from(components).where(isNull(components.deletedAt)).orderBy(asc(components.category)).limit(300)).map((c) => ({
    kategoria: c.category,
    nazwa: c.name,
    producent: c.manufacturer,
    cena: c.price,
    dataCeny: c.priceDate,
    wydajnoscW: c.capacityW,
    tempOdparowania: c.evapTempC,
  }))
  const others = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(ne(quotes.id, quoteId), isNull(quotes.deletedAt), eq(quotes.kind, 'quote')))
    .orderBy(desc(quotes.updatedAt))
    .limit(5)
  const history = []
  for (const o of others) {
    const oq = await getQuote(db, allPerms, o.id)
    history.push({
      wycena: `${oq.opportunityCode} rew. ${oq.revision} — ${oq.opportunityName ?? ''}`,
      status: oq.status,
      koszt: oq.costSummary?.cost ?? null,
      sekcje: oq.devices.flatMap((d) => d.sections.map((s) => ({ sekcja: s.name, koszt: s.cost, pozycje: s.lines.map((l) => `${l.group ? `${l.group}: ` : ''}${l.name} = ${l.cost}`) }))),
    })
  }
  const answers = (await db.select().from(quoteQuestions).where(and(eq(quoteQuestions.quoteId, quoteId), eq(quoteQuestions.status, 'answered')))).map((a) => ({ pytanie: a.text, odpowiedz: a.answer }))
  const { laborRate } = await loadSettings(db)
  return { quote: q, checklist, structure, calcs, catalog, history, answers, laborRate }
}

async function proposeLines(ctx: JobCtx, params: { hint?: string | null; lineId?: string; comment?: string }) {
  const { deps, quoteId } = ctx
  const c = await quoteContext(deps, quoteId)
  const materials = await buildMaterials(deps, quoteId)
  const single = params.lineId ? c.structure.flatMap((d) => d.sekcje.flatMap((s) => s.pozycje.map((p) => ({ ...p, sectionId: s.sectionId })))).find((p) => p.lineId === params.lineId) : null
  if (params.lineId && !single) throw new AiError('api_error', 'Pozycja nie należy do tej wyceny')
  const task = single
    ? `Przelicz JEDNĄ pozycję wyceny (lineId=${single.lineId}, sectionId=${single.sectionId}): „${single.nazwa}”. Komentarz użytkownika: „${params.comment}”. Zwróć dokładnie jedną sugestię action="update" dla tej pozycji.`
    : `Zaproponuj wycenę kosztów wykonania: zaktualizuj istniejące pozycje (action="update", podaj lineId i sectionId) i dodaj brakujące (action="add", sectionId sekcji). Nie zmieniaj pozycji już zatwierdzonych, chyba że są wyraźnie sprzeczne z wymaganiami.${params.hint ? ` Wskazówki użytkownika: „${params.hint}”.` : ''}`
  const result = await callAi(ctx, {
    purpose: single ? 'reestimate_line' : 'propose_lines',
    system: ROLE,
    content: [
      ...materials.blocks,
      {
        type: 'text',
        text: `${task}

Zasady:
- Koszty to koszty wykonania netto w PLN (bez marży i rezerwy — te liczy aplikacja). unitCost to cena jednostkowa lub kwota ryczałtowa przy ilości 1; robociznę podawaj jako laborHours × laborRate, gdy ma to sens.
- ${c.laborRate != null ? `Stawka robocizny Envcheck: ${c.laborRate} PLN/h — używaj jej jako laborRate (inną tylko z uzasadnieniem, np. podwykonawca).` : 'Stawka robocizny nie jest ustalona w ustawieniach — przy robociźnie zostaw laborRate=null, podaj laborHours i zaznacz to w uzasadnieniu.'}
- Każda propozycja ma "justification": jak policzono — z czego wynika kwota (profil/poprzednia wycena z nazwą, pozycja katalogu z ceną i datą, wynik kalkulatora mocy, parametr z checklisty) i ilość.
- Opieraj się na: checkliście, kalkulacjach mocy, katalogu komponentów i podobnych wycenach. Gdy brak danych, zaproponuj ostrożny szacunek i ustaw confidence="low".
- "notes": najważniejsze założenia i ryzyka (krótko).

Wycena (JSON):
${JSON.stringify({ checklista: c.checklist, struktura: c.structure, kalkulacje: c.calcs, odpowiedziNaPytania: c.answers })}

Katalog komponentów (JSON):
${JSON.stringify(c.catalog)}

Poprzednie wyceny (JSON):
${JSON.stringify(c.history)}`,
      },
    ],
    schema: proposeJsonSchema,
    maxTokens: 48000,
    effort: 'high',
    context: { structure: c.structure, single, comment: params.comment ?? null },
  })
  const out = parse(proposeSchema, result.json)
  const sections = new Map(c.structure.flatMap((d) => d.sekcje.map((s) => [s.sectionId, new Set(s.pozycje.map((p) => p.lineId))] as const)))
  const valid = out.suggestions.filter((s) => {
    const lines = sections.get(s.sectionId)
    if (!lines) return false
    if (s.action === 'update') return !!s.lineId && lines.has(s.lineId) && (!single || s.lineId === single.lineId)
    return !single
  })
  await deps.db.transaction(async (tx) => {
    // Nowa propozycja zastępuje wcześniejsze nierozpatrzone (całej wyceny albo tej pozycji).
    await tx
      .update(aiSuggestions)
      .set({ status: 'rejected', decidedAt: sql`now()` })
      .where(and(eq(aiSuggestions.quoteId, quoteId), eq(aiSuggestions.status, 'pending'), single ? eq(aiSuggestions.lineId, single.lineId) : undefined))
    if (valid.length) {
      await tx.insert(aiSuggestions).values(
        valid.slice(0, 300).map((s) => ({
          quoteId,
          jobId: ctx.jobId,
          sectionId: s.sectionId,
          lineId: s.action === 'update' ? s.lineId : null,
          payload: {
            name: s.name.slice(0, 300),
            group: s.group?.slice(0, 100) ?? null,
            quantity: s.quantity,
            unit: s.unit?.slice(0, 20) ?? null,
            unitCost: s.unitCost,
            laborHours: s.laborHours,
            laborRate: s.laborRate ?? (s.laborHours != null ? c.laborRate : null),
            justification: s.justification.slice(0, 10000),
            confidence: s.confidence,
          } satisfies SuggestionPayload,
        })),
      )
    }
  })
  const dropped = out.suggestions.length - valid.length
  return `Propozycje: ${valid.length}${dropped ? ` (odrzucone jako niepasujące do wyceny: ${dropped})` : ''}. ${out.notes}`.trim().slice(0, 2000)
}

// ---------------- 3. Pytania doprecyzowujące (krok 6) ----------------

const questionsSchema = z.object({
  questions: z.array(z.object({ audience: z.enum(['internal', 'client']), text: z.string().min(1), context: z.string().nullable(), checklistKey: z.string().nullable() })),
})
export type QuestionsOutput = z.infer<typeof questionsSchema>
const questionsJsonSchema = obj({
  questions: {
    type: 'array',
    items: obj({ audience: { type: 'string', enum: ['internal', 'client'] }, text: { type: 'string' }, context: nullable('string'), checklistKey: nullable('string') }),
  },
})

export async function loadAiSettings(db: Database) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY))
  const v = (row?.value ?? {}) as { monthlyWarnUsd?: number | null; questionsAssigneeId?: string | null }
  return { monthlyWarnUsd: v.monthlyWarnUsd ?? null, questionsAssigneeId: v.questionsAssigneeId ?? null }
}

async function generateQuestions(ctx: JobCtx) {
  const { deps, quoteId } = ctx
  const [q] = await deps.db.select().from(quotes).where(eq(quotes.id, quoteId))
  const checklist = (await getChecklist(deps.db, q!)).items
  const gaps = checklist.filter((i) => i.status === 'missing' || (i.status === 'pending' && /pewność: low/.test(i.note ?? '')))
  const lowLines = await deps.db
    .select({ payload: aiSuggestions.payload })
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.quoteId, quoteId), eq(aiSuggestions.status, 'pending')))
  const open = await deps.db.select({ text: quoteQuestions.text }).from(quoteQuestions).where(and(eq(quoteQuestions.quoteId, quoteId), ne(quoteQuestions.status, 'dismissed')))
  const result = await callAi(ctx, {
    purpose: 'questions',
    system: ROLE,
    content: [
      {
        type: 'text',
        text: `Przygotuj pytania doprecyzowujące do wyceny:
- audience="internal" — techniczne pytania do Kamila (inżynier Envcheck): dobór układu chłodzenia, sprężarek, izolacji, automatyki, założenia kosztowe;
- audience="client" — pytania do zamawiającego o brakujące lub niejednoznaczne wymagania (uprzejmie, konkretnie, do wysłania mailem).
Każde pytanie jedno zagadnienie; "context" — dlaczego pytamy; "checklistKey" — klucz parametru, którego dotyczy (lub null). Nie powtarzaj pytań już zadanych. Najwyżej 15 pytań, najważniejsze najpierw.

Braki i niepewności w checkliście (JSON):
${JSON.stringify(gaps.map((g) => ({ key: g.key, parametr: g.label, status: g.status, wartosc: formatSpecValue(g.value, g.unit) || null, notatka: g.note })))}

Propozycje kosztów o niskiej pewności (JSON):
${JSON.stringify(lowLines.filter((l) => l.payload.confidence === 'low').map((l) => ({ pozycja: l.payload.name, uzasadnienie: l.payload.justification })))}

Pytania już zadane (JSON):
${JSON.stringify(open.map((o) => o.text))}`,
      },
    ],
    schema: questionsJsonSchema,
    maxTokens: 16000,
    effort: 'medium',
    context: { gaps: gaps.map((g) => ({ key: g.key, label: g.label })) },
  })
  const out = parse(questionsSchema, result.json)
  const settings = await loadAiSettings(deps.db)
  const keys = new Set(checklist.map((i) => i.key))
  const existing = new Set(open.map((o) => o.text.trim().toLowerCase()))
  const fresh = out.questions.filter((x) => !existing.has(x.text.trim().toLowerCase())).slice(0, 15)
  if (fresh.length) {
    await deps.db.insert(quoteQuestions).values(
      fresh.map((x) => ({
        quoteId,
        audience: x.audience,
        text: x.text.slice(0, 5000),
        context: x.context?.slice(0, 5000) ?? null,
        checklistKey: x.checklistKey && keys.has(x.checklistKey) ? x.checklistKey : null,
        assigneeId: x.audience === 'internal' ? settings.questionsAssigneeId : null,
        source: 'ai',
        createdBy: ctx.userId,
      })),
    )
  }
  const internal = fresh.filter((x) => x.audience === 'internal').length
  return `Pytania: ${internal} do Kamila, ${fresh.length - internal} do klienta.`
}

// ---------------- Wykonanie zadania ----------------

/**
 * Wykonuje zadanie AI (wywoływane przez funkcję w tle po weryfikacji tokenu albo inline w testach).
 * Zadanie przechodzi queued → running → done/error; wynik i błąd w `ai_jobs`, koszty w `ai_calls`.
 */
export async function runAiJob(deps: AppDeps, jobId: string, token: string): Promise<'done' | 'error' | 'rejected'> {
  const [claimed] = await deps.db
    .update(aiJobs)
    .set({ status: 'running', startedAt: sql`now()` })
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.tokenHash, sha256(token)), eq(aiJobs.status, 'queued')))
    .returning()
  if (!claimed) return 'rejected'
  const ctx: JobCtx = { deps, jobId, quoteId: claimed.quoteId, userId: claimed.createdBy }
  const params = claimed.params as { hint?: string | null; lineId?: string; comment?: string }
  try {
    const summary =
      claimed.kind === 'extract_checklist'
        ? await extractChecklist(ctx)
        : claimed.kind === 'questions'
          ? await generateQuestions(ctx)
          : await proposeLines(ctx, params)
    await deps.db.update(aiJobs).set({ status: 'done', summary, finishedAt: sql`now()` }).where(eq(aiJobs.id, jobId))
    await deps.db.insert(auditLog).values({ userId: claimed.createdBy, action: `ai.${claimed.kind}`, entity: 'quotes', entityId: claimed.quoteId, changes: { jobId, summary } })
    return 'done'
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 1000) : String(e)
    console.error(`[pmo] ai job ${jobId} (${claimed.kind}) failed:`, message)
    await deps.db.update(aiJobs).set({ status: 'error', error: message, finishedAt: sql`now()` }).where(eq(aiJobs.id, jobId))
    return 'error'
  }
}

/** Nierozpoczęte lub zawieszone zadania starsze niż 20 min oznaczane jako błąd (funkcja w tle ma limit 15 min). */
export async function expireStaleJobs(db: Database, quoteId: string) {
  await db
    .update(aiJobs)
    .set({ status: 'error', error: 'Przekroczony czas wykonania zadania', finishedAt: sql`now()` })
    .where(and(eq(aiJobs.quoteId, quoteId), inArray(aiJobs.status, ['queued', 'running']), sql`${aiJobs.createdAt} < now() - interval '20 minutes'`))
}
