import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Każdy plik ma własną bazę PGlite; ROUTE_POLICIES to stan modułu — izolacja plików jest wymagana.
    isolate: true,
  },
})
