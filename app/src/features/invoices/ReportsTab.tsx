import { Alert, Badge, Button, Group, List, Loader, Stack, Table, Text, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconCircleCheck, IconDownload } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { KindBadge } from './BankTab'
import { bankReportPath, useBankReport } from './bankApi'
import { formatMoney } from './status'

const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)
const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0)

/**
 * Rozliczenia (B3): ciągłość wyciągów, wydatki bez faktury (do uzupełnienia w inFakt), faktury niezapłacone
 * i po terminie. Okres domyślnie = okres zaimportowanych wyciągów.
 */
export function ReportsTab({ onOpen }: { onOpen: (invoiceId: string) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const q = useBankReport(range)
  const r = q.data

  return (
    <Stack>
      <Group align="flex-end" gap="sm">
        <DateInput
          size="xs"
          w={140}
          label={t('bank.report.from')}
          valueFormat="DD.MM.YYYY"
          value={toDate(range.from ?? r?.from ?? null)}
          onChange={(v) => setRange((x) => ({ ...x, from: fromDate(v) }))}
        />
        <DateInput size="xs" w={140} label={t('bank.report.to')} valueFormat="DD.MM.YYYY" value={toDate(range.to ?? r?.to ?? null)} onChange={(v) => setRange((x) => ({ ...x, to: fromDate(v) }))} />
        {(range.from || range.to) && (
          <Button size="xs" variant="subtle" onClick={() => setRange({ from: null, to: null })}>
            {t('bank.report.coverage')}
          </Button>
        )}
        {r?.coverage && (
          <Text size="xs" c="dimmed">
            {t('bank.report.coverageInfo', { from: formatDate(r.coverage.from), to: formatDate(r.coverage.to) })}
          </Text>
        )}
        {can('invoices', 'export') && r && (
          <Button
            ml="auto"
            size="xs"
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={() => downloadFile(bankReportPath(range, true), `rozliczenia-${r.from}_${r.to}.xlsx`).catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))}
          >
            {t('bank.report.export')}
          </Button>
        )}
      </Group>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      {q.isLoading || !r ? (
        <Loader />
      ) : (
        <>
          {!r.coverage ? (
            <Alert color="yellow">{t('bank.report.noStatements')}</Alert>
          ) : r.continuity.length ? (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />} title={t('bank.report.continuityTitle')}>
              <List size="sm">
                {r.continuity.map((c, i) => (
                  <List.Item key={i}>
                    {t(`bank.report.continuity.${c.kind}`, {
                      prev: c.prevNumber,
                      next: c.nextNumber,
                      prevTo: formatDate(c.prevTo),
                      nextFrom: formatDate(c.nextFrom),
                      closing: formatMoney(c.prevClosing),
                      opening: formatMoney(c.nextOpening),
                    })}
                  </List.Item>
                ))}
              </List>
            </Alert>
          ) : (
            <Alert color="green" icon={<IconCircleCheck size={18} />}>
              {t('bank.report.continuityOk')}
            </Alert>
          )}

          <Group justify="space-between" mt="sm">
            <Title order={4}>{t('bank.report.missingTitle', { count: r.missing.length })}</Title>
            <Text fw={600}>{formatMoney(sum(r.missing.map((x) => x.amount)))}</Text>
          </Group>
          <Text size="sm" c="dimmed">
            {t('bank.report.missingHint')}
          </Text>
          {r.missing.length > 0 && (
            <Table.ScrollContainer minWidth={800}>
              <Table striped withTableBorder fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={100}>{t('bank.date')}</Table.Th>
                    <Table.Th w={80}>{t('bank.report.statement')}</Table.Th>
                    <Table.Th w={120}>{t('bank.kindLabel')}</Table.Th>
                    <Table.Th>{t('bank.description')}</Table.Th>
                    <Table.Th>{t('bank.report.reference')}</Table.Th>
                    <Table.Th w={130} ta="right">
                      {t('bank.amount')}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {r.missing.map((x) => (
                    <Table.Tr key={x.id}>
                      <Table.Td>{formatDate(x.bookingDate)}</Table.Td>
                      <Table.Td>{x.statementNumber}</Table.Td>
                      <Table.Td>
                        <KindBadge kind={x.kind} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{x.counterparty ?? '—'}</Text>
                        {x.cardHolder && (
                          <Text size="xs" c="dimmed">
                            {x.cardHolder}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{x.reference ?? ''}</Text>
                        {x.costStatus === 'invoice' && (
                          <Badge size="xs" variant="light" color="yellow">
                            {t('bank.report.toLink')}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                        {formatMoney(x.amount, x.currency)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          <Group justify="space-between" mt="sm">
            <Title order={4}>{t('bank.report.unpaidTitle', { count: r.unpaid.length })}</Title>
            <Text fw={600}>{formatMoney(sum(r.unpaid.filter((x) => x.currency === 'PLN').map((x) => x.openAmount)))}</Text>
          </Group>
          <Text size="sm" c="dimmed">
            {t('bank.report.unpaidHint')}
          </Text>
          {r.unpaid.length > 0 && (
            <Table.ScrollContainer minWidth={800}>
              <Table striped highlightOnHover withTableBorder fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('invoices.number')}</Table.Th>
                    <Table.Th>{t('invoices.seller')}</Table.Th>
                    <Table.Th w={100}>{t('invoices.date')}</Table.Th>
                    <Table.Th w={100}>{t('invoices.dueDate')}</Table.Th>
                    <Table.Th w={120} ta="right">
                      {t('invoices.gross')}
                    </Table.Th>
                    <Table.Th w={120} ta="right">
                      {t('bank.unpaid')}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {r.unpaid.map((i) => (
                    <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(i.id)}>
                      <Table.Td>{i.number ?? '—'}</Table.Td>
                      <Table.Td>{i.sellerName ?? '—'}</Table.Td>
                      <Table.Td>{formatDate(i.issueDate)}</Table.Td>
                      <Table.Td>
                        {formatDate(i.dueDate)}
                        {i.overdueDays != null && (
                          <Badge ml={4} size="xs" color="red" variant="light">
                            {t('bank.report.overdue', { count: i.overdueDays })}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                        {formatMoney(i.grossPrice, i.currency)}
                      </Table.Td>
                      <Table.Td ta="right" fw={600} style={{ whiteSpace: 'nowrap' }}>
                        {formatMoney(i.openAmount, i.currency)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </>
      )}
    </Stack>
  )
}
