import { z } from '@hono/zod-openapi'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { WEEKLY_OPEN_STATUSES, isoWeekOf, weekEnd } from '#shared'
import i18nPl from '../../../shared/i18n/pl.json' with { type: 'json' }
import { weeklyItems } from '../../db/schema.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { defaultBuffer, listPurchases } from '../purchases/service.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { getProject, listTasks } from '../hrf/service.ts'
import { computeDashboard } from './compute.ts'

export const dashboardRouter = newRouter()

dashboardRouter.openapi(
  secureRoute(
    '',
    {
      method: 'get',
      path: '/projects/{projectId}/dashboard',
      request: { params: z.object({ projectId: z.uuid() }) },
      responses: { 200: { description: 'Dane dashboardu (część ogólna)', content: { 'application/json': { schema: z.any() } } } },
    },
    { permission: { module: 'dashboard', action: 'view' } },
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const db = c.get('deps').db
    const [project, tasks] = await Promise.all([getProject(db, projectId), listTasks(db, projectId)])
    const today = todayWarsaw(c.get('deps').now?.())
    const body = computeDashboard(
      tasks.map((t) => ({ ...t, percentComplete: Number(t.percentComplete) })),
      project,
      today,
      c.get('user').id,
    )
    const perms = c.get('permissions')
    const user = c.get('user')

    // Alerty M4 — tylko dla ról z dostępem do planu zakupów (spec. M18: bez wycieku poza uprawnienia).
    if (perms.has('purchases:view')) {
      const texts = (i18nPl as unknown as { purchases: { alert: Record<string, string> } }).purchases.alert
      const items = await listPurchases(db, projectId, { user, perms, today, buffer: defaultBuffer(project) })
      for (const i of items) {
        for (const a of i.alerts) {
          const task = i.hrfTaskCode ? ` (HRF ${i.hrfTaskCode}${i.hrfTaskCritical ? ', ścieżka krytyczna' : ''})` : ''
          body.alerts.push({ severity: a.severity, module: 'purchases', message: `${i.name}: ${texts[a.code]!.replace('{{count}}', String(a.days))}${task}`, entityId: i.id })
        }
      }
      body.alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1))
      body.alerts = body.alerts.slice(0, 30)
    }

    // Moje zadania: pozycje planu tygodniowego z bieżącego tygodnia.
    if (perms.has('weeklyPlan:view')) {
      const week = isoWeekOf(today)
      const mine = await db
        .select({ id: weeklyItems.id, title: weeklyItems.title, status: weeklyItems.status })
        .from(weeklyItems)
        .where(and(eq(weeklyItems.projectId, projectId), eq(weeklyItems.isoWeek, week), eq(weeklyItems.assigneeUserId, user.id), isNull(weeklyItems.deletedAt), inArray(weeklyItems.status, [...WEEKLY_OPEN_STATUSES])))
      body.myTasks.unshift(...mine.map((m) => ({ id: m.id, code: week, name: m.title, plannedEnd: weekEnd(week), status: m.status, source: 'weekly' as const })))
    }
    return c.json(body, 200)
  },
)
