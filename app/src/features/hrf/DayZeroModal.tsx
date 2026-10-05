import { Alert, Button, Group, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { format } from 'date-fns'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DayZeroPreview } from '#shared'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useDayZero, useProject } from './api'

/** Zmiana kotwicy dnia „0”: podgląd różnic → potwierdzenie → przeliczenie w jednej transakcji (audit log). */
export function DayZeroModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const project = useProject()
  const dz = useDayZero()
  const [date, setDate] = useState<Date | null>(null)
  const [preview, setPreview] = useState<DayZeroPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setPreview(null)
    setDate(null)
    setError(null)
    onClose()
  }
  const iso = date ? format(date, 'yyyy-MM-dd') : null

  return (
    <Modal opened={opened} onClose={close} title={t('hrf.setDayZero')} size="xl">
      <Stack>
        <Text size="sm">
          {t('hrf.dayZero')}: <b>{project.data?.dayZeroDate ? formatDate(project.data.dayZeroDate) : t('dashboard.dayZeroUnset')}</b>
        </Text>
        <Group align="flex-end">
          <DateInput label={t('hrf.dayZero')} valueFormat="DD.MM.YYYY" value={date} onChange={(v) => (setDate(v as Date | null), setPreview(null))} />
          <Button
            variant="light"
            disabled={!iso}
            onClick={() => dz.preview(iso!).then(setPreview, (e) => setError(errorMessage(e)))}
          >
            {t('hrf.dayZeroPreview')}
          </Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        {preview && (
          <>
            <Text size="sm">{t('hrf.dayZeroChanges', { count: preview.changes.length })}</Text>
            {preview.warnings.length > 0 && (
              <Alert color="yellow">
                {preview.warnings.slice(0, 10).map((w) => (
                  <div key={w.code}>
                    [{w.code}] {w.message}
                  </div>
                ))}
              </Alert>
            )}
            <ScrollArea h={300} type="auto">
              <Table striped fz="xs" stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('hrf.code')}</Table.Th>
                    <Table.Th>{t('hrf.name')}</Table.Th>
                    <Table.Th>{t('hrf.plannedStart')}</Table.Th>
                    <Table.Th>{t('hrf.plannedEnd')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {preview.changes.map((c) => (
                    <Table.Tr key={c.taskId}>
                      <Table.Td>{c.code}</Table.Td>
                      <Table.Td>{c.name}</Table.Td>
                      <Table.Td>
                        {formatDate(c.oldStart)} → <b>{formatDate(c.newStart)}</b>
                      </Table.Td>
                      <Table.Td>
                        {formatDate(c.oldEnd)} → <b>{formatDate(c.newEnd)}</b>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Text size="sm" c="dimmed">
              {t('hrf.dayZeroConfirm')}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                {t('app.cancel')}
              </Button>
              <Button
                loading={dz.apply.isPending}
                onClick={() =>
                  dz.apply.mutate(
                    { date: iso!, projectVersion: project.data!.version },
                    {
                      onSuccess: () => {
                        notifications.show({ color: 'green', message: t('app.saved') })
                        close()
                      },
                      onError: (e) => setError(errorMessage(e)),
                    },
                  )
                }
              >
                {t('hrf.dayZeroApply')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  )
}
