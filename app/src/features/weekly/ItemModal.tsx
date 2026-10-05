import { Button, Chip, Group, Modal, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BASE_PARTIES, WEEKLY_STATUSES, daysToMask, maskToDays, type WeeklyItemDto, type WeeklyItemInput, type WeeklyStatus } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useHrfTasks } from '../hrf/api'
import { usePeople, useSaveItem } from './api'

interface Props {
  opened: boolean
  isoWeek: string
  item: WeeklyItemDto | null
  presetTask?: { id: string; name: string } | null
  onClose: () => void
}

export function ItemModal({ opened, isoWeek, item, presetTask, onClose }: Props) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const people = usePeople()
  const hrf = useHrfTasks()
  const save = useSaveItem()
  const defaultParty = me.user.party === 'Envcheck' ? 'Envcheck' : me.user.party === 'Arsanit' ? 'Arsanit' : 'Konsorcjum'
  const [f, setF] = useState<WeeklyItemInput>({ isoWeek, title: '', party: 'Konsorcjum', plannedDays: 0, status: 'plan' })

  useEffect(() => {
    if (!opened) return
    setF(
      item
        ? { isoWeek: item.isoWeek, title: item.title, description: item.description, party: item.party as WeeklyItemInput['party'], hrfTaskId: item.hrfTaskId, assigneeUserId: item.assigneeUserId, plannedDays: item.plannedDays, status: item.status }
        : { isoWeek, title: presetTask?.name ?? '', party: defaultParty as WeeklyItemInput['party'], hrfTaskId: presetTask?.id ?? null, plannedDays: 0, status: 'plan' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, item, isoWeek, presetTask])

  const parents = new Set(hrf.data?.tasks.map((x) => x.parentId))
  const taskOptions = hrf.data?.tasks.filter((x) => !parents.has(x.id)).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` })) ?? []
  const editable = !item || item.canEdit

  const submit = () =>
    save.mutate(
      { id: item?.id, version: item?.version, data: f },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('app.saved') })
          onClose()
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )

  return (
    <Modal opened={opened} onClose={onClose} title={item ? t('weekly.edit') : t('weekly.add')} size="lg">
      <Stack>
        <TextInput label={t('weekly.itemTitle')} required disabled={!editable} value={f.title} onChange={(e) => setF({ ...f, title: e.currentTarget.value })} />
        {can('hrf', 'view') && (
          <Select label={t('weekly.hrfTask')} searchable clearable disabled={!editable} data={taskOptions} value={f.hrfTaskId ?? null} onChange={(v) => setF({ ...f, hrfTaskId: v })} />
        )}
        <Group grow>
          <Select label={t('hrf.party')} allowDeselect={false} disabled={!editable} data={BASE_PARTIES.map((p) => ({ value: p, label: t(`parties.${p}`) }))} value={f.party} onChange={(v) => v && setF({ ...f, party: v as WeeklyItemInput['party'] })} />
          <Select label={t('weekly.assignee')} searchable clearable disabled={!editable} data={people.data?.map((p) => ({ value: p.id, label: p.name })) ?? []} value={f.assigneeUserId ?? null} onChange={(v) => setF({ ...f, assigneeUserId: v })} />
        </Group>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {t('weekly.plannedDays')}
          </Text>
          <Chip.Group multiple value={maskToDays(f.plannedDays).map(String)} onChange={(v) => setF({ ...f, plannedDays: daysToMask(v.map(Number)) })}>
            <Group gap={6}>
              {(t('weekly.days', { returnObjects: true }) as string[]).map((d, i) => (
                <Chip key={d} value={String(i)} size="sm" disabled={!editable}>
                  {d}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </Stack>
        <Select label={t('hrf.statusLabel')} allowDeselect={false} disabled={!editable} data={WEEKLY_STATUSES.filter((s) => s !== 'moved').map((s) => ({ value: s, label: t(`weekly.status.${s}`) }))} value={f.status} onChange={(v) => v && setF({ ...f, status: v as WeeklyStatus })} />
        <Textarea label={t('weekly.description')} autosize minRows={2} disabled={!editable} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.currentTarget.value || null })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          {editable && (
            <Button onClick={submit} loading={save.isPending} disabled={!f.title.trim()}>
              {t('app.save')}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  )
}
