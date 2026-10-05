import { Button, Code, Group, Pagination, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconDownload } from '@tabler/icons-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditEntryDto, Paged } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { api, downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'

const PAGE_SIZE = 50

export function AuditPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [from, setFrom] = useState<Date | null>(null)
  const [to, setTo] = useState<Date | null>(null)

  const params = new URLSearchParams()
  if (action) params.set('action', action)
  if (entity) params.set('entity', entity)
  if (from) params.set('from', format(from, 'yyyy-MM-dd'))
  if (to) params.set('to', format(to, 'yyyy-MM-dd'))

  const query = useQuery({
    queryKey: ['admin', 'audit', page, params.toString()],
    queryFn: () => api<Paged<AuditEntryDto>>(`/admin/audit?page=${page}&pageSize=${PAGE_SIZE}&${params}`),
    placeholderData: keepPreviousData,
  })
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE))

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('audit.title')}</Title>
        {can('auditLog', 'export') && (
          <Button
            leftSection={<IconDownload size={16} />}
            variant="light"
            onClick={() => downloadFile(`/admin/audit/export.csv?${params}`, 'audit-log.csv').catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))}
          >
            {t('app.exportCsv')}
          </Button>
        )}
      </Group>
      <Group align="flex-end">
        <TextInput label={t('audit.action')} value={action} onChange={(e) => (setAction(e.currentTarget.value), setPage(1))} />
        <TextInput label={t('audit.entity')} value={entity} onChange={(e) => (setEntity(e.currentTarget.value), setPage(1))} />
        <DateInput label={t('audit.from')} valueFormat="DD.MM.YYYY" clearable value={from} onChange={(v) => (setFrom(v as Date | null), setPage(1))} />
        <DateInput label={t('audit.to')} valueFormat="DD.MM.YYYY" clearable value={to} onChange={(v) => (setTo(v as Date | null), setPage(1))} />
      </Group>
      <Table.ScrollContainer minWidth={900}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('audit.ts')}</Table.Th>
              <Table.Th>{t('audit.user')}</Table.Th>
              <Table.Th>{t('audit.action')}</Table.Th>
              <Table.Th>{t('audit.entity')}</Table.Th>
              <Table.Th>{t('audit.ip')}</Table.Th>
              <Table.Th>{t('audit.changes')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {query.data?.items.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.ts)}</Table.Td>
                <Table.Td>{e.userEmail ?? '—'}</Table.Td>
                <Table.Td>
                  <Code>{e.action}</Code>
                </Table.Td>
                <Table.Td>
                  {e.entity ?? '—'}
                  {e.entityId && (
                    <Text size="xs" c="dimmed">
                      {e.entityId}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{e.ip ?? '—'}</Table.Td>
                <Table.Td maw={360}>
                  {e.changes ? (
                    <Code block fz="xs">
                      {JSON.stringify(e.changes, null, 1)}
                    </Code>
                  ) : (
                    '—'
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t('app.pageOf', { page, pages })}
        </Text>
        <Pagination value={page} onChange={setPage} total={pages} />
      </Group>
    </Stack>
  )
}
