import { z } from '@hono/zod-openapi'
import { todayWarsaw } from '../../lib/dates.ts'
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
    return c.json(body, 200)
  },
)
