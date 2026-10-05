import { Alert, Button, PasswordInput, Stack, Text } from '@mantine/core'
import { acceptInvite, updateUser } from '@netlify/identity'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'

const MIN_LENGTH = 12

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
