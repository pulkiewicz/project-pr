/**
 * „Zapamiętaj mnie”.
 * - zaznaczone: sesja Identity (localStorage) i cookie 2FA przetrwają zamknięcie przeglądarki; e-mail podpowiadany przy logowaniu,
 * - odznaczone: sesyjne cookie-znacznik `pmo_alive`; po ponownym uruchomieniu przeglądarki brak znacznika → wylogowanie.
 */
const KEY = 'pmo_remember'
const EMAIL = 'pmo_last_email'
const ALIVE = 'pmo_alive'

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const rememberPreference = () => safe(() => localStorage.getItem(KEY) !== '0', true)
export const rememberedEmail = () => safe(() => localStorage.getItem(EMAIL) ?? '', '')

export function setRemember(remember: boolean, email: string) {
  safe(() => {
    localStorage.setItem(KEY, remember ? '1' : '0')
    if (remember) localStorage.setItem(EMAIL, email)
    else localStorage.removeItem(EMAIL)
  }, undefined)
  // Cookie bez daty wygaśnięcia = sesyjne (usuwane po zamknięciu przeglądarki), wspólne dla kart.
  document.cookie = `${ALIVE}=1; path=/; secure; samesite=strict`
}

/** true, gdy użytkownik nie chciał być zapamiętany, a przeglądarka została zamknięta od ostatniego logowania. */
export function sessionShouldEnd(): boolean {
  return !rememberPreference() && !/(?:^|; )pmo_alive=1/.test(document.cookie)
}
