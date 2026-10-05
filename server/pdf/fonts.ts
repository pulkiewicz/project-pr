import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Font } from '@react-pdf/renderer'

/**
 * DejaVu Sans (pełne pokrycie polskich znaków). Pliki dołączane do bundla funkcji przez
 * `[functions] included_files` w netlify.toml; lokalnie z node_modules.
 */
function resolveFont(file: string): string {
  const rel = `dejavu-fonts-ttf/ttf/${file}`
  const candidates: string[] = []
  try {
    candidates.push(createRequire(import.meta.url).resolve(rel))
  } catch {
    // brak w ścieżce resolvera — spróbuj katalogu roboczego
  }
  candidates.push(join(process.cwd(), 'node_modules', rel))
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error(`Font not found: ${rel}`)
  return found
}

let registered = false
export function registerFonts() {
  if (registered) return
  Font.register({
    family: 'DejaVu',
    fonts: [
      { src: resolveFont('DejaVuSans.ttf') },
      { src: resolveFont('DejaVuSans-Bold.ttf'), fontWeight: 'bold' },
    ],
  })
  Font.registerHyphenationCallback((word) => [word])
  registered = true
}
