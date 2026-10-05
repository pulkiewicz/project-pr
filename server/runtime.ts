import { netlifyIdentityAdmin, netlifyIdentityVerifier } from './auth/identity.ts'
import type { AppDeps } from './context.ts'
import { getDb } from './db/client.ts'
import { requireEnv, env } from './lib/env.ts'
import { parseKeyring } from './lib/field-crypto.ts'

let deps: AppDeps | undefined

/** Zależności produkcyjne (sekrety z env Netlify oznaczonych jako secret). */
export function runtimeDeps(): AppDeps {
  deps ??= {
    db: getDb(),
    identity: netlifyIdentityVerifier,
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
