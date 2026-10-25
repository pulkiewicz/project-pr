import type { Action, ModuleKey } from '#shared'
import { MODULES } from '#shared'
import { projectPath } from './lib/project'

export interface NavItem {
  module: ModuleKey
  /** Moduły projektu: ścieżka względem `/projekty/{code}` (pusta = dashboard projektu); moduły firmy: ścieżka bezwzględna. */
  path: string
  /** Etap wdrożenia (E* — spec. PIT-RADWAR, R* — plan Envcheck Hub); moduły niezaimplementowane pokazują placeholder. */
  stage: string
  ready: boolean
}

/** Moduły w kontekście projektu. */
export const PROJECT_NAV: NavItem[] = [
  { module: 'dashboard', path: '', stage: 'E1', ready: true },
  { module: 'hrf', path: 'hrf', stage: 'E1', ready: true },
  { module: 'weeklyPlan', path: 'plan-tygodniowy', stage: 'E3', ready: true },
  { module: 'purchases', path: 'zakupy', stage: 'E3', ready: true },
  { module: 'avizations', path: 'awizacje', stage: 'E3', ready: true },
  { module: 'subcontractors', path: 'podwykonawcy', stage: 'E4', ready: false },
  { module: 'acceptances', path: 'odbiory', stage: 'E4', ready: false },
  { module: 'acceptanceDocs', path: 'dokumentacja-odbiorowa', stage: 'E4', ready: false },
  { module: 'changes', path: 'zmiany', stage: 'E5', ready: false },
  { module: 'risks', path: 'ryzyka', stage: 'E5', ready: false },
  { module: 'letters', path: 'korespondencja', stage: 'E5', ready: false },
  { module: 'meetings', path: 'spotkania', stage: 'E5', ready: false },
  { module: 'weeklyReport', path: 'raport-tygodniowy', stage: 'E7', ready: false },
  // [W]
  { module: 'weeklyReportInternal', path: 'raport-tygodniowy-w', stage: 'E7', ready: false },
  { module: 'penalties', path: 'kary', stage: 'E6', ready: false },
  { module: 'arsanitFlows', path: 'przeplywy-arsanit', stage: 'E6', ready: false },
  { module: 'guarantees', path: 'zabezpieczenia', stage: 'E6', ready: false },
]

/** Moduły firmy: sprzedaż i baza wiedzy wycen (tylko pracownicy Envcheck). */
export const SALES_NAV: NavItem[] = [
  { module: 'crm', path: '/crm', stage: 'R1', ready: true },
  { module: 'quotes', path: '/wyceny', stage: 'R2', ready: false },
  { module: 'quoteKnowledge', path: '/baza-wiedzy', stage: 'R2', ready: false },
]

/** Dawne adresy sprzed Envcheck Hub (jeden projekt) → moduł projektu. */
export const LEGACY_PROJECT_PATHS = PROJECT_NAV.filter((n) => n.path).map((n) => n.path)

/** Strona startowa projektu: dashboard, a bez dostępu do niego — pierwszy dostępny moduł (np. podwykonawca). */
export function projectHomePath(code: string, can: (m: ModuleKey, a: Action) => boolean) {
  const first = PROJECT_NAV.find((n) => n.ready && can(n.module, 'view'))
  return projectPath(code, first?.path ?? '')
}

export const isInternal = (m: ModuleKey) => MODULES[m].internal
