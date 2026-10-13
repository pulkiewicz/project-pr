import type { PermissionSet } from './permissions.ts'
import type { Party, Role } from './roles.ts'

export interface ProjectSummary {
  id: string
  name: string
  client: string
  contractNo: string
  procurementNo: string
  contractEndDate: string // yyyy-MM-dd
  dayZeroDate: string | null
}

export interface MeResponse {
  user: {
    id: string
    email: string
    name: string
    role: Role
    party: Party
    /** Hasło tymczasowe — przed dalszą pracą użytkownik musi ustawić własne. */
    mustChangePassword: boolean
  }
  mfa: {
    required: boolean
    enrolled: boolean
    verified: boolean
  }
  /** Uprawnienia są puste, dopóki sesja nie przejdzie 2FA (jeśli wymagane). */
  permissions: PermissionSet
  projects: ProjectSummary[]
}

export interface MfaSetupResponse {
  otpauthUrl: string
  qrDataUrl: string
  manualKey: string
}

export interface MfaEnableResponse {
  recoveryCodes: string[]
}

export interface UserDto {
  id: string
  email: string
  name: string
  role: Role
  party: Party
  subcontractorId: string | null
  isActive: boolean
  totpEnabled: boolean
  invitedAt: string | null
  lastLoginAt: string | null
  identityLinked: boolean
  mustChangePassword: boolean
  version: number
}

export interface AuditEntryDto {
  id: string
  ts: string
  userId: string | null
  userEmail: string | null
  ip: string | null
  userAgent: string | null
  action: string
  entity: string | null
  entityId: string | null
  changes: unknown
  projectId: string | null
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** RFC 7807 */
export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail?: string
  code?: string
  [key: string]: unknown
}

/** Wynik zaproszenia Identity przy dodawaniu użytkownika (rekord w aplikacji powstaje niezależnie). */
export type InviteStatus = 'password_set' | 'sent' | 'exists' | 'skipped' | 'failed'
export interface UserCreatedResponse extends UserDto {
  inviteStatus: InviteStatus
  inviteError: string | null
  /** Hasło tymczasowe — zwracane tylko raz (nie jest nigdzie zapisywane). */
  initialPassword: string | null
}

export interface TempPasswordResponse {
  user: UserDto
  password: string
}
