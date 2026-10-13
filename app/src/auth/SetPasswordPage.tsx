import { Alert, Anchor, Button, Group, PasswordInput, Stack, Text } from '@mantine/core'
import { acceptInvite, updateUser } from '@netlify/identity'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MIN_LENGTH as MIN_LENGTH } from '#shared'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'

/** Aktywacja konta z zaproszenia (`inviteToken`) albo ustawienie nowego hasła po linku resetującym. */
export function SetPasswordPage({ inviteToken }: { inviteToken?: string }) {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_LENGTH) return setError(t('auth.passwordTooShort'))
    if (password !== confirm) return setError(t('auth.passwordsMismatch'))
    setBusy(true)
    setError(null)
    try {
      if (inviteToken) await acceptInvite(inviteToken, password)
      else await updateUser({ password })
      window.history.replaceState(null, '', '/')
      await refresh()
    } catch {
      setError(t('auth.genericError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t(inviteToken ? 'auth.acceptInviteTitle' : 'auth.recoveryTitle')}>
      <form onSubmit={submit}>
        <Stack>
          {inviteToken && <Text size="sm">{t('auth.acceptInviteHint')}</Text>}
          {error && <Alert color="red">{error}</Alert>}
          <PasswordInput label={t('auth.newPassword')} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <PasswordInput label={t('auth.confirmPassword')} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          <Button type="submit" loading={busy} fullWidth>
            {t('auth.setPassword')}
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  )
}

/** Obowiązkowa zmiana hasła tymczasowego nadanego przez Admina (przed konfiguracją 2FA). */
export function ChangePasswordPage() {
  const { t } = useTranslation()
  const { refresh, logout } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_LENGTH) return setError(t('auth.passwordTooShort'))
    if (password !== confirm) return setError(t('auth.passwordsMismatch'))
    setBusy(true)
    setError(null)
    try {
      await api('/me/password', { method: 'POST', json: { newPassword: password } })
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.changePasswordTitle')}>
      <form onSubmit={submit}>
        <Stack>
          <Text size="sm">{t('auth.changePasswordHint')}</Text>
          {error && <Alert color="red">{error}</Alert>}
          <PasswordInput label={t('auth.newPassword')} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <PasswordInput label={t('auth.confirmPassword')} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          <Button type="submit" loading={busy} fullWidth>
            {t('auth.changePassword')}
          </Button>
          <Group justify="center">
            <Anchor component="button" type="button" size="sm" onClick={() => void logout()}>
              {t('app.logout')}
            </Anchor>
          </Group>
        </Stack>
      </form>
    </AuthLayout>
  )
}
