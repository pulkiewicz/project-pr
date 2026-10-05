import { defineConfig, devices } from '@playwright/test'

/**
 * E2E: lokalnie na `netlify dev` (http://localhost:8888) lub na deploy preview (E2E_BASE_URL).
 * Pełny przepływ logowania wymaga Netlify Identity — działa tylko na deployu (Identity nie działa pod netlify dev).
 */
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8888', locale: 'pl-PL', timezoneId: 'Europe/Warsaw' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
