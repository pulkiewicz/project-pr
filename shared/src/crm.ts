import { z } from 'zod'
import { httpUrl } from './hrf.ts'

/** Lejek sprzedaży (decyzja C1 planu Envcheck Hub): 6 etapów. */
export const OPPORTUNITY_STAGES = ['new', 'quoting', 'submitted', 'won', 'lost', 'on_hold'] as const
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number]
/** Etapy zamknięte — wymagają powodu przy przejściu (przegrana) i nie podlegają przypomnieniom. */
export const OPPORTUNITY_CLOSED: readonly OpportunityStage[] = ['won', 'lost', 'on_hold']

/** Typ postępowania (decyzja C2). */
export const OPPORTUNITY_TYPES = ['public_tender', 'private_inquiry', 'modernization', 'service', 'other'] as const
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number]

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting', 'stage_change'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]
/** Rodzaje wpisywane ręcznie (zmiana etapu powstaje automatycznie). */
export const MANUAL_ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting'] as const satisfies readonly ActivityKind[]

/** Po tylu dniach bez aktywności złożona oferta dostaje etykietę „brak odpowiedzi” (decyzja C1). */
export const NO_RESPONSE_DAYS = 14

/**
 * Kod oferty: litera roku po „O” (2026 = OF, 2027 = OG, …) + numer w roku, min. 3 cyfry (OF038, OG001).
 * Stare kody z arkusza (OF14, OF015_S, OF32) zostają bez zmian.
 */
export function opportunityCodePrefix(year: number): string {
  const letter = String.fromCharCode('F'.charCodeAt(0) + (year - 2026))
  if (year < 2026 || letter > 'Z') throw new Error(`Unsupported year for opportunity code: ${year}`)
  return `O${letter}`
}

export function formatOpportunityCode(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(3, '0')}`
}

/** NIP: 10 cyfr z sumą kontrolną; akceptuje zapis z kreskami/spacjami i prefiksem PL. */
export function normalizeNip(raw: string): string | null {
  const digits = raw.replace(/^PL/i, '').replace(/[\s-]/g, '')
  if (!/^\d{10}$/.test(digits)) return null
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const sum = w.reduce((s, x, i) => s + x * Number(digits[i]), 0)
  return sum % 11 === Number(digits[9]) ? digits : null
}

const optText = (max: number) => z.string().trim().max(max).nullable().optional()
const nip = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null
    const n = normalizeNip(v)
    if (!n) ctx.addIssue({ code: 'custom', message: 'validation.nip' })
    return n
  })
  .nullable()
  .optional()

export const companyInput = z.object({
  name: z.string().trim().min(1).max(300),
  nip,
  regon: optText(14),
  address: optText(500),
  website: optText(300),
  industry: optText(200),
  notes: optText(5000),
  ownerId: z.uuid().nullable().optional(),
})
export type CompanyInput = z.input<typeof companyInput>
export const companyPatch = companyInput.partial().extend({ version: z.number().int() })

export const contactInput = z.object({
  name: z.string().trim().min(1).max(200),
  position: optText(200),
  email: z.email().nullable().optional().or(z.literal('').transform(() => null)),
  phone: optText(50),
  notes: optText(2000),
})
export type ContactInput = z.input<typeof contactInput>
export const contactPatch = contactInput.partial().extend({ version: z.number().int() })

const isoDate = z.iso.date().nullable().optional()

export const opportunityInput = z.object({
  name: z.string().trim().min(1).max(300),
  companyId: z.uuid().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  type: z.enum(OPPORTUNITY_TYPES).nullable().optional(),
  source: optText(200),
  /** Szacowana wartość netto (PLN). */
  value: z.number().min(0).max(1e12).nullable().optional(),
  submissionDeadline: isoDate,
  decisionDate: isoDate,
  nextStep: optText(1000),
  nextStepDate: isoDate,
  link: httpUrl.nullable().optional(),
  notes: optText(10000),
})
export type OpportunityInput = z.input<typeof opportunityInput>
export const opportunityPatch = opportunityInput.partial().extend({ version: z.number().int() })

export const stageChangeInput = z
  .object({
    stage: z.enum(OPPORTUNITY_STAGES),
    lossReason: optText(2000),
    version: z.number().int(),
  })
  .refine((v) => v.stage !== 'lost' || !!v.lossReason?.trim(), { message: 'validation.lossReasonRequired', path: ['lossReason'] })

export const activityInput = z.object({
  kind: z.enum(MANUAL_ACTIVITY_KINDS),
  body: z.string().trim().min(1).max(10000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
})
export type ActivityInput = z.input<typeof activityInput>

/** „Utwórz projekt” z wygranej szansy — pola wymagane przez tabelę projektów. */
export const projectFromOpportunityInput = z.object({
  name: z.string().trim().min(1).max(300),
  client: z.string().trim().min(1).max(300),
  contractNo: z.string().trim().min(1).max(100),
  procurementNo: z.string().trim().max(100).default('-'),
  contractValue: z.number().min(0).max(1e12).nullable().optional(),
  contractEndDate: z.iso.date(),
})
export type ProjectFromOpportunityInput = z.input<typeof projectFromOpportunityInput>

export interface ContactDto {
  id: string
  companyId: string
  name: string
  position: string | null
  email: string | null
  phone: string | null
  notes: string | null
  version: number
}

export interface CompanyDto {
  id: string
  name: string
  nip: string | null
  regon: string | null
  address: string | null
  website: string | null
  industry: string | null
  notes: string | null
  ownerId: string | null
  ownerName: string | null
  opportunityCount: number
  openOpportunityCount: number
  version: number
}

export interface CompanyDetailDto extends CompanyDto {
  contacts: ContactDto[]
  opportunities: OpportunityDto[]
}

export interface OpportunityDto {
  id: string
  code: string
  name: string
  stage: OpportunityStage
  companyId: string | null
  companyName: string | null
  contactId: string | null
  contactName: string | null
  ownerId: string | null
  ownerName: string | null
  type: OpportunityType | null
  source: string | null
  value: number | null
  submissionDeadline: string | null
  decisionDate: string | null
  nextStep: string | null
  nextStepDate: string | null
  link: string | null
  notes: string | null
  lossReason: string | null
  projectId: string | null
  projectCode: string | null
  stageChangedAt: string | null
  lastActivityAt: string | null
  /** Złożona oferta bez aktywności od {@link NO_RESPONSE_DAYS} dni. */
  noResponse: boolean
  createdAt: string
  version: number
}

export interface ActivityDto {
  id: string
  kind: ActivityKind
  body: string
  /** Dla zmiany etapu: { from, to, lossReason? }. */
  meta: Record<string, unknown> | null
  occurredAt: string
  userId: string | null
  userName: string | null
}

export interface OpportunityDetailDto extends OpportunityDto {
  activities: ActivityDto[]
}

export interface NipLookupResult {
  nip: string
  name: string
  regon: string | null
  address: string | null
  vatStatus: string | null
}

export interface CrmOwnerOption {
  id: string
  name: string
}
