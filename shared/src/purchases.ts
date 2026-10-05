import { z } from 'zod'

export const PURCHASE_STATUSES = [
  'to_inquire',
  'inquiry_sent',
  'offer',
  'ordered',
  'confirmed',
  'in_transit',
  'delivered',
  'quality_accepted',
  'complaint',
] as const
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]
/** Statusy, w których zamówienie jeszcze nie zostało złożone. */
export const PURCHASE_NOT_ORDERED: readonly PurchaseStatus[] = ['to_inquire', 'inquiry_sent', 'offer']
export const PURCHASE_DELIVERED: readonly PurchaseStatus[] = ['delivered', 'quality_accepted']

/** Kto kupuje (spec. M4: Envcheck / Arsanit). */
export const PURCHASE_PARTIES = ['Envcheck', 'Arsanit'] as const

const isoDate = z.iso.date()
const optDate = isoDate.nullable().optional()
const optText = (max: number) => z.string().trim().max(max).nullable().optional()

/** Bez pól cenowych (zasada nadrzędna spec. §1). */
export const purchaseItemInput = z.object({
  name: z.string().trim().min(1).max(300),
  category: optText(100),
  manufacturer: optText(200),
  partNo: optText(100),
  quantity: z.number().positive().max(1e9).nullable().optional(),
  unit: optText(20),
  supplierName: optText(200),
  supplierContact: optText(300),
  party: z.enum(PURCHASE_PARTIES),
  hrfTaskId: z.uuid().nullable().optional(),
  /** Bufor w dniach roboczych przed startem zadania HRF; null = domyślny projektu (5). */
  bufferDays: z.number().int().min(0).max(250).nullable().optional(),
  leadTimeWeeks: z.number().min(0).max(260).nullable().optional(),
  inquiryDate: optDate,
  orderDatePlanned: optDate,
  orderDateActual: optDate,
  orderRef: optText(100),
  confirmedDeliveryDate: optDate,
  actualDeliveryDate: optDate,
  status: z.enum(PURCHASE_STATUSES).default('to_inquire'),
  isCritical: z.boolean().default(false),
  deliveryLocation: optText(200),
  requiresAvization: z.boolean().default(false),
  notes: optText(5000),
})
export type PurchaseItemInput = z.infer<typeof purchaseItemInput>
export const purchaseItemPatch = purchaseItemInput.partial().extend({ version: z.number().int() })

export type PurchaseAlertCode = 'order_due_soon' | 'order_overdue' | 'delivery_after_need' | 'no_confirmation'

export interface PurchaseAlert {
  code: PurchaseAlertCode
  severity: 'yellow' | 'red'
  days: number
}

export interface PurchaseItemDto extends Required<Omit<PurchaseItemInput, 'quantity' | 'leadTimeWeeks' | 'bufferDays'>> {
  id: string
  quantity: number | null
  leadTimeWeeks: number | null
  bufferDays: number | null
  hrfTaskCode: string | null
  hrfTaskName: string | null
  hrfTaskCritical: boolean
  /** Wyliczane: start zadania HRF − bufor (dni robocze). */
  needDate: string | null
  /** Wyliczane: data potrzeby − lead time. */
  orderByDate: string | null
  alerts: PurchaseAlert[]
  version: number
  canEdit: boolean
}

export interface PurchasesResponse {
  defaultBufferDays: number
  items: PurchaseItemDto[]
}
