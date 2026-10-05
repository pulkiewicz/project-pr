import { z } from 'zod'

export const ID_DOC_TYPES = ['id_card', 'passport'] as const
export type IdDocType = (typeof ID_DOC_TYPES)[number]
export const VEHICLE_TYPES = ['car', 'van', 'truck', 'hds', 'crane'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]
export const AVIZATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'cancelled'] as const
export type AvizationStatus = (typeof AVIZATION_STATUSES)[number]
/** Statusy blokujące osobę w danym terminie (walidacja nakładania się awizacji). */
export const AVIZATION_ACTIVE: readonly AvizationStatus[] = ['draft', 'sent', 'accepted']

const opt = (max: number) => z.string().trim().max(max).nullable().optional()

export const personInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  idDocType: z.enum(ID_DOC_TYPES),
  idDocNumber: z.string().trim().min(3).max(40),
  company: z.string().trim().min(1).max(200),
  subcontractorId: z.uuid().nullable().optional(),
  phone: opt(40),
  roleOnSite: opt(100),
  notes: opt(2000),
})
export type PersonInput = z.infer<typeof personInput>
export const personPatch = personInput.partial().extend({ version: z.number().int() })

export const vehicleInput = z.object({
  registrationNumber: z.string().trim().min(2).max(20),
  makeModel: opt(100),
  vehicleType: z.enum(VEHICLE_TYPES).default('car'),
  company: z.string().trim().min(1).max(200),
  defaultDriverId: z.uuid().nullable().optional(),
})
export type VehicleInput = z.infer<typeof vehicleInput>
export const vehiclePatch = vehicleInput.partial().extend({ version: z.number().int() })

const isoDate = z.iso.date()

export const avizationInput = z
  .object({
    dateFrom: isoDate,
    dateTo: isoDate,
    entryPointId: z.uuid().nullable().optional(),
    purpose: z.string().trim().min(1).max(500),
    hrfTaskId: z.uuid().nullable().optional(),
    personIds: z.array(z.uuid()).max(200).default([]),
    vehicles: z.array(z.object({ vehicleId: z.uuid(), driverPersonId: z.uuid().nullable().optional() })).max(100).default([]),
    weeklyItemId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.dateTo >= v.dateFrom, { message: 'validation.dateRange', path: ['dateTo'] })
export type AvizationInput = z.infer<typeof avizationInput>
export const avizationPatch = z
  .object({
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    entryPointId: z.uuid().nullable().optional(),
    purpose: z.string().trim().min(1).max(500).optional(),
    hrfTaskId: z.uuid().nullable().optional(),
    personIds: z.array(z.uuid()).max(200).optional(),
    vehicles: z.array(z.object({ vehicleId: z.uuid(), driverPersonId: z.uuid().nullable().optional() })).max(100).optional(),
    version: z.number().int(),
  })

export const avizationTransition = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), version: z.number().int() }),
  z.object({ action: z.literal('withdraw'), version: z.number().int() }),
  z.object({ action: z.literal('accept'), version: z.number().int() }),
  z.object({ action: z.literal('reject'), version: z.number().int(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('cancel'), version: z.number().int() }),
  /** Admin: odbiór akceptacji poza systemem (np. e-mail od ochrony). */
  z.object({ action: z.literal('accept_external'), version: z.number().int(), externalRef: z.string().trim().min(1).max(200) }),
])
export type AvizationTransition = z.infer<typeof avizationTransition>

export interface PersonDto {
  id: string
  firstName: string
  lastName: string
  idDocType: IdDocType
  /** Zamaskowany numer; pełny — wyłącznie przez endpoint odczytu (wpis w audit log). */
  idDocNumberMasked: string
  company: string
  subcontractorId: string | null
  phone: string | null
  roleOnSite: string | null
  notes: string | null
  party: string
  version: number
  canEdit: boolean
}

export interface VehicleDto {
  id: string
  /** Pełny numer (odczyt listy rejestrowany w audit log). */
  registrationNumber: string
  makeModel: string | null
  vehicleType: VehicleType
  company: string
  defaultDriverId: string | null
  party: string
  version: number
  canEdit: boolean
}

export interface EntryPointDto {
  id: string
  name: string
  isActive: boolean
}

export interface AvizationDto {
  id: string
  number: string
  dateFrom: string
  dateTo: string
  entryPointId: string | null
  entryPointName: string | null
  purpose: string
  hrfTaskId: string | null
  hrfTaskCode: string | null
  status: AvizationStatus
  party: string
  requestedBy: string | null
  requestedByName: string | null
  decidedAt: string | null
  decidedByName: string | null
  rejectionReason: string | null
  externalRef: string | null
  persons: { id: string; name: string; company: string; idDocNumberMasked: string }[]
  vehicles: { vehicleId: string; registrationNumber: string; makeModel: string | null; driverPersonId: string | null; driverName: string | null }[]
  warnings: { code: 'short_notice'; message: string }[]
  version: number
  canEdit: boolean
  canDecide: boolean
}

export interface OnSiteResponse {
  date: string
  avizations: { id: string; number: string; entryPointName: string | null; purpose: string; dateFrom: string; dateTo: string }[]
  persons: { id: string; name: string; company: string; avizationNumber: string }[]
  vehicles: { id: string; registrationNumber: string; makeModel: string | null; driverName: string | null; avizationNumber: string }[]
}

/** Kolumny eksportu listy awizacyjnej (szablon konfigurowalny). */
export const AVIZATION_EXPORT_COLUMNS = [
  'lp',
  'nameWithDoc',
  'nameWithDocLastFirst',
  'lastFirst',
  'firstLast',
  'docType',
  'docNumber',
  'vehicle',
  'makeModel',
  'registration',
  'company',
  'phone',
  'roleOnSite',
  'dateFrom',
  'dateTo',
  'entryPoint',
] as const
export type AvizationExportColumn = (typeof AVIZATION_EXPORT_COLUMNS)[number]

export const exportTemplateInput = z.object({
  name: z.string().trim().min(1).max(100),
  columns: z
    .array(z.object({ key: z.enum(AVIZATION_EXPORT_COLUMNS), header: z.string().trim().min(1).max(100), width: z.number().int().min(4).max(80).default(20) }))
    .min(1)
    .max(15),
  /** Pusty wiersze na dopiski ręczne (jak w formularzu ochrony, do 20 Lp). */
  minRows: z.number().int().min(0).max(100).default(0),
})
export type ExportTemplateInput = z.infer<typeof exportTemplateInput>

/** Domyślny szablon — format listy ochrony PIT-RADWAR (Lp | Nazwisko i imię, nr dokumentu | Marka i nr rejestracyjny auta | Firma). */
export const DEFAULT_EXPORT_TEMPLATE: ExportTemplateInput = {
  name: 'Lista ochrony PIT-RADWAR',
  columns: [
    { key: 'lp', header: 'Lp', width: 5 },
    { key: 'nameWithDoc', header: 'Nazwisko i imię, nr dokumentu', width: 40 },
    { key: 'vehicle', header: 'Marka i nr rejestracyjny auta', width: 32 },
    { key: 'company', header: 'Firma', width: 20 },
  ],
  minRows: 20,
}

export interface AvizationSettings {
  minLeadWorkingDays: number
  exportTemplate: ExportTemplateInput
}

export const avizationSettingsInput = z.object({ minLeadWorkingDays: z.number().int().min(0).max(30), exportTemplate: exportTemplateInput })

// --- import słownika osób/pojazdów z listy XLSX ---
export interface PeopleImportRow {
  row: number
  firstName: string
  lastName: string
  idDocType: IdDocType
  idDocNumber: string
  company: string
  vehicle: { makeModel: string | null; registrationNumber: string } | null
  warnings: string[]
  /** Osoba o tym numerze dokumentu już istnieje — zostanie pominięta. */
  duplicate: boolean
}
