import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      // Pakiet nie eksportuje ścieżki do CSS (tylko warunek `style`).
      'frappe-gantt.css': fileURLToPath(new URL('../node_modules/frappe-gantt/dist/frappe-gantt.css', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
})
