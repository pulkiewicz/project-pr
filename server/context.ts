import type { Action, ModuleKey, Role } from '#shared'
import type { IdentityAdmin, IdentityClaims, IdentityVerifier } from './auth/identity.ts'
import type { Database } from './db/client.ts'
import type { users } from './db/schema.ts'
import type { Keyring } from './lib/field-crypto.ts'

export interface AppConfig {
  mfaSecret: Uint8Array
  keyring: Keyring
  /** Klucz HMAC-SHA256 do wyszukiwania po polach szyfrowanych (FIELD_HMAC_KEY). */
  hmacKey: Buffer
  /** E-mail pierwszego Admina — tworzony przy pierwszym logowaniu, jeśli w bazie nie ma żadnego Admina. */
  bootstrapAdminEmail?: string
  secureCookies: boolean
}

export interface AppDeps {
  db: Database
  identity: IdentityVerifier
  identityAdmin: IdentityAdmin
  config: AppConfig
  now?: () => Date
}

export type UserRow = typeof users.$inferSelect

export interface AppEnv {
  Variables: {
    deps: AppDeps
    identity: IdentityClaims
    user: UserRow
    mfa: { required: boolean; verified: boolean }
    permissions: Set<`${ModuleKey}:${Action}`>
  }
}

export interface RoutePolicy {
  method: string
  path: string
  /** `null` = endpoint dostępny dla każdego zalogowanego użytkownika (np. /me, /mfa/*). */
  permission: { module: ModuleKey; action: Action } | null
  mfaExempt: boolean
}

export type { Role }
