import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, eq, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import {
  DEFAULT_PARAMS,
  QUOTE_KINDS,
  devicePatch,
  deviceInput,
  linePatch,
  lineInput,
  nextRevision,
  quoteCreateInput,
  quotePatch,
  quoteSettingsInput,
  quoteStatusInput,
  saveAsProfileInput,
  sectionInput,
  sectionPatch,
  DEFAULT_SECTIONS,
  type Action,
  type QuoteDto,
  type QuoteKind,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { appSettings, opportunities, quoteDevices, quoteLines, quoteSections, quotes } from '../../db/schema.ts'
import { HttpProblem, conflict, forbidden } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import {
  QUOTE_SETTINGS_KEY,
  addDefaultDevice,
  assertEditable,
  assertKind,
  copyTree,
  deviceOf,
  getQuote,
  getQuoteRow,
  lineOf,
  listQuotes,
  loadSettings,
  sectionOf,
  touch,
} from './service.ts'

export const quotesRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const created = { 201: { description: 'Utworzono', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const deviceParam = idParam.extend({ deviceId: z.uuid() })
const sectionParam = idParam.extend({ sectionId: z.uuid() })
const lineParam = idParam.extend({ lineId: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: 'quotes' | 'quotesPricing', action: Action) => secureRoute('', r, { permission: { module, action } })

const perms = (c: Context<AppEnv>) => c.get('permissions')
const canPricing = (c: Context<AppEnv>, a: Action) => perms(c).has(`quotesPricing:${a}`)
const COST_FIELDS = ['unitCost', 'laborRate'] as const

/** Koszty pozycji wymagają `quotesCost:edit`; marża, rezerwa i cena — `quotesPricing:edit`. */
function assertLineCosts(c: Context<AppEnv>, input: Record<string, unknown>) {
  if (COST_FIELDS.some((f) => input[f] !== undefined && input[f] !== null) && !perms(c).has('quotesCost:edit')) throw forbidden('cost_forbidden')
}

async function respond<S extends 200 | 201 = 200>(c: Context<AppEnv>, id: string, status: S = 200 as S) {
  return c.json(await getQuote(c.get('deps').db, perms(c), id), status)
}

/** Zmiana w drzewie wyceny: kontrola, transakcja, podbicie wersji, wpis w audit logu. */
async function mutate(c: Context<AppEnv>, quoteId: string, action: string, fn: (tx: Database) => Promise<unknown>) {
  const db = c.get('deps').db
  await assertEditable(db, perms(c), quoteId)
  await db.transaction(async (tx) => {
    const changes = await fn(tx)
    await touch(tx, quoteId, c.get('user').id)
    await writeAudit(c, { action, entity: 'quotes', entityId: quoteId, changes }, tx)
  })
  return respond(c, quoteId)
}

// ---------------- Ustawienia (rezerwa, stawka robocizny) ----------------

quotesRouter.openapi(route({ method: 'get', path: '/quotes/settings', responses: ok }, 'quotes', 'view'), async (c) => c.json(await loadSettings(c.get('deps').db), 200))

quotesRouter.openapi(
  route({ method: 'put', path: '/quotes/settings', request: { body: body(quoteSettingsInput) }, responses: ok }, 'quotesPricing', 'edit'),
  async (c) => {
    const value = c.req.valid('json')
    const db = c.get('deps').db
    const before = await loadSettings(db)
    await db.transaction(async (tx) => {
      await tx
        .insert(appSettings)
        .values({ key: QUOTE_SETTINGS_KEY, value, updatedBy: c.get('user').id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: c.get('user').id } })
      await writeAudit(c, { action: 'quotes.settings', entity: 'app_settings', entityId: QUOTE_SETTINGS_KEY, changes: { old: before, new: value } }, tx)
    })
    return c.json(value, 200)
  },
)

// ---------------- Wyceny i profile ----------------

quotesRouter.openapi(
  route({ method: 'get', path: '/quotes', request: { query: z.object({ kind: z.enum(QUOTE_KINDS).default('quote'), opportunityId: z.uuid().optional() }) }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { kind, opportunityId } = c.req.valid('query')
    assertKind(perms(c), kind, 'view')
    return c.json(await listQuotes(c.get('deps').db, perms(c), kind, opportunityId ? eq(quotes.opportunityId, opportunityId) : undefined), 200)
  },
)

async function createQuote(
  c: Context<AppEnv>,
  tx: Database,
  v: { kind: QuoteKind; opportunityId: string | null; name: string | null; description: string | null; basedOnId: string | null },
) {
  let params = DEFAULT_PARAMS
  let basedOnLabel: string | null = null
  let source: 'profile' | 'previous' = 'previous'
  let info = {}
  if (v.basedOnId) {
    const base = await getQuoteRow(tx, v.basedOnId)
    assertKind(perms(c), base.kind, 'view')
    // Parametry (marża, złożoność, gwarancja) z wyceny bazowej; nadpisanie rezerwy z importu nie przechodzi dalej.
    params = { ...DEFAULT_PARAMS, ...base.params, reservePctOverride: base.kind === 'profile' ? base.params.reservePctOverride : null }
    if (base.kind === 'profile') {
      source = 'profile'
      basedOnLabel = `Profil: ${base.name ?? ''}`
    } else {
      const [o] = base.opportunityId ? await tx.select({ code: opportunities.code }).from(opportunities).where(eq(opportunities.id, base.opportunityId)) : []
      basedOnLabel = `Wycena ${o?.code ?? ''} rew. ${base.revision ?? ''}`.trim()
      if (base.opportunityId === v.opportunityId) info = base.info ?? {}
    }
  }
  let revision: string | null = null
  if (v.kind === 'quote') {
    const [opp] = await tx.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.id, v.opportunityId!), isNull(opportunities.deletedAt)))
    if (!opp) throw new HttpProblem(422, 'opportunity_not_found')
    const existing = await tx.select({ revision: quotes.revision }).from(quotes).where(and(eq(quotes.opportunityId, v.opportunityId!), eq(quotes.kind, 'quote')))
    revision = nextRevision(existing.map((r) => r.revision ?? ''))
  }
  const user = c.get('user')
  const [q] = await tx
    .insert(quotes)
    .values({
      kind: v.kind,
      opportunityId: v.kind === 'quote' ? v.opportunityId : null,
      revision,
      name: v.name,
      description: v.description,
      basedOnId: v.basedOnId,
      basedOnLabel,
      params,
      info,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: quotes.id })
  if (v.basedOnId) await copyTree(tx, v.basedOnId, q!.id, source)
  else await addDefaultDevice(tx, q!.id)
  await writeAudit(c, { action: `${v.kind}.create`, entity: 'quotes', entityId: q!.id, changes: { ...v, revision } }, tx)
  return q!.id
}

quotesRouter.openapi(route({ method: 'post', path: '/quotes', request: { body: body(quoteCreateInput) }, responses: created }, 'quotes', 'create'), async (c) => {
  const input = c.req.valid('json')
  assertKind(perms(c), input.kind, 'create')
  const id = await c.get('deps').db.transaction((tx) =>
    createQuote(c, tx, { kind: input.kind, opportunityId: input.opportunityId ?? null, name: input.name ?? null, description: input.description ?? null, basedOnId: input.basedOnId ?? null }),
  )
  return respond(c, id, 201)
})

quotesRouter.openapi(route({ method: 'get', path: '/quotes/{id}', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => respond(c, c.req.valid('param').id))

quotesRouter.openapi(route({ method: 'patch', path: '/quotes/{id}', request: { params: idParam, body: body(quotePatch) }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const { version, params, info, ...rest } = c.req.valid('json')
  const db = c.get('deps').db
  const current = await assertEditable(db, perms(c), id)
  const pricingKeys = ['marginMultiplier', 'reservePctOverride', 'riskPct', 'vatPct'] as const
  if (params && pricingKeys.some((k) => params[k] !== undefined) && !canPricing(c, 'edit')) throw forbidden('pricing_forbidden')
  const set = {
    ...rest,
    ...(params ? { params: { ...DEFAULT_PARAMS, ...current.params, ...params } } : {}),
    ...(info ? { info: { ...(current.info ?? {}), ...info } } : {}),
  }
  const updated = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(quotes)
      .set({ ...set, version: sql`${quotes.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
      .where(and(eq(quotes.id, id), eq(quotes.version, version)))
      .returning({ id: quotes.id })
    if (r) await writeAudit(c, { action: 'quote.update', entity: 'quotes', entityId: id, changes: diffFields(current as Record<string, unknown>, set) }, tx)
    return r
  })
  if (!updated) throw conflict(await getQuote(db, perms(c), id))
  return respond(c, id)
})

/** Roboczy ↔ zatwierdzony (approve) → wysłany. Zatwierdzona/wysłana jest tylko do odczytu; zmiany = nowa rewizja. */
quotesRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/status', request: { params: idParam, body: body(quoteStatusInput) }, responses: ok }, 'quotes', 'approve'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { status, version } = c.req.valid('json')
    const db = c.get('deps').db
    const q = await getQuoteRow(db, id)
    if (q.kind !== 'quote' || q.status === 'imported') throw new HttpProblem(422, 'quote_status_not_allowed')
    const allowed: Record<string, string[]> = { draft: ['approved'], approved: ['draft', 'sent'], sent: [] }
    if (!allowed[q.status]?.includes(status)) throw new HttpProblem(422, 'quote_status_not_allowed', `${q.status} → ${status}`)
    const user = c.get('user')
    const updated = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(quotes)
        .set({
          status,
          ...(status === 'approved' ? { approvedAt: sql`now()`, approvedBy: user.id } : status === 'draft' ? { approvedAt: null, approvedBy: null } : {}),
          version: sql`${quotes.version} + 1`,
          updatedAt: sql`now()`,
          updatedBy: user.id,
        })
        .where(and(eq(quotes.id, id), eq(quotes.version, version)))
        .returning({ id: quotes.id })
      if (r) await writeAudit(c, { action: 'quote.status', entity: 'quotes', entityId: id, changes: { from: q.status, to: status } }, tx)
      return r
    })
    if (!updated) throw conflict(await getQuote(db, perms(c), id))
    return respond(c, id)
  },
)

quotesRouter.openapi(route({ method: 'post', path: '/quotes/{id}/revision', request: { params: idParam }, responses: created }, 'quotes', 'create'), async (c) => {
  const { id } = c.req.valid('param')
  const db = c.get('deps').db
  const base = await getQuoteRow(db, id)
  if (base.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
  const newId = await db.transaction(async (tx) => {
    const nid = await createQuote(c, tx, { kind: 'quote', opportunityId: base.opportunityId, name: base.name, description: base.description, basedOnId: id })
    await tx.update(quotes).set({ notes: base.notes, params: base.params }).where(eq(quotes.id, nid))
    return nid
  })
  return respond(c, newId, 201)
})

quotesRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/save-as-profile', request: { params: idParam, body: body(saveAsProfileInput) }, responses: created }, 'quotes', 'view'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    assertKind(perms(c), 'profile', 'create')
    const newId = await c.get('deps').db.transaction((tx) => createQuote(c, tx, { kind: 'profile', opportunityId: null, name: input.name, description: input.description ?? null, basedOnId: id }))
    return respond(c, newId, 201)
  },
)

quotesRouter.openapi(route({ method: 'delete', path: '/quotes/{id}', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const { id } = c.req.valid('param')
  const db = c.get('deps').db
  const q = await getQuoteRow(db, id)
  assertKind(perms(c), q.kind, 'delete')
  if (q.status === 'sent' || q.status === 'imported') throw new HttpProblem(409, 'quote_locked', q.status)
  await db.transaction(async (tx) => {
    await tx.update(quotes).set({ deletedAt: sql`now()`, deletedBy: c.get('user').id }).where(eq(quotes.id, id))
    await writeAudit(c, { action: `${q.kind}.delete`, entity: 'quotes', entityId: id, changes: { name: q.name, revision: q.revision } }, tx)
  })
  return c.json({ ok: true }, 200)
})

// ---------------- Urządzenia, sekcje, pozycje ----------------

quotesRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/devices', request: { params: idParam, body: body(deviceInput) }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { withDefaultSections, ...input } = c.req.valid('json')
    return mutate(c, id, 'quote.device_create', async (tx) => {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(quoteDevices).where(eq(quoteDevices.quoteId, id))) as [{ n: number }]
      const [d] = await tx.insert(quoteDevices).values({ ...input, quoteId: id, sortOrder: n }).returning({ id: quoteDevices.id })
      if (withDefaultSections) await tx.insert(quoteSections).values(DEFAULT_SECTIONS.map((s, i) => ({ deviceId: d!.id, name: s, sortOrder: i })))
      return input
    })
  },
)

quotesRouter.openapi(
  route({ method: 'patch', path: '/quotes/{id}/devices/{deviceId}', request: { params: deviceParam, body: body(devicePatch) }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, deviceId } = c.req.valid('param')
    const patch = c.req.valid('json')
    return mutate(c, id, 'quote.device_update', async (tx) => {
      const d = await deviceOf(tx, id, deviceId)
      await tx.update(quoteDevices).set(patch).where(eq(quoteDevices.id, deviceId))
      return diffFields(d, patch)
    })
  },
)

quotesRouter.openapi(
  route({ method: 'delete', path: '/quotes/{id}/devices/{deviceId}', request: { params: deviceParam }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, deviceId } = c.req.valid('param')
    return mutate(c, id, 'quote.device_delete', async (tx) => {
      const d = await deviceOf(tx, id, deviceId)
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(quoteDevices).where(eq(quoteDevices.quoteId, id))) as [{ n: number }]
      if (n <= 1) throw new HttpProblem(422, 'last_device')
      await tx.delete(quoteDevices).where(eq(quoteDevices.id, deviceId))
      return { name: d.name }
    })
  },
)

quotesRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/devices/{deviceId}/sections', request: { params: deviceParam, body: body(sectionInput) }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, deviceId } = c.req.valid('param')
    const input = c.req.valid('json')
    return mutate(c, id, 'quote.section_create', async (tx) => {
      await deviceOf(tx, id, deviceId)
      const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(sort_order), -1)::int` }).from(quoteSections).where(eq(quoteSections.deviceId, deviceId))) as [{ n: number }]
      await tx.insert(quoteSections).values({ deviceId, name: input.name, sortOrder: n + 1 })
      return input
    })
  },
)

quotesRouter.openapi(
  route({ method: 'patch', path: '/quotes/{id}/sections/{sectionId}', request: { params: sectionParam, body: body(sectionPatch) }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, sectionId } = c.req.valid('param')
    const patch = c.req.valid('json')
    return mutate(c, id, 'quote.section_update', async (tx) => {
      const s = await sectionOf(tx, id, sectionId)
      await tx.update(quoteSections).set(patch).where(eq(quoteSections.id, sectionId))
      return diffFields(s, patch)
    })
  },
)

quotesRouter.openapi(
  route({ method: 'delete', path: '/quotes/{id}/sections/{sectionId}', request: { params: sectionParam }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, sectionId } = c.req.valid('param')
    return mutate(c, id, 'quote.section_delete', async (tx) => {
      const s = await sectionOf(tx, id, sectionId)
      await tx.delete(quoteSections).where(eq(quoteSections.id, sectionId))
      return { name: s.name }
    })
  },
)

quotesRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/sections/{sectionId}/lines', request: { params: sectionParam, body: body(lineInput) }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, sectionId } = c.req.valid('param')
    const input = c.req.valid('json')
    assertLineCosts(c, input)
    return mutate(c, id, 'quote.line_create', async (tx) => {
      await sectionOf(tx, id, sectionId)
      const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(sort_order), -1)::int` }).from(quoteLines).where(eq(quoteLines.sectionId, sectionId))) as [{ n: number }]
      await tx.insert(quoteLines).values({ ...input, sectionId, sortOrder: n + 1 })
      return input
    })
  },
)

quotesRouter.openapi(
  route({ method: 'patch', path: '/quotes/{id}/lines/{lineId}', request: { params: lineParam, body: body(linePatch) }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, lineId } = c.req.valid('param')
    const patch = c.req.valid('json')
    assertLineCosts(c, patch)
    return mutate(c, id, 'quote.line_update', async (tx) => {
      const l = await lineOf(tx, id, lineId)
      if (patch.sectionId) await sectionOf(tx, id, patch.sectionId)
      await tx.update(quoteLines).set(patch).where(eq(quoteLines.id, lineId))
      return { name: l.name, ...diffFields(l as Record<string, unknown>, patch) }
    })
  },
)

quotesRouter.openapi(
  route({ method: 'delete', path: '/quotes/{id}/lines/{lineId}', request: { params: lineParam }, responses: ok }, 'quotes', 'view'),
  async (c) => {
    const { id, lineId } = c.req.valid('param')
    return mutate(c, id, 'quote.line_delete', async (tx) => {
      const l = await lineOf(tx, id, lineId)
      await tx.delete(quoteLines).where(eq(quoteLines.id, lineId))
      return { name: l.name }
    })
  },
)

// ---------------- Eksport XLSX (układ arkusza „Wstępna cena wykonania”) ----------------

quotesRouter.openapi(
  route(
    {
      method: 'get',
      path: '/quotes/{id}/export.xlsx',
      request: { params: idParam },
      responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } },
    },
    'quotesPricing',
    'view',
  ),
  async (c) => {
    const { id } = c.req.valid('param')
    const q = await getQuote(c.get('deps').db, perms(c), id)
    const xlsx = await buildQuoteWorkbook(q)
    await writeAudit(c, { action: 'quote.export', entity: 'quotes', entityId: id })
    const base = q.kind === 'profile' ? `profil-${q.name ?? 'wyceny'}` : `${q.opportunityCode ?? 'wycena'}-rew-${q.revision ?? ''}`
    return c.body(xlsx, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(base.replace(/[^\w.-]+/g, '-'))}.xlsx"`,
    })
  },
)

/** PODSUMOWANIE + zakładka na sekcję (sekcje o tej samej nazwie z wielu urządzeń w jednej zakładce). */
export async function buildQuoteWorkbook(q: QuoteDto): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Envcheck Hub'
  const money = '#,##0.00 [$zł-415]'
  const s = q.summary!
  const sum = wb.addWorksheet('PODSUMOWANIE')
  sum.columns = [{ width: 34 }, { width: 22 }, { width: 18 }]
  const title = q.kind === 'profile' ? `Profil wyceny: ${q.name}` : `${q.opportunityCode ?? ''} rew. ${q.revision ?? ''} — ${q.opportunityName ?? ''}`
  sum.addRow([title]).font = { bold: true, size: 13 }
  sum.addRow(['Wstępne oszacowanie ceny wykonania produktu'])
  sum.addRow([])
  sum.addRow(['INFORMACJE']).font = { bold: true }
  sum.addRow(['Wartość zamówienia', q.info.budget ?? '??'])
  sum.addRow(['Miejsce dostawy', q.info.deliveryPlace ?? ''])
  sum.addRow(['Termin dostawy', q.info.deliveryTerm ?? '??'])
  sum.addRow(['Warunki udziału', q.info.participationConditions ?? ''])
  sum.addRow(['Kryteria oceny', q.info.evaluationCriteria ?? ''])
  sum.addRow(['Okres gwarancji', `${q.params.warrantyMonths} mies.`])
  sum.addRow([])
  sum.addRow(['Zestawienie kosztów']).font = { bold: true }
  for (const sec of s.sections) sum.addRow([sec.name, sec.cost])
  sum.addRow(['suma', s.cost]).font = { bold: true }
  sum.addRow([])
  sum.addRow(['Obliczenie ceny']).font = { bold: true }
  sum.addRow(['Koszt wykonania', s.cost])
  sum.addRow(['Marża (mnożnik)', q.params.marginMultiplier])
  sum.addRow(['Wartość marży', s.marginValue])
  sum.addRow(['Rezerwa gwarancyjna', s.reservePct])
  sum.addRow(['Wartość rezerwy', s.reserveValue])
  if (q.params.riskPct) {
    sum.addRow(['Ryzyko / nieprzewidziane', q.params.riskPct])
    sum.addRow(['Wartość ryzyka', s.riskValue])
  }
  sum.addRow(['Suma netto', s.net]).font = { bold: true }
  sum.addRow(['Suma brutto', s.gross]).font = { bold: true }
  const options = s.devices.filter((d) => d.isOption || !d.included)
  if (options.length) {
    sum.addRow([])
    sum.addRow(['Opcje / warianty (poza ceną)']).font = { bold: true }
    for (const o of options) sum.addRow([o.name, o.price.net, o.price.gross])
  }
  sum.getColumn(2).numFmt = money
  sum.getColumn(3).numFmt = money

  const sectionNames = [...new Set(q.devices.flatMap((d) => d.sections.map((x) => x.name)))]
  for (const name of sectionNames) {
    const ws = wb.addWorksheet(name.toUpperCase().slice(0, 31))
    ws.columns = [
      { header: 'Urządzenie', width: 26 },
      { header: 'Grupa', width: 14 },
      { header: 'Pozycja', width: 30 },
      { header: 'Ilość', width: 8 },
      { header: 'J.m.', width: 6 },
      { header: 'Cena jedn.', width: 14, style: { numFmt: money } },
      { header: 'Godziny', width: 9 },
      { header: 'Stawka', width: 10, style: { numFmt: money } },
      { header: 'Koszt', width: 14, style: { numFmt: money } },
      { header: 'Uzasadnienie', width: 50 },
    ]
    ws.getRow(1).font = { bold: true }
    let total = 0
    for (const d of q.devices) {
      for (const sec of d.sections.filter((x) => x.name === name)) {
        for (const l of sec.lines) {
          ws.addRow([d.name, l.group, l.name, l.quantity, l.unit, l.unitCost, l.laborHours, l.laborRate, l.cost, l.justification])
          if (d.included && !d.isOption) total += (l.cost ?? 0) * d.quantity
        }
      }
    }
    ws.addRow([])
    const r = ws.addRow(['suma', null, null, null, null, null, null, null, total])
    r.font = { bold: true }
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

