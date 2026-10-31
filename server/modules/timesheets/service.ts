import { randomBytes } from 'node:crypto'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { hours, type TimesheetEmployeeDto } from '#shared'
import type { Database } from '../../db/client.ts'
import { timesheetEmployees, timesheetEntries } from '../../db/schema.ts'

type EmployeeRow = typeof timesheetEmployees.$inferSelect
type EntryRow = typeof timesheetEntries.$inferSelect

/** Znaczniki czasu jako ISO (jak w workload-calendar), niezależnie od formatu sterownika bazy. */
const iso = (v: string) => new Date(v).toISOString()

export const toEmployeeDto = (e: EmployeeRow): TimesheetEmployeeDto => ({ id: e.id, name: e.name, active: e.active, createdAt: iso(e.createdAt) })

const toEntry = (r: EntryRow): hours.StoredTimesheetEntry => ({
  mode: r.mode,
  start: r.startTime,
  end: r.endTime,
  breakMin: r.breakMin,
  hours: Number(r.hours),
  note: r.note,
  updatedAt: iso(r.updatedAt),
})

/**
 * 8-znakowe ID z `randomBytes`: alfabet ma 32 znaki, a 256 dzieli się przez 32 bez reszty,
 * więc maskowanie bajtu (& 31) nie wprowadza obciążenia statystycznego (jak w workload-calendar).
 */
export function generateTimesheetId() {
  let id = ''
  for (const byte of randomBytes(hours.ID_LENGTH)) id += hours.ID_ALPHABET[byte & 31]
  return id
}

export const cleanName = (raw: unknown) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 120) : '')

export async function listEmployees(db: Database) {
  return db.select().from(timesheetEmployees).orderBy(asc(timesheetEmployees.name))
}

export async function findEmployee(db: Database, id: string) {
  const [row] = await db.select().from(timesheetEmployees).where(eq(timesheetEmployees.id, id))
  return row ?? null
}

/** Wpisy jednego pracownika z zakresu dat: data → wpis. */
export async function getEntries(db: Database, employeeId: string, from: string, to: string) {
  const rows = await db
    .select()
    .from(timesheetEntries)
    .where(and(eq(timesheetEntries.employeeId, employeeId), gte(timesheetEntries.workDate, from), lte(timesheetEntries.workDate, to)))
    .orderBy(asc(timesheetEntries.workDate))
  const out: Record<string, hours.StoredTimesheetEntry> = {}
  for (const r of rows) out[r.workDate] = toEntry(r)
  return out
}

/** Wpisy wszystkich pracowników z zakresu dat: id → data → wpis. */
export async function getEntriesForAll(db: Database, from: string, to: string) {
  const rows = await db
    .select()
    .from(timesheetEntries)
    .where(and(gte(timesheetEntries.workDate, from), lte(timesheetEntries.workDate, to)))
    .orderBy(asc(timesheetEntries.employeeId), asc(timesheetEntries.workDate))
  const out: Record<string, Record<string, hours.StoredTimesheetEntry>> = {}
  for (const r of rows) (out[r.employeeId] ??= {})[r.workDate] = toEntry(r)
  return out
}

/** Zapis kompletu zmian jednego pracownika: data → wpis (po walidacji) albo null (dzień do usunięcia). */
export async function saveEntries(db: Database, employeeId: string, entries: Record<string, hours.TimesheetEntry | null>, updatedAt: string) {
  const dates = Object.keys(entries)
  const toDelete = dates.filter((d) => entries[d] === null)
  const toUpsert = dates.filter((d) => entries[d] !== null)
  await db.transaction(async (tx) => {
    if (toDelete.length) await tx.delete(timesheetEntries).where(and(eq(timesheetEntries.employeeId, employeeId), inArray(timesheetEntries.workDate, toDelete)))
    if (toUpsert.length) {
      await tx
        .insert(timesheetEntries)
        .values(
          toUpsert.map((workDate) => {
            const e = entries[workDate]!
            return { employeeId, workDate, mode: e.mode, startTime: e.start, endTime: e.end, breakMin: e.breakMin, hours: e.hours, note: e.note, updatedAt }
          }),
        )
        .onConflictDoUpdate({
          target: [timesheetEntries.employeeId, timesheetEntries.workDate],
          set: {
            mode: sql`excluded.mode`,
            startTime: sql`excluded.start_time`,
            endTime: sql`excluded.end_time`,
            breakMin: sql`excluded.break_min`,
            hours: sql`excluded.hours`,
            note: sql`excluded.note`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
    }
  })
}

/** Raport nie ufa zapisanym godzinom — każdy wpis przeliczany ponownie (jak w starej aplikacji). */
export function revalidate(stored: Record<string, hours.StoredTimesheetEntry>) {
  const out: Record<string, hours.StoredTimesheetEntry> = {}
  for (const [date, entry] of Object.entries(stored)) {
    const r = hours.validateEntry(entry)
    if (r.ok && r.entry) out[date] = { ...r.entry, updatedAt: entry.updatedAt ?? null }
  }
  return out
}
