import { ActionIcon, Alert, Badge, Group, Modal, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconEye, IconPencil, IconStar, IconStarOff, IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { BaselineDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime } from '../../lib/format'
import { useBaselines, useDeleteBaseline, useUpdateBaseline } from './api'

interface Props {
  opened: boolean
  onClose: () => void
  /** Otwiera plan jako wyświetlany wariant HRF. */
  onShow: (id: string) => void
}

export function BaselinesModal({ opened, onClose, onShow }: Props) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const baselines = useBaselines()
  const update = useUpdateBaseline()
  const remove = useDeleteBaseline()
  const approve = can('hrf', 'approve')
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

  const setCurrent = (b: BaselineDto) =>
    update.mutate({ id: b.id, patch: { isCurrent: !b.isCurrent } }, { onSuccess: () => notifications.show({ color: 'green', message: t('app.saved') }), onError: fail })

  const rename = (b: BaselineDto) => {
    let name = b.name
    modals.openConfirmModal({
      title: t('hrf.baselineRename'),
      children: <TextInput label={t('hrf.baselineName')} defaultValue={name} onChange={(e) => (name = e.currentTarget.value)} />,
      labels: { confirm: t('app.save'), cancel: t('app.cancel') },
      onConfirm: () => update.mutate({ id: b.id, patch: { name } }, { onError: fail }),
    })
  }

  const confirmDelete = (b: BaselineDto) =>
    modals.openConfirmModal({
      title: t('hrf.baselineDelete'),
      children: t('hrf.baselineDeleteConfirm', { name: b.name }),
      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(b.id, { onSuccess: () => notifications.show({ color: 'green', message: t('hrf.baselineDeleted') }), onError: fail }),
    })

  const rows = baselines.data ?? []
  return (
    <Modal opened={opened} onClose={onClose} title={t('hrf.baselineManage')} size="xl">
      <Text size="sm" c="dimmed" mb="sm">
        {t('hrf.baselineCurrentHint')}
      </Text>
      {rows.length === 0 ? (
        <Alert>{t('hrf.baselineEmpty')}</Alert>
      ) : (
        <Table striped fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('hrf.baselineName')}</Table.Th>
              <Table.Th>{t('hrf.baselineFrozenAt')}</Table.Th>
              <Table.Th>{t('hrf.dayZero')}</Table.Th>
              <Table.Th>{t('hrf.baselineTasks')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm">{b.name}</Text>
                    {b.isCurrent && <Badge size="sm">{t('hrf.baselineCurrent')}</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>{formatDateTime(b.createdAt)}</Table.Td>
                <Table.Td>{formatDate(b.dayZeroDate)}</Table.Td>
                <Table.Td>{b.taskCount}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <Tooltip label={t('hrf.variant')}>
                      <ActionIcon variant="subtle" aria-label={t('hrf.variant')} onClick={() => onShow(b.id)}>
                        <IconEye size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {approve && (
                      <>
                        <Tooltip label={b.isCurrent ? t('hrf.baselineUnsetCurrent') : t('hrf.baselineSetCurrent')}>
                          <ActionIcon variant="subtle" aria-label={b.isCurrent ? t('hrf.baselineUnsetCurrent') : t('hrf.baselineSetCurrent')} onClick={() => setCurrent(b)}>
                            {b.isCurrent ? <IconStarOff size={16} /> : <IconStar size={16} />}
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t('hrf.baselineRename')}>
                          <ActionIcon variant="subtle" aria-label={t('hrf.baselineRename')} onClick={() => rename(b)}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </>
                    )}
                    {can('hrf', 'delete') && (
                      <Tooltip label={t('hrf.baselineDelete')}>
                        <ActionIcon variant="subtle" color="red" aria-label={t('hrf.baselineDelete')} onClick={() => confirmDelete(b)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Modal>
  )
}
