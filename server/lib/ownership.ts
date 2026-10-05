import type { Action, ModuleKey, Role } from '#shared'
import type { UserRow } from '../context.ts'

type Perms = Set<`${ModuleKey}:${Action}`>

/**
 * Strony, których rekordy rola edytuje przy uprawnieniu „E (własne)”.
 * Envcheck jako koordynator obejmuje też rekordy wspólne i czynności Zamawiającego (HRF/plan tygodniowy).
 */
export const OWN_PARTIES: Record<string, Record<Role, readonly string[]>> = {
  default: {
    Admin: [],
    EnvcheckInternal: ['Envcheck', 'Konsorcjum', 'Client'],
    Arsanit: ['Arsanit', 'Konsorcjum'],
    Client: [],
    Subcontractor: [],
  },
  /** M4: „kto kupuje” — tylko Envcheck albo Arsanit. */
  purchases: {
    Admin: [],
    EnvcheckInternal: ['Envcheck'],
    Arsanit: ['Arsanit'],
    Client: [],
    Subcontractor: [],
  },
}

/** `<moduł>:approve` (domyślnie Admin) = dostęp do rekordów wszystkich stron. */
export function canEditRecord(
  user: UserRow,
  perms: Perms,
  module: ModuleKey,
  record: { party: string; assigneeUserId?: string | null },
  scope: keyof typeof OWN_PARTIES = 'default',
) {
  if (perms.has(`${module}:approve`)) return true
  if (!perms.has(`${module}:edit`)) return false
  return OWN_PARTIES[scope]![user.role].includes(record.party) || (!!record.assigneeUserId && record.assigneeUserId === user.id)
}

export function canCreateForParty(user: UserRow, perms: Perms, module: ModuleKey, party: string, scope: keyof typeof OWN_PARTIES = 'default') {
  if (perms.has(`${module}:approve`)) return true
  return perms.has(`${module}:create`) && OWN_PARTIES[scope]![user.role].includes(party)
}
