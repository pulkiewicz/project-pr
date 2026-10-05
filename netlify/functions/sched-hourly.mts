import type { Config } from '@netlify/functions'
import { triggerJob } from '../../server/jobs/trigger.ts'

/**
 * Co godzinę (UTC). Zadania „o godzinie lokalnej” (Europe/Warsaw) wybierane w server/jobs/trigger.ts
 * — odporne na zmianę czasu (spec. 3.4). Obecnie: sprzątanie uploadów; kolejne zadania dochodzą z modułami.
 */
export default async () => {
  await triggerJob('cleanup-uploads')
}

export const config: Config = { schedule: '0 * * * *' }
