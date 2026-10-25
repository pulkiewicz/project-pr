import { Alert, Badge, Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useOwners } from '../crm/api'
import { useAiStatus, useDriveStatus, useSaveAiSettings, useSaveDriveSettings } from './ai-api'

/** Dysk współdzielony dla folderów szans i materiałów (Administrator). */
export function DriveSettingsCard() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const status = useDriveStatus()
  const save = useSaveDriveSettings()
  const [id, setId] = useState('')
  useEffect(() => setId(status.data?.sharedDriveId ?? ''), [status.data?.sharedDriveId])
  const s = status.data
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={4}>{t('drive.title')}</Title>
        {s?.fake && <Badge variant="outline">{t('drive.fake')}</Badge>}
      </Group>
      {s && !s.available && <Alert color="yellow" mb="sm">{t('drive.unavailable')}</Alert>}
      {s?.configured && (
        <Text size="sm" c="green" mb="xs">
          {t('drive.connected', { name: s.driveName })}
        </Text>
      )}
      <Text size="sm" c="dimmed" mb="xs">
        {t('drive.hint')}
      </Text>
      <Group align="flex-end">
        <TextInput label={t('drive.sharedDriveId')} style={{ flex: 1 }} disabled={!can('admin', 'edit') || !s?.available} value={id} onChange={(e) => setId(e.currentTarget.value.trim())} />
        {can('admin', 'edit') && (
          <Button
            disabled={!id || id === s?.sharedDriveId || !s?.available}
            loading={save.isPending}
            onClick={() =>
              save.mutate(id, {
                onSuccess: (r) => notifications.show({ color: 'green', message: t('drive.connected', { name: r.driveName }) }),
                onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
              })
            }
          >
            {t('drive.save')}
          </Button>
        )}
      </Group>
    </Card>
  )
}

/** Koszty AI w miesiącu, próg ostrzeżenia i adresat pytań technicznych (G6, B2). */
export function AiSettingsCard() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const status = useAiStatus()
  const owners = useOwners()
  const save = useSaveAiSettings()
  const [warn, setWarn] = useState<number | null>(null)
  const [assignee, setAssignee] = useState<string | null>(null)
  useEffect(() => {
    if (status.data) {
      setWarn(status.data.settings.monthlyWarnUsd)
      setAssignee(status.data.settings.questionsAssigneeId)
    }
  }, [status.data])
  const s = status.data
  if (!s) return null
  const editable = can('admin', 'edit')
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={4}>{t('ai.costs')}</Title>
        <Group gap="xs">
          <Badge variant="light">
            {t('ai.model')}: {s.model}
          </Badge>
          {s.fake && <Badge variant="outline">{t('ai.fake')}</Badge>}
        </Group>
      </Group>
      {!s.available && <Alert color="yellow" mb="sm">{t('ai.unavailable')}</Alert>}
      {s.warn && <Alert color="orange" mb="sm">{t('ai.warn')}</Alert>}
      <Text size="sm" mb="sm">
        {t('ai.monthUsd', { usd: s.monthUsd.toFixed(2), calls: s.monthCalls })}
      </Text>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label={t('ai.warnUsd')} min={0} decimalSeparator="," disabled={!editable} value={warn ?? ''} onChange={(v) => setWarn(v === '' ? null : Number(v))} />
          <Select label={t('ai.assignee')} clearable disabled={!editable} data={owners.data?.map((u) => ({ value: u.id, label: u.name })) ?? []} value={assignee} onChange={setAssignee} />
        </SimpleGrid>
        {editable && (
          <Group justify="flex-end">
            <Button
              loading={save.isPending}
              disabled={warn === s.settings.monthlyWarnUsd && assignee === s.settings.questionsAssigneeId}
              onClick={() => save.mutate({ monthlyWarnUsd: warn, questionsAssigneeId: assignee }, { onSuccess: () => notifications.show({ color: 'green', message: t('app.saved') }) })}
            >
              {t('app.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  )
}
