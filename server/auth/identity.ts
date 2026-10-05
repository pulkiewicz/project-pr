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
export const netlifyIdentityAdmin: IdentityAdmin = {
  async invite(email, name) {
    const cfg = getIdentityConfig()
    if (!cfg?.url || !cfg.token) throw new Error('Identity operator token unavailable (only in Netlify Functions)')
    const res = await fetch(`${cfg.url}/invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, data: { full_name: name } }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { msg?: string }
      throw new Error(`Identity invite failed (${res.status}): ${body.msg ?? 'unknown'}`)
    }
  },
}
