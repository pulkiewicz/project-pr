import { and, asc, eq, isNull } from 'drizzle-orm'
import type { PurchaseItemDto } from '#shared'
import type { UserRow } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { hrfTasks, projects, purchaseItems } from '../../db/schema.ts'
import { canEditRecord } from '../../lib/ownership.ts'
import { DEFAULT_BUFFER_DAYS, purchaseAlerts, purchaseDates } from './compute.ts'

type Perms = Parameters<typeof canEditRecord>[1]

export function defaultBuffer(project: typeof projects.$inferSelect): number {
  const v = (project.settings as Record<string, unknown>)?.['purchases.defaultBufferDays']
  return typeof v === 'number' ? v : DEFAULT_BUFFER_DAYS
}

export async function listPurchases(db: Database, projectId: string, ctx: { user: UserRow; perms: Perms; today: string; buffer: number }): Promise<PurchaseItemDto[]> {
  const rows = await db
    .select({ p: purchaseItems, t: { code: hrfTasks.code, name: hrfTasks.name, plannedStart: hrfTasks.plannedStart, critical: hrfTasks.isCriticalPath } })
    .from(purchaseItems)
    .leftJoin(hrfTasks, eq(hrfTasks.id, purchaseItems.hrfTaskId))
    .where(and(eq(purchaseItems.projectId, projectId), isNull(purchaseItems.deletedAt)))
    .orderBy(asc(purchaseItems.name))
  return rows.map(({ p, t }) => {
    const calc = { taskPlannedStart: t?.plannedStart ?? null, bufferDays: p.bufferDays, leadTimeWeeks: p.leadTimeWeeks, status: p.status, orderDateActual: p.orderDateActual, confirmedDeliveryDate: p.confirmedDeliveryDate }
    const { needDate, orderByDate } = purchaseDates(calc, ctx.buffer)
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      manufacturer: p.manufacturer,
      partNo: p.partNo,
      quantity: p.quantity,
      unit: p.unit,
      supplierName: p.supplierName,
      supplierContact: p.supplierContact,
      party: p.party as PurchaseItemDto['party'],
      hrfTaskId: p.hrfTaskId,
      bufferDays: p.bufferDays,
      leadTimeWeeks: p.leadTimeWeeks,
      inquiryDate: p.inquiryDate,
      orderDatePlanned: p.orderDatePlanned,
      orderDateActual: p.orderDateActual,
      orderRef: p.orderRef,
      confirmedDeliveryDate: p.confirmedDeliveryDate,
      actualDeliveryDate: p.actualDeliveryDate,
      status: p.status,
      isCritical: p.isCritical,
      deliveryLocation: p.deliveryLocation,
      requiresAvization: p.requiresAvization,
      notes: p.notes,
      hrfTaskCode: t?.code ?? null,
      hrfTaskName: t?.name ?? null,
      hrfTaskCritical: t?.critical ?? false,
      needDate,
      orderByDate,
      alerts: purchaseAlerts(calc, ctx.today, ctx.buffer),
      version: p.version,
      canEdit: canEditRecord(ctx.user, ctx.perms, 'purchases', p, 'purchases'),
    }
  })
}
