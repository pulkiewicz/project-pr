import { z } from 'zod'

/**
 * Zarząd Envcheck (decyzja 31.10.2026): ewidencja pojazdów i lista pracowników.
 * Dostęp: rola (Admin / Envcheck wewnętrzny) + osoba na liście `management.access` (Ania, Kamil, Krzysztof).
 */

/** Ustawienie `management.access`: kto ma dostęp do modułów Pojazdy i Pracownicy (niezależnie od roli). */
export interface ManagementSettings {
  userIds: string[]
}
export const managementSettingsInput = z.object({ userIds: z.array(z.uuid()).max(50) })

// ---------------- Terminy ----------------

/** Ile dni przed terminem pozycja jest oznaczana jako „kończy się”. */
export const DEADLINE_SOON_DAYS = 30
export type DeadlineStatus = 'none' | 'ok' | 'soon' | 'expired'

/** Status terminu względem dziś (obie daty `yyyy-MM-dd`); dzień terminu jest jeszcze ważny. */
export function deadlineStatus(date: string | null | undefined, today: string): DeadlineStatus {
  if (!date) return 'none'
  const days = daysBetween(today, date)
  if (days < 0) return 'expired'
  return days <= DEADLINE_SOON_DAYS ? 'soon' : 'ok'
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

const DEADLINE_RANK: Record<DeadlineStatus, number> = { none: 0, ok: 1, soon: 2, expired: 3 }
export const worstDeadline = (statuses: DeadlineStatus[]): DeadlineStatus => statuses.reduce<DeadlineStatus>((w, s) => (DEADLINE_RANK[s] > DEADLINE_RANK[w] ? s : w), 'none')

/** Najpóźniejsza data ważności wśród wpisów danego rodzaju (np. ostatnia polisa OC). */
export function latestValid<T>(rows: T[], match: (r: T) => boolean, date: (r: T) => string | null): string | null {
  return rows.filter(match).reduce<string | null>((max, r) => {
    const d = date(r)
    return d && (!max || d > max) ? d : max
  }, null)
}

const isoDate = z.iso.date()
const optDate = isoDate.nullable().optional()
const optText = (max: number) => z.string().trim().max(max).nullable().optional()
const optUrl = z.url({ protocol: /^https?$/ }).max(2000).nullable().optional()

// ---------------- Pojazdy ----------------

export const FLEET_KINDS = ['car', 'van', 'truck', 'trailer', 'forklift', 'lift', 'other'] as const
export type FleetKind = (typeof FLEET_KINDS)[number]
export const FLEET_OWNERSHIP = ['owned', 'leasing', 'rental'] as const
export const INSURANCE_TYPES = ['OC', 'AC', 'NNW', 'assistance', 'other'] as const
export type InsuranceType = (typeof INSURANCE_TYPES)[number]
/** Badanie techniczne, dozór UDT, przegląd serwisowy, legalizacja tachografu. */
export const INSPECTION_KINDS = ['technical', 'udt', 'service', 'tachograph', 'other'] as const
export type InspectionKind = (typeof INSPECTION_KINDS)[number]

export const insuranceInput = z.object({
  type: z.enum(INSURANCE_TYPES),
  insurer: optText(200),
  policyNumber: optText(100),
  validFrom: optDate,
  validTo: isoDate,
  policyUrl: optUrl,
  notes: optText(1000),
})
export type InsuranceInput = z.infer<typeof insuranceInput>

export const inspectionInput = z.object({
  kind: z.enum(INSPECTION_KINDS),
  performedDate: optDate,
  validUntil: optDate,
  documentUrl: optUrl,
  notes: optText(1000),
})
export type InspectionInput = z.infer<typeof inspectionInput>

const fleetVehicleBase = z.object({
  registrationNumber: z.string().trim().min(1).max(20),
  make: optText(100),
  model: optText(100),
  kind: z.enum(FLEET_KINDS),
  vin: optText(17),
  productionYear: z.number().int().min(1950).max(2100).nullable().optional(),
  ownership: z.enum(FLEET_OWNERSHIP),
  /** Leasingodawca / wynajmujący. */
  financingCompany: optText(200),
  financingEndDate: optDate,
  assignedEmployeeId: z.uuid().nullable().optional(),
  isActive: z.boolean(),
  notes: optText(5000),
  /** Pełna lista — zapis zastępuje dotychczasowe wpisy. */
  insurances: z.array(insuranceInput).max(100),
  inspections: z.array(inspectionInput).max(100),
})
export const fleetVehicleInput = fleetVehicleBase.extend({
  ownership: fleetVehicleBase.shape.ownership.default('owned'),
  isActive: fleetVehicleBase.shape.isActive.default(true),
  insurances: fleetVehicleBase.shape.insurances.default([]),
  inspections: fleetVehicleBase.shape.inspections.default([]),
})
export type FleetVehicleInput = z.input<typeof fleetVehicleInput>
export const fleetVehiclePatch = fleetVehicleBase.partial().extend({ version: z.number().int() })

export interface FleetVehicleDto extends Required<Omit<z.infer<typeof fleetVehicleBase>, 'productionYear'>> {
  id: string
  productionYear: number | null
  assignedEmployeeName: string | null
  version: number
}

// ---------------- Pracownicy ----------------

export const CONTRACT_TYPES = ['employment', 'mandate', 'specific_task', 'b2b', 'internship', 'other'] as const
export type ContractType = (typeof CONTRACT_TYPES)[number]

export const qualificationInput = z.object({
  /** Np. „SEP E1”, „Certyfikat F-gazowy”, „UDT — wózki jezdniowe”. */
  name: z.string().trim().min(1).max(200),
  number: optText(100),
  validUntil: optDate,
  documentUrl: optUrl,
  notes: optText(1000),
})
export type QualificationInput = z.infer<typeof qualificationInput>

/** PESEL: 11 cyfr z poprawną sumą kontrolną. */
export function isValidPesel(v: string): boolean {
  if (!/^\d{11}$/.test(v)) return false
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  const sum = w.reduce((s, x, i) => s + x * Number(v[i]), 0)
  return (10 - (sum % 10)) % 10 === Number(v[10])
}

/** Data urodzenia z PESEL (miesiąc koduje stulecie). */
export function birthDateFromPesel(v: string): string | null {
  if (!isValidPesel(v)) return null
  const yy = Number(v.slice(0, 2))
  let mm = Number(v.slice(2, 4))
  const dd = v.slice(4, 6)
  const centuries: [number, number][] = [[80, 1800], [0, 1900], [20, 2000], [40, 2100], [60, 2200]]
  const [offset, century] = centuries.find(([o]) => mm > o && mm <= o + 12)!
  mm -= offset
  return `${century + yy}-${String(mm).padStart(2, '0')}-${dd}`
}

const employeeBase = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  position: optText(200),
  email: z.email().max(200).nullable().optional(),
  phone: optText(50),
  birthDate: optDate,
  /** Zapisywany zaszyfrowany; w odpowiedziach tylko maska. `null` czyści, brak pola — bez zmian. */
  pesel: z.string().trim().refine(isValidPesel, 'validation.pesel').nullable().optional(),
  address: optText(500),
  emergencyContactName: optText(200),
  emergencyContactPhone: optText(50),
  contractType: z.enum(CONTRACT_TYPES).nullable().optional(),
  contractStart: optDate,
  /** Null = umowa na czas nieokreślony. */
  contractEnd: optDate,
  medicalExamValidUntil: optDate,
  bhpTrainingValidUntil: optDate,
  /** Konto w aplikacji — do połączenia z raportowaniem czasu pracy. */
  userId: z.uuid().nullable().optional(),
  isActive: z.boolean(),
  notes: optText(5000),
  qualifications: z.array(qualificationInput).max(100),
})
export const employeeInput = employeeBase.extend({
  isActive: employeeBase.shape.isActive.default(true),
  qualifications: employeeBase.shape.qualifications.default([]),
})
export type EmployeeInput = z.input<typeof employeeInput>
export const employeePatch = employeeBase.partial().extend({ version: z.number().int() })

export interface EmployeeDto extends Required<Omit<z.infer<typeof employeeBase>, 'pesel'>> {
  id: string
  /** „•••••••1234” albo null, gdy brak. */
  peselMasked: string | null
  userName: string | null
  version: number
}

export interface ManagementUserOption {
  id: string
  name: string
}

// ---------------- Import z listy awizacyjnej ----------------

/** Osoba z firmy Envcheck z awizacji (wszystkie projekty), której nie ma jeszcze na liście pracowników. */
export interface AvizationCandidate {
  personId: string
  firstName: string
  lastName: string
  company: string
  phone: string | null
  /** Rola na budowie z awizacji → stanowisko. */
  position: string | null
  projects: string[]
}
export const employeeImportInput = z.object({ personIds: z.array(z.uuid()).min(1).max(500) })
