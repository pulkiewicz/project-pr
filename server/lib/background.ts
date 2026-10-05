import type { Context } from 'hono'
import type { AppEnv } from '../context.ts'

/**
 * Praca po wysłaniu odpowiedzi (Netlify `context.waitUntil`); poza runtime Netlify (testy) — wykonanie od razu.
 * Błędy są logowane, nie przerywają żądania.
 */
export async function inBackground(c: Context<AppEnv>, work: () => Promise<unknown>) {
  const run = () => work().catch((e) => console.error('[pmo] zadanie w tle nie powiodło się', e))
  const netlify = (c.env as { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined)?.context
  if (netlify?.waitUntil) netlify.waitUntil(run())
  else await run()
}
