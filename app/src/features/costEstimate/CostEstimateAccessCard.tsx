import { Button, Card, Group, MultiSelect, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CostEstimateAccessSettings } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'

const KEY = ['admin', 'settings', 'costEstimate']

/** Ustawienia (Admin): kto ma dostęp do Kosztorysu projektów — jak lista Finansów. */
export function CostEstimateAccessCard() {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: KEY, queryFn: () => api<{ settings: CostEstimateAccessSettings; users: { id: string; name: string }[] }>('/admin/settings/cost-estimate') })
  const save = useMutation({
    mutationFn: (s: CostEstimateAccessSettings) => api<CostEstimateAccessSettings>('/admin/settings/cost-estimate', { method: 'PUT', json: s }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
  const [userIds, setUserIds] = useState<string[] | null>(null)
  useEffect(() => {
    if (q.data) setUserIds(q.data.settings.userIds)
  }, [q.data])
  if (!userIds || !q.data) return null
  return (
    <Card withBorder maw={520}>
      <Stack>
        <Text fw={600}>{t('costEstimate.access.title')}</Text>
        <MultiSelect
          label={t('costEstimate.access.users')}
          description={t('costEstimate.access.usersHint')}
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
                    // Lista zmienia uprawnienia — także bieżącego Admina (menu z /me).
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
