export const ROLES = ['Admin', 'EnvcheckInternal', 'Arsanit', 'Client', 'Subcontractor'] as const
export type Role = (typeof ROLES)[number]

/** Role pracowników Envcheck — dostęp do wszystkich projektów i modułów sprzedaży. */
export const STAFF_ROLES = ['Admin', 'EnvcheckInternal'] as const satisfies readonly Role[]

/** Pracownik Envcheck; pozostałe role (Arsanit, Zamawiający, podwykonawcy) widzą tylko przypisane projekty. */
export function isStaffRole(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role)
}

/**
 * Strona projektu. Dla podwykonawcy: `Subcontractor:{id}`.
 * `Konsorcjum` — zadanie wspólne Envcheck i Arsanit (w HRF: „Envcheck / Arsanit”); edytują obie strony.
 */
export const BASE_PARTIES = ['Envcheck', 'Arsanit', 'Konsorcjum', 'Client'] as const
export type Party = (typeof BASE_PARTIES)[number] | `Subcontractor:${string}`

export function isParty(value: string): value is Party {
  return (BASE_PARTIES as readonly string[]).includes(value) || /^Subcontractor:[0-9a-f-]{36}$/i.test(value)
}

/** Domyślna strona dla roli (Admin i EnvcheckInternal to Envcheck). */
export function defaultPartyForRole(role: Role, subcontractorId?: string | null): Party {
  switch (role) {
    case 'Admin':
    case 'EnvcheckInternal':
      return 'Envcheck'
    case 'Arsanit':
      return 'Arsanit'
    case 'Client':
      return 'Client'
    case 'Subcontractor':
      if (!subcontractorId) throw new Error('Subcontractor requires subcontractorId')
      return `Subcontractor:${subcontractorId}`
  }
}
