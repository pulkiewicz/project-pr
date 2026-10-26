import { z } from 'zod'

/** Kod projektu w adresach (`/projekty/{kod}`): litery, cyfry, `-` i `_`, np. OF038, WEW-BIURO. */
export const PROJECT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/

const text = (max: number) => z.string().trim().min(1).max(max)

/** Projekt zakładany ręcznie w Administracji (bez szansy w CRM, np. projekt wewnętrzny). */
export const projectInput = z.object({
  code: z.string().trim().regex(PROJECT_CODE_RE, 'validation.projectCode'),
  name: text(300),
  client: text(300),
  contractNo: z.string().trim().max(100).default('-'),
  procurementNo: z.string().trim().max(100).default('-'),
  contractValue: z.number().min(0).max(1e12).nullable().optional(),
  contractEndDate: z.iso.date(),
})
export type ProjectInput = z.input<typeof projectInput>

/** Kod projektu jest stały (adresy, powiązanie z ofertą w CRM). */
export const projectPatch = projectInput.omit({ code: true }).partial().extend({ version: z.number().int() })

export interface ProjectAdminDto {
  id: string
  code: string
  name: string
  client: string
  contractNo: string
  procurementNo: string
  contractValue: number | null
  contractEndDate: string
  /** Kod szansy w CRM, z której powstał projekt (jeśli powstał z CRM). */
  opportunityCode: string | null
  archived: boolean
  archivedAt: string | null
  version: number
}
