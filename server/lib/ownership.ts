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
  /** M5: słowniki i awizacje. Podwykonawca — wyłącznie własne wpisy (party = Subcontractor:{id}), patrz `ownParties`. */
  avizations: {
    Admin: [],
    EnvcheckInternal: ['Envcheck', 'Konsorcjum'],
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

function ownParties(user: UserRow, scope: keyof typeof OWN_PARTIES): readonly string[] {
  if (user.role === 'Subcontractor') return [user.party]
  return OWN_PARTIES[scope]![user.role]
}

/** `<moduł>:approve` (domyślnie Admin) = dostęp do rekordów wszystkich stron. Dla M5 approve ma Zamawiający — patrz `avizations`. */
/** M5: approve oznacza akceptację awizacji (Zamawiający), nie edycję cudzych rekordów — pełny dostęp tylko `avizations:delete` (Admin). */
export function canEditAvizationRecord(user: UserRow, perms: Perms, record: { party: string }) {
  if (perms.has('avizations:delete')) return true
  return perms.has('avizations:edit') && ownParties(user, 'avizations').includes(record.party)
}

export function defaultPartyFor(user: UserRow): string {
  if (user.role === 'Subcontractor') return user.party
  if (user.role === 'Arsanit') return 'Arsanit'
  return 'Envcheck'
}

export function canEditRecord(
  user: UserRow,
  perms: Perms,
  module: ModuleKey,
  record: { party: string; assigneeUserId?: string | null },
  scope: keyof typeof OWN_PARTIES = 'default',
) {
  if (perms.has(`${module}:approve`)) return true
  if (!perms.has(`${module}:edit`)) return false
  return ownParties(user, scope).includes(record.party) || (!!record.assigneeUserId && record.assigneeUserId === user.id)
}

export function canCreateForParty(user: UserRow, perms: Perms, module: ModuleKey, party: string, scope: keyof typeof OWN_PARTIES = 'default') {
  if (perms.has(`${module}:approve`)) return true
  return perms.has(`${module}:create`) && ownParties(user, scope).includes(party)
}
