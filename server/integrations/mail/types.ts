export interface MailMessage {
  to: string[]
  subject: string
  text: string
  html?: string
}

/** Wysyłka e-maili z aplikacji (powiadomienia); nadawca ustawiony w implementacji. */
export interface Mailer {
  readonly fake: boolean
  send(message: MailMessage): Promise<void>
}
