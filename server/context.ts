import type { Action, ModuleKey, Role } from '#shared'
import type { IdentityAdmin, IdentityClaims, IdentityVerifier } from './auth/identity.ts'
import type { Database } from './db/client.ts'
import type { AiClient } from './integrations/ai/types.ts'
import type { DriveClient } from './integrations/drive/types.ts'
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
  /** Zewnętrzne HTTP (np. biała lista VAT); w testach atrapa. */
  fetch?: typeof fetch
  /** Google Shared Drive (konto serwisowe); null = nieskonfigurowany. Lokalnie i w testach — atrapa. */
  drive?: DriveClient | null
  /** Claude (ANTHROPIC_API_KEY); null = AI wyłączone. Lokalnie i w testach — atrapa. */
  ai?: AiClient | null
  /** Zlecenie zadania AI do wykonania w tle (funkcja background); w testach wykonanie od razu. */
  dispatchJob?: (jobId: string, token: string, origin: string) => Promise<void>
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
