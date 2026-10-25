import { useMatch } from 'react-router-dom'
import type { ProjectSummary } from '#shared'
import { useMe } from '../auth/AuthProvider'

export const PROJECTS_BASE = '/projekty'

/** Adres modułu projektu, np. `projectPath('OF14', 'hrf')` → `/projekty/OF14/hrf`. */
export function projectPath(code: string, sub = '') {
  return `${PROJECTS_BASE}/${encodeURIComponent(code)}${sub ? `/${sub}` : ''}`
}

export function findProject(projects: readonly ProjectSummary[], code: string | undefined) {
  const c = code?.toLowerCase()
  return c ? (projects.find((p) => p.code.toLowerCase() === c) ?? null) : null
}

/** Projekt z bieżącego adresu `/projekty/{code}/…`; null poza projektem albo dla nieznanego kodu. */
export function useCurrentProject(): ProjectSummary | null {
  const match = useMatch(`${PROJECTS_BASE}/:code/*`)
  return findProject(useMe().projects, match?.params.code)
}
