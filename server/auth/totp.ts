import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { generateSecret, generateURI, verify } from 'otplib'
import QRCode from 'qrcode'

const ISSUER = 'Envcheck PMO'

export function newTotpSecret(): string {
  return generateSecret()
}

export async function totpEnrollment(secret: string, label: string) {
  const otpauthUrl = generateURI({ issuer: ISSUER, label, secret })
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 })
  return { otpauthUrl, qrDataUrl, manualKey: secret.replace(/(.{4})/g, '$1 ').trim() }
}

/** Weryfikacja kodu z tolerancją ±1 krok (30 s) na rozjazd zegarów. */
export async function verifyTotp(secret: string, token: string, at: Date = new Date()): Promise<boolean> {
  const result = await verify({ secret, token, epoch: Math.floor(at.getTime() / 1000), epochTolerance: 30 })
  return result.valid
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // bez 0/O/1/I

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10)
    const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
    return `${chars.slice(0, 5)}-${chars.slice(5)}`
  })
}

const normalize = (code: string) => code.trim().toUpperCase()

/** Kody zapasowe mają ~50 bitów entropii i są jednorazowe — SHA-256 jest wystarczający. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalize(code)).digest('hex')
}

/** Zwraca listę hashy bez zużytego kodu albo null, jeśli kod nie pasuje. */
export function consumeRecoveryCode(hashes: string[], code: string): string[] | null {
  const candidate = Buffer.from(hashRecoveryCode(code), 'hex')
  const idx = hashes.findIndex((h) => {
    const buf = Buffer.from(h, 'hex')
    return buf.length === candidate.length && timingSafeEqual(buf, candidate)
  })
  if (idx < 0) return null
  return hashes.filter((_, i) => i !== idx)
}
