/**
 * Sprawdza, czy każdy pakiet w package-lock.json jest opublikowany co najmniej MIN_DAYS dni temu.
 * Build Netlify nie widzi zbyt świeżych wydań npm (ETARGET dla wersji sprzed kilku dni),
 * więc zależności dodawaj z odcięciem daty, np.:
 *   npm install <pakiet> --before=$(date -v-10d +%F)      # macOS
 *   npm install <pakiet> --before=$(date -d '-10 days' +%F) # Linux
 * Użycie: npm run deps:check-age [-- <MIN_DAYS>]
 */
import { readFileSync } from 'node:fs'

const MIN_DAYS = Number(process.argv[2] ?? 7)
const cutoff = new Date(Date.now() - MIN_DAYS * 86_400_000).toISOString()
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')).packages
const entries = [...new Set(
  Object.entries(lock)
    .filter(([k, v]) => k && v.version && !v.link)
    .map(([k, v]) => `${v.name ?? k.replace(/^.*node_modules\//, '')}@${v.version}`),
)]

const tooNew = []
let i = 0
async function worker() {
  while (i < entries.length) {
    const spec = entries[i++]
    const at = spec.lastIndexOf('@')
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1)
    const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, { headers: { accept: 'application/json' } })
    const time = (await res.json()).time?.[version]
    if (!time || time > cutoff) tooNew.push(`${spec} (${time?.slice(0, 10) ?? 'brak daty'})`)
  }
}
await Promise.all(Array.from({ length: 24 }, worker))

if (tooNew.length) {
  console.error(`Pakiety młodsze niż ${MIN_DAYS} dni (${tooNew.length}):\n  ${tooNew.sort().join('\n  ')}`)
  process.exit(1)
}
console.log(`OK: ${entries.length} pakietów, wszystkie starsze niż ${MIN_DAYS} dni.`)
