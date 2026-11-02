import { exportPKCS8, generateKeyPair, decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'
import { SmtpMailer } from './smtp.ts'

const base = { host: 'smtp.gmail.com', port: 587, user: 'krzysztof@envcheck.test', from: 'Envcheck Hub <hub@envcheck.test>' }

describe('SmtpMailer: logowanie', () => {
  it('hasło (np. hasło aplikacji)', async () => {
    expect(await new SmtpMailer({ ...base, auth: { kind: 'password', pass: 'p' } }).auth()).toEqual({ user: base.user, pass: 'p' })
  })

  it('konto serwisowe Google: token w imieniu SMTP_USER z zakresem mail.google.com, odświeżany dopiero przed wygaśnięciem', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const pem = await exportPKCS8(privateKey)
    const assertions: string[] = []
    const fetchFn = (async (_url: string, init: RequestInit) => {
      assertions.push(new URLSearchParams(init.body as string).get('assertion')!)
      return new Response(JSON.stringify({ access_token: `tok${assertions.length}`, expires_in: 3600 }), { status: 200 })
    }) as unknown as typeof fetch
    const mailer = new SmtpMailer({ ...base, auth: { kind: 'google-service-account', serviceEmail: 'sa@proj.iam.gserviceaccount.com', privateKeyPem: pem } }, fetchFn)
    expect(await mailer.auth()).toEqual({ type: 'OAuth2', user: base.user, accessToken: 'tok1' })
    expect(await mailer.auth()).toMatchObject({ accessToken: 'tok1' })
    expect(assertions).toHaveLength(1)
    expect(decodeJwt(assertions[0]!)).toMatchObject({ iss: 'sa@proj.iam.gserviceaccount.com', sub: base.user, scope: 'https://mail.google.com/' })
  })

  it('brak delegowania w Workspace → czytelny błąd', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const fetchFn = (async () => new Response('{"error":"unauthorized_client"}', { status: 401 })) as unknown as typeof fetch
    const mailer = new SmtpMailer({ ...base, auth: { kind: 'google-service-account', serviceEmail: 'sa@x', privateKeyPem: await exportPKCS8(privateKey) } }, fetchFn)
    await expect(mailer.auth()).rejects.toThrow(/401 .*unauthorized_client/)
  })
})
