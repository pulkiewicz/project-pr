import { formatInTimeZone } from 'date-fns-tz'
import { and, eq, inArray, isNotNull, isNull, lt, lte, notInArray, or } from 'drizzle-orm'
import { isStaffRole, type Role } from '#shared'
import { loadPermissions } from '../../auth/access.ts'
import type { AppDeps } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { hrfInternalTaskAssignees, hrfInternalTasks, hrfTasks, projectMembers, projects, users } from '../../db/schema.ts'
import { addDays, isWorkingDay, todayWarsaw } from '../../lib/dates.ts'

/** Przypomnienie obejmuje zadania po terminie i z terminem w ciągu tylu dni (włącznie). */
export const REMINDER_HORIZON_DAYS = 7
/** Godzina wysyłki w Europe/Warsaw (funkcja harmonogramu startuje o 5:00 i 6:00 UTC — jedna z nich to 7:00 lokalnie). */
export const REMINDER_HOUR = 7

export interface ReminderItem {
  projectCode: string
  projectName: string
  kind: 'hrf' | 'internal'
  /** Kod HRF zadania formalnego (dla wewnętrznego — kod zadania nadrzędnego). */
  code: string
  name: string
  due: string
  overdue: boolean
}

export interface ReminderRecipient {
  id: string
  email: string
  name: string
  items: ReminderItem[]
}

export const isReminderHour = (now: Date) => Number(formatInTimeZone(now, 'Europe/Warsaw', 'H')) === REMINDER_HOUR

/**
 * Odbiorcy dzisiejszych przypomnień: aktywni, z włączonymi przypomnieniami, jeszcze bez wysyłki tego dnia.
 * Zadania formalne — osoba odpowiedzialna (`hrf:view`); wewnętrzne — przypisane osoby (`hrfInternal:view`);
 * tylko projekty, do których osoba ma dostęp (spec. M18: bez powiadomień o rekordach, których nie widzi).
 * Treść bez pól [W] (wartości Etapów).
 */
export async function collectReminders(db: Database, today: string): Promise<ReminderRecipient[]> {
  const people = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.isActive, true),
        eq(users.taskReminders, true),
        or(isNull(users.taskRemindersSentOn), lt(users.taskRemindersSentOn, today)),
      ),
    )
  if (!people.length) return []
  const ids = people.map((p) => p.id)
  const horizon = addDays(today, REMINDER_HORIZON_DAYS)

  const formal = await db
    .select({ userId: hrfTasks.responsibleUserId, code: hrfTasks.code, name: hrfTasks.name, due: hrfTasks.plannedEnd, projectId: projects.id, projectCode: projects.code, projectName: projects.name })
    .from(hrfTasks)
    .innerJoin(projects, and(eq(projects.id, hrfTasks.projectId), isNull(projects.deletedAt)))
    .where(
      and(
        isNull(hrfTasks.deletedAt),
        inArray(hrfTasks.responsibleUserId, ids),
        notInArray(hrfTasks.status, ['accepted', 'ready_for_acceptance']),
        lt(hrfTasks.percentComplete, 100),
        isNotNull(hrfTasks.plannedEnd),
        lte(hrfTasks.plannedEnd, horizon),
      ),
    )

  const internal = await db
    .select({ userId: hrfInternalTaskAssignees.userId, code: hrfTasks.code, name: hrfInternalTasks.name, due: hrfInternalTasks.endDate, projectId: projects.id, projectCode: projects.code, projectName: projects.name })
    .from(hrfInternalTasks)
    .innerJoin(hrfInternalTaskAssignees, eq(hrfInternalTaskAssignees.taskId, hrfInternalTasks.id))
    .innerJoin(hrfTasks, and(eq(hrfTasks.id, hrfInternalTasks.parentTaskId), isNull(hrfTasks.deletedAt)))
    .innerJoin(projects, and(eq(projects.id, hrfInternalTasks.projectId), isNull(projects.deletedAt)))
    .where(
      and(
        isNull(hrfInternalTasks.deletedAt),
        inArray(hrfInternalTaskAssignees.userId, ids),
        lt(hrfInternalTasks.percentComplete, 100),
        isNotNull(hrfInternalTasks.endDate),
        lte(hrfInternalTasks.endDate, horizon),
      ),
    )

  const external = people.filter((p) => !isStaffRole(p.role)).map((p) => p.id)
  const memberships = external.length
    ? await db.select().from(projectMembers).where(inArray(projectMembers.userId, external))
    : []
  const permsByRole = new Map<Role, Set<string>>()
  for (const role of new Set(people.map((p) => p.role))) permsByRole.set(role, await loadPermissions(db, role))

  const out: ReminderRecipient[] = []
  for (const p of people) {
    const perms = permsByRole.get(p.role)!
    const sees = (projectId: string) => isStaffRole(p.role) || memberships.some((m) => m.userId === p.id && m.projectId === projectId)
    const toItem = (kind: ReminderItem['kind']) => (r: (typeof formal)[number]): ReminderItem => ({
      projectCode: r.projectCode,
      projectName: r.projectName,
      kind,
      code: r.code,
      name: r.name,
      due: r.due!,
      overdue: r.due! < today,
    })
    const items = [
      ...(perms.has('hrf:view') ? formal.filter((r) => r.userId === p.id && sees(r.projectId)).map(toItem('hrf')) : []),
      ...(perms.has('hrfInternal:view') ? internal.filter((r) => r.userId === p.id && sees(r.projectId)).map(toItem('internal')) : []),
    ].sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.due.localeCompare(b.due) || a.code.localeCompare(b.code, 'pl', { numeric: true }))
    if (items.length) out.push({ id: p.id, email: p.email, name: p.name, items })
  }
  return out
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const plDate = (d: string) => d.split('-').reverse().join('.')
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many

export function reminderEmail(r: ReminderRecipient, today: string, appUrl: string) {
  const overdue = r.items.filter((i) => i.overdue).length
  const n = r.items.length
  const subject = `Przypomnienie: ${n} ${plural(n, 'zadanie', 'zadania', 'zadań')}${overdue ? ` (${overdue} po terminie)` : ''}`
  const kindLabel = (i: ReminderItem) => (i.kind === 'hrf' ? `HRF ${i.code}` : `wewnętrzne (HRF ${i.code})`)
  const dueLabel = (i: ReminderItem) => (i.overdue ? `po terminie od ${plDate(i.due)}` : i.due === today ? 'termin dzisiaj' : `termin ${plDate(i.due)}`)
  const byProject = new Map<string, ReminderItem[]>()
  for (const i of r.items) byProject.set(i.projectCode, [...(byProject.get(i.projectCode) ?? []), i])
  const base = appUrl.replace(/\/+$/, '')
  const projectUrl = (code: string) => `${base}/projekty/${encodeURIComponent(code)}/hrf`

  const intro = `Dzień dobry ${r.name},\n\nponiżej Twoje zadania po terminie i z terminem w ciągu ${REMINDER_HORIZON_DAYS} dni.`
  const text = [
    intro,
    ...[...byProject].map(([code, items]) =>
      [`\n${code} — ${items[0]!.projectName} (${projectUrl(code)})`, ...items.map((i) => `- ${i.name} [${kindLabel(i)}] — ${dueLabel(i)}`)].join('\n'),
    ),
    '\nWiadomość wysłana automatycznie przez Envcheck PMO. Wyłączenie przypomnień: administrator aplikacji.',
  ].join('\n')

  const rows = (items: ReminderItem[]) =>
    items
      .map(
        (i) =>
          `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(i.name)}<br><span style="color:#868e96;font-size:12px">${esc(kindLabel(i))}</span></td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap;color:${i.overdue ? '#e03131' : '#212529'}">${esc(dueLabel(i))}</td></tr>`,
      )
      .join('')
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#212529;max-width:640px">` +
    `<p>Dzień dobry ${esc(r.name)},</p><p>poniżej Twoje zadania po terminie i z terminem w ciągu ${REMINDER_HORIZON_DAYS} dni.</p>` +
    [...byProject]
      .map(
        ([code, items]) =>
          `<h3 style="margin:20px 0 6px;font-size:15px"><a href="${esc(projectUrl(code))}" style="color:#1c7ed6">${esc(code)} — ${esc(items[0]!.projectName)}</a></h3>` +
          `<table style="border-collapse:collapse;width:100%">${rows(items)}</table>`,
      )
      .join('') +
    `<p style="margin-top:24px;color:#868e96;font-size:12px">Wiadomość wysłana automatycznie przez Envcheck PMO. Wyłączenie przypomnień: administrator aplikacji.</p></div>`
  return { to: r.email, subject, html, text }
}

export interface ReminderRunResult {
  skipped?: 'non_working_day' | 'email_disabled'
  sent: number
  failed: number
}

/**
 * Codzienna wysyłka (dni robocze). Przed wysyłką rezerwuje dzień w `task_reminders_sent_on` warunkowym UPDATE —
 * równoległe lub ponowione uruchomienie nie wyśle drugiego maila; po błędzie wysyłki rezerwacja jest cofana
 * (null zamiast poprzedniej daty — ta i tak była wcześniejsza niż dziś).
 */
export async function sendTaskReminders(deps: Pick<AppDeps, 'db' | 'email'>, now: Date, appUrl: string): Promise<ReminderRunResult> {
  const today = todayWarsaw(now)
  if (!isWorkingDay(today)) return { skipped: 'non_working_day', sent: 0, failed: 0 }
  if (!deps.email) return { skipped: 'email_disabled', sent: 0, failed: 0 }
  const result: ReminderRunResult = { sent: 0, failed: 0 }
  for (const r of await collectReminders(deps.db, today)) {
    const [claimed] = await deps.db
      .update(users)
      .set({ taskRemindersSentOn: today })
      .where(and(eq(users.id, r.id), or(isNull(users.taskRemindersSentOn), lt(users.taskRemindersSentOn, today))))
      .returning({ id: users.id })
    if (!claimed) continue
    try {
      await deps.email.send(reminderEmail(r, today, appUrl))
      result.sent += 1
    } catch (e) {
      result.failed += 1
      console.error(`[pmo] przypomnienie e-mail nieudane (${r.id}):`, e instanceof Error ? e.message : e)
      await deps.db.update(users).set({ taskRemindersSentOn: null }).where(and(eq(users.id, r.id), eq(users.taskRemindersSentOn, today)))
    }
  }
  return result
}
