import { Center, Loader } from '@mantine/core'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Action, ModuleKey } from '#shared'
import { Suspense, lazy, type ReactNode } from 'react'
import { useAuth } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { MfaSetupPage, MfaVerifyPage } from './auth/MfaPages'
import { SetPasswordPage } from './auth/SetPasswordPage'
import { AppLayout } from './layout/AppLayout'
import { NAV } from './nav'
import { DashboardPage } from './pages/DashboardPage'
import { ForbiddenPage, ModulePlaceholder, NotFoundPage } from './pages/ModulePlaceholder'
import { AuditPage } from './pages/admin/AuditPage'
import { PermissionsPage } from './pages/admin/PermissionsPage'
import { SettingsPage } from './pages/admin/SettingsPage'
import { UsersPage } from './pages/admin/UsersPage'

// Moduł HRF (frappe-gantt, mantine-react-table) ładowany na żądanie — mniejszy bundle startowy.
const HrfPage = lazy(() => import('./features/hrf/HrfPage').then((m) => ({ default: m.HrfPage })))

/** Ukrywa trasę w UI; właściwa autoryzacja zawsze po stronie API. */
function Guard({ module, action = 'view', children }: { module: ModuleKey; action?: Action; children: ReactNode }) {
  const { can } = useAuth()
  return can(module, action) ? <>{children}</> : <ForbiddenPage />
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
        <Route
          index
          element={
            <Guard module="dashboard">
              <DashboardPage />
            </Guard>
          }
        />
        <Route path="/hrf" element={<Guard module="hrf"><Suspense fallback={<Loader />}><HrfPage /></Suspense></Guard>} />
        {NAV.filter((n) => !n.ready).map((n) => (
          <Route
            key={n.module}
            path={n.path}
            element={
              <Guard module={n.module}>
                <ModulePlaceholder item={n} />
              </Guard>
            }
          />
        ))}
        <Route path="/admin/users" element={<Guard module="admin"><UsersPage /></Guard>} />
        <Route path="/admin/permissions" element={<Guard module="admin"><PermissionsPage /></Guard>} />
        <Route path="/admin/settings" element={<Guard module="admin"><SettingsPage /></Guard>} />
        <Route path="/admin/audit" element={<Guard module="auditLog"><AuditPage /></Guard>} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
