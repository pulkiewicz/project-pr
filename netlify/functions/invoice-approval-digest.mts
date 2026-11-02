import type { Config } from '@netlify/functions'
import { sendApprovalDigest } from '../../server/modules/invoices/notify.ts'
import { appUrl, runtimeDeps } from '../../server/runtime.ts'

/** Poranne przypomnienie o fakturach kosztowych czekających na akceptację (gdy włączone w Ustawieniach). */
export default async () => {
  const deps = runtimeDeps()
  const url = appUrl()
  if (!deps.mailer || !url) {
    console.log('[pmo] invoice digest: brak SMTP_HOST/MAIL_FROM albo adresu aplikacji — pomijam')
    return
  }
  const result = await sendApprovalDigest(deps.db, deps.mailer, url)
  console.log(`[pmo] invoice digest: ${JSON.stringify(result)}`)
}

// 06:00 UTC = 7:00/8:00 w Warszawie, w dni robocze (po synchronizacji z inFakt o 05:00).
export const config: Config = { schedule: '0 6 * * 1-5' }
