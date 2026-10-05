import { drizzle } from 'drizzle-orm/netlify-db'
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema.ts'

/**
 * Wspólny typ bazy dla adaptera netlify-db (serverless/HTTP lub node-postgres).
 * Klient tworzony raz na moduł — nigdy per żądanie (operational-footguns.md).
 */
export type Database = PgAsyncDatabase<PgQueryResultHKT, typeof schema>

let instance: Database | undefined

export function getDb(): Database {
  instance ??= drizzle({ schema }) as unknown as Database
  return instance
}

export { schema }
