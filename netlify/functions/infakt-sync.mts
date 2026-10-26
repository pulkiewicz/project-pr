import type { Config } from '@netlify/functions'
import { invoiceSettings } from '../../server/auth/access.ts'
import { syncInvoices } from '../../server/modules/invoices/service.ts'
import { runtimeDeps } from '../../server/runtime.ts'

/** Codzienna synchronizacja kosztów z inFakt (oprócz przycisku „Synchronizuj” w module Faktury). */
export default async () => {
  const deps = runtimeDeps()
  if (!deps.infakt) {
    console.log('[pmo] infakt sync: INFAKT_API_KEY nie ustawiony — pomijam')
    return
  }
  const result = await syncInvoices(deps.db, deps.infakt, await invoiceSettings(deps.db), null, new Date())
  console.log(`[pmo] infakt sync: ${JSON.stringify(result)}`)
}

// 05:00 UTC = 6:00/7:00 w Warszawie.
export const config: Config = { schedule: '0 5 * * *' }
