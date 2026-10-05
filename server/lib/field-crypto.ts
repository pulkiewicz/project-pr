import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

/**
 * Szyfrowanie pól AES-256-GCM z wersjonowaniem klucza (sekcja 5/M5, 4.1).
 *
 * Format klucza w env: `k2:<base64 32B>,k1:<base64 32B>` — pierwszy wpis to klucz aktywny,
 * kolejne służą tylko do odszyfrowania starszych rekordów (rotacja).
 * Format szyfrogramu: `<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>` — osobny IV na rekord.
 */
export interface Keyring {
  activeId: string
  keys: Map<string, Buffer>
}

export function parseKeyring(spec: string): Keyring {
  const keys = new Map<string, Buffer>()
  let activeId: string | undefined
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(':')
    if (idx <= 0) throw new Error('Invalid key spec: expected <id>:<base64>')
    const id = part.slice(0, idx)
    const key = Buffer.from(part.slice(idx + 1), 'base64')
    if (key.length !== 32) throw new Error(`Key ${id} must be 32 bytes`)
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid key id ${id}`)
    keys.set(id, key)
    activeId ??= id
  }
  if (!activeId) throw new Error('Empty keyring')
  return { activeId, keys }
}

export function encryptField(keyring: Keyring, plaintext: string): string {
  const key = keyring.keys.get(keyring.activeId)!
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [keyring.activeId, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.')
}

export function decryptField(keyring: Keyring, payload: string): string {
  const [keyId, iv, tag, ct] = payload.split('.')
  if (!keyId || !iv || !tag || ct === undefined) throw new Error('Malformed ciphertext')
  const key = keyring.keys.get(keyId)
  if (!key) throw new Error(`Unknown key id ${keyId}`)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

export function keyIdOf(payload: string): string {
  return payload.split('.', 1)[0]!
}

/** Deterministyczny HMAC-SHA256 do wyszukiwania po polach szyfrowanych (np. numer rejestracyjny). */
export function hmacField(hmacKey: Buffer, value: string): string {
  return createHmac('sha256', hmacKey).update(value).digest('hex')
}
