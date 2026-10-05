import { OpenAPIHono, createRoute, type RouteConfig } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import type { Action, ModuleKey } from '#shared'
import { requireMfa, requirePermission } from './auth/middleware.ts'
import type { AppEnv, RoutePolicy } from './context.ts'
import { problemResponse } from './lib/problem.ts'

/** Rejestr polityk wszystkich tras — używany przez test macierzy ról (każdy endpoint × każda rola). */
export const ROUTE_POLICIES: RoutePolicy[] = []

export function newRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        return problemResponse(422, 'validation_failed', undefined, {
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        })
      }
    },
  })
}

type Secured = { permission: { module: ModuleKey; action: Action } | null; mfaExempt?: boolean }

/**
 * Definicja trasy z obowiązkową deklaracją uprawnienia.
 * `basePath` to prefiks montowania routera (np. `/admin`), potrzebny do rejestru.
 */
export function secureRoute<R extends RouteConfig>(basePath: string, route: R, secured: Secured) {
  const mw: MiddlewareHandler<AppEnv>[] = []
  if (!secured.mfaExempt) mw.push(requireMfa)
  if (secured.permission) mw.push(requirePermission(secured.permission.module, secured.permission.action))
  const existing = route.middleware ? (Array.isArray(route.middleware) ? route.middleware : [route.middleware]) : []
  ROUTE_POLICIES.push({
    method: route.method.toUpperCase(),
    path: `/api${basePath}${route.path}`,
    permission: secured.permission,
    mfaExempt: !!secured.mfaExempt,
  })
  return createRoute({ ...route, middleware: [...mw, ...existing] as RouteConfig['middleware'] })
}
