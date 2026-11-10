import { createHash } from 'node:crypto'
import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { bankLinkInput, bankMatchInput, bankRuleInput, bankSettlementInput, bankTxPatch, type Action, type BankImportResult, type BankRuleResult } from '#shared'
import type { AppEnv } from '../../context.ts'
import { bankStatements, bankTransactions, costCategories, costInvoices, projects } from '../../db/schema.ts'
import { HttpProblem, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { extractPdfItems, parsePkoStatement } from './pko.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { buildReport, reportWorkbook } from './report.ts'
import { createRule, deleteRule, linkInvoice, linksFor, listRules, runMatching, unlinkInvoice } from './reconcile.ts'
import { buildPreview, commitImport, getStatement, listBankCosts, listStatements, listTransactions, statementExists } from './service.ts'

/** Wyciągi bankowe — część modułu Faktury (te same uprawnienia i lista osób w Ustawieniach). */
export const bankRouter = newRouter()

const ok = { 200: { description: 'OK', content: { 'application/json': { schema: z.any() } } } }
const multipart = { content: { 'multipart/form-data': { schema: z.any() } }, required: true as const }
const idParam = z.object({ id: z.uuid() })
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } }, required: true as const })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'invoices', action } })

const MAX_PDF_BYTES = 10 * 1024 * 1024

/** Plik PDF z pola „file” → odczyt wyciągu i podgląd importu. */
async function readStatement(c: Context<AppEnv>) {
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw new HttpProblem(422, 'import_file_missing')
  if (file.size > MAX_PDF_BYTES) throw new HttpProblem(422, 'bank_file_too_large')
  if (!/\.pdf$/i.test(file.name)) throw new HttpProblem(422, 'bank_file_type')
  const data = new Uint8Array(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(data).digest('hex')
  let items
  try {
    items = await extractPdfItems(data)
  } catch {
    throw new HttpProblem(422, 'bank_file_invalid')
  }
  const preview = await buildPreview(c.get('deps').db, parsePkoStatement(items), sha256)
  if (!preview) throw new HttpProblem(422, 'bank_statement_unrecognized')
  return { preview, file: { name: file.name, sha256 } }
}

bankRouter.openapi(route({ method: 'get', path: '/bank/statements', responses: ok }, 'view'), async (c) => c.json(await listStatements(c.get('deps').db), 200))

bankRouter.openapi(route({ method: 'get', path: '/bank/statements/{id}', request: { params: idParam }, responses: ok }, 'view'), async (c) => {
  const st = await getStatement(c.get('deps').db, c.req.valid('param').id)
  if (!st) throw notFound()
  return c.json(st, 200)
})

bankRouter.openapi(route({ method: 'post', path: '/bank/import/preview', request: { body: multipart }, responses: ok }, 'create'), async (c) => {
  const { preview } = await readStatement(c)
  return c.json(preview, 200)
})

bankRouter.openapi(route({ method: 'post', path: '/bank/import', request: { body: multipart }, responses: ok }, 'create'), async (c) => {
  const { preview, file } = await readStatement(c)
  if (!preview.canCommit) throw new HttpProblem(422, 'import_has_errors', undefined, { issues: preview.issues.filter((i) => i.severity === 'error') })
  const db = c.get('deps').db
  const userId = c.get('user').id
  const committed = await commitImport(db, preview, file, userId)
  const result: BankImportResult = { ...committed, match: await runMatching(db, userId, committed.statementId) }
  const s = preview.statement
  await writeAudit(c, {
    action: 'bank.import',
    entity: 'bank_statements',
    entityId: result.statementId,
    changes: { number: s.number, account: s.accountNumber, period: `${s.periodFrom}–${s.periodTo}`, fileName: file.name, created: result.created, duplicates: result.duplicates, match: result.match },
  })
  return c.json(result, 200)
})

/** Usunięcie wyciągu razem z jego operacjami (np. pomyłkowy import). */
bankRouter.openapi(route({ method: 'delete', path: '/bank/statements/{id}', request: { params: idParam }, responses: ok }, 'delete'), async (c) => {
  const { id } = c.req.valid('param')
  const db = c.get('deps').db
  if (!(await statementExists(db, id))) throw notFound()
  const [st] = await db.delete(bankStatements).where(eq(bankStatements.id, id)).returning({ number: bankStatements.number, accountNumber: bankStatements.accountNumber })
  await writeAudit(c, { action: 'bank.delete', entity: 'bank_statements', entityId: id, changes: st })
  return c.json({ ok: true }, 200)
})

/** Koszty bez faktury ze wszystkich wyciągów — do „Kosztów per projekt”. */
bankRouter.openapi(route({ method: 'get', path: '/bank/costs', responses: ok }, 'view'), async (c) => c.json(await listBankCosts(c.get('deps').db), 200))

/**
 * Rozliczenie operacji: status, kategoria, projekt. Projekt / koszty ogólne tylko przy koszcie bez faktury —
 * zmiana statusu na inny czyści przypisanie (koszt z faktury przypisuje się w fakturze).
 */
bankRouter.openapi(
  route({ method: 'patch', path: '/bank/transactions/{id}', request: { params: idParam, body: body(bankTxPatch) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const patch = c.req.valid('json')
    const db = c.get('deps').db
    const [cur] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, id))
    if (!cur) throw notFound()
    if (patch.costCategoryId && patch.costCategoryId !== cur.costCategoryId) {
      const [cat] = await db.select({ active: costCategories.active }).from(costCategories).where(eq(costCategories.id, patch.costCategoryId))
      if (!cat?.active) throw new HttpProblem(422, 'cost_category_not_found')
    }
    if (patch.projectId && patch.projectId !== cur.projectId) {
      const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, patch.projectId), isNull(projects.deletedAt)))
      if (!p) throw new HttpProblem(422, 'project_not_found')
    }
    const costStatus = patch.costStatus ?? cur.costStatus
    // Operacja połączona z fakturą ma koszt w fakturze — najpierw rozłącz.
    if (costStatus !== 'invoice' && (await linksFor(db, [id])).get(id)?.length) throw new HttpProblem(409, 'bank_tx_linked')
    let projectId = patch.projectId !== undefined ? patch.projectId : cur.projectId
    let general = patch.projectId ? false : (patch.general ?? cur.general)
    if (costStatus !== 'no_invoice') {
      projectId = null
      general = false
    } else if (projectId) general = false
    const next = { costStatus, costCategoryId: patch.costCategoryId !== undefined ? patch.costCategoryId : cur.costCategoryId, projectId, general, vatRate: patch.vatRate ?? cur.vatRate }
    const user = c.get('user')
    await db.transaction(async (tx) => {
      await tx.update(bankTransactions).set({ ...next, updatedAt: sql`now()`, updatedBy: user.id }).where(eq(bankTransactions.id, id))
      const old = { costStatus: cur.costStatus, costCategoryId: cur.costCategoryId, projectId: cur.projectId, general: cur.general, vatRate: cur.vatRate }
      await writeAudit(c, { action: 'bank.tx_update', entity: 'bank_transactions', entityId: id, changes: { old, new: next } }, tx)
    })
    const [dto] = await listTransactions(db, eq(bankTransactions.id, id))
    return c.json(dto, 200)
  },
)

/**
 * Rozliczenia: komentarz i ręczne odhaczenie płatności bez faktury (np. dostawca zwrócił część kwoty, a korekty
 * faktury nie ma). Rozliczenie w kosztach (status, projekt) bez zmian — odhaczenie tylko zdejmuje płatność z listy braków.
 */
bankRouter.openapi(
  route({ method: 'patch', path: '/bank/transactions/{id}/settlement', request: { params: idParam, body: body(bankSettlementInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const [cur] = await db.select({ note: bankTransactions.settlementNote, settledAt: bankTransactions.settledAt }).from(bankTransactions).where(eq(bankTransactions.id, id))
    if (!cur) throw notFound()
    const user = c.get('user')
    const set: Partial<typeof bankTransactions.$inferInsert> = {}
    if (input.note !== undefined) set.settlementNote = input.note || null
    if (input.settled !== undefined) {
      set.settledAt = input.settled ? (cur.settledAt ?? new Date().toISOString()) : null
      set.settledBy = input.settled ? user.id : null
    }
    await db.transaction(async (tx) => {
      await tx.update(bankTransactions).set({ ...set, updatedAt: sql`now()`, updatedBy: user.id }).where(eq(bankTransactions.id, id))
      await writeAudit(c, { action: 'bank.tx_settlement', entity: 'bank_transactions', entityId: id, changes: { old: { note: cur.note, settled: !!cur.settledAt }, new: input } }, tx)
    })
    return c.json({ ok: true as const }, 200)
  },
)

// ---------------- Rekoncyliacja (B2) ----------------

const txDto = async (c: Context<AppEnv>, id: string) => {
  const [dto] = await listTransactions(c.get('deps').db, eq(bankTransactions.id, id))
  if (!dto) throw notFound()
  return dto
}

/** Dopasuj automatycznie — np. po synchronizacji faktur z inFakt, które doszły po imporcie wyciągu. */
bankRouter.openapi(route({ method: 'post', path: '/bank/match', request: { body: body(bankMatchInput) }, responses: ok }, 'edit'), async (c) => {
  const { statementId } = c.req.valid('json')
  const db = c.get('deps').db
  if (statementId && !(await statementExists(db, statementId))) throw notFound()
  const result = await runMatching(db, c.get('user').id, statementId)
  await writeAudit(c, { action: 'bank.match', entity: 'bank_statements', entityId: statementId, changes: result })
  return c.json(result, 200)
})

/** Połączenie z fakturą (ręczne albo zatwierdzenie propozycji). */
bankRouter.openapi(
  route({ method: 'post', path: '/bank/transactions/{id}/links', request: { params: idParam, body: body(bankLinkInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { invoiceId } = c.req.valid('json')
    const db = c.get('deps').db
    const [t] = await db.select({ amount: bankTransactions.amount }).from(bankTransactions).where(eq(bankTransactions.id, id))
    if (!t) throw notFound()
    if (t.amount >= 0) throw new HttpProblem(422, 'bank_tx_not_expense')
    const [inv] = await db.select({ id: costInvoices.id }).from(costInvoices).where(eq(costInvoices.id, invoiceId))
    if (!inv) throw new HttpProblem(422, 'invoice_not_found')
    const r = await linkInvoice(db, id, invoiceId, c.get('user').id)
    await writeAudit(c, { action: 'bank.link', entity: 'bank_transactions', entityId: id, changes: { invoiceId, amount: r?.amount } })
    return c.json(await txDto(c, id), 200)
  },
)

bankRouter.openapi(
  route({ method: 'delete', path: '/bank/transactions/{id}/links/{invoiceId}', request: { params: z.object({ id: z.uuid(), invoiceId: z.uuid() }) }, responses: ok }, 'edit'),
  async (c) => {
    const { id, invoiceId } = c.req.valid('param')
    const r = await unlinkInvoice(c.get('deps').db, id, invoiceId, c.get('user').id)
    if (!r) throw notFound()
    await writeAudit(c, { action: 'bank.unlink', entity: 'bank_transactions', entityId: id, changes: { invoiceId, ...r } })
    return c.json(await txDto(c, id), 200)
  },
)

// ---------------- Reguły kontrahentów (W5) ----------------

bankRouter.openapi(route({ method: 'get', path: '/bank/rules', responses: ok }, 'view'), async (c) => c.json(await listRules(c.get('deps').db), 200))

/** Reguła z ustawień operacji („zawsze tak dla tego kontrahenta”) — od razu stosowana do operacji „do ustalenia”. */
bankRouter.openapi(route({ method: 'post', path: '/bank/rules', request: { body: body(bankRuleInput) }, responses: ok }, 'edit'), async (c) => {
  const db = c.get('deps').db
  const r = await createRule(db, c.req.valid('json').transactionId, c.get('user').id)
  if ('error' in r) {
    if (r.error === 'not_found') throw notFound()
    throw new HttpProblem(422, r.error)
  }
  const rule = (await listRules(db)).find((x) => x.id === r.id)!
  await writeAudit(c, { action: 'bank.rule_create', entity: 'bank_counterparty_rules', entityId: r.id, changes: { ...rule, applied: r.applied } })
  const result: BankRuleResult = { rule, applied: r.applied }
  return c.json(result, 200)
})

bankRouter.openapi(route({ method: 'delete', path: '/bank/rules/{id}', request: { params: idParam }, responses: ok }, 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const r = await deleteRule(c.get('deps').db, id)
  if (!r) throw notFound()
  // Operacje oznaczone wcześniej regułą zostają bez zmian — reguła działa tylko na kolejne.
  await writeAudit(c, { action: 'bank.rule_delete', entity: 'bank_counterparty_rules', entityId: id, changes: r })
  return c.json({ ok: true }, 200)
})

// ---------------- Raporty (B3) ----------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const reportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() })
const today = (c: Context<AppEnv>) => todayWarsaw(c.get('deps').now?.() ?? new Date())

bankRouter.openapi(route({ method: 'get', path: '/bank/report', request: { query: reportQuery }, responses: ok }, 'view'), async (c) =>
  c.json(await buildReport(c.get('deps').db, today(c), c.req.valid('query')), 200),
)

bankRouter.openapi(
  route(
    {
      method: 'get',
      path: '/bank/report.xlsx',
      request: { query: reportQuery },
      responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } },
    },
    'export',
  ),
  async (c) => {
    const r = await buildReport(c.get('deps').db, today(c), c.req.valid('query'))
    await writeAudit(c, { action: 'bank.report_xlsx', entity: 'bank_statements', changes: { from: r.from, to: r.to, missing: r.missing.length, unpaid: r.unpaid.length } })
    return c.body(await reportWorkbook(r), 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="rozliczenia-${r.from}_${r.to}.xlsx"`,
    })
  },
)
