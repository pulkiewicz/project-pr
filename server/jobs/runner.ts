import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { formatInTimeZone } from 'date-fns-tz'
import type { AppDeps } from '../context.ts'
import { jobRuns, pendingUploads, projects } from '../db/schema.ts'
import { driveSettings, runSync } from '../modules/documents/service.ts'

export const JOBS = ['drive-sync', 'cleanup-uploads'] as const
export type JobName = (typeof JOBS)[number]

/** Klucz idempotencji: drive-sync — okno 5 min, pozostałe — godzina lokalna (Europe/Warsaw). */
export function runKeyFor(job: JobName, now: Date): string {
  if (job === 'drive-sync') {
    const slot = Math.floor(now.getUTCMinutes() / 5) * 5
    return `${now.toISOString().slice(0, 14)}${String(slot).padStart(2, '0')}`
  }
  return formatInTimeZone(now, 'Europe/Warsaw', "yyyy-MM-dd'T'HH")
}

/** Background function ma 15 min; synchronizacja ograniczona do 12 min z zapisem postępu (spec. 7.5). */
const SYNC_BUDGET_MS = 12 * 60_000

export async function runJob(deps: AppDeps, job: JobName, now = new Date()) {
  const db = deps.db
  const runKey = runKeyFor(job, now)
  const [claimed] = await db.insert(jobRuns).values({ job, runKey, status: 'running' }).onConflictDoNothing().returning()
  if (!claimed) return { skipped: true, runKey }
  try {
    let details: Record<string, unknown> = {}
    if (job === 'drive-sync') {
      if (!deps.drive) details = { skipped: 'drive_not_configured' }
      else {
        const all = await db.select().from(projects).where(isNull(projects.deletedAt))
        for (const p of all) {
          const s = driveSettings(p)
          if (s.sharedDriveId && s.rootFolderId) details[p.id] = await runSync(db, deps.drive, p.id, s, Date.now() + SYNC_BUDGET_MS)
        }
      }
    }
    if (job === 'cleanup-uploads') {
      // Sesje resumable wygasają po stronie Google; pliki dokończone bez potwierdzenia rejestruje synchronizacja (folder ACL).
      const removed = await db.delete(pendingUploads).where(and(lt(pendingUploads.expiresAt, sql`now()`))).returning({ id: pendingUploads.id })
      details = { removed: removed.length }
    }
    await db.update(jobRuns).set({ status: 'done', finishedAt: sql`now()`, details }).where(and(eq(jobRuns.job, job), eq(jobRuns.runKey, runKey)))
    return { skipped: false, runKey, details }
  } catch (e) {
    await db
      .update(jobRuns)
      .set({ status: 'error', finishedAt: sql`now()`, error: e instanceof Error ? e.message.slice(0, 2000) : String(e) })
      .where(and(eq(jobRuns.job, job), eq(jobRuns.runKey, runKey)))
    throw e
  }
}
