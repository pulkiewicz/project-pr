import type { Action, ModuleKey, Role } from '#shared'
import type { UserRow } from '../../context.ts'

type Perms = Set<`${ModuleKey}:${Action}`>

/**
 * „E (własne/przypisane)” dla HRF:
 * - Envcheck: zadania Envcheck, wspólne (Konsorcjum) i czynności Zamawiającego (odbiory — śledzi je koordynator),
 * - Arsanit: zadania Arsanit i wspólne (Konsorcjum),
 * - każdy: zadania, w których jest osobą odpowiedzialną.
 * `hrf:approve` (domyślnie Admin) = wszystkie zadania i zmiany struktury.
 */
const OWN_PARTIES: Record<Role, readonly string[]> = {
  Admin: [],
  EnvcheckInternal: ['Envcheck', 'Konsorcjum', 'Client'],
  Arsanit: ['Arsanit', 'Konsorcjum'],
  Client: [],
  Subcontractor: [],
}

export function canEditProgress(user: UserRow, perms: Perms, task: { party: string; responsibleUserId: string | null }) {
  if (perms.has('hrf:approve')) return true
  if (!perms.has('hrf:edit')) return false
  return OWN_PARTIES[user.role].includes(task.party) || task.responsibleUserId === user.id
}

export const canEditStructure = (perms: Perms) => perms.has('hrf:approve')
/** Pola [W] HRF (wartość Etapu) — powiązane z modułem kar. */
export const canSeeInternal = (perms: Perms) => perms.has('penalties:view')
export const canEditInternal = (perms: Perms) => perms.has('penalties:edit')
