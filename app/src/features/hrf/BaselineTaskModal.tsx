import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HrfTaskDto } from '#shared'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useSetBaselineTask } from './api'

export interface BaselineTaskTarget {
  baseline: { id: string; name: string }
  /** Zadanie z bieżącego harmonogramu (daty bieżące — do porównania). */
  task: HrfTaskDto
  start: string | null
  end: string | null
}

interface Props {
  target: BaselineTaskTarget | null
  onClose: () => void
  onOpenDetails: (taskId: string) => void
}

const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)

/** Korekta dat zadania w zamrożonym planie bazowym — dostępna tylko dla Admina. */
export function BaselineTaskModal({ target, onClose, onOpenDetails }: Props) {
  const { t } = useTranslation()
  const save = useSetBaselineTask()
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)

  useEffect(() => {
    setStart(target?.start ?? null)
    setEnd(target?.end ?? null)
  }, [target])

  const error = (start === null) !== (end === null) ? t('hrf.baselineTaskBoth') : start && end && end < start ? t('hrf.baselineTaskOrder') : null

  const submit = () => {
    if (!target || error) return
    save.mutate(
      { baselineId: target.baseline.id, taskId: target.task.id, start, end },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('app.saved') })
          onClose()
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )
  }

  return (
    <Modal opened={!!target} onClose={onClose} title={target ? t('hrf.baselineTaskEdit', { name: target.baseline.name }) : ''}>
      {target && (
        <Stack gap="sm">
          <Text fw={500}>
            {target.task.code} {target.task.name}
          </Text>
          <Text size="sm" c="dimmed">
            {t('hrf.baselineTaskCurrent', { start: formatDate(target.task.plannedStart), end: formatDate(target.task.plannedEnd) })}
          </Text>
          <Group grow>
            <DateInput label={t('hrf.plannedStart')} valueFormat="DD.MM.YYYY" clearable value={toDate(start)} onChange={(v) => setStart(fromDate(v))} />
            <DateInput label={t('hrf.plannedEnd')} valueFormat="DD.MM.YYYY" clearable value={toDate(end)} onChange={(v) => setEnd(fromDate(v))} />
          </Group>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Alert color="gray" variant="light">
            {t('hrf.baselineTaskHint')}
          </Alert>
          <Group justify="space-between">
            <Button variant="subtle" onClick={() => onOpenDetails(target.task.id)}>
              {t('hrf.details')}
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                {t('app.cancel')}
              </Button>
              <Button onClick={submit} loading={save.isPending} disabled={!!error}>
                {t('app.save')}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
