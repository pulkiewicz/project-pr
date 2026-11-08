import type { Config } from '@netlify/functions'
import { invoiceSettings } from '../../server/auth/access.ts'
import { syncSalesSafe } from '../../server/modules/finance/service.ts'
import { syncInvoices } from '../../server/modules/invoices/service.ts'
import { runtimeDeps } from '../../server/runtime.ts'

/** Codzienna synchronizacja kosztów i faktur sprzedażowych z inFakt (oprócz przycisku „Synchronizuj” w module Faktury). */
export default async () => {
  const deps = runtimeDeps()
  if (!deps.infakt) {
    console.log('[pmo] infakt sync: INFAKT_API_KEY nie ustawiony — pomijam')
    return
  }
  const settings = await invoiceSettings(deps.db)
  const result = await syncInvoices(deps.db, deps.infakt, settings, null, new Date())
  const sales = await syncSalesSafe(deps.db, deps.infakt, settings.syncFrom, null, new Date())
  console.log(`[pmo] infakt sync: ${JSON.stringify({ ...result, ...sales })}`)
}

// 05:00 UTC = 6:00/7:00 w Warszawie.
export const config: Config = { schedule: '0 5 * * *' }
