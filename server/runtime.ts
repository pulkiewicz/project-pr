import { devIdentityVerifier } from './auth/dev-identity.ts'
import { netlifyIdentityAdmin, netlifyIdentityVerifier, type IdentityVerifier } from './auth/identity.ts'
import type { AppDeps } from './context.ts'
import { getDb } from './db/client.ts'
import { FakeDrive } from './integrations/drive/fake.ts'
import { GoogleDriveClient } from './integrations/drive/google.ts'
import type { DriveClient } from './integrations/drive/types.ts'
import { requireEnv, env } from './lib/env.ts'
import { parseKeyring } from './lib/field-crypto.ts'

let deps: AppDeps | undefined

/** Logowanie deweloperskie: tylko pod `netlify dev` (NETLIFY_DEV ustawia wyłącznie CLI) i przy jawnym DEV_AUTH=1. */
function identityVerifier(): IdentityVerifier {
  if (env('NETLIFY_DEV') === 'true' && env('DEV_AUTH') === '1') {
    console.warn('[pmo] DEV_AUTH aktywne — logowanie deweloperskie (tylko lokalnie)')
    return devIdentityVerifier
  }
  return netlifyIdentityVerifier
}

/** Zależności produkcyjne (sekrety z env Netlify oznaczonych jako secret). */
/** Konto serwisowe Google: e-mail + klucz prywatny PEM (bez całego JSON — limit 4 KB na zmienne środowiskowe). */
function driveClient(): DriveClient | null {
  const email = env('GOOGLE_SA_EMAIL')
  const key = env('GOOGLE_SA_PRIVATE_KEY')
  if (email && key) return new GoogleDriveClient(email, key.replace(/\\n/g, '\n'))
  // Lokalnie bez Google: atrapa w pamięci (tylko pod netlify dev).
  if (env('NETLIFY_DEV') === 'true' && env('DEV_FAKE_DRIVE') === '1') return new FakeDrive()
  return null
}

export function runtimeDeps(): AppDeps {
  deps ??= {
    db: getDb(),
    identity: identityVerifier(),
    identityAdmin: netlifyIdentityAdmin,
    drive: driveClient(),
    config: {
      mfaSecret: new TextEncoder().encode(requireEnv('MFA_JWT_SECRET')),
      keyring: parseKeyring(requireEnv('FIELD_ENCRYPTION_KEY')),
      hmacKey: Buffer.from(requireEnv('FIELD_HMAC_KEY'), 'base64'),
      bootstrapAdminEmail: env('BOOTSTRAP_ADMIN_EMAIL'),
      secureCookies: env('NETLIFY_DEV') !== 'true',
    },
  }
  return deps
}
