import type { MailMessage, Mailer } from './types.ts'

/** Atrapa poczty (testy i lokalny dev): zapamiętuje wysłane wiadomości. */
export class FakeMailer implements Mailer {
  readonly fake = true
  sent: MailMessage[] = []
  fail = false

  /** `log` — wypisuje wiadomości na konsolę (lokalny dev, DEV_FAKE_MAIL=1). */
  constructor(private readonly log = false) {}

  async send(message: MailMessage) {
    if (this.fail) throw new Error('smtp down')
    if (this.log) console.log(`[pmo] DEV_FAKE_MAIL → ${message.to.join(', ')}: ${message.subject}\n${message.text}`)
    this.sent.push(structuredClone(message))
  }
}
