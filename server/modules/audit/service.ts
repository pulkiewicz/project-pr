import type { Context } from 'hono'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { auditLog } from '../../db/schema.ts'

export interface AuditEntry {
  action: string
  entity?: string
  entityId?: string
  changes?: unknown
  projectId?: string | null
  userId?: string | null
}

export function requestMeta(c: Context<AppEnv>) {
  return {
    ip: c.req.header('x-nf-client-connection-ip') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  }
}

/** Zapis do audit_log. Przekaż `tx`, by wpis był w tej samej transakcji co zmiana. */
export async function writeAudit(c: Context<AppEnv>, entry: AuditEntry, tx?: Database) {
  const db = tx ?? c.get('deps').db
  const { ip, userAgent } = requestMeta(c)
  await db.insert(auditLog).values({
    userId: entry.userId !== undefined ? entry.userId : (c.get('user')?.id ?? null),
    ip,
    userAgent,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    changes: entry.changes ?? null,
    projectId: entry.projectId ?? null,
  })
}

/** Diff pól old → new (tylko zmienione). Pola wrażliwe można zamaskować. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  mask: readonly (keyof T)[] = [],
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {}
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] === undefined) continue
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
    out[key as string] = mask.includes(key) ? { old: '***', new: '***' } : { old: before[key], new: after[key] }
  }
  return out
}
