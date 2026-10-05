import type { Config } from '@netlify/functions'
import { triggerJob } from '../../server/jobs/trigger.ts'

/** Co 5 minut: synchronizacja Shared Drive (Drive Changes API). Praca właściwa w job-runner-background. */
export default async () => {
  await triggerJob('drive-sync')
}

export const config: Config = { schedule: '*/5 * * * *' }
