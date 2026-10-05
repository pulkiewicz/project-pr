/** Logowanie deweloperskie (tylko `vite dev` + backend z DEV_AUTH=1). W buildzie produkcyjnym `DEV` = false → kod usuwany. */
const KEY = 'pmo_dev_token'

export const devAuthEnabled = import.meta.env.DEV

export function devToken(): string | null {
  if (!devAuthEnabled) return null
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function devLogin(email: string) {
  const payload = btoa(JSON.stringify({ sub: `dev-${email.toLowerCase()}`, email })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  sessionStorage.setItem(KEY, `dev.${payload}`)
}

export function devLogout() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
