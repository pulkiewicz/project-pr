import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { BANK_TX_NEEDS_INVOICE, counterpartyKey, defaultCostStatus, isStaffCost, netOfGross, type BankCostDto, type BankImportPreview, type BankStatementDetailDto, type BankStatementDto, type BankTransactionDto, type BankTxKind } from '#shared'
import type { Database } from '../../db/client.ts'
import { bankStatements, bankTransactions, costCategories, projects, users } from '../../db/schema.ts'
import type { ParsedStatement } from './pko.ts'
import { linksFor, ruleKeys, suggestionsFor } from './reconcile.ts'

const key = (t: { operationId: string; type: string; amount: number }) => `${t.operationId}|${t.type}|${t.amount}`

/** Podgląd importu: wynik odczytu + operacje już zapisane wcześniej (pominięte) + czy ten plik już był. */
export async function buildPreview(db: Database, parsed: ParsedStatement, sha256: string): Promise<BankImportPreview | null> {
  const { statement, transactions } = parsed
  if (!statement) return null
  const issues = [...parsed.issues]
  const [same] = await db.select({ number: bankStatements.number }).from(bankStatements).where(eq(bankStatements.sha256, sha256))
  if (same) issues.push({ severity: 'error', code: 'already_imported', detail: same.number })

  const existing = new Set<string>()
  const ids = [...new Set(transactions.map((t) => t.operationId))]
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ operationId: bankTransactions.operationId, type: bankTransactions.type, amount: bankTransactions.amount })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.accountNumber, statement.accountNumber), inArray(bankTransactions.operationId, ids.slice(i, i + 500))))
    for (const r of rows) existing.add(key(r))
  }
  const rows = transactions.map((t) => ({ ...t, duplicate: existing.has(key(t)) }))
  const kinds: Partial<Record<BankTxKind, number>> = {}
  for (const t of rows) if (!t.duplicate) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1
  return {
    statement,
    transactions: rows,
    kinds,
    duplicates: rows.filter((t) => t.duplicate).length,
    issues,
    canCommit: !issues.some((i) => i.severity === 'error'),
  }
}

/** Zapis wyciągu i nowych operacji (duplikaty pominięte przez klucz naturalny). */
export async function commitImport(db: Database, preview: BankImportPreview, file: { name: string; sha256: string }, userId: string) {
  return db.transaction(async (tx) => {
    const [st] = await tx
      .insert(bankStatements)
      .values({ ...preview.statement, fileName: file.name, sha256: file.sha256, importedBy: userId })
      .returning({ id: bankStatements.id })
    const fresh = preview.transactions.filter((t) => !t.duplicate)
    const [staff] = await tx.select({ id: costCategories.id }).from(costCategories).where(eq(costCategories.staff, true))
    let created = 0
    for (let i = 0; i < fresh.length; i += 200) {
      const inserted = await tx
        .insert(bankTransactions)
        .values(fresh.slice(i, i + 200).map(({ duplicate: _d, ...t }) => ({ ...t, statementId: st!.id, accountNumber: preview.statement.accountNumber, costStatus: defaultCostStatus(t.kind, t.title), costCategoryId: staff && isStaffCost(t.kind, t.title) ? staff.id : null })))
        .onConflictDoNothing()
        .returning({ id: bankTransactions.id })
      created += inserted.length
    }
    return { statementId: st!.id, created, duplicates: preview.transactions.length - created }
  })
}

const statementCols = {
  id: bankStatements.id,
  bank: bankStatements.bank,
  accountNumber: bankStatements.accountNumber,
  currency: bankStatements.currency,
  number: bankStatements.number,
  periodFrom: bankStatements.periodFrom,
  periodTo: bankStatements.periodTo,
  openingBalance: bankStatements.openingBalance,
  closingBalance: bankStatements.closingBalance,
  creditTurnover: bankStatements.creditTurnover,
  debitTurnover: bankStatements.debitTurnover,
  fileName: bankStatements.fileName,
  importedByName: users.name,
  importedAt: bankStatements.importedAt,
  transactionCount: sql<number>`(select count(*)::int from ${bankTransactions} where ${bankTransactions.statementId} = ${bankStatements.id})`,
}

const toDto = (r: Omit<BankStatementDto, 'importedAt'> & { importedAt: Date | string }): BankStatementDto => ({
  ...r,
  importedAt: typeof r.importedAt === 'string' ? r.importedAt : r.importedAt.toISOString(),
})

export async function listStatements(db: Database): Promise<BankStatementDto[]> {
  const rows = await db
    .select(statementCols)
    .from(bankStatements)
    .leftJoin(users, eq(users.id, bankStatements.importedBy))
    .orderBy(desc(bankStatements.periodFrom), desc(bankStatements.importedAt))
  return rows.map(toDto)
}

export async function getStatement(db: Database, id: string): Promise<BankStatementDetailDto | null> {
  const [row] = await db.select(statementCols).from(bankStatements).leftJoin(users, eq(users.id, bankStatements.importedBy)).where(eq(bankStatements.id, id))
  if (!row) return null
  return { ...toDto(row), transactions: await listTransactions(db, eq(bankTransactions.statementId, id)) }
}

export async function listTransactions(db: Database, where: SQL): Promise<BankTransactionDto[]> {
  const rows = await db
    .select({ tx: bankTransactions, costCategoryName: costCategories.name })
    .from(bankTransactions)
    .leftJoin(costCategories, eq(costCategories.id, bankTransactions.costCategoryId))
    .where(where)
    .orderBy(bankTransactions.seq)
  const ids = rows.map((r) => r.tx.id)
  const pending = rows.filter((r) => r.tx.costStatus === 'pending' && BANK_TX_NEEDS_INVOICE.includes(r.tx.kind) && r.tx.amount < 0).map((r) => r.tx.id)
  const [links, suggestions, rules] = await Promise.all([linksFor(db, ids), suggestionsFor(db, pending), ruleKeys(db)])
  return rows.map(({ tx: { accountNumber: _a, createdAt: _c, updatedAt: _u, updatedBy: _b, ...t }, costCategoryName }) => {
    const ruleKey = counterpartyKey(t)
    return { ...t, costCategoryName, links: links.get(t.id) ?? [], suggestions: suggestions.get(t.id) ?? [], ruleKey, hasRule: !!ruleKey && rules.has(ruleKey) }
  })
}

/** Koszty bez faktury (do „Kosztów per projekt”): kwota zapłacona jako dodatnia, waluta rachunku. */
export async function listBankCosts(db: Database): Promise<BankCostDto[]> {
  const rows = await db
    .select({
      id: bankTransactions.id,
      bookingDate: bankTransactions.bookingDate,
      amount: bankTransactions.amount,
      vatRate: bankTransactions.vatRate,
      currency: bankStatements.currency,
      projectId: bankTransactions.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      general: bankTransactions.general,
      costCategoryId: bankTransactions.costCategoryId,
    })
    .from(bankTransactions)
    .innerJoin(bankStatements, eq(bankStatements.id, bankTransactions.statementId))
    .leftJoin(projects, eq(projects.id, bankTransactions.projectId))
    .where(eq(bankTransactions.costStatus, 'no_invoice'))
    .orderBy(bankTransactions.bookingDate)
  return rows.map((r) => ({ ...r, amount: -r.amount, net: netOfGross(-r.amount, r.vatRate) }))
}

export async function statementExists(db: Database, id: string) {
  const [r] = await db.select({ n: count() }).from(bankStatements).where(eq(bankStatements.id, id))
  return (r?.n ?? 0) > 0
}
