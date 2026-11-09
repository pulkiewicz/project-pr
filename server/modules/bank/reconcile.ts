import { and, eq, inArray, lt, sql, type SQL } from 'drizzle-orm'
import { BANK_TX_NEEDS_INVOICE, counterpartyKey, type BankLinkDto, type BankMatchResult, type BankRuleDto, type BankSuggestionDto, type InvoicePaymentDto } from '#shared'
import type { Database } from '../../db/client.ts'
import { bankCounterpartyRules, bankStatements, bankTransactions, bankTxInvoiceLinks, costCategories, costInvoices, projects, users } from '../../db/schema.ts'
import { effective } from '../invoices/service.ts'
import { findMatches, type Match, type MatchInvoice, type MatchTx } from './match.ts'

type Tx = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

/** Suma płatności połączonych z fakturami (grosze). */
export async function paidAmounts(db: Tx, invoiceIds?: string[]): Promise<Map<string, number>> {
  if (invoiceIds && !invoiceIds.length) return new Map()
  const rows = await db
    .select({ invoiceId: bankTxInvoiceLinks.invoiceId, paid: sql<number>`sum(${bankTxInvoiceLinks.amount})::bigint` })
    .from(bankTxInvoiceLinks)
    .where(invoiceIds ? inArray(bankTxInvoiceLinks.invoiceId, invoiceIds) : undefined)
    .groupBy(bankTxInvoiceLinks.invoiceId)
  return new Map(rows.map((r) => [r.invoiceId, Number(r.paid)]))
}

export async function invoicePayments(db: Database, invoiceId: string): Promise<InvoicePaymentDto[]> {
  const rows = await db
    .select({
      transactionId: bankTransactions.id,
      statementId: bankTransactions.statementId,
      statementNumber: bankStatements.number,
      bookingDate: bankTransactions.bookingDate,
      amount: bankTxInvoiceLinks.amount,
      counterpartyName: bankTransactions.counterpartyName,
      merchant: bankTransactions.merchant,
      source: bankTxInvoiceLinks.source,
    })
    .from(bankTxInvoiceLinks)
    .innerJoin(bankTransactions, eq(bankTransactions.id, bankTxInvoiceLinks.transactionId))
    .innerJoin(bankStatements, eq(bankStatements.id, bankTransactions.statementId))
    .where(eq(bankTxInvoiceLinks.invoiceId, invoiceId))
    .orderBy(bankTransactions.bookingDate)
  return rows.map(({ counterpartyName, merchant, ...r }) => ({ ...r, counterparty: counterpartyName ?? merchant }))
}

/** Faktury do dopasowania: dane efektywne (z poprawkami ręcznymi), niezapłacona część brutto. */
async function loadInvoices(db: Tx) {
  const rows = await db.select().from(costInvoices)
  const paid = await paidAmounts(db)
  const info = new Map<string, { number: string | null; sellerName: string | null; issueDate: string | null; grossPrice: number | null; open: number | null }>()
  const list: MatchInvoice[] = []
  for (const raw of rows) {
    const inv = effective(raw)
    // Rachunek firmowy jest w PLN — faktury w walutach obcych dopasowujemy tylko ręcznie.
    const open = inv.grossPrice == null || inv.currency !== 'PLN' ? null : inv.grossPrice - (paid.get(inv.id) ?? 0)
    const date = inv.issueDate ?? (inv.infaktCreatedAt ? new Date(inv.infaktCreatedAt).toISOString().slice(0, 10) : null)
    list.push({ id: inv.id, number: inv.number, sellerName: inv.sellerName, date, open })
    info.set(inv.id, { number: inv.number, sellerName: inv.sellerName, issueDate: inv.issueDate, grossPrice: inv.grossPrice, open })
  }
  return { list, info }
}

/** Operacje do dopasowania: wydatki (przelew, karta) „do ustalenia”, jeszcze bez powiązań. */
async function loadOpenTxs(db: Tx, where?: SQL): Promise<MatchTx[]> {
  const rows = await db
    .select()
    .from(bankTransactions)
    .where(
      and(
        inArray(bankTransactions.kind, [...BANK_TX_NEEDS_INVOICE]),
        lt(bankTransactions.amount, 0),
        eq(bankTransactions.costStatus, 'pending'),
        sql`not exists (select 1 from ${bankTxInvoiceLinks} where ${bankTxInvoiceLinks.transactionId} = ${bankTransactions.id})`,
        where,
      ),
    )
  return rows.map((t) => ({
    id: t.id,
    open: -t.amount,
    bookingDate: t.bookingDate,
    valueDate: t.valueDate,
    texts: [t.invoiceRef, t.title, t.description].filter((x): x is string => !!x),
    counterparty: t.counterpartyName ?? t.merchant,
  }))
}

/** Propozycje dla operacji (liczone na bieżąco — zawsze względem aktualnych faktur i płatności). */
export async function suggestionsFor(db: Database, txIds: string[]): Promise<Map<string, BankSuggestionDto[]>> {
  const out = new Map<string, BankSuggestionDto[]>()
  if (!txIds.length) return out
  // Wszystkie otwarte operacje — reguła „kilka przelewów z tym samym numerem” potrzebuje też operacji z innych wyciągów.
  const [txs, { list, info }] = await Promise.all([loadOpenTxs(db), loadInvoices(db)])
  const wanted = new Set(txIds)
  for (const m of findMatches(txs, list)) {
    if (!wanted.has(m.txId)) continue
    const i = info.get(m.invoiceId)!
    out.set(m.txId, [...(out.get(m.txId) ?? []), { invoiceId: m.invoiceId, invoiceNumber: i.number, sellerName: i.sellerName, issueDate: i.issueDate, grossPrice: i.grossPrice, amount: m.amount, reason: m.reason }])
  }
  return out
}

async function insertLinks(tx: Tx, matches: Pick<Match, 'txId' | 'invoiceId' | 'amount'>[], source: 'auto' | 'manual', userId: string | null) {
  if (!matches.length) return
  await tx
    .insert(bankTxInvoiceLinks)
    .values(matches.map((m) => ({ transactionId: m.txId, invoiceId: m.invoiceId, amount: m.amount, source, createdBy: userId })))
    .onConflictDoNothing()
  // Koszt jest w fakturze — operacja nie liczy się osobno i nie ma własnego projektu.
  await tx
    .update(bankTransactions)
    .set({ costStatus: 'invoice', projectId: null, general: false, updatedAt: sql`now()`, updatedBy: userId })
    .where(inArray(bankTransactions.id, [...new Set(matches.map((m) => m.txId))]))
}

/**
 * Dopasowanie automatyczne (po imporcie i na żądanie): łączy pewne pary (numer + kwota), potem stosuje reguły
 * kontrahentów do pozostałych operacji „do ustalenia”. `statementId` zawęża łączenie i reguły do jednego wyciągu.
 * `userId` null = synchronizacja automatyczna (harmonogram).
 */
export async function runMatching(db: Database, userId: string | null, statementId?: string): Promise<BankMatchResult> {
  return db.transaction(async (tx) => {
    const scope = statementId ? eq(bankTransactions.statementId, statementId) : undefined
    const all = await loadOpenTxs(tx)
    const inScope = new Set((statementId ? await loadOpenTxs(tx, scope) : all).map((t) => t.id))
    const matches = findMatches(all, (await loadInvoices(tx)).list).filter((m) => inScope.has(m.txId))
    const autos = matches.filter((m) => m.auto)
    await insertLinks(tx, autos, 'auto', userId)
    const linked = new Set(autos.map((m) => m.txId))
    const ruled = await applyRules(tx, userId, scope)
    const suggested = new Set(matches.filter((m) => !m.auto && !linked.has(m.txId)).map((m) => m.txId)).size
    return { linked: linked.size, suggested, ruled }
  })
}

/** Połączenie ręczne / zatwierdzenie propozycji. Kwota: mniejsza z nierozliczonej części operacji i faktury. */
export async function linkInvoice(db: Database, txId: string, invoiceId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, txId))
    const [raw] = await tx.select().from(costInvoices).where(eq(costInvoices.id, invoiceId))
    if (!t || !raw) return null
    const linkedTx = await tx.select({ invoiceId: bankTxInvoiceLinks.invoiceId, amount: bankTxInvoiceLinks.amount }).from(bankTxInvoiceLinks).where(eq(bankTxInvoiceLinks.transactionId, txId))
    if (linkedTx.some((l) => l.invoiceId === invoiceId)) return { amount: 0 }
    const txOpen = -t.amount - linkedTx.reduce((s, l) => s + l.amount, 0)
    const inv = effective(raw)
    const invOpen = inv.grossPrice == null ? null : inv.grossPrice - ((await paidAmounts(tx, [invoiceId])).get(invoiceId) ?? 0)
    // Operacja już rozliczona w całości (np. dopinana korekta) — liczymy od pełnej kwoty operacji.
    const base = txOpen > 0 ? txOpen : -t.amount
    const amount = invOpen != null && invOpen > 0 ? Math.min(base, invOpen) : base
    await insertLinks(tx, [{ txId, invoiceId, amount }], 'manual', userId)
    return { amount }
  })
}

/** Rozłączenie; operacja bez powiązań wraca do „do ustalenia”. */
export async function unlinkInvoice(db: Database, txId: string, invoiceId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .delete(bankTxInvoiceLinks)
      .where(and(eq(bankTxInvoiceLinks.transactionId, txId), eq(bankTxInvoiceLinks.invoiceId, invoiceId)))
      .returning({ amount: bankTxInvoiceLinks.amount, source: bankTxInvoiceLinks.source })
    if (!r) return null
    const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(bankTxInvoiceLinks).where(eq(bankTxInvoiceLinks.transactionId, txId))
    if (!left?.n) await tx.update(bankTransactions).set({ costStatus: 'pending', updatedAt: sql`now()`, updatedBy: userId }).where(eq(bankTransactions.id, txId))
    return r
  })
}

export async function linksFor(db: Database, txIds: string[]): Promise<Map<string, BankLinkDto[]>> {
  const out = new Map<string, BankLinkDto[]>()
  if (!txIds.length) return out
  const rows = await db
    .select({ txId: bankTxInvoiceLinks.transactionId, invoiceId: bankTxInvoiceLinks.invoiceId, amount: bankTxInvoiceLinks.amount, source: bankTxInvoiceLinks.source, inv: costInvoices })
    .from(bankTxInvoiceLinks)
    .innerJoin(costInvoices, eq(costInvoices.id, bankTxInvoiceLinks.invoiceId))
    .where(inArray(bankTxInvoiceLinks.transactionId, txIds))
  for (const r of rows) {
    const inv = effective(r.inv)
    out.set(r.txId, [...(out.get(r.txId) ?? []), { invoiceId: r.invoiceId, invoiceNumber: inv.number, sellerName: inv.sellerName, amount: r.amount, source: r.source }])
  }
  return out
}

// ---------------- Reguły kontrahentów ----------------

export async function ruleKeys(db: Database): Promise<Set<string>> {
  return new Set((await db.select({ key: bankCounterpartyRules.key }).from(bankCounterpartyRules)).map((r) => r.key))
}

export async function listRules(db: Database): Promise<BankRuleDto[]> {
  const rows = await db
    .select({ r: bankCounterpartyRules, costCategoryName: costCategories.name, projectCode: projects.code, createdByName: users.name })
    .from(bankCounterpartyRules)
    .leftJoin(costCategories, eq(costCategories.id, bankCounterpartyRules.costCategoryId))
    .leftJoin(projects, eq(projects.id, bankCounterpartyRules.projectId))
    .leftJoin(users, eq(users.id, bankCounterpartyRules.createdBy))
    .orderBy(bankCounterpartyRules.label)
  return rows.map(({ r, costCategoryName, projectCode, createdByName }) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    costCategoryId: r.costCategoryId,
    costCategoryName,
    projectId: r.projectId,
    projectCode,
    general: r.general,
    vatRate: r.vatRate,
    createdByName,
    createdAt: r.createdAt,
  }))
}

/**
 * Reguły → operacje „do ustalenia” (przelewy i karty bez powiązań) z kluczem kontrahenta: koszt bez faktury
 * z kategorią, projektem / kosztami ogólnymi i stawką VAT z reguły. Zwraca liczbę oznaczonych operacji.
 */
export async function applyRules(db: Tx, userId: string | null, where?: SQL, onlyRuleId?: string): Promise<number> {
  const rules = await db.select().from(bankCounterpartyRules).where(onlyRuleId ? eq(bankCounterpartyRules.id, onlyRuleId) : undefined)
  if (!rules.length) return 0
  const byKey = new Map(rules.map((r) => [r.key, r]))
  const txs = await db
    .select()
    .from(bankTransactions)
    .where(
      and(
        inArray(bankTransactions.kind, [...BANK_TX_NEEDS_INVOICE]),
        eq(bankTransactions.costStatus, 'pending'),
        sql`not exists (select 1 from ${bankTxInvoiceLinks} where ${bankTxInvoiceLinks.transactionId} = ${bankTransactions.id})`,
        where,
      ),
    )
  let n = 0
  for (const t of txs) {
    const key = counterpartyKey(t)
    const rule = key ? byKey.get(key) : undefined
    if (!rule) continue
    await db
      .update(bankTransactions)
      .set({
        costStatus: 'no_invoice',
        costCategoryId: rule.costCategoryId ?? t.costCategoryId,
        projectId: rule.projectId,
        general: !rule.projectId && rule.general,
        vatRate: rule.vatRate,
        updatedAt: sql`now()`,
        updatedBy: userId,
      })
      .where(eq(bankTransactions.id, t.id))
    n++
  }
  return n
}

/** Reguła z ustawień operacji (koszt bez faktury); istniejąca reguła tego kontrahenta jest nadpisywana. */
export async function createRule(db: Database, txId: string, userId: string) {
  const [t] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, txId))
  if (!t) return { error: 'not_found' as const }
  const key = counterpartyKey(t)
  if (!key) return { error: 'bank_rule_no_counterparty' as const }
  if (t.costStatus !== 'no_invoice') return { error: 'bank_rule_needs_no_invoice' as const }
  const values = {
    key,
    label: t.counterpartyName ?? t.merchant ?? key,
    costCategoryId: t.costCategoryId,
    projectId: t.projectId,
    general: !t.projectId && t.general,
    vatRate: t.vatRate,
    createdBy: userId,
  }
  return db.transaction(async (tx) => {
    const [rule] = await tx
      .insert(bankCounterpartyRules)
      .values(values)
      .onConflictDoUpdate({ target: bankCounterpartyRules.key, set: { ...values, createdAt: sql`now()` } })
      .returning({ id: bankCounterpartyRules.id })
    const applied = await applyRules(tx, userId, undefined, rule!.id)
    return { id: rule!.id, applied, key }
  })
}

export async function deleteRule(db: Database, id: string) {
  const [r] = await db.delete(bankCounterpartyRules).where(eq(bankCounterpartyRules.id, id)).returning({ key: bankCounterpartyRules.key, label: bankCounterpartyRules.label })
  return r ?? null
}

