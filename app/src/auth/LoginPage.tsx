import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { login, requestPasswordRecovery } from '@netlify/identity'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'
import { devAuthEnabled, devLogin } from './devAuth'

export function LoginPage({ deniedCode }: { deniedCode?: string }) {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    deniedCode ? t(deniedCode === 'user_inactive' ? 'auth.inactive' : 'auth.notRegistered') : null,
  )
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(email, password)
        await refresh()
      } else {
        await requestPasswordRecovery(email).catch(() => undefined)
        setInfo(t('auth.recoverySent'))
      }
    } catch {
      setError(t('auth.invalidCredentials'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.loginTitle')}>
      <form onSubmit={submit}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          {info && <Alert color="green">{info}</Alert>}
          <TextInput label={t('auth.email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          {mode === 'login' && (
            <PasswordInput label={t('auth.password')} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          )}
          <Button type="submit" loading={busy} fullWidth>
            {mode === 'login' ? t('auth.login') : t('auth.sendRecovery')}
          </Button>
          <Anchor component="button" type="button" size="sm" onClick={() => setMode(mode === 'login' ? 'recover' : 'login')}>
            {mode === 'login' ? t('auth.forgotPassword') : t('auth.backToLogin')}
          </Anchor>
          <Text size="xs" c="dimmed" ta="center">
            {t('auth.inviteOnly')}
          </Text>
          {devAuthEnabled && (
            <Button
              variant="outline"
              color="orange"
              data-testid="dev-login"
              disabled={!email}
              onClick={() => {
                devLogin(email)
                void refresh()
              }}
            >
              DEV: zaloguj bez Identity
            </Button>
          )}
        </Stack>
      </form>
    </AuthLayout>
  )
}
