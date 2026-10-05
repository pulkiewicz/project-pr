import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MFA_IDLE_SECONDS, MFA_MAX_SECONDS, shouldRefresh, signMfaSession, verifyMfaSession } from './mfa-session.ts'
import { consumeRecoveryCode, generateRecoveryCodes, hashRecoveryCode } from './totp.ts'

const secret = randomBytes(32)
const t0 = 1_800_000_000

describe('sesja 2FA (cookie pmo_mfa)', () => {
  it('wygasa po 8 h bezczynności', async () => {
    const { token } = await signMfaSession(secret, 'u1', t0, t0)
    expect(await verifyMfaSession(secret, token, t0 + MFA_IDLE_SECONDS - 1)).not.toBeNull()
    expect(await verifyMfaSession(secret, token, t0 + MFA_IDLE_SECONDS + 1)).toBeNull()
  })

  it('odświeżenie przesuwa okno bezczynności, ale nie dalej niż 12 h od weryfikacji', async () => {
    const t1 = t0 + 6 * 3600
    const { token, maxAge } = await signMfaSession(secret, 'u1', t0, t1)
    expect(maxAge).toBe(MFA_MAX_SECONDS - 6 * 3600) // 6 h, nie 8 h
    expect(await verifyMfaSession(secret, token, t0 + MFA_MAX_SECONDS + 1)).toBeNull()
  })

  it('odrzuca podpis innym sekretem', async () => {
    const { token } = await signMfaSession(secret, 'u1', t0, t0)
    expect(await verifyMfaSession(randomBytes(32), token, t0)).toBeNull()
  })

  it('odświeża dopiero po 5 min', async () => {
    const { token } = await signMfaSession(secret, 'u1', t0, t0)
    const s = (await verifyMfaSession(secret, token, t0 + 10))!
    expect(shouldRefresh(s, t0 + 10)).toBe(false)
    expect(shouldRefresh(s, t0 + 301)).toBe(true)
  })
})

describe('kody zapasowe', () => {
  it('generuje 10 unikalnych kodów, każdy jednorazowy', () => {
    const codes = generateRecoveryCodes()
    expect(new Set(codes).size).toBe(10)
    let hashes = codes.map(hashRecoveryCode)
    const after = consumeRecoveryCode(hashes, codes[3]!.toLowerCase())
    expect(after).toHaveLength(9)
    hashes = after!
    expect(consumeRecoveryCode(hashes, codes[3]!)).toBeNull()
  })
})
