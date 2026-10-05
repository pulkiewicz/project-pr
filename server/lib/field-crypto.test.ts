import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptField, encryptField, hmacField, keyIdOf, parseKeyring } from './field-crypto.ts'

const key = () => randomBytes(32).toString('base64')

describe('field crypto (AES-256-GCM)', () => {
  it('szyfruje i odszyfrowuje, z osobnym IV na rekord', () => {
    const kr = parseKeyring(`k1:${key()}`)
    const a = encryptField(kr, 'ABC 123456')
    const b = encryptField(kr, 'ABC 123456')
    expect(a).not.toBe(b)
    expect(decryptField(kr, a)).toBe('ABC 123456')
    expect(keyIdOf(a)).toBe('k1')
  })

  it('obsługuje rotację: nowy klucz aktywny, stary nadal odszyfrowuje', () => {
    const k1 = key()
    const old = parseKeyring(`k1:${k1}`)
    const ct = encryptField(old, 'WX 12345')
    const rotated = parseKeyring(`k2:${key()},k1:${k1}`)
    expect(decryptField(rotated, ct)).toBe('WX 12345')
    expect(keyIdOf(encryptField(rotated, 'x'))).toBe('k2')
  })

  it('wykrywa manipulację szyfrogramem', () => {
    const kr = parseKeyring(`k1:${key()}`)
    const [id, iv, tag, ct] = encryptField(kr, 'secret').split('.')
    const tampered = [id, iv, tag, Buffer.from('zzzzzz').toString('base64url') + ct].join('.')
    expect(() => decryptField(kr, tampered)).toThrow()
  })

  it('odrzuca klucz o złej długości', () => {
    expect(() => parseKeyring(`k1:${randomBytes(16).toString('base64')}`)).toThrow()
  })

  it('HMAC jest deterministyczny', () => {
    const k = randomBytes(32)
    expect(hmacField(k, 'WX12345')).toBe(hmacField(k, 'WX12345'))
    expect(hmacField(k, 'WX12345')).not.toBe(hmacField(k, 'WX12346'))
  })
})
