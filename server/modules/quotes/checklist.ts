import { asc, desc, eq } from 'drizzle-orm'
import type { ChecklistDto, ChecklistItemDto, SpecListDto } from '#shared'
import type { Database } from '../../db/client.ts'
import { quoteChecklistItems, quotes, specListVersions, users } from '../../db/schema.ts'
import { HttpProblem } from '../../lib/problem.ts'

export const CUSTOM_PREFIX = 'custom:'

export async function latestSpecList(db: Database) {
  const [v] = await db.select().from(specListVersions).orderBy(desc(specListVersions.version)).limit(1)
  if (!v) throw new HttpProblem(500, 'spec_list_missing')
  return v
}

export async function listSpecVersions(db: Database): Promise<SpecListDto[]> {
  const rows = await db
    .select({ v: specListVersions, createdByName: users.name })
    .from(specListVersions)
    .leftJoin(users, eq(users.id, specListVersions.createdBy))
    .orderBy(desc(specListVersions.version))
  return rows.map(({ v, createdByName }) => ({ id: v.id, version: v.version, items: v.items, notes: v.notes, createdAt: v.createdAt, createdByName }))
}

/** Wersja listy dla wyceny: zapamiętana przy pierwszym zapisie checklisty, a do tego czasu — najnowsza. */
export async function specListFor(db: Database, quote: { specListVersionId: string | null }) {
  if (quote.specListVersionId) {
    const [v] = await db.select().from(specListVersions).where(eq(specListVersions.id, quote.specListVersionId))
    if (v) return v
  }
  return latestSpecList(db)
}

/** Pierwszy zapis checklisty przypina wycenę do bieżącej wersji listy (późniejsze zmiany listy jej nie zmieniają). */
export async function pinSpecList(tx: Database, quote: { id: string; specListVersionId: string | null }) {
  if (quote.specListVersionId) return quote.specListVersionId
  const v = await latestSpecList(tx)
  await tx.update(quotes).set({ specListVersionId: v.id }).where(eq(quotes.id, quote.id))
  return v.id
}

export async function getChecklist(db: Database, quote: { id: string; specListVersionId: string | null }): Promise<ChecklistDto> {
  const spec = await specListFor(db, quote)
  const rows = await db
    .select({ i: quoteChecklistItems, updatedByName: users.name })
    .from(quoteChecklistItems)
    .leftJoin(users, eq(users.id, quoteChecklistItems.updatedBy))
    .where(eq(quoteChecklistItems.quoteId, quote.id))
    .orderBy(asc(quoteChecklistItems.sortOrder), asc(quoteChecklistItems.updatedAt))
  const byKey = new Map(rows.map((r) => [r.i.key, r]))
  const fromRow = (r: (typeof rows)[number] | undefined) => ({
    value: r?.i.value ?? null,
    status: r?.i.status ?? 'pending',
    note: r?.i.note ?? null,
    sourceRef: r?.i.sourceRef ?? null,
    updatedAt: r?.i.updatedAt ?? null,
    updatedByName: r?.updatedByName ?? null,
  })
  const items: ChecklistItemDto[] = spec.items.map((d) => ({
    key: d.key,
    group: d.group,
    label: d.label,
    type: d.type,
    unit: d.unit ?? null,
    options: d.options ?? null,
    help: d.help ?? null,
    custom: false,
    ...fromRow(byKey.get(d.key)),
  }))
  for (const r of rows.filter((x) => x.i.key.startsWith(CUSTOM_PREFIX))) {
    items.push({ key: r.i.key, group: r.i.group ?? 'Wymagania dodatkowe', label: r.i.label ?? '', type: 'text', unit: null, options: null, help: null, custom: true, ...fromRow(r) })
  }
  const count = (s: string) => items.filter((x) => x.status === s).length
  return {
    specVersion: spec.version,
    items,
    progress: { confirmed: count('confirmed'), missing: count('missing'), na: count('na'), pending: count('pending'), total: items.length },
  }
}

/** Nowa rewizja przejmuje checklistę (wersję listy i wartości). */
export async function copyChecklist(tx: Database, fromQuoteId: string, toQuoteId: string) {
  const [src] = await tx.select({ v: quotes.specListVersionId }).from(quotes).where(eq(quotes.id, fromQuoteId))
  if (src?.v) await tx.update(quotes).set({ specListVersionId: src.v }).where(eq(quotes.id, toQuoteId))
  const rows = await tx.select().from(quoteChecklistItems).where(eq(quoteChecklistItems.quoteId, fromQuoteId))
  if (rows.length) await tx.insert(quoteChecklistItems).values(rows.map(({ id: _id, quoteId: _q, ...r }) => ({ ...r, quoteId: toQuoteId })))
}
