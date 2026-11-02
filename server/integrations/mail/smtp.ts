import { SignJWT, importPKCS8 } from 'jose'
import nodemailer from 'nodemailer'
import type { MailMessage, Mailer } from './types.ts'

/**
 * Logowanie do SMTP: hasło (np. hasło aplikacji) albo konto serwisowe Google z domain-wide delegation
 * (zakres `https://mail.google.com/`) — wysyłka w imieniu `user` bez hasła aplikacji.
 */
export type SmtpAuth = { kind: 'password'; pass: string } | { kind: 'google-service-account'; serviceEmail: string; privateKeyPem: string } | { kind: 'none' }

export interface SmtpConfig {
  host: string
  port: number
  /** Konto, na które logujemy się do SMTP (dla Google: główny adres, nie alias). */
  user?: string
  auth: SmtpAuth
  /** Nadawca, np. „Envcheck Hub <hub@envcheck.pl>”. */
  from: string
}

/** Token OAuth2 konta serwisowego działającego w imieniu użytkownika (JWT bearer z `sub`). */
async function googleAccessToken(fetchFn: typeof fetch, serviceEmail: string, privateKeyPem: string, user: string) {
  const key = await importPKCS8(privateKeyPem, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://mail.google.com/' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceEmail)
    .setSubject(user)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  // np. 401 unauthorized_client — brak delegowania w konsoli administratora Workspace.
  if (!res.ok) throw new Error(`Google token (SMTP): ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; expires_in: number }
  return { value: body.access_token, until: Date.now() + body.expires_in * 1000 }
}

/** SMTP przez nodemailer (np. skrzynka firmowa Google Workspace / Microsoft 365). Port 465 — TLS od razu, inne — STARTTLS. */
export class SmtpMailer implements Mailer {
  readonly fake = false
  private token: { value: string; until: number } | null = null

  constructor(
    private readonly config: SmtpConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Dane logowania dla nodemailera (token konta serwisowego odświeżany przed wygaśnięciem). */
  async auth() {
    const { auth, user } = this.config
    if (auth.kind === 'password') return { user, pass: auth.pass }
    if (auth.kind === 'google-service-account') {
      if (!user) throw new Error('SMTP_USER wymagany przy logowaniu kontem serwisowym')
      if (!this.token || this.token.until < Date.now() + 60_000) this.token = await googleAccessToken(this.fetchFn, auth.serviceEmail, auth.privateKeyPem, user)
      return { type: 'OAuth2' as const, user, accessToken: this.token.value }
    }
    return undefined
  }

  async send(message: MailMessage) {
    const { host, port, from } = this.config
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: await this.auth(),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
    // Każdy odbiorca osobno widzi tylko siebie (BCC), nadawca jako adresat jawny.
    await transport.sendMail({ from, to: from, bcc: message.to, subject: message.subject, text: message.text, html: message.html })
  }
}
