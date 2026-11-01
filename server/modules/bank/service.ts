import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { BankImportPreview, BankStatementDetailDto, BankStatementDto, BankTxKind } from '#shared'
import type { Database } from '../../db/client.ts'
import { bankStatements, bankTransactions, users } from '../../db/schema.ts'
import type { ParsedStatement } from './pko.ts'

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
    let created = 0
    for (let i = 0; i < fresh.length; i += 200) {
      const inserted = await tx
        .insert(bankTransactions)
        .values(fresh.slice(i, i + 200).map(({ duplicate: _d, ...t }) => ({ ...t, statementId: st!.id, accountNumber: preview.statement.accountNumber })))
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
  const txs = await db.select().from(bankTransactions).where(eq(bankTransactions.statementId, id)).orderBy(bankTransactions.seq)
  return {
    ...toDto(row),
    transactions: txs.map(({ accountNumber: _a, createdAt: _c, ...t }) => t),
  }
}

export async function statementExists(db: Database, id: string) {
  const [r] = await db.select({ n: count() }).from(bankStatements).where(eq(bankStatements.id, id))
  return (r?.n ?? 0) > 0
}
