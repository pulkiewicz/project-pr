/**
 * Generuje nowe sekrety produkcyjne i wypisuje polecenia `netlify env:set` (scope: functions, oznaczone jako secret).
 * Uruchom w katalogu połączonym z projektem (`netlify link`). Wartości NIE są zapisywane na dysku.
 * Użycie: npm run secrets:generate -- <email-pierwszego-admina>
 */
import { randomBytes } from 'node:crypto'

const adminEmail = process.argv[2]
if (!adminEmail) {
  console.error('Podaj e-mail pierwszego Administratora: npm run secrets:generate -- jan@firma.pl')
  process.exit(1)
}
const secrets = {
  MFA_JWT_SECRET: randomBytes(48).toString('base64'),
  FIELD_ENCRYPTION_KEY: `k1:${randomBytes(32).toString('base64')}`,
  FIELD_HMAC_KEY: randomBytes(32).toString('base64'),
  JOB_SECRET: randomBytes(32).toString('hex'),
}
console.log('# Skopiuj i uruchom (wartości pokazywane tylko raz). FIELD_ENCRYPTION_KEY przechowaj także w sejfie haseł —')
console.log('# bez niego zaszyfrowanych pól (sekrety 2FA, dane awizacji) nie da się odczytać.\n')
for (const [k, v] of Object.entries(secrets)) {
  console.log(`netlify env:set ${k} '${v}' --secret --scope functions`)
}
console.log(`netlify env:set BOOTSTRAP_ADMIN_EMAIL '${adminEmail}' --scope functions`)
