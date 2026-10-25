import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import {
  DEFAULT_PARAMS,
  DEFAULT_PRICE_MAX_AGE_MONTHS,
  DEFAULT_RESERVE,
  DEFAULT_SECTIONS,
  QUOTE_EDITABLE,
  computeSummary,
  toCostSummary,
  lineCost,
  type Action,
  type ModuleKey,
  type QuoteDeviceDto,
  type QuoteDto,
  type QuoteKind,
  type QuoteListItemDto,
  type QuoteSettings,
  type LineSource,
} from '#shared'
import type { Database } from '../../db/client.ts'
import { appSettings, companies, opportunities, quoteDevices, quoteLines, quoteSections, quotes, users } from '../../db/schema.ts'
import { HttpProblem, forbidden, notFound } from '../../lib/problem.ts'
import { getChecklist } from './checklist.ts'

export const QUOTE_SETTINGS_KEY = 'quotes.settings'

type Perms = Set<`${ModuleKey}:${Action}`>
const has = (perms: Perms, m: ModuleKey, a: Action) => perms.has(`${m}:${a}`)

/** Wyceny — moduł `quotes`, profile — `quoteKnowledge`; koszty — `quotesCost`; marża i cena — `quotesPricing`. */
export const moduleFor = (kind: QuoteKind): ModuleKey => (kind === 'profile' ? 'quoteKnowledge' : 'quotes')

export function assertKind(perms: Perms, kind: QuoteKind, action: Action) {
  if (!has(perms, moduleFor(kind), action)) throw forbidden('permission_denied', `${moduleFor(kind)}:${action}`)
}

export async function loadSettings(db: Database): Promise<QuoteSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, QUOTE_SETTINGS_KEY))
  const v = (row?.value ?? {}) as Partial<QuoteSettings>
  return { reserve: { ...DEFAULT_RESERVE, ...(v.reserve ?? {}) }, laborRate: v.laborRate ?? null, priceMaxAgeMonths: v.priceMaxAgeMonths ?? DEFAULT_PRICE_MAX_AGE_MONTHS }
}

const updaters = aliasedTable(users, 'updater')
const approvers = aliasedTable(users, 'approver')

async function baseRows(db: Database, where?: SQL) {
  return db
    .select({ q: quotes, oppCode: opportunities.code, oppName: opportunities.name, companyName: companies.name, updatedByName: updaters.name, approvedByName: approvers.name })
    .from(quotes)
    .leftJoin(opportunities, eq(opportunities.id, quotes.opportunityId))
    .leftJoin(companies, eq(companies.id, opportunities.companyId))
    .leftJoin(updaters, eq(updaters.id, quotes.updatedBy))
    .leftJoin(approvers, eq(approvers.id, quotes.approvedBy))
    .where(and(isNull(quotes.deletedAt), where))
    .orderBy(desc(quotes.updatedAt))
}

type BaseRow = Awaited<ReturnType<typeof baseRows>>[number]

/** Drzewo urządzeń → sekcji → pozycji dla wielu wycen naraz (koszty pełne — maskowanie później). */
async function loadTrees(db: Database, quoteIds: string[]) {
  const byQuote = new Map<string, QuoteDeviceDto[]>()
  if (!quoteIds.length) return byQuote
  const devs = await db.select().from(quoteDevices).where(inArray(quoteDevices.quoteId, quoteIds)).orderBy(asc(quoteDevices.sortOrder))
  const secs = devs.length ? await db.select().from(quoteSections).where(inArray(quoteSections.deviceId, devs.map((d) => d.id))).orderBy(asc(quoteSections.sortOrder)) : []
  const lines = secs.length ? await db.select().from(quoteLines).where(inArray(quoteLines.sectionId, secs.map((s) => s.id))).orderBy(asc(quoteLines.sortOrder)) : []
  for (const d of devs) {
    const sections = secs
      .filter((s) => s.deviceId === d.id)
      .map((s) => {
        const ls = lines
          .filter((l) => l.sectionId === s.id)
          .map((l) => ({
            id: l.id,
            name: l.name,
            group: l.group,
            quantity: l.quantity,
            unit: l.unit,
            unitCost: l.unitCost,
            laborHours: l.laborHours,
            laborRate: l.laborRate,
            cost: lineCost(l),
            justification: l.justification,
            source: l.source,
            confidence: l.confidence,
            approved: l.approved,
            componentId: l.componentId,
            sortOrder: l.sortOrder,
          }))
        return { id: s.id, name: s.name, sortOrder: s.sortOrder, cost: ls.reduce((a, l) => a + (l.cost ?? 0), 0), lines: ls }
      })
    const dto: QuoteDeviceDto = { id: d.id, name: d.name, quantity: d.quantity, isOption: d.isOption, included: d.included, sortOrder: d.sortOrder, cost: sections.reduce((a, s) => a + (s.cost ?? 0), 0) * d.quantity, sections }
    byQuote.set(d.quoteId, [...(byQuote.get(d.quoteId) ?? []), dto])
  }
  return byQuote
}

function maskDevices(devices: QuoteDeviceDto[]): QuoteDeviceDto[] {
  return devices.map((d) => ({
    ...d,
    cost: null,
    sections: d.sections.map((s) => ({ ...s, cost: null, lines: s.lines.map((l) => ({ ...l, unitCost: null, laborRate: null, cost: null })) })),
  }))
}

function listItem(r: BaseRow, perms: Perms, devices: QuoteDeviceDto[], settings: QuoteSettings): QuoteListItemDto {
  const summary = computeSummary(devices, { ...DEFAULT_PARAMS, ...r.q.params }, settings.reserve)
  return {
    id: r.q.id,
    kind: r.q.kind,
    name: r.q.name,
    description: r.q.description,
    opportunityId: r.q.opportunityId,
    opportunityCode: r.oppCode,
    opportunityName: r.oppName,
    companyName: r.companyName,
    revision: r.q.revision,
    status: r.q.status,
    basedOnLabel: r.q.basedOnLabel,
    cost: has(perms, 'quotesCost', 'view') ? summary.cost : null,
    net: has(perms, 'quotesPricing', 'view') ? summary.net : null,
    updatedAt: r.q.updatedAt,
    updatedByName: r.updatedByName,
  }
}

export async function listQuotes(db: Database, perms: Perms, kind: QuoteKind, where?: SQL): Promise<QuoteListItemDto[]> {
  const rows = await baseRows(db, and(eq(quotes.kind, kind), where))
  const trees = await loadTrees(db, rows.map((r) => r.q.id))
  const settings = await loadSettings(db)
  return rows.map((r) => listItem(r, perms, trees.get(r.q.id) ?? [], settings))
}

export async function getQuoteRow(db: Database, id: string) {
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
  if (!q) throw notFound()
  return q
}

export async function getQuote(db: Database, perms: Perms, id: string): Promise<QuoteDto> {
  const [r] = await baseRows(db, eq(quotes.id, id))
  if (!r) throw notFound()
  assertKind(perms, r.q.kind, 'view')
  const devices = (await loadTrees(db, [id])).get(id) ?? []
  const settings = await loadSettings(db)
  const params = { ...DEFAULT_PARAMS, ...r.q.params }
  const canSeeCosts = has(perms, 'quotesCost', 'view')
  const canSeePricing = has(perms, 'quotesPricing', 'view')
  const summary = computeSummary(devices, params, settings.reserve)
  return {
    ...listItem(r, perms, devices, settings),
    params: canSeePricing ? params : { ...params, marginMultiplier: null, reservePctOverride: null, riskPct: null, vatPct: null },
    info: r.q.info ?? {},
    notes: r.q.notes,
    devices: canSeeCosts ? devices : maskDevices(devices),
    costSummary: canSeeCosts ? toCostSummary(summary) : null,
    summary: canSeePricing ? summary : null,
    canEdit: QUOTE_EDITABLE.includes(r.q.status) && has(perms, moduleFor(r.q.kind), 'edit'),
    canSeeCosts,
    canEditCosts: has(perms, 'quotesCost', 'edit'),
    canSeePricing,
    canEditPricing: has(perms, 'quotesPricing', 'edit'),
    checklistProgress: r.q.kind === 'quote' ? (({ confirmed, total }) => ({ confirmed, total }))((await getChecklist(db, r.q)).progress) : null,
    approvedAt: r.q.approvedAt,
    approvedByName: r.approvedByName,
    version: r.q.version,
  }
}

/** Zmiana treści: tylko wycena robocza i uprawnienie `edit` dla jej rodzaju. */
export async function assertEditable(db: Database, perms: Perms, quoteId: string) {
  const q = await getQuoteRow(db, quoteId)
  assertKind(perms, q.kind, 'edit')
  if (!QUOTE_EDITABLE.includes(q.status)) throw new HttpProblem(409, 'quote_locked', q.status)
  return q
}

/** Każda zmiana w drzewie podbija wersję wyceny (kontrola współbieżności w PATCH nagłówka). */
export async function touch(tx: Database, quoteId: string, userId: string) {
  await tx.update(quotes).set({ version: sql`${quotes.version} + 1`, updatedAt: sql`now()`, updatedBy: userId }).where(eq(quotes.id, quoteId))
}

export async function addDefaultDevice(tx: Database, quoteId: string, name = 'Komora') {
  const [d] = await tx.insert(quoteDevices).values({ quoteId, name, sortOrder: 0 }).returning({ id: quoteDevices.id })
  await tx.insert(quoteSections).values(DEFAULT_SECTIONS.map((s, i) => ({ deviceId: d!.id, name: s, sortOrder: i })))
}

/** Kopia drzewa wyceny/profilu; pozycje dostają źródło i wracają do „niezatwierdzonych”. */
export async function copyTree(tx: Database, fromId: string, toId: string, source: LineSource) {
  const devs = await tx.select().from(quoteDevices).where(eq(quoteDevices.quoteId, fromId)).orderBy(asc(quoteDevices.sortOrder))
  for (const d of devs) {
    const [nd] = await tx
      .insert(quoteDevices)
      .values({ quoteId: toId, name: d.name, quantity: d.quantity, isOption: d.isOption, included: d.included, sortOrder: d.sortOrder })
      .returning({ id: quoteDevices.id })
    const secs = await tx.select().from(quoteSections).where(eq(quoteSections.deviceId, d.id)).orderBy(asc(quoteSections.sortOrder))
    for (const s of secs) {
      const [ns] = await tx.insert(quoteSections).values({ deviceId: nd!.id, name: s.name, sortOrder: s.sortOrder }).returning({ id: quoteSections.id })
      const ls = await tx.select().from(quoteLines).where(eq(quoteLines.sectionId, s.id)).orderBy(asc(quoteLines.sortOrder))
      if (ls.length) {
        await tx.insert(quoteLines).values(
          ls.map(({ id: _id, sectionId: _s, ...l }) => ({ ...l, sectionId: ns!.id, source, approved: false })),
        )
      }
    }
  }
}

/** Sekcja/pozycja/urządzenie należy do wskazanej wyceny (ochrona przed mieszaniem identyfikatorów). */
export async function deviceOf(db: Database, quoteId: string, deviceId: string) {
  const [d] = await db.select().from(quoteDevices).where(and(eq(quoteDevices.id, deviceId), eq(quoteDevices.quoteId, quoteId)))
  if (!d) throw notFound()
  return d
}

export async function sectionOf(db: Database, quoteId: string, sectionId: string) {
  const [s] = await db
    .select({ s: quoteSections })
    .from(quoteSections)
    .innerJoin(quoteDevices, eq(quoteDevices.id, quoteSections.deviceId))
    .where(and(eq(quoteSections.id, sectionId), eq(quoteDevices.quoteId, quoteId)))
  if (!s) throw notFound()
  return s.s
}

export async function lineOf(db: Database, quoteId: string, lineId: string) {
  const [l] = await db
    .select({ l: quoteLines })
    .from(quoteLines)
    .innerJoin(quoteSections, eq(quoteSections.id, quoteLines.sectionId))
    .innerJoin(quoteDevices, eq(quoteDevices.id, quoteSections.deviceId))
    .where(and(eq(quoteLines.id, lineId), eq(quoteDevices.quoteId, quoteId)))
  if (!l) throw notFound()
  return l.l
}
