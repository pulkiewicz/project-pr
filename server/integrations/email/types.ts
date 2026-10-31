export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

/** Wysyłka e-mail (spec. §3: abstrakcja `EmailSender`; decyzja 31.10.2026 — Resend). */
export interface EmailSender {
  readonly fake: boolean
  send(message: EmailMessage): Promise<void>
}

export class EmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
