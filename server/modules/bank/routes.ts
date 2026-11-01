import { createHash } from 'node:crypto'
import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { bankTxPatch, type Action, type BankImportResult } from '#shared'
import type { AppEnv } from '../../context.ts'
import { bankStatements, bankTransactions, costCategories, projects } from '../../db/schema.ts'
import { HttpProblem, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { extractPdfItems, parsePkoStatement } from './pko.ts'
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
  const result: BankImportResult = await commitImport(c.get('deps').db, preview, file, c.get('user').id)
  const s = preview.statement
  await writeAudit(c, {
    action: 'bank.import',
    entity: 'bank_statements',
    entityId: result.statementId,
    changes: { number: s.number, account: s.accountNumber, period: `${s.periodFrom}–${s.periodTo}`, fileName: file.name, created: result.created, duplicates: result.duplicates },
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
    let projectId = patch.projectId !== undefined ? patch.projectId : cur.projectId
    let general = patch.projectId ? false : (patch.general ?? cur.general)
    if (costStatus !== 'no_invoice') {
      projectId = null
      general = false
    } else if (projectId) general = false
    const next = { costStatus, costCategoryId: patch.costCategoryId !== undefined ? patch.costCategoryId : cur.costCategoryId, projectId, general }
    const user = c.get('user')
    await db.transaction(async (tx) => {
      await tx.update(bankTransactions).set({ ...next, updatedAt: sql`now()`, updatedBy: user.id }).where(eq(bankTransactions.id, id))
      const old = { costStatus: cur.costStatus, costCategoryId: cur.costCategoryId, projectId: cur.projectId, general: cur.general }
      await writeAudit(c, { action: 'bank.tx_update', entity: 'bank_transactions', entityId: id, changes: { old, new: next } }, tx)
    })
    const [dto] = await listTransactions(db, eq(bankTransactions.id, id))
    return c.json(dto, 200)
  },
)
