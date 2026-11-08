import { z } from '@hono/zod-openapi'
import { financeMonth } from '#shared'
import { todayWarsaw } from '../../lib/dates.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { financePlan } from './service.ts'

/** Plan finansowy — te same uprawnienia co Faktury (lista osób w Ustawieniach); wynagrodzenia imiennie tylko z dostępem do Pracowników. */
export const financeRouter = newRouter()

const ok = { 200: { description: 'OK', content: { 'application/json': { schema: z.any() } } } }
const planQuery = z.object({ month: z.string().regex(financeMonth, 'validation.month').optional() })

financeRouter.openapi(
  secureRoute('', { method: 'get', path: '/finance/plan', request: { query: planQuery }, responses: ok }, { permission: { module: 'invoices', action: 'view' } }),
  async (c) => {
    const deps = c.get('deps')
    const month = c.req.valid('query').month ?? todayWarsaw(deps.now?.()).slice(0, 7)
    const plan = await financePlan(deps.db, month, { staffRows: c.get('permissions').has('employees:view'), configured: !!deps.infakt })
    return c.json(plan, 200)
  },
)
