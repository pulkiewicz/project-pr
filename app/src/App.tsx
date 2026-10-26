import { Center, Loader } from '@mantine/core'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import type { Action, ModuleKey } from '#shared'
import { Suspense, lazy, type ReactNode } from 'react'
import { useAuth, useMe } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { MfaSetupPage, MfaVerifyPage } from './auth/MfaPages'
import { ChangePasswordPage, SetPasswordPage } from './auth/SetPasswordPage'
import { AppLayout } from './layout/AppLayout'
import { PROJECTS_BASE, projectPath, useCurrentProject } from './lib/project'
import { LEGACY_PROJECT_PATHS, PROJECT_NAV, SALES_NAV } from './nav'
import { DashboardPage } from './pages/DashboardPage'
import { HomePage } from './pages/HomePage'
import { ForbiddenPage, ModulePlaceholder, NotFoundPage } from './pages/ModulePlaceholder'
import { AuditPage } from './pages/admin/AuditPage'
import { PermissionsPage } from './pages/admin/PermissionsPage'
import { ProjectsPage } from './pages/admin/ProjectsPage'
import { SettingsPage } from './pages/admin/SettingsPage'
import { UsersPage } from './pages/admin/UsersPage'

// Moduł HRF (frappe-gantt, mantine-react-table) ładowany na żądanie — mniejszy bundle startowy.
const HrfPage = lazy(() => import('./features/hrf/HrfPage').then((m) => ({ default: m.HrfPage })))
const WeeklyPlanPage = lazy(() => import('./features/weekly/WeeklyPlanPage').then((m) => ({ default: m.WeeklyPlanPage })))
const AvizationsPage = lazy(() => import('./features/avizations/AvizationsPage').then((m) => ({ default: m.AvizationsPage })))
const CrmPage = lazy(() => import('./features/crm/CrmPage').then((m) => ({ default: m.CrmPage })))
const QuotesPage = lazy(() => import('./features/quotes/QuotesPage').then((m) => ({ default: m.QuotesPage })))
const KnowledgePage = lazy(() => import('./features/quotes/KnowledgePage').then((m) => ({ default: m.KnowledgePage })))
const InvoicesPage = lazy(() => import('./features/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage })))
const PurchasesPage = lazy(() => import('./features/purchases/PurchasesPage').then((m) => ({ default: m.PurchasesPage })))

/** Ukrywa trasę w UI; właściwa autoryzacja zawsze po stronie API. */
function Guard({ module, action = 'view', children }: { module: ModuleKey; action?: Action; children: ReactNode }) {
  const { can } = useAuth()
  return can(module, action) ? <>{children}</> : <ForbiddenPage />
}

/** Moduły projektu renderują się tylko dla projektu dostępnego użytkownikowi (kod z adresu). */
function ProjectLayout() {
  const project = useCurrentProject()
  return project ? <Outlet key={project.id} /> : <NotFoundPage />
}

/** Dawne adresy (`/hrf`, `/zakupy`, …) → ten sam moduł w pierwszym dostępnym projekcie, z zachowaniem parametrów. */
function LegacyProjectRedirect({ path }: { path: string }) {
  const project = useMe().projects[0]
  const { search, hash } = useLocation()
  return project ? <Navigate to={`${projectPath(project.code, path)}${search}${hash}`} replace /> : <NotFoundPage />
}

export function App() {
  const { state } = useAuth()

  switch (state.status) {
    case 'loading':
      return (
        <Center mih="100vh">
          <Loader />
        </Center>
      )
    case 'anonymous':
      return <LoginPage />
    case 'denied':
      return <LoginPage deniedCode={state.code} />
    case 'invite':
      return <SetPasswordPage inviteToken={state.token} />
    case 'recovery':
      return <SetPasswordPage />
    case 'password-change':
      return <ChangePasswordPage />
    case 'mfa-setup':
      return <MfaSetupPage />
    case 'mfa-verify':
      return <MfaVerifyPage />
    case 'ready':
      break
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path={`${PROJECTS_BASE}/:code`} element={<ProjectLayout />}>
          <Route index element={<Guard module="dashboard"><DashboardPage /></Guard>} />
          <Route path="hrf" element={<Guard module="hrf"><Suspense fallback={<Loader />}><HrfPage /></Suspense></Guard>} />
          <Route path="plan-tygodniowy" element={<Guard module="weeklyPlan"><Suspense fallback={<Loader />}><WeeklyPlanPage /></Suspense></Guard>} />
          <Route path="awizacje" element={<Guard module="avizations"><Suspense fallback={<Loader />}><AvizationsPage /></Suspense></Guard>} />
          <Route path="zakupy" element={<Guard module="purchases"><Suspense fallback={<Loader />}><PurchasesPage /></Suspense></Guard>} />
          {PROJECT_NAV.filter((n) => !n.ready).map((n) => (
            <Route key={n.module} path={n.path} element={<Guard module={n.module}><ModulePlaceholder item={n} /></Guard>} />
          ))}
        </Route>
        <Route path={PROJECTS_BASE} element={<Navigate to="/" replace />} />
        <Route path="/crm/*" element={<Guard module="crm"><Suspense fallback={<Loader />}><CrmPage /></Suspense></Guard>} />
        <Route path="/wyceny/:id?" element={<Guard module="quotes"><Suspense fallback={<Loader />}><QuotesPage /></Suspense></Guard>} />
        <Route path="/baza-wiedzy" element={<Guard module="quoteKnowledge"><Suspense fallback={<Loader />}><KnowledgePage /></Suspense></Guard>} />
        <Route path="/baza-wiedzy/profile/:id" element={<Guard module="quoteKnowledge"><Suspense fallback={<Loader />}><KnowledgePage /></Suspense></Guard>} />
        <Route path="/faktury" element={<Guard module="invoices"><Suspense fallback={<Loader />}><InvoicesPage /></Suspense></Guard>} />
        {SALES_NAV.filter((n) => !n.ready).map((n) => (
          <Route key={n.module} path={n.path} element={<Guard module={n.module}><ModulePlaceholder item={n} /></Guard>} />
        ))}
        {LEGACY_PROJECT_PATHS.map((path) => (
          <Route key={path} path={`/${path}`} element={<LegacyProjectRedirect path={path} />} />
        ))}
        <Route path="/admin/users" element={<Guard module="admin"><UsersPage /></Guard>} />
        <Route path="/admin/projects" element={<Guard module="admin"><ProjectsPage /></Guard>} />
        <Route path="/admin/permissions" element={<Guard module="admin"><PermissionsPage /></Guard>} />
        <Route path="/admin/settings" element={<Guard module="admin"><SettingsPage /></Guard>} />
        <Route path="/admin/audit" element={<Guard module="auditLog"><AuditPage /></Guard>} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
