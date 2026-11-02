import { devIdentityVerifier } from './auth/dev-identity.ts'
import { netlifyIdentityAdmin, netlifyIdentityVerifier, type IdentityVerifier } from './auth/identity.ts'
import type { AppDeps } from './context.ts'
import { getDb } from './db/client.ts'
import { ClaudeClient } from './integrations/ai/claude.ts'
import { FakeAiClient } from './integrations/ai/fake.ts'
import type { AiClient } from './integrations/ai/types.ts'
import { FakeDrive } from './integrations/drive/fake.ts'
import { GoogleDriveClient } from './integrations/drive/google.ts'
import type { DriveClient } from './integrations/drive/types.ts'
import { HttpInfaktClient } from './integrations/infakt/client.ts'
import { FakeInfaktClient } from './integrations/infakt/fake.ts'
import type { InfaktClient } from './integrations/infakt/types.ts'
import { FakeMailer } from './integrations/mail/fake.ts'
import { SmtpMailer, type SmtpAuth } from './integrations/mail/smtp.ts'
import type { Mailer } from './integrations/mail/types.ts'
import { requireEnv, env } from './lib/env.ts'
import { parseKeyring } from './lib/field-crypto.ts'

let deps: AppDeps | undefined

/** Logowanie deweloperskie: tylko pod `netlify dev` (NETLIFY_DEV ustawia wyłącznie CLI) i przy jawnym DEV_AUTH=1. */
function identityVerifier(): IdentityVerifier {
  if (env('NETLIFY_DEV') === 'true' && env('DEV_AUTH') === '1') {
    console.warn('[pmo] DEV_AUTH aktywne — logowanie deweloperskie (tylko lokalnie)')
    return devIdentityVerifier
  }
  return netlifyIdentityVerifier
}

const localDev = () => env('NETLIFY_DEV') === 'true'

/** Konto serwisowe Google: e-mail + klucz prywatny PEM (bez całego JSON — limit 4 KB na zmienne środowiskowe). */
function driveClient(): DriveClient | null {
  // Lokalnie atrapa na jawne żądanie ma pierwszeństwo (netlify dev wstrzykuje też zmienne z Netlify).
  // Jedna instancja na proces — API i funkcja w tle widzą te same pliki.
  if (localDev() && env('DEV_FAKE_DRIVE') === '1') return ((globalThis as { __pmoFakeDrive?: FakeDrive }).__pmoFakeDrive ??= new FakeDrive())
  const email = env('GOOGLE_SA_EMAIL')
  const key = env('GOOGLE_SA_PRIVATE_KEY')
  if (email && key) return new GoogleDriveClient(email, key.replace(/\\n/g, '\n'))
  return null
}

function aiClient(): AiClient | null {
  // Lokalnie atrapa (deterministyczne odpowiedzi, bez kosztów) na jawne żądanie ma pierwszeństwo przed kluczem.
  if (localDev() && env('DEV_FAKE_AI') === '1') return new FakeAiClient()
  const key = env('ANTHROPIC_API_KEY')
  if (key) return new ClaudeClient(key)
  return null
}

function infaktClient(): InfaktClient | null {
  // Lokalnie atrapa na jawne żądanie ma pierwszeństwo przed kluczem.
  if (localDev() && env('DEV_FAKE_INFAKT') === '1') return new FakeInfaktClient()
  const key = env('INFAKT_API_KEY')
  return key ? new HttpInfaktClient(key) : null
}

function mailer(): Mailer | null {
  // Lokalnie atrapa (wiadomości tylko w logu) na jawne żądanie ma pierwszeństwo przed SMTP.
  if (localDev() && env('DEV_FAKE_MAIL') === '1') return new FakeMailer(true)
  const host = env('SMTP_HOST')
  const from = env('MAIL_FROM') ?? env('SMTP_USER')
  if (!host || !from) return null
  // Hasło (np. hasło aplikacji) albo — bez hasła — konto serwisowe Google (to samo co Drive) z domain-wide delegation.
  const pass = env('SMTP_PASSWORD')
  const saEmail = env('GOOGLE_SA_EMAIL')
  const saKey = env('GOOGLE_SA_PRIVATE_KEY')
  const auth: SmtpAuth = pass
    ? { kind: 'password', pass }
    : saEmail && saKey
      ? { kind: 'google-service-account', serviceEmail: saEmail, privateKeyPem: saKey.replace(/\\n/g, '\n') }
      : { kind: 'none' }
  return new SmtpMailer({ host, port: Number(env('SMTP_PORT') ?? 587), user: env('SMTP_USER'), auth, from })
}

/** Adres aplikacji do linków w e-mailach; URL ustawia Netlify (główna domena serwisu). */
export const appUrl = () => env('APP_URL') ?? env('URL')

/** Zadanie AI wykonuje funkcja w tle (do 15 min) — tutaj tylko zlecenie z jednorazowym tokenem. */
async function dispatchJob(jobId: string, token: string, origin: string) {
  const res = await fetch(`${origin}/.netlify/functions/ai-job-background`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, token }),
  })
  if (res.status >= 400) throw new Error(`Nie udało się zlecić zadania AI (${res.status})`)
}

/** Zależności produkcyjne (sekrety z env Netlify oznaczonych jako secret). */
export function runtimeDeps(): AppDeps {
  deps ??= {
    db: getDb(),
    identity: identityVerifier(),
    identityAdmin: netlifyIdentityAdmin,
    config: {
      mfaSecret: new TextEncoder().encode(requireEnv('MFA_JWT_SECRET')),
      keyring: parseKeyring(requireEnv('FIELD_ENCRYPTION_KEY')),
      hmacKey: Buffer.from(requireEnv('FIELD_HMAC_KEY'), 'base64'),
      bootstrapAdminEmail: env('BOOTSTRAP_ADMIN_EMAIL'),
      secureCookies: env('NETLIFY_DEV') !== 'true',
      appUrl: appUrl(),
    },
    drive: driveClient(),
    ai: aiClient(),
    infakt: infaktClient(),
    mailer: mailer(),
    dispatchJob,
  }
  return deps
}
