import type { IdentityVerifier } from './identity.ts'

/**
 * WYŁĄCZNIE do lokalnego `netlify dev` (Identity nie działa lokalnie).
 * Token: `dev.<base64url(JSON {sub,email})>`. Aktywowany tylko gdy NETLIFY_DEV=true i DEV_AUTH=1 — patrz runtime.ts.
 * 2FA, rola i uprawnienia nadal pochodzą z bazy.
 */
export const devIdentityVerifier: IdentityVerifier = {
  async verify(token) {
    if (!token.startsWith('dev.')) return null
    try {
      const { sub, email } = JSON.parse(Buffer.from(token.slice(4), 'base64url').toString('utf8')) as { sub?: string; email?: string }
      return sub && email ? { sub, email } : null
    } catch {
      return null
    }
  },
}
