import { env } from '../lib/env.ts'
import type { JobName } from './runner.ts'

/** Wywołanie background function (scheduled ma limit 30 s — sama tylko zleca pracę). */
export async function triggerJob(job: JobName) {
  const base = env('URL') ?? env('DEPLOY_PRIME_URL')
  const secret = env('JOB_SECRET')
  if (!base || !secret) {
    console.error('[pmo] brak URL lub JOB_SECRET — nie można zlecić zadania', job)
    return
  }
  const res = await fetch(`${base}/.netlify/functions/job-runner-background`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-job-secret': secret },
    body: JSON.stringify({ job }),
  })
  if (res.status !== 202 && !res.ok) console.error(`[pmo] zlecenie ${job}: HTTP ${res.status}`)
}
