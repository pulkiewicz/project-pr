import { SignJWT, jwtVerify } from 'jose'

export const MFA_COOKIE = 'pmo_mfa'
export const MFA_IDLE_SECONDS = 8 * 3600
export const MFA_MAX_SECONDS = 12 * 3600
/** Odświeżaj cookie (przesuwne okno bezczynności) najwyżej co 5 min. */
const REFRESH_AFTER_SECONDS = 300

export interface MfaSession {
  sub: string
  authTime: number
  issuedAt: number
  /** false = cookie sesyjne (bez Max-Age) — „Zapamiętaj mnie” odznaczone. */
  remember: boolean
}

/**
 * Cookie `pmo_mfa`: JWT HS256 z `sub` (Identity), `auth_time` (chwila weryfikacji 2FA) i `exp`
 * = min(teraz + 8 h bezczynności, auth_time + 12 h).
 */
export async function signMfaSession(secret: Uint8Array, sub: string, authTime: number, nowSec: number, remember = true) {
  const exp = Math.min(nowSec + MFA_IDLE_SECONDS, authTime + MFA_MAX_SECONDS)
  const token = await new SignJWT({ auth_time: authTime, rem: remember })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .setAudience('pmo-mfa')
    .sign(secret)
  return { token, maxAge: exp - nowSec, remember }
}

export async function verifyMfaSession(secret: Uint8Array, token: string, nowSec: number): Promise<MfaSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      audience: 'pmo-mfa',
      currentDate: new Date(nowSec * 1000),
    })
    const authTime = payload.auth_time
    if (typeof payload.sub !== 'string' || typeof authTime !== 'number' || typeof payload.iat !== 'number') return null
    if (nowSec - authTime > MFA_MAX_SECONDS) return null
    return { sub: payload.sub, authTime, issuedAt: payload.iat, remember: payload.rem !== false }
  } catch {
    return null
  }
}

export function shouldRefresh(session: MfaSession, nowSec: number) {
  return nowSec - session.issuedAt >= REFRESH_AFTER_SECONDS && session.authTime + MFA_MAX_SECONDS > nowSec
}

/** Ważność i tak wymusza `exp` w JWT; przy `remember=false` cookie znika po zamknięciu przeglądarki. */
export function mfaCookieHeader(token: string, maxAge: number, secure: boolean, remember = true) {
  return `${MFA_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict${remember ? `; Max-Age=${maxAge}` : ''}${secure ? '; Secure' : ''}`
}

export function clearMfaCookieHeader(secure: boolean) {
  return `${MFA_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}
