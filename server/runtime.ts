import { devIdentityVerifier } from './auth/dev-identity.ts'
import { netlifyIdentityAdmin, netlifyIdentityVerifier, type IdentityVerifier } from './auth/identity.ts'
import type { AppDeps } from './context.ts'
import { getDb } from './db/client.ts'
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
export function runtimeDeps(): AppDeps {
  deps ??= {
    db: getDb(),
    identity: identityVerifier(),
    identityAdmin: netlifyIdentityAdmin,
    config: {
      mfaSecret: new TextEncoder().encode(requireEnv('MFA_JWT_SECRET')),
      keyring: parseKeyring(requireEnv('FIELD_ENCRYPTION_KEY')),
      bootstrapAdminEmail: env('BOOTSTRAP_ADMIN_EMAIL'),
      secureCookies: env('NETLIFY_DEV') !== 'true',
    },
  }
  return deps
}
