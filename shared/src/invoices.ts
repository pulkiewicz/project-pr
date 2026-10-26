import { z } from 'zod'

/**
 * Faktury kosztowe z inFakt przypisywane do projektów (proporcjonalnie, %).
 * Część nieprzypisana do projektów = koszty ogólne firmy.
 *
 * Przepływ: new (do przypisania) → pending (wysłana do akceptacji) → approved | rejected.
 * Odrzucona wraca do poprawy (edycja i ponowne wysłanie). Akceptuje inna osoba z dostępem niż wysyłająca (zasada czterech oczu).
 */
export const INVOICE_STATUSES = ['new', 'pending', 'approved', 'rejected'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
/** Statusy, w których można zmieniać przypisanie. */
export const INVOICE_EDITABLE: readonly InvoiceStatus[] = ['new', 'rejected']

export const INVOICE_EVENT_KINDS = ['imported', 'edited', 'allocated', 'submitted', 'approved', 'rejected', 'reopened', 'changed_in_infakt'] as const
export type InvoiceEventKind = (typeof INVOICE_EVENT_KINDS)[number]

/**
 * Rodzaje dokumentów kosztowych inFakt pobierane do przypisania (bez dowodów wewnętrznych za składki ZUS).
 * W Envcheck faktury są w inFakt jako pliki (`document_scan`) — księgowanie odbywa się poza inFakt.
 */
export const INFAKT_COST_KINDS = ['document_scan', 'cost', 'internal_evidence'] as const

/**
 * Dane faktury, które można uzupełnić / poprawić ręcznie, gdy inFakt ich nie odczytał z pliku.
 * Wartość ręczna ma pierwszeństwo i nie jest nadpisywana przez synchronizację; `null` w zapisie przywraca dane z inFakt.
 */
export const INVOICE_MANUAL_FIELDS = ['number', 'sellerName', 'issueDate', 'dueDate', 'currency', 'netPrice', 'taxPrice', 'grossPrice'] as const
export type InvoiceManualField = (typeof INVOICE_MANUAL_FIELDS)[number]
export interface InvoiceManual {
  number?: string
  sellerName?: string
  issueDate?: string
  dueDate?: string
  currency?: string
  /** Grosze. */
  netPrice?: number
  taxPrice?: number
  grossPrice?: number
}

/** Ustawienie `invoices.access`: kto ma dostęp do modułu (niezależnie od roli) i od kiedy synchronizować. */
export interface InvoiceSettings {
  userIds: string[]
  /** Data dodania do inFakt (yyyy-MM-dd), od której pobierane są dokumenty kosztowe. */
  syncFrom: string
}
export const DEFAULT_INVOICE_SYNC_FROM = '2026-01-01'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date')

export const invoiceSettingsInput = z.object({
  userIds: z.array(z.uuid()).max(50),
  syncFrom: isoDate,
})

/** Udział w %, maks. 2 miejsca po przecinku. */
const share = z.number().gt(0).max(100).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'validation.share')

export const invoiceAllocationInput = z
  .object({
    allocations: z
      .array(z.object({ projectId: z.uuid(), share, description: z.string().trim().max(500).nullable().optional() }))
      .max(50)
      .refine((a) => new Set(a.map((x) => x.projectId)).size === a.length, 'validation.duplicateProject')
      .refine((a) => Math.round(a.reduce((s, x) => s + x.share * 100, 0)) <= 10000, 'validation.sharesOver100'),
    note: z.string().trim().max(2000).nullable().optional(),
    version: z.number().int(),
  })
export type InvoiceAllocationInput = z.input<typeof invoiceAllocationInput>

const cents = z.number().int().min(-10_000_000_000).max(10_000_000_000)
/** Pola pominięte — bez zmian; `null` — usuń wartość ręczną (wróć do danych z inFakt). */
export const invoiceDetailsInput = z.object({
  number: z.string().trim().min(1).max(200).nullable().optional(),
  sellerName: z.string().trim().min(1).max(300).nullable().optional(),
  issueDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'validation.currency').nullable().optional(),
  netPrice: cents.nullable().optional(),
  taxPrice: cents.nullable().optional(),
  grossPrice: cents.nullable().optional(),
  version: z.number().int(),
})
export type InvoiceDetailsInput = z.input<typeof invoiceDetailsInput>

/** Zbiorcze przypisanie: zaznaczone faktury → jeden projekt (100%) albo koszty ogólne (`projectId: null`). */
export const invoiceBulkAllocationInput = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  projectId: z.uuid().nullable(),
  /** Pominięte — opis bez zmian (gdy projekt ten sam) / pusty; `null` lub "" — bez opisu. */
  description: z.string().trim().max(500).nullable().optional(),
})
export type InvoiceBulkAllocationInput = z.input<typeof invoiceBulkAllocationInput>
export interface InvoiceBulkResult {
  updated: number
  /** Faktury pominięte: wysłane do akceptacji lub zaakceptowane (nie można zmieniać przypisania). */
  skipped: number
}

export const invoiceTransitionInput = z.object({
  comment: z.string().trim().max(2000).nullable().optional(),
  version: z.number().int(),
})
export const invoiceRejectInput = invoiceTransitionInput.extend({ comment: z.string().trim().min(1).max(2000) })

/** Kwota udziału w groszach (zaokrąglenie do grosza). */
export function shareAmount(totalCents: number, sharePct: number): number {
  return Math.round((totalCents * Math.round(sharePct * 100)) / 10000)
}

export interface InvoiceAllocationDto {
  projectId: string
  projectCode: string
  projectName: string
  share: number
  /** Opis kosztu w projekcie (np. „sprężarki do komory”). */
  description: string | null
  /** Netto udziału w groszach (null, gdy inFakt nie podał kwoty). */
  netAmount: number | null
}

export interface InvoiceDto {
  id: string
  infaktUuid: string
  kind: string
  number: string | null
  sellerName: string | null
  description: string | null
  category: string | null
  issueDate: string | null
  dueDate: string | null
  currency: string
  /** Kwoty w groszach (jak w inFakt). */
  netPrice: number | null
  grossPrice: number | null
  taxPrice: number | null
  paymentStatus: string | null
  accountingStatus: string | null
  /** Data dodania do inFakt (dla plików bez daty wystawienia). */
  infaktCreatedAt: string | null
  /** Pola uzupełnione / poprawione ręcznie (wartości w polach DTO już je uwzględniają). */
  manualFields: InvoiceManualField[]
  status: InvoiceStatus
  note: string | null
  allocations: InvoiceAllocationDto[]
  /** Suma udziałów projektów (%); reszta do 100 = koszty ogólne. */
  allocatedShare: number
  submittedBy: string | null
  submittedByName: string | null
  submittedAt: string | null
  decidedByName: string | null
  decidedAt: string | null
  version: number
}

export interface InvoiceEventDto {
  id: string
  kind: InvoiceEventKind
  comment: string | null
  meta: Record<string, unknown> | null
  userName: string | null
  createdAt: string
}

export interface InvoiceDetailDto extends InvoiceDto {
  events: InvoiceEventDto[]
}

export interface InvoiceSyncResult {
  fetched: number
  created: number
  updated: number
  skipped: number
  syncedAt: string
}

export interface InvoiceListResponse {
  items: InvoiceDto[]
  lastSync: { at: string; by: string | null; result: InvoiceSyncResult | null } | null
  configured: boolean
}

export interface InvoiceUserOption {
  id: string
  name: string
}
