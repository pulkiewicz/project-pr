import { randomInt } from 'node:crypto'

// Bez znaków mylących przy przepisywaniu (0/O, 1/l/I).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Hasło tymczasowe w grupach po 4 znaki, np. `k7Pq-x2Mn-...` (~93 bity entropii). */
export function generateTempPassword(groups = 4): string {
  const parts: string[] = []
  for (let g = 0; g < groups; g++) {
    let part = ''
    for (let i = 0; i < 4; i++) part += ALPHABET[randomInt(ALPHABET.length)]
    parts.push(part)
  }
  return parts.join('-')
}
