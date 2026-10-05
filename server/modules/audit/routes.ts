import { z } from '@hono/zod-openapi'
import { and, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm'
import { auditQuery, type AuditEntryDto, type AuditQuery, type Paged } from '#shared'
import type { Database } from '../../db/client.ts'
import { auditLog, users } from '../../db/schema.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from './service.ts'

export const auditRouter = newRouter()

const ok = { 200: { description: 'OK', content: { 'application/json': { schema: z.any() } } } }

function filters(q: AuditQuery): SQL | undefined {
  const parts: SQL[] = []
  if (q.userId) parts.push(eq(auditLog.userId, q.userId))
  if (q.action) parts.push(eq(auditLog.action, q.action))
  if (q.entity) parts.push(eq(auditLog.entity, q.entity))
  if (q.from) parts.push(gte(auditLog.ts, `${q.from}T00:00:00Z`))
  if (q.to) parts.push(lt(auditLog.ts, nextDay(q.to)))
  return parts.length ? and(...parts) : undefined
}

function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

function select(db: Database) {
  return db
    .select({
      id: auditLog.id,
      ts: auditLog.ts,
      userId: auditLog.userId,
      userEmail: users.email,
      ip: auditLog.ip,
      userAgent: auditLog.userAgent,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      changes: auditLog.changes,
      projectId: auditLog.projectId,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
}

auditRouter.openapi(
  secureRoute(
    '/admin',
    { method: 'get', path: '/audit', request: { query: auditQuery }, responses: ok },
    { permission: { module: 'auditLog', action: 'view' } },
  ),
  async (c) => {
    const q = c.req.valid('query')
    const db = c.get('deps').db
    const where = filters(q)
    const [items, [totalRow]] = await Promise.all([
      select(db).where(where).orderBy(desc(auditLog.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ n: count() }).from(auditLog).where(where),
    ])
    const body: Paged<AuditEntryDto> = {
      items: items.map((i) => ({ ...i, id: String(i.id) })),
      total: totalRow?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    }
    return c.json(body, 200)
  },
)

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  // Neutralizacja formuł (CSV injection) + cudzysłowy.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

const EXPORT_LIMIT = 50_000

auditRouter.openapi(
  secureRoute(
    '/admin',
    {
      method: 'get',
      path: '/audit/export.csv',
      request: { query: auditQuery.omit({ page: true, pageSize: true }) },
      responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } } },
    },
    { permission: { module: 'auditLog', action: 'export' } },
  ),
  async (c) => {
    const q = c.req.valid('query') as AuditQuery
    const rows = await select(c.get('deps').db).where(filters(q)).orderBy(desc(auditLog.id)).limit(EXPORT_LIMIT)
    await writeAudit(c, { action: 'audit.export', entity: 'audit_log', changes: { filters: q, rows: rows.length } })
    const header = ['id', 'ts', 'user_id', 'user_email', 'ip', 'user_agent', 'action', 'entity', 'entity_id', 'changes', 'project_id']
    const lines = rows.map((r) =>
      [r.id, r.ts, r.userId, r.userEmail, r.ip, r.userAgent, r.action, r.entity, r.entityId, r.changes, r.projectId].map(csvCell).join(';'),
    )
    // BOM + średnik: poprawne otwarcie w polskim Excelu.
    const csv = '﻿' + [header.join(';'), ...lines].join('\r\n')
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-log.csv"`,
    })
  },
)
