import type { Role } from './roles.ts'

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const
export type Action = (typeof ACTIONS)[number]

/**
 * Moduły aplikacji (klucze używane w macierzy uprawnień, menu i API).
 * `internal: true` oznacza moduł [W] — wyłącznie wewnętrzny dla Envcheck.
 */
export const MODULES = {
  dashboard: { internal: false },
  dashboardInternal: { internal: true },
  hrf: { internal: false },
  weeklyPlan: { internal: false },
  purchases: { internal: false },
  avizations: { internal: false },
  subcontractors: { internal: false },
  acceptances: { internal: false },
  changes: { internal: false },
  risks: { internal: false },
  letters: { internal: false },
  meetings: { internal: false },
  weeklyReport: { internal: false },
  weeklyReportInternal: { internal: true },
  penalties: { internal: true },
  arsanitFlows: { internal: true },
  guarantees: { internal: true },
  acceptanceDocs: { internal: false },
  documents: { internal: false },
  auditLog: { internal: true },
  admin: { internal: true },
} as const satisfies Record<string, { internal: boolean }>

export type ModuleKey = keyof typeof MODULES
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]

/**
 * Poziomy z sekcji 4.3 specyfikacji:
 * P = pełny (CRUD + approve + export), E = edycja własnych/przypisanych,
 * O = odczyt, A = akceptacja (odczyt + approve), OA = odczyt + akceptacja,
 * '-' = brak dostępu.
 * Zawężenie „własnych” (po `party`) realizuje polityka modułu, nie macierz.
 */
export type Level = 'P' | 'E' | 'O' | 'A' | '-'

const LEVEL_ACTIONS: Record<Level, readonly Action[]> = {
  P: ACTIONS,
  E: ['view', 'create', 'edit', 'export'],
  O: ['view', 'export'],
  A: ['view', 'approve', 'export'],
  '-': [],
}

type Row = Record<Role, Level>
const row = (Admin: Level, EnvcheckInternal: Level, Arsanit: Level, Client: Level, Subcontractor: Level): Row => ({
  Admin,
  EnvcheckInternal,
  Arsanit,
  Client,
  Subcontractor,
})

/** Domyślna macierz z sekcji 4.3 (seed). */
export const DEFAULT_LEVELS: Record<ModuleKey, Row> = {
  dashboard: row('P', 'O', 'O', 'O', '-'),
  dashboardInternal: row('P', 'O', '-', '-', '-'),
  hrf: row('P', 'E', 'E', 'O', '-'),
  weeklyPlan: row('P', 'E', 'E', 'O', 'O'),
  purchases: row('P', 'E', 'E', '-', '-'),
  avizations: row('P', 'E', 'E', 'A', 'E'),
  subcontractors: row('P', 'E', 'E', 'O', 'O'),
  acceptances: row('P', 'E', 'O', 'A', '-'),
  changes: row('P', 'E', 'E', 'A', '-'), // Client: O + A
  risks: row('P', 'E', 'E', '-', '-'),
  letters: row('P', 'E', 'O', '-', '-'),
  meetings: row('P', 'E', 'E', 'O', '-'),
  weeklyReport: row('P', 'O', 'O', 'O', '-'),
  weeklyReportInternal: row('P', 'O', '-', '-', '-'),
  penalties: row('P', 'O', '-', '-', '-'),
  arsanitFlows: row('P', 'O', '-', '-', '-'),
  guarantees: row('P', 'O', '-', '-', '-'),
  acceptanceDocs: row('P', 'E', 'E', 'O', '-'),
  // Repozytorium: dostęp do treści wg ACL folderu (sekcja 7); macierz decyduje tylko o widoczności modułu.
  documents: row('P', 'O', 'O', 'O', 'O'),
  auditLog: row('P', '-', '-', '-', '-'),
  admin: row('P', '-', '-', '-', '-'),
}

export interface PermissionEntry {
  role: Role
  module: ModuleKey
  action: Action
  allowed: boolean
}

/** Pełna lista wpisów (rola × moduł × akcja) dla domyślnej macierzy. */
export function defaultPermissionEntries(): PermissionEntry[] {
  const out: PermissionEntry[] = []
  for (const module of MODULE_KEYS) {
    for (const [role, level] of Object.entries(DEFAULT_LEVELS[module]) as [Role, Level][]) {
      for (const action of ACTIONS) {
        out.push({ role, module, action, allowed: LEVEL_ACTIONS[level].includes(action) })
      }
    }
  }
  return out
}

/** Zbiór „module:action” dozwolonych dla roli — format przekazywany do frontendu w /api/me. */
export type PermissionSet = readonly `${ModuleKey}:${Action}`[]

export function hasPermission(set: PermissionSet, module: ModuleKey, action: Action): boolean {
  return set.includes(`${module}:${action}`)
}
