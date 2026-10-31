import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  STAFF_ROLES,
  TIMESHEET_MAX_SUMMARY_MONTHS,
  hours,
  timesheetEmployeeInput,
  timesheetEmployeePatch,
  timesheetImportInput,
  timesheetSettingsInput,
  type Action,
  type ManagementUserOption,
  type TimesheetImportResult,
  type TimesheetReportResponse,
  type TimesheetSummaryResponse,
} from '#shared'
import { TIMESHEETS_SETTING_KEY, timesheetSettings } from '../../auth/access.ts'
import { appSettings, timesheetEmployees, timesheetEntries, users } from '../../db/schema.ts'
import { HttpProblem } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { cleanName, findEmployee, generateTimesheetId, getEntriesForAll, listEmployees, revalidate, toEmployeeDto } from './service.ts'

/** Zarząd → Czas pracy: panel ewidencji (dawny `/admin` workload-calendar). */
export const timesheetsRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const created = { 201: { description: 'Utworzono', ...json(z.any()) } }
const idParam = z.object({ id: z.string().max(20) })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'timesheets', action } })
const fail = (status: number, message: string) => new HttpProblem(status, 'timesheet_error', message)

const employeeId = (raw: string) => {
  const id = hours.normalizeId(raw)
  if (!id) throw fail(400, 'Niepoprawny identyfikator.')
  return id
}

// ---------------- Pracownicy ----------------

timesheetsRouter.openapi(route({ method: 'get', path: '/timesheets/employees', responses: ok }, 'view'), async (c) => {
  return c.json({ employees: (await listEmployees(c.get('deps').db)).map(toEmployeeDto) }, 200)
})

timesheetsRouter.openapi(
  route({ method: 'post', path: '/timesheets/employees', request: { body: body(timesheetEmployeeInput) }, responses: created }, 'create'),
  async (c) => {
    const name = cleanName(c.req.valid('json').name)
    if (!name) throw fail(400, 'Podaj imię i nazwisko pracownika.')
    const db = c.get('deps').db
    const me = c.get('user').id
    // Klucz główny pilnuje unikalności; przy kolizji losujemy ponownie.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = generateTimesheetId()
      const [row] = await db.insert(timesheetEmployees).values({ id, name, createdBy: me, updatedBy: me }).onConflictDoNothing().returning()
      if (row) {
        await writeAudit(c, { action: 'timesheets.employee_create', entity: 'timesheet_employees', changes: { id, name } })
        return c.json({ employee: toEmployeeDto(row) }, 201)
      }
    }
    throw fail(500, 'Nie udało się wygenerować identyfikatora.')
  },
)

timesheetsRouter.openapi(
  route({ method: 'patch', path: '/timesheets/employees/{id}', request: { params: idParam, body: body(timesheetEmployeePatch) }, responses: ok }, 'edit'),
  async (c) => {
    const id = employeeId(c.req.valid('param').id)
    const input = c.req.valid('json')
    const patch: { name?: string; active?: boolean } = {}
    if (input.name !== undefined) {
      const name = cleanName(input.name)
      if (!name) throw fail(400, 'Nazwa pracownika nie może być pusta.')
      patch.name = name
    }
    if (input.active !== undefined) patch.active = input.active
    if (!Object.keys(patch).length) throw fail(400, 'Brak zmian do zapisania.')
    const db = c.get('deps').db
    const before = await findEmployee(db, id)
    if (!before) throw fail(404, 'Nie znaleziono pracownika.')
    const [row] = await db
      .update(timesheetEmployees)
      .set({ ...patch, updatedAt: sql`now()`, updatedBy: c.get('user').id })
      .where(eq(timesheetEmployees.id, id))
      .returning()
    await writeAudit(c, { action: 'timesheets.employee_update', entity: 'timesheet_employees', changes: { id, old: { name: before.name, active: before.active }, new: patch } })
    return c.json({ employee: toEmployeeDto(row!) }, 200)
  },
)

timesheetsRouter.openapi(
  route({ method: 'delete', path: '/timesheets/employees/{id}', request: { params: idParam }, responses: ok }, 'delete'),
  async (c) => {
    const id = employeeId(c.req.valid('param').id)
    const db = c.get('deps').db
    const result = await db.transaction(async (tx) => {
      const removedEntries = await tx.delete(timesheetEntries).where(eq(timesheetEntries.employeeId, id)).returning({ d: timesheetEntries.workDate })
      const [removed] = await tx.delete(timesheetEmployees).where(eq(timesheetEmployees.id, id)).returning()
      if (!removed) return null
      await writeAudit(c, { action: 'timesheets.employee_delete', entity: 'timesheet_employees', changes: { id, name: removed.name, deletedEntries: removedEntries.length } }, tx)
      return removedEntries.length
    })
    if (result === null) throw fail(404, 'Nie znaleziono pracownika.')
    return c.json({ ok: true, deletedEntries: result }, 200)
  },
)

// ---------------- Zestawienie miesięczne i podsumowanie okresu ----------------

timesheetsRouter.openapi(
  route({ method: 'get', path: '/timesheets/report', request: { query: z.object({ month: z.string().max(7) }) }, responses: ok }, 'view'),
  async (c) => {
    const { month } = c.req.valid('query')
    if (!hours.isValidMonth(month)) throw fail(400, 'Podaj miesiąc w formacie RRRR-MM.')
    const db = c.get('deps').db
    const days = hours.monthDates(month)
    const [employees, byEmployee] = await Promise.all([listEmployees(db), getEntriesForAll(db, days[0]!, days.at(-1)!)])
    const rows = employees.map((e) => {
      const entries = revalidate(byEmployee[e.id] ?? {})
      return { id: e.id, name: e.name, active: e.active, days: entries, total: hours.sumHours(entries) }
    })
    // Nieaktywni pojawiają się tylko wtedy, gdy mają godziny w tym miesiącu.
    const visible = rows.filter((r) => r.active || Object.keys(r.days).length > 0)
    const res: TimesheetReportResponse = { month, days, employees: visible, total: hours.roundHours(visible.reduce((s, r) => s + r.total, 0)) }
    return c.json(res, 200)
  },
)

timesheetsRouter.openapi(
  route({ method: 'get', path: '/timesheets/summary', request: { query: z.object({ from: z.string().max(7), to: z.string().max(7).optional() }) }, responses: ok }, 'view'),
  async (c) => {
    const q = c.req.valid('query')
    const from = q.from
    const to = q.to ?? from
    if (!hours.isValidMonth(from) || !hours.isValidMonth(to)) throw fail(400, 'Podaj zakres miesięcy w formacie RRRR-MM.')
    if (from > to) throw fail(400, 'Miesiąc początkowy jest późniejszy niż końcowy.')
    const months = hours.monthRange(from, to)
    if (months.length > TIMESHEET_MAX_SUMMARY_MONTHS) throw fail(400, `Okres nie może przekraczać ${TIMESHEET_MAX_SUMMARY_MONTHS} miesięcy.`)

    // Jeden miesiąc rozbijamy na dni, dłuższy okres — na miesiące (ta sama oś na wykresie i w Excelu).
    const granularity = months.length === 1 ? 'day' : 'month'
    const buckets = granularity === 'day' ? hours.monthDates(months[0]!) : months
    const db = c.get('deps').db
    const [employees, byEmployee] = await Promise.all([listEmployees(db), getEntriesForAll(db, `${months[0]}-01`, hours.monthDates(months.at(-1)!).at(-1)!)])

    const rows = employees.map((e) => {
      const byBucket: Record<string, number> = Object.fromEntries(buckets.map((b) => [b, 0]))
      const entries = revalidate(byEmployee[e.id] ?? {})
      for (const [date, entry] of Object.entries(entries)) {
        const bucket = granularity === 'day' ? date : date.slice(0, 7)
        if (bucket in byBucket) byBucket[bucket] = hours.roundHours(byBucket[bucket]! + entry.hours)
      }
      const total = hours.sumHours(entries)
      const workedDays = hours.countWorkedDays(entries)
      return { id: e.id, name: e.name, active: e.active, byBucket, total, workedDays, average: workedDays ? hours.roundHours(total / workedDays) : 0 }
    })
    const visible = rows.filter((r) => r.active || r.total > 0 || r.workedDays > 0)
    const res: TimesheetSummaryResponse = {
      from,
      to,
      months,
      granularity,
      buckets,
      employees: visible,
      total: hours.roundHours(visible.reduce((s, r) => s + r.total, 0)),
      workedDays: visible.reduce((s, r) => s + r.workedDays, 0),
    }
    return c.json(res, 200)
  },
)

// ---------------- Ustawienia (Admin): kto ma dostęp ----------------

timesheetsRouter.openapi(
  secureRoute('', { method: 'get', path: '/admin/settings/timesheets', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const db = c.get('deps').db
    const staff: ManagementUserOption[] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.name))
    return c.json({ settings: await timesheetSettings(db), users: staff }, 200)
  },
)

timesheetsRouter.openapi(
  secureRoute('', { method: 'put', path: '/admin/settings/timesheets', request: { body: body(timesheetSettingsInput) }, responses: ok }, { permission: { module: 'admin', action: 'edit' } }),
  async (c) => {
    const input = c.req.valid('json')
    // Edycja obejmuje podgląd — osoba jest na jednej liście.
    const value = { editorIds: [...new Set(input.editorIds)], viewerIds: [...new Set(input.viewerIds)].filter((id) => !input.editorIds.includes(id)) }
    const all = [...value.viewerIds, ...value.editorIds]
    const db = c.get('deps').db
    if (all.length) {
      const found = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, all), inArray(users.role, [...STAFF_ROLES]), isNull(users.deletedAt)))
      if (found.length !== all.length) throw new HttpProblem(422, 'user_not_staff')
    }
    const before = await timesheetSettings(db)
    const me = c.get('user').id
    await db.transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: TIMESHEETS_SETTING_KEY, value, updatedBy: me }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: me } })
      await writeAudit(c, { action: 'settings.timesheets', entity: 'app_settings', entityId: TIMESHEETS_SETTING_KEY, changes: { old: before, new: value } }, tx)
    })
    return c.json(value, 200)
  },
)

// ---------------- Import z workload-calendar (Admin) ----------------

/**
 * Powtarzalny import pliku z eksportu starej aplikacji: pracownicy po ID (nazwa i aktywność z pliku),
 * wpisy po (ID, dzień) — nadpisywane tylko, gdy w PMO nie ma nowszej wersji. Godziny przeliczane `validateEntry`.
 * Wpisów usuniętych w starej aplikacji import nie kasuje.
 */
timesheetsRouter.openapi(
  secureRoute('', { method: 'post', path: '/admin/timesheets/import', request: { body: body(timesheetImportInput) }, responses: ok }, { permission: { module: 'admin', action: 'edit' } }),
  async (c) => {
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const me = c.get('user').id
    const result: TimesheetImportResult = { employeesCreated: 0, employeesUpdated: 0, entriesCreated: 0, entriesUpdated: 0, entriesSkippedNewer: 0, rejected: [], comparison: null }

    const employees = input.employees.map((e) => ({ ...e, id: hours.normalizeId(e.id), name: cleanName(e.name) }))
    const badEmployee = employees.find((e) => !e.id || !e.name)
    if (badEmployee) throw fail(422, `Niepoprawny pracownik w pliku: ${badEmployee.name || badEmployee.id || '?'}.`)
    const known = new Set(employees.map((e) => e.id!))

    await db.transaction(async (tx) => {
      const existing = new Map((await tx.select().from(timesheetEmployees)).map((e) => [e.id, e]))
      for (const e of employees) {
        const cur = existing.get(e.id!)
        if (!cur) {
          await tx.insert(timesheetEmployees).values({ id: e.id!, name: e.name, active: e.active, createdAt: e.createdAt ?? undefined, createdBy: me, updatedBy: me })
          result.employeesCreated++
        } else if (cur.name !== e.name || cur.active !== e.active) {
          await tx.update(timesheetEmployees).set({ name: e.name, active: e.active, updatedAt: sql`now()`, updatedBy: me }).where(eq(timesheetEmployees.id, e.id!))
          result.employeesUpdated++
        }
      }

      const current = new Map(
        (await tx.select({ employeeId: timesheetEntries.employeeId, workDate: timesheetEntries.workDate, updatedAt: timesheetEntries.updatedAt }).from(timesheetEntries)).map((r) => [
          `${r.employeeId}|${r.workDate}`,
          r.updatedAt,
        ]),
      )
      for (const raw of input.entries) {
        const id = hours.normalizeId(raw.employeeId)
        const reject = (error: string) => result.rejected.push({ employeeId: raw.employeeId, date: raw.date, error })
        if (!id || !known.has(id)) {
          reject('Pracownik spoza pliku.')
          continue
        }
        if (!hours.isValidDate(raw.date)) {
          reject('Niepoprawna data.')
          continue
        }
        const v = hours.validateEntry(raw)
        if (!v.ok) {
          reject(v.error)
          continue
        }
        if (!v.entry) continue
        const updatedAt = raw.updatedAt && !Number.isNaN(Date.parse(raw.updatedAt)) ? new Date(raw.updatedAt).toISOString() : input.exportedAt
        const key = `${id}|${raw.date}`
        const have = current.get(key)
        if (have && Date.parse(have) > Date.parse(updatedAt)) {
          result.entriesSkippedNewer++
          continue
        }
        const e = v.entry
        const values = { employeeId: id, workDate: raw.date, mode: e.mode, startTime: e.start, endTime: e.end, breakMin: e.breakMin, hours: e.hours, note: e.note, updatedAt }
        await tx
          .insert(timesheetEntries)
          .values(values)
          .onConflictDoUpdate({ target: [timesheetEntries.employeeId, timesheetEntries.workDate], set: { ...values } })
        if (have) result.entriesUpdated++
        else result.entriesCreated++
      }
      // Audyt bez treści wpisów — tylko liczby.
      await writeAudit(c, { action: 'timesheets.import', entity: 'timesheet_entries', changes: { exportedAt: input.exportedAt, ...result, rejected: result.rejected.length } }, tx)
    })

    // Kontrola przełączenia: suma każdego miesiąca w PMO = suma z zestawienia starej aplikacji.
    if (input.totals?.length) {
      const names = new Map(employees.map((e) => [e.id!, e.name]))
      const mismatches: NonNullable<TimesheetImportResult['comparison']>['mismatches'] = []
      const months = [...new Set(input.totals.map((t) => t.month))].filter((m) => hours.isValidMonth(m)).sort()
      for (const month of months) {
        const days = hours.monthDates(month)
        const byEmployee = await getEntriesForAll(db, days[0]!, days.at(-1)!)
        for (const t of input.totals.filter((x) => x.month === month)) {
          const id = hours.normalizeId(t.employeeId)
          if (!id) continue
          const newTotal = hours.sumHours(revalidate(byEmployee[id] ?? {}))
          if (hours.roundHours(t.total) !== newTotal) mismatches.push({ month, employeeId: id, name: names.get(id) ?? id, oldTotal: hours.roundHours(t.total), newTotal })
        }
      }
      result.comparison = { checked: input.totals.length, mismatches }
    }
    return c.json(result, 200)
  },
)
