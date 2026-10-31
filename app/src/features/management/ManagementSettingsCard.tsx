import { Button, Card, Group, MultiSelect, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useManagementSettings, useSaveManagementSettings } from './api'

/** Ustawienia Zarządu (Admin): kto widzi moduły Pojazdy i Pracownicy. */
export function ManagementSettingsCard() {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const q = useManagementSettings()
  const save = useSaveManagementSettings()
  const [userIds, setUserIds] = useState<string[] | null>(null)
  useEffect(() => {
    if (q.data) setUserIds(q.data.settings.userIds)
  }, [q.data])
  if (!userIds || !q.data) return null
  return (
    <Card withBorder maw={520}>
      <Stack>
        <Text fw={600}>{t('management.settings.title')}</Text>
        <MultiSelect
          label={t('management.settings.users')}
          description={t('management.settings.usersHint')}
          data={q.data.users.map((u) => ({ value: u.id, label: u.name }))}
          value={userIds}
          onChange={setUserIds}
          searchable
        />
        <Group justify="flex-end">
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { userIds },
                {
                  onSuccess: () => {
                    notifications.show({ color: 'green', message: t('app.saved') })
                    // Lista osób zmienia uprawnienia — także bieżącego Admina (menu z /me).
                    void refresh()
                  },
                  onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                },
              )
            }
          >
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}
