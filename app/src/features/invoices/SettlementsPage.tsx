import { ActionIcon, Alert, Badge, Button, Checkbox, Group, List, Loader, Modal, SegmentedControl, Stack, Switch, Table, Tabs, Text, Textarea, Title, Tooltip } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconCheck, IconDownload, IconPencil, IconReceiptOff } from '@tabler/icons-react'
import { addMonths, endOfMonth, format, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BankReportTxDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime, todayWarsaw } from '../../lib/format'
import { KindBadge } from './BankTab'
import { bankReportPath, useBankReport, useBankSettlement, useLinkInvoice, useUpdateBankTx } from './bankApi'
import { InvoiceDrawer } from './InvoiceDrawer'
import { formatMoney } from './status'

const monthDate = (m: string) => parseISO(`${m}-01`)
const shiftMonth = (m: string, n: number) => format(addMonths(monthDate(m), n), 'yyyy-MM')
/** Okres raportu: miesiąc (od 1. do ostatniego dnia) albo null = cały okres zaimportowanych wyciągów. */
const monthRange = (m: string | null) => (m ? { from: `${m}-01`, to: format(endOfMonth(monthDate(m)), 'yyyy-MM-dd') } : { from: null, to: null })
/**
 * Propozycje faktury dla płatności bez faktury (ta sama kwota; daty różnią się do 30 dni, podobny kontrahent albo
 * kilka możliwości) — do ręcznego potwierdzenia. Klik w numer otwiera kartę faktury, ✓ łączy płatność z fakturą.
 */
function SuggestionsCell({ tx, onOpen }: { tx: BankReportTxDto; onOpen: (invoiceId: string) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const link = useLinkInvoice()
  if (!tx.suggestions.length) return null
  return (
    <Stack gap={4}>
      {tx.suggestions.map((s) => (
        <Group key={s.invoiceId} gap={4} wrap="nowrap">
          <Tooltip multiline w={300} label={`${t(`bank.reason.${s.reason}`)} · ${s.sellerName ?? ''} · ${formatDate(s.issueDate)} · ${t('invoices.gross')} ${formatMoney(s.grossPrice)}`}>
            <Badge variant="outline" color="yellow" size="sm" style={{ textTransform: 'none', maxWidth: 180, cursor: 'pointer' }} onClick={() => onOpen(s.invoiceId)}>
              {s.invoiceNumber ?? s.sellerName ?? '?'} · {formatDate(s.issueDate)}
            </Badge>
          </Tooltip>
          {can('invoices', 'edit') && (
            <ActionIcon
              size="sm"
              variant="light"
              color="green"
              aria-label={t('bank.accept')}
              title={t('bank.accept')}
              loading={link.isPending && link.variables?.invoiceId === s.invoiceId}
              onClick={() =>
                link.mutate(
                  { txId: tx.id, invoiceId: s.invoiceId },
                  { onSuccess: () => notifications.show({ color: 'green', message: t('bank.report.linked', { number: s.invoiceNumber ?? '' }) }), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
                )
              }
            >
              <IconCheck size={14} />
            </ActionIcon>
          )}
        </Group>
      ))}
    </Stack>
  )
}

/**
 * Potwierdzenie, że do płatności nie będzie faktury — operacja dostaje rozliczenie „Koszt bez faktury”
 * (znika z listy; kategorię / projekt / VAT można uzupełnić w zakładce Wyciągi bankowe).
 */
function NoInvoiceButton({ tx }: { tx: BankReportTxDto }) {
  const { t } = useTranslation()
  const update = useUpdateBankTx()
  const confirm = () =>
    modals.openConfirmModal({
      title: t('bank.report.noInvoiceTitle'),
      children: (
        <Text size="sm">
          {t('bank.report.noInvoiceBody', { counterparty: tx.counterparty ?? '—', amount: formatMoney(tx.amount, tx.currency), date: formatDate(tx.bookingDate) })}
        </Text>
      ),
      labels: { confirm: t('bank.report.noInvoiceConfirm'), cancel: t('app.cancel') },
      onConfirm: () =>
        update.mutate(
          { id: tx.id, patch: { costStatus: 'no_invoice' } },
          { onSuccess: () => notifications.show({ color: 'green', message: t('bank.report.noInvoiceDone') }), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
        ),
    })
  return (
    <Tooltip label={t('bank.report.noInvoice')}>
      <ActionIcon size="sm" variant="light" color="gray" aria-label={t('bank.report.noInvoice')} loading={update.isPending} onClick={confirm}>
        <IconReceiptOff size={14} />
      </ActionIcon>
    </Tooltip>
  )
}

/**
 * Komentarz i ręczne odhaczenie płatności (np. dostawca zwrócił część kwoty za brakujący towar, a korekty faktury
 * nie ma). `settle` — odhaczenie z komentarzem; bez niego — sama zmiana komentarza.
 */
function SettlementModal({ tx, settle, onClose }: { tx: BankReportTxDto; settle: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const save = useBankSettlement()
  const [note, setNote] = useState(tx.settlementNote ?? '')
  const submit = () =>
    save.mutate(
      { id: tx.id, note: note.trim() || null, ...(settle ? { settled: true } : {}) },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t(settle ? 'bank.report.settleDone' : 'bank.report.commentSaved') })
          onClose()
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )
  return (
    <Modal opened onClose={onClose} title={t(settle ? 'bank.report.settleTitle' : tx.settlementNote ? 'bank.report.commentEdit' : 'bank.report.commentAdd')}>
      <Stack>
        {settle && (
          <Text size="sm">
            {t('bank.report.settleBody', { counterparty: tx.counterparty ?? '—', amount: formatMoney(tx.amount, tx.currency), date: formatDate(tx.bookingDate) })}
          </Text>
        )}
        <Textarea autosize minRows={3} maxLength={1000} label={t('bank.report.comment')} placeholder={t('bank.report.commentPlaceholder')} value={note} onChange={(e) => setNote(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button color={settle ? 'green' : undefined} leftSection={settle ? <IconCheck size={16} /> : undefined} loading={save.isPending} onClick={submit}>
            {settle ? t('bank.report.settleConfirm') : t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Komentarz w wierszu (z edycją) i informacja, kto odhaczył. */
function CommentCell({ tx, canEdit, onEdit }: { tx: BankReportTxDto; canEdit: boolean; onEdit: () => void }) {
  const { t } = useTranslation()
  return (
    <Stack gap={2}>
      <Group gap={4} wrap="nowrap" align="flex-start">
        {tx.settlementNote ? (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {tx.settlementNote}
          </Text>
        ) : (
          canEdit && (
            <Text size="xs" c="dimmed">
              —
            </Text>
          )
        )}
        {canEdit && (
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label={t(tx.settlementNote ? 'bank.report.commentEdit' : 'bank.report.commentAdd')} title={t(tx.settlementNote ? 'bank.report.commentEdit' : 'bank.report.commentAdd')} onClick={onEdit}>
            <IconPencil size={14} />
          </ActionIcon>
        )}
      </Group>
      {tx.settledAt && (
        <Text size="xs" c="dimmed">
          {t('bank.report.settledBy', { name: tx.settledByName ?? '—', at: formatDateTime(tx.settledAt) })}
        </Text>
      )}
    </Stack>
  )
}

/** Pole „rozliczone”: zaznaczenie otwiera okno z komentarzem, odznaczenie od razu przywraca płatność na listę. */
function SettleCheckbox({ tx, onSettle }: { tx: BankReportTxDto; onSettle: () => void }) {
  const { t } = useTranslation()
  const save = useBankSettlement()
  const unsettle = () =>
    save.mutate(
      { id: tx.id, settled: false },
      { onSuccess: () => notifications.show({ message: t('bank.report.unsettleDone') }), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
    )
  const label = t(tx.settledAt ? 'bank.report.unsettle' : 'bank.report.settle')
  return (
    <Tooltip label={label}>
      <Checkbox aria-label={label} color="green" checked={!!tx.settledAt} disabled={save.isPending} onChange={() => (tx.settledAt ? unsettle() : onSettle())} />
    </Tooltip>
  )
}

/**
 * Filtr płatności bez faktury: bez propozycji i bez oznaczenia (nic nie dopasowano), z propozycją, oznaczone „jest faktura”,
 * odhaczone ręcznie (domyślnie ukryte — „Wszystkie” to pozycje do wyjaśnienia).
 */
type MissingFilter = 'all' | 'unmatched' | 'suggested' | 'toLink' | 'settled'
const missingFilterOf = (x: BankReportTxDto): Exclude<MissingFilter, 'all'> =>
  x.settledAt ? 'settled' : x.costStatus === 'invoice' ? 'toLink' : x.suggestions.length ? 'suggested' : 'unmatched'
/** Filtr faktur bez płatności: bez żadnej płatności w wyciągach albo zapłacone częściowo. */
type UnpaidFilter = 'all' | 'none' | 'partial'

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0)

/**
 * Rozliczenia (pozycja menu Finanse): faktury bez płatności w wyciągach i płatności z wyciągów bez faktury,
 * nad nimi ciągłość wyciągów. Filtr miesiąca (domyślnie bieżący) albo cały okres zaimportowanych wyciągów.
 */
export function SettlementsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const currentMonth = todayWarsaw().slice(0, 7)
  // Miesiąc 'YYYY-MM'; null = cały okres wyciągów.
  const [month, setMonth] = useState<string | null>(currentMonth)
  const range = monthRange(month)
  const [open, setOpen] = useState<string | null>(null)
  const [showPaidInInfakt, setShowPaidInInfakt] = useState(false)
  const q = useBankReport(range)
  const r = q.data
  const paidInInfakt = r?.unpaid.filter((i) => i.paidInInfakt).length ?? 0
  const unpaidAll = useMemo(() => (r?.unpaid ?? []).filter((i) => showPaidInInfakt || !i.paidInInfakt), [r, showPaidInInfakt])
  const [unpaidFilter, setUnpaidFilter] = useState<UnpaidFilter>('all')
  const unpaidKind = (i: { paidAmount: number }) => (i.paidAmount > 0 ? 'partial' : 'none')
  const unpaid = useMemo(() => unpaidAll.filter((i) => unpaidFilter === 'all' || unpaidKind(i) === unpaidFilter), [unpaidAll, unpaidFilter])
  const [missingFilter, setMissingFilter] = useState<MissingFilter>('all')
  // Do wyjaśnienia — bez odhaczonych ręcznie (te w osobnym filtrze).
  const missingAll = useMemo(() => (r?.missing ?? []).filter((x) => !x.settledAt), [r])
  const missing = useMemo(
    () => (missingFilter === 'all' ? missingAll : (r?.missing ?? []).filter((x) => missingFilterOf(x) === missingFilter)),
    [r, missingAll, missingFilter],
  )
  const countMissing = (f: Exclude<MissingFilter, 'all'>) => (r?.missing ?? []).filter((x) => missingFilterOf(x) === f).length
  const [settling, setSettling] = useState<{ tx: BankReportTxDto; settle: boolean } | null>(null)
  const countUnpaid = (f: Exclude<UnpaidFilter, 'all'>) => unpaidAll.filter((i) => unpaidKind(i) === f).length
  const canEdit = can('invoices', 'edit')

  return (
    <Stack>
      <Title order={2}>{t('bank.report.title')}</Title>
      <Group align="flex-end" gap="sm">
        <Group gap={4}>
          <ActionIcon variant="default" size="lg" aria-label={t('bank.report.prevMonth')} onClick={() => setMonth((m) => shiftMonth(m ?? currentMonth, -1))}>
            <IconChevronLeft size={18} />
          </ActionIcon>
          <MonthPickerInput
            w={170}
            aria-label={t('bank.report.month')}
            placeholder={t('bank.report.coverage')}
            valueFormat="MMMM YYYY"
            locale="pl"
            value={month ? monthDate(month) : null}
            onChange={(d) => d && setMonth(format(typeof d === 'string' ? parseISO(d) : d, 'yyyy-MM'))}
          />
          <ActionIcon variant="default" size="lg" aria-label={t('bank.report.nextMonth')} onClick={() => setMonth((m) => shiftMonth(m ?? currentMonth, 1))}>
            <IconChevronRight size={18} />
          </ActionIcon>
        </Group>
        <Button variant={month ? 'default' : 'light'} onClick={() => setMonth(null)}>
          {t('bank.report.coverage')}
        </Button>
        {month !== currentMonth && (
          <Button variant="subtle" onClick={() => setMonth(currentMonth)}>
            {t('bank.report.currentMonth')}
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
          ) : null}

          <Tabs defaultValue="unpaid" keepMounted={false} mt="sm">
            <Tabs.List>
              <Tabs.Tab value="unpaid">
                {t('bank.report.tabUnpaid')} ({unpaidAll.length})
              </Tabs.Tab>
              <Tabs.Tab value="missing">
                {t('bank.report.tabMissing')} ({missingAll.length})
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="unpaid" pt="sm">
              <Stack>
                <Group justify="space-between">
                  <Title order={4}>{t('bank.report.unpaidTitle', { count: unpaid.length })}</Title>
                  <Text fw={600}>{formatMoney(sum(unpaid.filter((x) => x.currency === 'PLN').map((x) => x.openAmount)))}</Text>
                </Group>
                <Group gap="md">
                  <SegmentedControl
                    size="xs"
                    value={unpaidFilter}
                    onChange={(v) => setUnpaidFilter(v as UnpaidFilter)}
                    data={[
                      { value: 'all', label: `${t('bank.report.filter.all')} (${unpaidAll.length})` },
                      { value: 'none', label: `${t('bank.report.filter.noPayment')} (${countUnpaid('none')})` },
                      { value: 'partial', label: `${t('bank.report.filter.partial')} (${countUnpaid('partial')})` },
                    ]}
                  />
                  {paidInInfakt > 0 && (
                    <Switch size="sm" label={t('bank.report.showPaidInInfakt', { count: paidInInfakt })} checked={showPaidInInfakt} onChange={(e) => setShowPaidInInfakt(e.currentTarget.checked)} />
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {t('bank.report.unpaidHint')}
                </Text>
                {unpaid.length > 0 && (
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
                        {unpaid.map((i) => (
                          <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(i.id)}>
                            <Table.Td>{i.number ?? '—'}</Table.Td>
                            <Table.Td>
                              {i.sellerName ?? '—'}
                              {i.paidInInfakt && (
                                <Tooltip label={t('bank.report.paidInInfaktHint')} multiline w={300}>
                                  <Badge ml={6} size="xs" color="green" variant="light">
                                    {t('bank.report.paidInInfakt')}
                                  </Badge>
                                </Tooltip>
                              )}
                            </Table.Td>
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
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="missing" pt="sm">
              <Stack>
                <Group justify="space-between">
                  <Title order={4}>{t('bank.report.missingTitle', { count: missing.length })}</Title>
                  <Text fw={600}>{formatMoney(sum(missing.map((x) => x.amount)))}</Text>
                </Group>
                <SegmentedControl
                  size="xs"
                  style={{ alignSelf: 'flex-start' }}
                  value={missingFilter}
                  onChange={(v) => setMissingFilter(v as MissingFilter)}
                  data={[
                    { value: 'all', label: `${t('bank.report.filter.all')} (${missingAll.length})` },
                    { value: 'unmatched', label: `${t('bank.report.filter.unmatched')} (${countMissing('unmatched')})` },
                    { value: 'suggested', label: `${t('bank.report.filter.suggested')} (${countMissing('suggested')})` },
                    { value: 'toLink', label: `${t('bank.report.filter.toLink')} (${countMissing('toLink')})` },
                    { value: 'settled', label: `${t('bank.report.filter.settled')} (${countMissing('settled')})` },
                  ]}
                />
                <Text size="sm" c="dimmed">
                  {t('bank.report.missingHint')}
                </Text>
                {missing.length > 0 && (
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
                          <Table.Th w={230}>{t('bank.report.suggestion')}</Table.Th>
                          <Table.Th w={240}>{t('bank.report.comment')}</Table.Th>
                          {canEdit && <Table.Th w={76} />}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {missing.map((x) => (
                          <Table.Tr key={x.id} bg={x.settledAt ? 'var(--mantine-color-green-light)' : undefined}>
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
                            <Table.Td>
                              <SuggestionsCell tx={x} onOpen={setOpen} />
                            </Table.Td>
                            <Table.Td>
                              <CommentCell tx={x} canEdit={canEdit} onEdit={() => setSettling({ tx: x, settle: false })} />
                            </Table.Td>
                            {canEdit && (
                              <Table.Td>
                                <Group gap={6} wrap="nowrap">
                                  <SettleCheckbox tx={x} onSettle={() => setSettling({ tx: x, settle: true })} />
                                  {!x.settledAt && <NoInvoiceButton tx={x} />}
                                </Group>
                              </Table.Td>
                            )}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </>
      )}
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
      {settling && <SettlementModal key={settling.tx.id} tx={settling.tx} settle={settling.settle} onClose={() => setSettling(null)} />}
    </Stack>
  )
}
