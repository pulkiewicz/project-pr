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
import { StrictMode } from 'react'
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
            <BrowserRouter>
              <AuthProvider>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
)
