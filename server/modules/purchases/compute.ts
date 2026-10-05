import { PURCHASE_DELIVERED, PURCHASE_NOT_ORDERED, type PurchaseAlert, type PurchaseStatus } from '#shared'
import { addDays, diffDays, subtractWorkingDays } from '../../lib/dates.ts'

export const DEFAULT_BUFFER_DAYS = 5
const ORDER_SOON_DAYS = 14
const CONFIRMATION_DAYS = 7

export interface PurchaseCalcInput {
  taskPlannedStart: string | null
  bufferDays: number | null
  leadTimeWeeks: number | null
  status: PurchaseStatus
  orderDateActual: string | null
  confirmedDeliveryDate: string | null
}

/**
 * M4: need_date = start zadania HRF − bufor (dni robocze), order_by_date = need_date − lead time (tygodnie kalendarzowe).
 * Liczone przy odczycie, więc zawsze zgodne z aktualnym HRF (zmiana dnia „0” lub terminu zadania).
 */
export function purchaseDates(i: Pick<PurchaseCalcInput, 'taskPlannedStart' | 'bufferDays' | 'leadTimeWeeks'>, defaultBuffer = DEFAULT_BUFFER_DAYS) {
  if (!i.taskPlannedStart) return { needDate: null, orderByDate: null }
  const needDate = subtractWorkingDays(i.taskPlannedStart, i.bufferDays ?? defaultBuffer)
  const orderByDate = i.leadTimeWeeks === null ? null : addDays(needDate, -Math.round(i.leadTimeWeeks * 7))
  return { needDate, orderByDate }
}

export function purchaseAlerts(i: PurchaseCalcInput, today: string, defaultBuffer = DEFAULT_BUFFER_DAYS): PurchaseAlert[] {
  const { needDate, orderByDate } = purchaseDates(i, defaultBuffer)
  const alerts: PurchaseAlert[] = []
  const delivered = PURCHASE_DELIVERED.includes(i.status)
  const notOrdered = !i.orderDateActual && PURCHASE_NOT_ORDERED.includes(i.status)

  if (orderByDate && notOrdered) {
    const left = diffDays(orderByDate, today)
    if (left < 0) alerts.push({ code: 'order_overdue', severity: 'red', days: -left })
    else if (left <= ORDER_SOON_DAYS) alerts.push({ code: 'order_due_soon', severity: 'yellow', days: left })
  }
  if (!delivered && needDate && i.confirmedDeliveryDate && i.confirmedDeliveryDate > needDate) {
    alerts.push({ code: 'delivery_after_need', severity: 'red', days: diffDays(i.confirmedDeliveryDate, needDate) })
  }
  if (!delivered && i.orderDateActual && !i.confirmedDeliveryDate) {
    const since = diffDays(today, i.orderDateActual)
    if (since > CONFIRMATION_DAYS) alerts.push({ code: 'no_confirmation', severity: 'yellow', days: since })
  }
  return alerts
}
