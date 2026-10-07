import { Alert, Anchor, Button, Code, CopyButton, Group, Image, PinInput, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MfaEnableResponse, MfaSetupResponse } from '#shared'
import { ApiError, api } from '../lib/api'
import { AuthLayout } from './AuthLayout'
import { rememberPreference } from './remember'
import { useAuth } from './AuthProvider'

function useErrorText() {
  const { t } = useTranslation()
  return (e: unknown) => {
    if (e instanceof ApiError && e.code === 'mfa_locked') {
      const seconds = Number(e.problem.retryAfter ?? 900)
      return t('mfa.locked', { minutes: Math.ceil(seconds / 60) })
    }
    if (e instanceof ApiError && (e.code === 'mfa_invalid_code' || e.code === 'validation_failed')) return t('mfa.invalidCode')
    return t('auth.genericError')
  }
}

export function MfaSetupPage() {
  const { t } = useTranslation()
  const { refresh, logout } = useAuth()
  const errorText = useErrorText()
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Jednokrotne wywołanie (StrictMode uruchamia efekty dwukrotnie — drugi sekret unieważniłby pokazany QR).
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api<MfaSetupResponse>('/mfa/setup', { method: 'POST' }).then(setSetup, (e) => setError(errorText(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api<MfaEnableResponse>('/mfa/enable', { method: 'POST', json: { code, remember: rememberPreference() } })
      setCodes(res.recoveryCodes)
    } catch (e) {
      setError(errorText(e))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (codes) {
    return (
      <AuthLayout title={t('mfa.recoveryTitle')}>
        <Text size="sm">{t('mfa.recoveryHint')}</Text>
        <SimpleGrid cols={2} spacing="xs">
          {codes.map((c) => (
            <Code key={c} ta="center" fz="md">
              {c}
            </Code>
          ))}
        </SimpleGrid>
        <CopyButton value={codes.join('\n')}>
          {({ copied, copy }) => (
            <Button variant="light" onClick={copy}>
              {copied ? t('mfa.copied') : t('mfa.copy')}
            </Button>
          )}
        </CopyButton>
        <Button onClick={() => void refresh()}>{t('mfa.recoverySaved')}</Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('mfa.setupTitle')}>
      <Text size="sm">{t('mfa.setupHint')}</Text>
      {error && <Alert color="red">{error}</Alert>}
      {setup && (
        <Stack align="center" gap="xs">
          <Image src={setup.qrDataUrl} w={200} h={200} alt="QR" />
          <Text size="xs" c="dimmed">
            {t('mfa.manualKey')}
          </Text>
          <Code fz="sm">{setup.manualKey}</Code>
        </Stack>
      )}
      <Stack gap={4} align="center">
        <Text size="sm">{t('mfa.code')}</Text>
        <PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} onComplete={() => undefined} />
      </Stack>
      <Button onClick={enable} loading={busy} disabled={code.length !== 6 || !setup}>
        {t('mfa.confirm')}
      </Button>
      <Anchor component="button" size="sm" onClick={() => void logout()}>
        {t('app.logout')}
      </Anchor>
    </AuthLayout>
  )
}

export function MfaVerifyPage() {
  const { t } = useTranslation()
  const { refresh, logout } = useAuth()
  const errorText = useErrorText()
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const verify = async (value?: string) => {
    setBusy(true)
    setError(null)
    try {
      await api('/mfa/verify', { method: 'POST', json: { ...(useRecovery ? { recoveryCode } : { code: value ?? code }), remember: rememberPreference() } })
      await refresh()
    } catch (e) {
      setError(errorText(e))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('mfa.verifyTitle')}>
      {error && <Alert color="red">{error}</Alert>}
      {useRecovery ? (
        <TextInput label={t('mfa.recoveryCode')} value={recoveryCode} onChange={(e) => setRecoveryCode(e.currentTarget.value)} autoComplete="one-time-code" />
      ) : (
        <Stack gap={4} align="center">
          <Text size="sm">{t('mfa.verifyHint')}</Text>
          <PinInput length={6} type="number" oneTimeCode autoFocus value={code} onChange={setCode} onComplete={(v) => void verify(v)} />
        </Stack>
      )}
      <Button onClick={() => void verify()} loading={busy} disabled={useRecovery ? !recoveryCode : code.length !== 6}>
        {t('mfa.confirm')}
      </Button>
      <Group justify="space-between">
        <Anchor component="button" size="sm" onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? t('mfa.useTotp') : t('mfa.useRecovery')}
        </Anchor>
        <Anchor component="button" size="sm" onClick={() => void logout()}>
          {t('app.logout')}
        </Anchor>
      </Group>
    </AuthLayout>
  )
}
