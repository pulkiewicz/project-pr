import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, SegmentedControl, Stack, Table, Text, Textarea, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCheck } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoiceCostDate, type InvoiceDto } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime } from '../../lib/format'
import { fromDate, toDate } from '../management/common'
import { useBulkApprove, useInvoices } from './api'
import { InvoiceDrawer } from './InvoiceDrawer'
import { PaymentDot, formatMoney } from './status'

type View = 'mine' | 'sent' | 'all'

/** Czy faktura czeka na decyzję tej osoby: wskazany akceptujący albo (bez wskazania) każdy oprócz wysyłającego. */
const awaitsDecisionOf = (i: InvoiceDto, userId: string) => (i.approverId ? i.approverId === userId : i.submittedBy !== userId)

/** Suma netto zaznaczonych — osobno dla każdej waluty. */
const sumByCurrency = (items: InvoiceDto[]) => {
  const m = new Map<string, number>()
  for (const i of items) m.set(i.currency, (m.get(i.currency) ?? 0) + (i.netPrice ?? 0))
  return [...m].map(([cur, cents]) => formatMoney(cents, cur)).join(' + ')
}

/**
 * Do akceptacji (pozycja menu Finanse): faktury wysłane do akceptacji.
 * Każdy widzi czekające na niego i wysłane przez siebie; Admin — wszystkie, z informacją, na czyją akceptację czekają.
 * Czekające na mnie (i u Admina — wszystkie) można zaznaczyć i zaakceptować zbiorczo.
 */
export function ApprovalsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const isAdmin = me.user.role === 'Admin'
  const canApprove = can('invoiceApprovals', 'approve')
  const [view, setView] = useState<View>(isAdmin ? 'all' : canApprove ? 'mine' : 'sent')
  const [dateTo, setDateTo] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [comment, setComment] = useState('')
  const q = useInvoices()
  const bulkApprove = useBulkApprove()

  const pending = useMemo(
    () => (q.data?.items ?? []).filter((i) => i.status === 'pending').sort((a, b) => (invoiceCostDate(a) ?? '').localeCompare(invoiceCostDate(b) ?? '')),
    [q.data],
  )
  const inRange = (i: InvoiceDto) => !dateTo || (invoiceCostDate(i) ?? '') <= dateTo
  const byView: Record<View, InvoiceDto[]> = {
    mine: canApprove ? pending.filter((i) => awaitsDecisionOf(i, me.user.id)) : [],
    sent: pending.filter((i) => i.submittedBy === me.user.id),
    all: isAdmin ? pending : [],
  }
  const rows = byView[view].filter(inRange)
  const views = [
    ...(canApprove ? [{ value: 'mine', label: `${t('invoices.approvals.mine')} (${byView.mine.length})` }] : []),
    { value: 'sent', label: `${t('invoices.approvals.sent')} (${byView.sent.length})` },
    ...(isAdmin ? [{ value: 'all', label: `${t('invoices.approvals.all')} (${byView.all.length})` }] : []),
  ]

  // Zaznaczać można faktury, które mogę zaakceptować: nie wysłane przez siebie, czekające na mnie (Admin — każda).
  const selectable = (i: InvoiceDto) => canApprove && view !== 'sent' && i.submittedBy !== me.user.id && (isAdmin || awaitsDecisionOf(i, me.user.id))
  const selectableRows = rows.filter(selectable)
  const chosen = selectableRows.filter((i) => selected.has(i.id))
  const showSelect = selectableRows.length > 0
  // Zaznaczenie obejmuje tylko widoczne wiersze — zmiana widoku lub daty je czyści.
  useEffect(() => setSelected(new Set()), [view, dateTo])

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allChosen = selectableRows.length > 0 && chosen.length === selectableRows.length

  const approve = () =>
    bulkApprove.mutate(
      { ids: chosen.map((i) => i.id), comment: comment.trim() || null },
      {
        onSuccess: (r) => {
          notifications.show({ color: r.skipped ? 'yellow' : 'green', message: t('invoices.approvals.approveDone', { updated: r.updated, skipped: r.skipped }) })
          setConfirming(false)
          setComment('')
          setSelected(new Set())
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )

  return (
    <Stack>
      <Title order={2}>{t('invoices.approvals.title')}</Title>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      {q.isLoading ? (
        <Loader />
      ) : (
        <>
          <Group align="flex-end" gap="sm">
            <SegmentedControl data={views} value={view} onChange={(v) => setView(v as View)} />
            <DateInput w={180} label={t('invoices.approvals.dateTo')} valueFormat="DD.MM.YYYY" clearable value={toDate(dateTo)} onChange={(d) => setDateTo(fromDate(d))} />
            {showSelect && (
              <Button color="green" leftSection={<IconCheck size={16} />} disabled={!chosen.length} onClick={() => setConfirming(true)} ml="auto">
                {t('invoices.approvals.approveSelected', { count: chosen.length })}
              </Button>
            )}
          </Group>
          {rows.length === 0 ? (
            <Text c="dimmed">{view === 'mine' ? t('invoices.approvals.emptyMine') : t('invoices.approvals.empty')}</Text>
          ) : (
            <Table.ScrollContainer minWidth={900}>
              <Table highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    {showSelect && (
                      <Table.Th w={40}>
                        <Checkbox
                          aria-label={t('invoices.approvals.selectAll')}
                          checked={allChosen}
                          indeterminate={chosen.length > 0 && !allChosen}
                          onChange={() => setSelected(allChosen ? new Set() : new Set(selectableRows.map((i) => i.id)))}
                        />
                      </Table.Th>
                    )}
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
                    <Table.Tr key={i.id} onClick={() => setOpen(i.id)} style={{ cursor: 'pointer' }} bg={selected.has(i.id) ? 'var(--mantine-color-green-light)' : undefined}>
                      {showSelect && (
                        <Table.Td onClick={(e) => e.stopPropagation()}>
                          {selectable(i) && <Checkbox aria-label={i.number ?? i.id} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />}
                        </Table.Td>
                      )}
                      <Table.Td>{formatDate(invoiceCostDate(i))}</Table.Td>
                      <Table.Td>
                        {i.number ?? (
                          <Text size="sm" c="dimmed" fs="italic">
                            {i.description ?? t('invoices.fileNoData')}
                          </Text>
                        )}
                      </Table.Td>
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
      <Modal opened={confirming} onClose={() => setConfirming(false)} title={t('invoices.approvals.approveTitle', { count: chosen.length })}>
        <Stack>
          <Text size="sm">{t('invoices.approvals.approveSum', { sum: sumByCurrency(chosen) })}</Text>
          <Textarea autosize minRows={2} label={t('invoices.comment')} value={comment} onChange={(e) => setComment(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>
              {t('app.cancel')}
            </Button>
            <Button color="green" leftSection={<IconCheck size={16} />} loading={bulkApprove.isPending} onClick={approve}>
              {t('invoices.approvals.approveSelected', { count: chosen.length })}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
    </Stack>
  )
}
