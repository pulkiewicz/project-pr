import type { EmailMessage, EmailSender } from './types.ts'

/** Atrapa (testy i lokalny dev): wiadomości zostają w pamięci i w logu, nic nie wychodzi na zewnątrz. */
export class FakeEmailSender implements EmailSender {
  readonly fake = true
  sent: EmailMessage[] = []
  /** Adresy, dla których wysyłka ma się nie udać (test obsługi błędów). */
  failFor = new Set<string>()

  async send(m: EmailMessage) {
    if (this.failFor.has(m.to)) throw new Error(`fake email failure for ${m.to}`)
    this.sent.push(m)
    console.log(`[pmo] e-mail (atrapa) → ${m.to}: ${m.subject}`)
  }
}
