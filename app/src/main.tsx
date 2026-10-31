import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import 'mantine-react-table/styles.css'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import 'dayjs/locale/pl'
import './i18n'
import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ApiError } from './lib/api'
import { theme } from './theme'

// Po nowym deployu stare pliki leniwie ładowanych stron znikają — przeładuj raz zamiast pokazywać błąd.
window.addEventListener('vite:preloadError', (e) => {
  const last = Number(sessionStorage.getItem('chunk_reload_at') ?? 0)
  if (Date.now() - last < 60_000) return
  sessionStorage.setItem('chunk_reload_at', String(Date.now()))
  e.preventDefault()
  window.location.reload()
})

/**
 * Ekran pracownika ewidencji czasu (`/godziny?id=…`) — publiczny, bez logowania Identity i bez reszty aplikacji
 * (osobny, leniwie ładowany fragment; własne style ładują się tylko tutaj).
 */
const TIMESHEET_PATH = '/godziny'
const isTimesheetPage = window.location.pathname === TIMESHEET_PATH || window.location.pathname.startsWith(`${TIMESHEET_PATH}/`)
const EmployeeView = lazy(() => import('./features/timesheets/employee/EmployeeView').then((m) => ({ default: m.EmployeeView })))
if (isTimesheetPage) {
  document.title = 'Ewidencja czasu pracy'
  const robots = document.createElement('meta')
  robots.name = 'robots'
  robots.content = 'noindex, nofollow'
  document.head.appendChild(robots)
}

// Wpisywanie dat w polach DateInput w formacie DD.MM.YYYY.
dayjs.extend(customParseFormat)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <DatesProvider settings={{ locale: 'pl', firstDayOfWeek: 1, timezone: 'Europe/Warsaw' }}>
        <ModalsProvider>
          <Notifications position="top-right" />
          <QueryClientProvider client={queryClient}>
            {isTimesheetPage ? (
              <Suspense fallback={null}>
                <EmployeeView />
              </Suspense>
            ) : (
              <BrowserRouter>
                <AuthProvider>
                  <App />
                </AuthProvider>
              </BrowserRouter>
            )}
          </QueryClientProvider>
        </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
)
