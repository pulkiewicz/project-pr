import { Alert, Badge, Group, Loader, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoiceCostDate, type InvoiceDto } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime } from '../../lib/format'
import { useInvoices } from './api'
import { InvoiceDrawer } from './InvoiceDrawer'
import { PaymentDot, formatMoney } from './status'

type View = 'mine' | 'sent' | 'all'

/** Czy faktura czeka na decyzję tej osoby: wskazany akceptujący albo (bez wskazania) każdy oprócz wysyłającego. */
const awaitsDecisionOf = (i: InvoiceDto, userId: string) => (i.approverId ? i.approverId === userId : i.submittedBy !== userId)

/**
 * Do akceptacji (pozycja menu Finanse): faktury wysłane do akceptacji.
 * Każdy widzi czekające na niego i wysłane przez siebie; Admin — wszystkie, z informacją, na czyją akceptację czekają.
 */
export function ApprovalsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const isAdmin = me.user.role === 'Admin'
  const canApprove = can('invoices', 'approve')
  const [view, setView] = useState<View>(isAdmin ? 'all' : canApprove ? 'mine' : 'sent')
  const [open, setOpen] = useState<string | null>(null)
  const q = useInvoices()

  const pending = useMemo(
    () => (q.data?.items ?? []).filter((i) => i.status === 'pending').sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '')),
    [q.data],
  )
  const byView: Record<View, InvoiceDto[]> = {
    mine: canApprove ? pending.filter((i) => awaitsDecisionOf(i, me.user.id)) : [],
    sent: pending.filter((i) => i.submittedBy === me.user.id),
    all: isAdmin ? pending : [],
  }
  const rows = byView[view]
  const views = [
    ...(canApprove ? [{ value: 'mine', label: `${t('invoices.approvals.mine')} (${byView.mine.length})` }] : []),
    { value: 'sent', label: `${t('invoices.approvals.sent')} (${byView.sent.length})` },
    ...(isAdmin ? [{ value: 'all', label: `${t('invoices.approvals.all')} (${byView.all.length})` }] : []),
  ]

  return (
    <Stack>
      <Title order={2}>{t('invoices.approvals.title')}</Title>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      {q.isLoading ? (
        <Loader />
      ) : (
        <>
          <Group>
            <SegmentedControl data={views} value={view} onChange={(v) => setView(v as View)} />
          </Group>
          {rows.length === 0 ? (
            <Text c="dimmed">{view === 'mine' ? t('invoices.approvals.emptyMine') : t('invoices.approvals.empty')}</Text>
          ) : (
            <Table.ScrollContainer minWidth={900}>
              <Table highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('invoices.date')}</Table.Th>
                    <Table.Th>{t('invoices.number')}</Table.Th>
                    <Table.Th>{t('invoices.seller')}</Table.Th>
                    <Table.Th ta="right">{t('invoices.net')}</Table.Th>
                    <Table.Th>{t('invoices.projects')}</Table.Th>
                    <Table.Th>{t('invoices.approvals.submitted')}</Table.Th>
                    <Table.Th>{t('invoices.approver')}</Table.Th>
                    <Table.Th ta="center">{t('invoices.pay.label')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((i) => (
                    <Table.Tr key={i.id} onClick={() => setOpen(i.id)} style={{ cursor: 'pointer' }}>
                      <Table.Td>{formatDate(invoiceCostDate(i))}</Table.Td>
                      <Table.Td>{i.number ?? <Text size="sm" c="dimmed" fs="italic">{i.description ?? t('invoices.fileNoData')}</Text>}</Table.Td>
                      <Table.Td>{i.sellerName}</Table.Td>
                      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                        {formatMoney(i.netPrice, i.currency)}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {i.allocations.map((a) => (
                            <Badge key={a.projectId} variant="light" title={a.projectName}>
                              {a.projectCode} {a.share}%
                            </Badge>
                          ))}
                          {(i.general || (i.allocatedShare > 0 && i.allocatedShare < 100)) && (
                            <Badge variant="light" color="gray">
                              {t('invoices.general')}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{i.submittedByName}</Text>
                        <Text size="xs" c="dimmed">
                          {formatDateTime(i.submittedAt)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {i.approverName ? (
                          <Text size="sm" fw={i.approverId === me.user.id ? 600 : undefined}>
                            {i.approverName}
                          </Text>
                        ) : (
                          <Text size="sm" c="dimmed" fs="italic">
                            {t('invoices.approverAny')}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="center">
                        <PaymentDot inv={i} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </>
      )}
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
    </Stack>
  )
}
