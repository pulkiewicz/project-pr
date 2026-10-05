import type { Config } from '@netlify/functions'
import { timingSafeEqual } from 'node:crypto'
import { JOBS, runJob, type JobName } from '../../server/jobs/runner.ts'
import { env } from '../../server/lib/env.ts'
import { runtimeDeps } from '../../server/runtime.ts'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Wykonawca zadań w tle (15 min). Wywoływany przez funkcje harmonogramu z nagłówkiem x-job-secret. */
export default async (req: Request) => {
  const secret = env('JOB_SECRET')
  const given = req.headers.get('x-job-secret') ?? ''
  if (!secret || !same(given, secret)) return new Response('Unauthorized', { status: 401 })
  const { job } = (await req.json().catch(() => ({}))) as { job?: string }
  if (!job || !(JOBS as readonly string[]).includes(job)) return new Response('Unknown job', { status: 400 })
  const result = await runJob(runtimeDeps(), job as JobName)
  console.log(`[pmo] job ${job}`, JSON.stringify(result))
}

export const config: Config = { background: true }
