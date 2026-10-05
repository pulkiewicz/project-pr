import { HTTPException } from 'hono/http-exception'
import { authenticate } from './auth/middleware.ts'
import type { AppDeps } from './context.ts'
import { HttpProblem, problemResponse } from './lib/problem.ts'
import { adminPermissionsRouter } from './modules/admin/permissions.ts'
import { adminUsersRouter } from './modules/admin/users.ts'
import { auditRouter } from './modules/audit/routes.ts'
import { meRouter } from './modules/me/routes.ts'
import { mfaRouter } from './modules/mfa/routes.ts'
import { ROUTE_POLICIES, newRouter } from './routing.ts'
import { requireMfa, requirePermission } from './auth/middleware.ts'

export function createApp(deps: AppDeps) {
  const app = newRouter().basePath('/api')

  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
  })

  app.get('/health', (c) => c.json({ ok: true }))

  // Wszystko poza /health wymaga JWT Identity + aktywnego użytkownika.
  app.use('*', async (c, next) => (c.req.path === '/api/health' ? next() : authenticate(c, next)))

  app.route('/', meRouter)
  app.route('/mfa', mfaRouter)
  app.route('/admin', adminUsersRouter)
  app.route('/admin', adminPermissionsRouter)
  app.route('/admin', auditRouter)

  // Dokumentacja OpenAPI — tylko Admin.
  app.use('/openapi.json', requireMfa, requirePermission('admin', 'view'))
  app.doc31('/openapi.json', { openapi: '3.1.0', info: { title: 'Envcheck PMO API', version: '0.1.0' } })
  app.get('/docs', requireMfa, requirePermission('admin', 'view'), (c) =>
    c.html(`<!doctype html><meta charset="utf-8"><title>API</title><p>Specyfikacja OpenAPI: <a href="/api/openapi.json">/api/openapi.json</a></p>`),
  )

  app.notFound(() => problemResponse(404, 'not_found'))
  app.onError((err) => {
    if (err instanceof HttpProblem) {
      const res = problemResponse(err.status, err.code, err.detail, err.extra)
      if (err.status === 429 && typeof err.extra.retryAfter === 'number') res.headers.set('Retry-After', String(err.extra.retryAfter))
      return res
    }
    if (err instanceof HTTPException) return problemResponse(err.status, 'http_error', err.message)
    console.error(err)
    return problemResponse(500, 'internal_error')
  })

  return app
}

for (const [method, path] of [
  ['GET', '/api/openapi.json'],
  ['GET', '/api/docs'],
] as const) {
  ROUTE_POLICIES.push({ method, path, permission: { module: 'admin', action: 'view' }, mfaExempt: false })
}

export { ROUTE_POLICIES }
