import { Button, Card, Checkbox, Group, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Role } from '#shared'
import { api } from '../../lib/api'
import { AvizationSettingsCard } from '../../features/avizations/AvizationSettingsCard'
import { errorMessage } from '../../lib/errors'

export function SettingsPage() {
  const { t } = useTranslation()
  const mfa = useQuery({ queryKey: ['admin', 'settings', 'mfa'], queryFn: () => api<{ requiredRoles: Role[]; allRoles: Role[] }>('/admin/settings/mfa') })
  const [roles, setRoles] = useState<string[]>([])
  useEffect(() => {
    if (mfa.data) setRoles(mfa.data.requiredRoles)
  }, [mfa.data])

  const save = useMutation({
    mutationFn: () => api('/admin/settings/mfa', { method: 'PUT', json: { requiredRoles: roles } }),
    onSuccess: () => notifications.show({ color: 'green', message: t('app.saved') }),
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
  })

  return (
    <Stack>
      <Title order={2}>{t('settings.title')}</Title>
      <Card withBorder maw={520}>
        <Stack>
          <Text fw={600}>{t('settings.mfaPolicy')}</Text>
          <Text size="sm" c="dimmed">
            {t('settings.mfaPolicyHint')}
          </Text>
          <Checkbox.Group value={roles} onChange={setRoles}>
            <Stack gap="xs">
              {mfa.data?.allRoles.map((r) => <Checkbox key={r} value={r} label={t(`roles.${r}`)} />)}
            </Stack>
          </Checkbox.Group>
          <Group justify="flex-end">
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              {t('app.save')}
            </Button>
          </Group>
        </Stack>
      </Card>
      <AvizationSettingsCard />
    </Stack>
  )
}
