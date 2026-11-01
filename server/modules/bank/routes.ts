import { createHash } from 'node:crypto'
import { z, type RouteConfig } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Action, BankImportResult } from '#shared'
import type { AppEnv } from '../../context.ts'
import { bankStatements } from '../../db/schema.ts'
import { HttpProblem, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { extractPdfItems, parsePkoStatement } from './pko.ts'
import { buildPreview, commitImport, getStatement, listStatements, statementExists } from './service.ts'

/** Wyciągi bankowe — część modułu Faktury (te same uprawnienia i lista osób w Ustawieniach). */
export const bankRouter = newRouter()

const ok = { 200: { description: 'OK', content: { 'application/json': { schema: z.any() } } } }
const multipart = { content: { 'multipart/form-data': { schema: z.any() } }, required: true as const }
const idParam = z.object({ id: z.uuid() })
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
