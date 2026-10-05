import { and, desc, eq, gt } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { authAttempts } from '../db/schema.ts'

export const MAX_FAILURES = 5
export const LOCK_MINUTES = 15

/**
 * Blokada po 5 nieudanych próbach w oknie 15 min (licząc od ostatniego sukcesu).
 * Zwraca sekundy do odblokowania albo 0.
 */
export async function lockedForSeconds(db: Database, userId: string, kind: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - LOCK_MINUTES * 60_000).toISOString()
  const recent = await db
    .select({ success: authAttempts.success, createdAt: authAttempts.createdAt })
    .from(authAttempts)
    .where(and(eq(authAttempts.userId, userId), eq(authAttempts.kind, kind), gt(authAttempts.createdAt, since)))
    .orderBy(desc(authAttempts.createdAt))
    .limit(50)
  const failures: string[] = []
  for (const r of recent) {
    if (r.success) break
    failures.push(r.createdAt)
  }
  if (failures.length < MAX_FAILURES) return 0
  // Blokada liczona od piątej (najstarszej w serii) porażki z ostatnich 5.
  const fifth = new Date(failures[MAX_FAILURES - 1]!)
  const unlockAt = fifth.getTime() + LOCK_MINUTES * 60_000
  return Math.max(0, Math.ceil((unlockAt - now.getTime()) / 1000))
}

export async function recordAttempt(db: Database, userId: string, kind: string, success: boolean, ip: string | null) {
  await db.insert(authAttempts).values({ userId, kind, success, ip: ip && isIp(ip) ? ip : null })
}

function isIp(value: string) {
  return /^[0-9a-f.:]+$/i.test(value)
}
