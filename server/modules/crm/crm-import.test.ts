import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { MIGRATIONS_DIR, createUser, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

/** Import arkusza CRM uruchomiony na bazie z Administratorem (jak na produkcji): opiekun = pierwszy Admin. */
let h: Harness
let first: TestUser
beforeAll(async () => {
  h = await startHarness()
  // Migracje w harnessie idą przed utworzeniem użytkowników — usuwamy import i powtarzamy go z kontami w bazie.
  await h.db.delete(schema.crmActivities)
  await h.db.delete(schema.opportunities)
  first = await createUser(h, 'Admin')
  await createUser(h, 'Admin')
  const file = readFileSync(`${MIGRATIONS_DIR}/20261025163030_crm_import/migration.sql`, 'utf8')
  for (const stmt of file.split('--> statement-breakpoint')) if (stmt.trim()) await h.db.execute(sql.raw(stmt))
})
afterAll(() => h.stop())

describe('import arkusza CRM — opiekun', () => {
  it('wszystkie 24 oferty przypisane pierwszemu Administratorowi', async () => {
    const rows = await h.db.select({ ownerId: schema.opportunities.ownerId }).from(schema.opportunities)
    expect(rows).toHaveLength(24)
    expect(new Set(rows.map((r) => r.ownerId))).toEqual(new Set([first.id]))
  })
})
