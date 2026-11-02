import nodemailer, { type Transporter } from 'nodemailer'
import type { MailMessage, Mailer } from './types.ts'

export interface SmtpConfig {
  host: string
  port: number
  user?: string
  pass?: string
  /** Nadawca, np. „Envcheck Hub <hub@envcheck.pl>”. */
  from: string
}

/** SMTP przez nodemailer (np. skrzynka firmowa Microsoft 365 / Google Workspace). Port 465 — TLS od razu, inne — STARTTLS. */
export class SmtpMailer implements Mailer {
  readonly fake = false
  private readonly transport: Transporter

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  }

  async send(message: MailMessage) {
    // Każdy odbiorca osobno widzi tylko siebie (BCC), nadawca jako adresat jawny.
    await this.transport.sendMail({ from: this.config.from, to: this.config.from, bcc: message.to, subject: message.subject, text: message.text, html: message.html })
  }
}
