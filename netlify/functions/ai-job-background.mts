import type { Config } from '@netlify/functions'
import { runAiJob } from '../../server/modules/ai/ops.ts'
import { runtimeDeps } from '../../server/runtime.ts'

/**
 * Wykonawca zadań AI (funkcja w tle, do 15 min). Zlecenie z API zawiera id zadania i jednorazowy token —
 * zadanie rusza tylko, gdy hash tokenu się zgadza, a zadanie czeka w kolejce (nie potrzeba wspólnego sekretu).
 */
export default async (req: Request) => {
  const { jobId, token } = (await req.json().catch(() => ({}))) as { jobId?: string; token?: string }
  if (!jobId || !token) return new Response('Bad request', { status: 400 })
  const result = await runAiJob(runtimeDeps(), jobId, token)
  console.log(`[pmo] ai job ${jobId}: ${result}`)
}

export const config: Config = { background: true }
