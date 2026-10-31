import { EmailError, type EmailMessage, type EmailSender } from './types.ts'

const ENDPOINT = 'https://api.resend.com/emails'

/** Resend REST API (bez SDK). `from` — zweryfikowana domena nadawcy, np. „Envcheck PMO <pmo@envcheck.pl>”. */
export class ResendEmailSender implements EmailSender {
  readonly fake = false

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(m: EmailMessage) {
    let res: Response
    try {
      res = await this.fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
        signal: AbortSignal.timeout(10000),
      })
    } catch (e) {
      throw new EmailError(0, e instanceof Error ? e.message : String(e))
    }
    if (!res.ok) throw new EmailError(res.status, `Resend HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  }
}
