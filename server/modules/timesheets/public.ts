import { Hono } from 'hono'
import {
  TIMESHEET_MAX_RANGE_DAYS,
  TIMESHEET_MAX_WRITE_DAYS,
  hours,
  type TimesheetEntriesResponse,
  type TimesheetMeResponse,
  type TimesheetSaveResponse,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import { HttpProblem } from '../../lib/problem.ts'
import { findEmployee, getEntries, saveEntries } from './service.ts'

/**
 * Ekran pracownika ewidencji czasu (`/godziny`) — BEZ konta i 2FA, jak w workload-calendar:
 * dostęp wyłącznie identyfikatorem z linku i wyłącznie do własnych godzin.
 * Montowany pod `/api/public/czas` poza middleware `authenticate` (patrz app.ts).
 */
export const timesheetPublicRouter = new Hono<AppEnv>()

/** Spowolnienie nieudanych prób z identyfikatorem — utrudnia zgadywanie ID (jak w starej aplikacji). */
export const FAILURE_DELAY_MS = 450
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Komunikaty dosłownie jak w starej aplikacji; frontend pokazuje `detail`. */
const fail = (status: number, message: string) => new HttpProblem(status, 'timesheet_error', message)

async function requireEmployee(c: { get(k: 'deps'): AppEnv['Variables']['deps'] }, rawId: unknown) {
  const id = hours.normalizeId(rawId)
  if (!id) {
    await sleep(FAILURE_DELAY_MS)
    throw fail(400, 'Niepoprawny identyfikator.')
  }
  const employee = await findEmployee(c.get('deps').db, id)
  if (!employee) {
    await sleep(FAILURE_DELAY_MS)
    throw fail(404, 'Nie znaleziono pracownika o takim identyfikatorze.')
  }
  if (!employee.active) {
    await sleep(FAILURE_DELAY_MS)
    throw fail(403, 'To konto jest nieaktywne. Skontaktuj się z administratorem.')
  }
  return employee
}

timesheetPublicRouter.get('/me', async (c) => {
  const e = await requireEmployee(c, c.req.query('id'))
  return c.json({ id: e.id, name: e.name } satisfies TimesheetMeResponse)
})

timesheetPublicRouter.get('/entries', async (c) => {
  const e = await requireEmployee(c, c.req.query('id'))
  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!hours.isValidDate(from) || !hours.isValidDate(to)) throw fail(400, 'Podaj poprawny zakres dat (format RRRR-MM-DD).')
  const span = hours.daysBetween(from, to)
  if (span < 0) throw fail(400, 'Data początkowa jest późniejsza niż końcowa.')
  if (span + 1 > TIMESHEET_MAX_RANGE_DAYS) throw fail(400, `Zakres nie może przekraczać ${TIMESHEET_MAX_RANGE_DAYS} dni.`)
  const entries = await getEntries(c.get('deps').db, e.id, from, to)
  return c.json({ id: e.id, name: e.name, from, to, entries, total: hours.sumHours(entries) } satisfies TimesheetEntriesResponse)
})

timesheetPublicRouter.put('/entries', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { id?: unknown; entries?: unknown } | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Nieprawidłowa treść żądania.')
  const e = await requireEmployee(c, body.id)
  const raw = body.entries
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail(400, 'Brak wpisów do zapisania.')
  const dates = Object.keys(raw)
  if (dates.length === 0) throw fail(400, 'Brak wpisów do zapisania.')
  if (dates.length > TIMESHEET_MAX_WRITE_DAYS) throw fail(400, `Jednorazowo można zapisać maksymalnie ${TIMESHEET_MAX_WRITE_DAYS} dni.`)

  // Walidacja całości PRZED jakimkolwiek zapisem — albo wszystko, albo nic.
  const validated: Record<string, hours.TimesheetEntry | null> = {}
  for (const date of dates) {
    if (!hours.isValidDate(date)) throw fail(400, `Niepoprawna data: ${date}.`)
    const r = hours.validateEntry((raw as Record<string, unknown>)[date])
    if (!r.ok) throw fail(400, `${date}: ${r.error}`)
    validated[date] = r.entry
  }
  const updatedAt = (c.get('deps').now?.() ?? new Date()).toISOString()
  await saveEntries(c.get('deps').db, e.id, validated, updatedAt)
  const saved: Record<string, hours.StoredTimesheetEntry> = {}
  for (const [date, entry] of Object.entries(validated)) if (entry) saved[date] = { ...entry, updatedAt }
  return c.json({ ok: true, saved, savedAt: updatedAt } satisfies TimesheetSaveResponse)
})
