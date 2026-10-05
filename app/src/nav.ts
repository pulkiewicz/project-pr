import type { ModuleKey } from '#shared'
import { MODULES } from '#shared'

export interface NavItem {
  module: ModuleKey
  path: string
  /** Etap wdrożenia z sekcji 12 — moduły jeszcze niezaimplementowane pokazują placeholder. */
  stage: string
  ready: boolean
}

export const NAV: NavItem[] = [
  { module: 'dashboard', path: '/', stage: 'E1', ready: true },
  { module: 'hrf', path: '/hrf', stage: 'E1', ready: true },
  { module: 'weeklyPlan', path: '/plan-tygodniowy', stage: 'E3', ready: true },
  { module: 'purchases', path: '/zakupy', stage: 'E3', ready: true },
  { module: 'avizations', path: '/awizacje', stage: 'E3', ready: false },
  { module: 'subcontractors', path: '/podwykonawcy', stage: 'E4', ready: false },
  { module: 'acceptances', path: '/odbiory', stage: 'E4', ready: false },
  { module: 'acceptanceDocs', path: '/dokumentacja-odbiorowa', stage: 'E4', ready: false },
  { module: 'changes', path: '/zmiany', stage: 'E5', ready: false },
  { module: 'risks', path: '/ryzyka', stage: 'E5', ready: false },
  { module: 'letters', path: '/korespondencja', stage: 'E5', ready: false },
  { module: 'meetings', path: '/spotkania', stage: 'E5', ready: false },
  { module: 'documents', path: '/dokumenty', stage: 'E2', ready: false },
  { module: 'weeklyReport', path: '/raport-tygodniowy', stage: 'E7', ready: false },
  // [W]
  { module: 'weeklyReportInternal', path: '/raport-tygodniowy-w', stage: 'E7', ready: false },
  { module: 'penalties', path: '/kary', stage: 'E6', ready: false },
  { module: 'arsanitFlows', path: '/przeplywy-arsanit', stage: 'E6', ready: false },
  { module: 'guarantees', path: '/zabezpieczenia', stage: 'E6', ready: false },
  { module: 'auditLog', path: '/admin/audit', stage: 'E0', ready: true },
]

export const isInternal = (m: ModuleKey) => MODULES[m].internal
