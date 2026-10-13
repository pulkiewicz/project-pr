import { createHash } from 'node:crypto'
import { getIdentityConfig } from '@netlify/identity'
import { decodeJwt } from 'jose'

export interface IdentityClaims {
  sub: string
  email: string
}

/** Weryfikacja tokenu Identity (Bearer) — abstrakcja, by testy mogły podstawić fałszywą implementację. */
export interface IdentityVerifier {
  /** `origin` żądania — zapasowe źródło adresu Identity, gdy runtime go nie udostępnia. */
  verify(token: string, origin?: string): Promise<IdentityClaims | null>
}

/** Operacje administracyjne Identity (wyłącznie w runtime Netlify Functions). */
export interface IdentityAdmin {
  invite(email: string, name: string): Promise<void>
  /**
   * Konto Identity potwierdzone od razu (bez e-maila) z podanym hasłem.
   * Gdy konto o tym e-mailu już istnieje — ustawia mu to hasło. Zwraca `sub`.
   */
  upsertWithPassword(email: string, name: string, password: string): Promise<string>
  /** Zmiana własnego hasła tokenem użytkownika (GoTrue `PUT /user`). */
  changeOwnPassword(token: string, password: string, origin?: string): Promise<void>
}

/** Błąd GoTrue z kodem HTTP — 422 zwykle oznacza odrzucone hasło lub istniejące konto. */
export class IdentityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { claims: IdentityClaims; until: number }>()

declare global {
  // Ustawiane przez runtime Netlify Functions; `user` to zweryfikowane przez platformę claims z nagłówka Bearer.
  var netlifyIdentityContext: { url?: string; token?: string; user?: { sub?: string; email?: string } } | undefined
}

/**
 * Implementacja produkcyjna.
 * 1. Jeśli runtime Netlify już zweryfikował Bearer (netlifyIdentityContext.user) i `sub` się zgadza — akceptuj.
 * 2. W przeciwnym razie zweryfikuj token wywołaniem GET {identity}/user (autorytatywne sprawdzenie przez GoTrue).
 * Wynik buforowany w pamięci instancji maks. 60 s (nigdy dłużej niż `exp` tokenu).
 */
export const netlifyIdentityVerifier: IdentityVerifier = {
  async verify(token, origin) {
    let exp: number | undefined
    let sub: string | undefined
    try {
      const payload = decodeJwt(token)
      exp = payload.exp
      sub = payload.sub
    } catch {
      return null
    }
    const nowSec = Date.now() / 1000
    if (!sub || !exp || exp <= nowSec) return null

    const key = createHash('sha256').update(token).digest('base64url')
    const hit = cache.get(key)
    if (hit && hit.until > Date.now()) return hit.claims

    const runtimeUser = globalThis.netlifyIdentityContext?.user
    let claims: IdentityClaims
    if (runtimeUser?.sub && runtimeUser.sub === sub && runtimeUser.email) {
      claims = { sub, email: runtimeUser.email }
    } else {
      const identityUrl = getIdentityConfig()?.url ?? (origin ? `${origin}/.netlify/identity` : null)
      if (!identityUrl) return null
      const res = await fetch(`${identityUrl}/user`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return null
      const body = (await res.json()) as { id?: string; email?: string }
      if (!body.id || body.id !== sub || !body.email) return null
      claims = { sub: body.id, email: body.email }
    }
    cache.set(key, { claims, until: Math.min(Date.now() + CACHE_TTL_MS, exp * 1000) })
    return claims
  },
}

/**
 * Zaproszenie przez endpoint GoTrue `/invite` z tokenem operatora z runtime Functions.
 * `@netlify/identity` nie udostępnia funkcji zaproszeń (stan na v2.0.0), stąd bezpośrednie wywołanie
 * z konfiguracją zwróconą przez udokumentowane `getIdentityConfig()`.
 */
function operator() {
  const cfg = getIdentityConfig()
  if (!cfg?.url || !cfg.token) throw new Error('Identity operator token unavailable (only in Netlify Functions)')
  return { url: cfg.url, token: cfg.token }
}

async function gotrue<T>(what: string, url: string, token: string, method: string, payload?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { msg?: string; error_description?: string }
    throw new IdentityError(res.status, `Identity ${what} failed (${res.status}): ${body.msg ?? body.error_description ?? 'unknown'}`)
  }
  return (await res.json().catch(() => ({}))) as T
}

interface GoTrueUser {
  id: string
  email: string
}

/** Wyszukiwanie konta po e-mailu (`filter` GoTrue dopasowuje fragment — tu porównujemy dokładnie). */
async function findByEmail(url: string, token: string, email: string): Promise<string | null> {
  const wanted = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const q = new URLSearchParams({ filter: email, page: String(page), per_page: '100' })
    const body = await gotrue<{ users?: GoTrueUser[] }>('user lookup', `${url}/admin/users?${q}`, token, 'GET')
    const users = body.users ?? []
    const hit = users.find((u) => u.email.toLowerCase() === wanted)
    if (hit) return hit.id
    if (users.length < 100) return null
  }
  return null
}

export const netlifyIdentityAdmin: IdentityAdmin = {
  async invite(email, name) {
    const { url, token } = operator()
    await gotrue('invite', `${url}/invite`, token, 'POST', { email, data: { full_name: name } })
  },

  async upsertWithPassword(email, name, password) {
    const { url, token } = operator()
    try {
      const created = await gotrue<GoTrueUser>('create user', `${url}/admin/users`, token, 'POST', {
        email,
        password,
        confirm: true,
        user_metadata: { full_name: name },
      })
      return created.id
    } catch (e) {
      if (!(e instanceof IdentityError) || e.status !== 422) throw e
      // Konto już istnieje (np. po wcześniejszym zaproszeniu) — nadpisujemy hasło i potwierdzamy e-mail.
      const sub = await findByEmail(url, token, email)
      if (!sub) throw e
      await gotrue('set password', `${url}/admin/users/${sub}`, token, 'PUT', { password, confirm: true })
      return sub
    }
  },

  async changeOwnPassword(userToken, password, origin) {
    const url = getIdentityConfig()?.url ?? (origin ? `${origin}/.netlify/identity` : null)
    if (!url) throw new Error('Identity URL unavailable')
    await gotrue('password change', `${url}/user`, userToken, 'PUT', { password })
  },
}
