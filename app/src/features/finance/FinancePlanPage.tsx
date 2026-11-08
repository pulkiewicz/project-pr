import { Accordion, ActionIcon, Alert, Anchor, Badge, Button, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { MonthPickerInput, YearPickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconChevronLeft, IconChevronRight, IconInfoCircle, IconRefresh } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FinanceCostCell, FinancePlanResponse, FinanceStaffRow } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime, todayWarsaw } from '../../lib/format'
import { useSyncInvoices } from '../invoices/api'
import { useFinancePlan } from './api'
import { FixedCostsSection, PlannedSection } from './PlanEditors'
import { YearPlanEditor } from './YearPlanEditor'
import { InvoiceDrawer } from '../invoices/InvoiceDrawer'
import { formatMoney } from '../invoices/status'

const NUM = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const
const money = (cents: number) => formatMoney(cents, 'PLN')
const wholePln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 })
/** Pasek roku: pełne złote (mniej miejsca). */
const moneyShort = (cents: number) => wholePln.format(Math.round(cents / 100))
const monthLabel = (m: string, fmt = 'MMMM YYYY') => dayjs(`${m}-01`).locale('pl').format(fmt)
const shift = (m: string, n: number) => dayjs(`${m}-01`).add(n, 'month').format('YYYY-MM')
const resultColor = (v: number) => (v < 0 ? 'red.7' : v > 0 ? 'teal.7' : undefined)

/** Pasek roku: 4 wiersze × 12 miesięcy; kliknięcie miesiąca przełącza widok. */
function YearStrip({ plan, onPick }: { plan: FinancePlanResponse; onPick: (m: string) => void }) {
  const { t } = useTranslation()
  type M = FinancePlanResponse['year'][number]
  // Wykonanie (inFakt + pracownicy) i plan (ręczne pozycje + koszty stałe + pracownicy).
  const rows = [
    ['revenue', (s: M) => s.revenue, false],
    ['invoiceCosts', (s: M) => -s.invoiceCosts, false],
    ['staffCosts', (s: M) => -s.staffCosts, false],
    ['result', (s: M) => s.result, true],
    ['plannedRevenue', (s: M) => s.plannedRevenue, false],
    ['plannedCosts', (s: M) => -s.plannedCosts, false],
    ['fixedCosts', (s: M) => -s.fixedCosts, false],
    ['plannedResult', (s: M) => s.plannedResult, true],
  ] as const
  return (
    <Card withBorder padding="xs">
      <Table.ScrollContainer minWidth={1100}>
        <Table fz="xs" verticalSpacing={4} horizontalSpacing={6} style={NUM}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('finance.year.title', { year: plan.month.slice(0, 4) })}</Table.Th>
              {plan.year.map((s) => (
                <Table.Th key={s.month} ta="right" bg={s.month === plan.month ? 'var(--mantine-color-blue-light)' : undefined}>
                  <Anchor component="button" size="xs" fw={s.month === plan.month ? 700 : 500} onClick={() => onPick(s.month)}>
                    {monthLabel(s.month, 'MMM')}
                  </Anchor>
                </Table.Th>
              ))}
              <Table.Th ta="right">{t('finance.year.total')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(([key, value, bold]) => {
              const total = plan.year.reduce((s, m) => s + value(m), 0)
              const planned = key.startsWith('planned') || key === 'fixedCosts'
              return (
                <Table.Tr key={key} fw={bold ? 600 : undefined} style={key === 'plannedRevenue' ? { borderTop: '2px solid var(--mantine-color-default-border)' } : undefined}>
                  <Table.Td c={planned && !bold ? 'dimmed' : undefined} style={{ whiteSpace: 'nowrap' }}>
                    {t(`finance.year.${key}`)}
                  </Table.Td>
                  {plan.year.map((s) => {
                    const v = value(s)
                    return (
                      <Table.Td key={s.month} ta="right" c={v === 0 ? 'dimmed' : bold ? resultColor(v) : undefined} bg={s.month === plan.month ? 'var(--mantine-color-blue-light)' : undefined}>
                        {v === 0 ? '·' : moneyShort(v)}
                      </Table.Td>
                    )
                  })}
                  <Table.Td ta="right" c={bold ? resultColor(total) : undefined}>
                    {moneyShort(total)}
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  )
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz={22} fw={700} c={color} style={NUM}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Card>
  )
}

function RevenueSection({ plan }: { plan: FinancePlanResponse }) {
  const { t } = useTranslation()
  const { invoices, foreign } = plan.revenue
  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        {t('finance.revenue.title')}
      </Title>
      {invoices.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('finance.revenue.empty')}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('finance.revenue.number')}</Table.Th>
                <Table.Th>{t('finance.revenue.client')}</Table.Th>
                <Table.Th>{t('finance.revenue.date')}</Table.Th>
                <Table.Th>{t('finance.revenue.paymentDate')}</Table.Th>
                <Table.Th>{t('finance.revenue.status')}</Table.Th>
                <Table.Th ta="right">{t('finance.revenue.net')}</Table.Th>
                <Table.Th ta="right">{t('finance.revenue.gross')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {invoices.map((i) => (
                <Table.Tr key={i.id} c={i.currency !== 'PLN' ? 'dimmed' : undefined}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {i.number ?? '—'}
                    {i.kind !== 'vat' && (
                      <Badge ml={6} size="xs" variant="outline" color="gray">
                        {i.kind}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{i.clientName ?? '—'}</Table.Td>
                  <Table.Td style={NUM}>{formatDate(i.invoiceDate)}</Table.Td>
                  <Table.Td style={NUM}>{formatDate(i.paymentDate)}</Table.Td>
                  <Table.Td>
                    {i.status && (
                      <Badge size="sm" variant="light" color={i.status === 'paid' ? 'teal' : i.status === 'draft' ? 'gray' : 'blue'}>
                        {t(`finance.revenue.statuses.${i.status}`, { defaultValue: i.status })}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right" style={NUM}>
                    {formatMoney(i.netPrice, i.currency)}
                  </Table.Td>
                  <Table.Td ta="right" style={NUM}>
                    {formatMoney(i.grossPrice, i.currency)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={600}>
                <Table.Td colSpan={5}>{t('finance.costs.total')} (PLN)</Table.Td>
                <Table.Td ta="right" style={NUM}>
                  {money(plan.revenue.net)}
                </Table.Td>
                <Table.Td ta="right" style={NUM}>
                  {money(plan.revenue.gross)}
                </Table.Td>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}
      {foreign > 0 && (
        <Text size="xs" c="orange.8" mt="xs">
          {t('finance.revenue.foreign', { count: foreign })}
        </Text>
      )}
    </Card>
  )
}

const NO_CATEGORY = '__none__'

/** Macierz kosztów: wiersze — projekty, koszty ogólne, nieprzypisane; kolumny — kategorie i „Bez kategorii”. */
function CostsSection({ plan, onOpen }: { plan: FinancePlanResponse; onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const { cells, projects, categories, invoices, missingAmount, foreign } = plan.costs
  const { rows, cols } = useMemo(() => {
    const rowKey = (c: FinanceCostCell) => (c.kind === 'project' ? c.projectId! : c.kind)
    const rows = [
      ...projects.map((p) => ({ key: p.id, label: `${p.code} — ${p.name}`, color: undefined as string | undefined })),
      { key: 'general', label: t('finance.costs.general'), color: 'dimmed' },
      { key: 'unassigned', label: t('finance.costs.unassigned'), color: 'orange.8' },
    ].filter((r) => cells.some((c) => rowKey(c) === r.key))
    const cols = [...categories.map((k) => ({ key: k.id, label: k.name })), { key: NO_CATEGORY, label: t('finance.costs.noCategory') }].filter((k) =>
      cells.some((c) => (c.categoryId ?? NO_CATEGORY) === k.key),
    )
    const value = new Map<string, number>()
    for (const c of cells) {
      const k = `${rowKey(c)}|${c.categoryId ?? NO_CATEGORY}`
      value.set(k, (value.get(k) ?? 0) + c.net)
    }
    return { rows: rows.map((r) => ({ ...r, cells: cols.map((k) => value.get(`${r.key}|${k.key}`) ?? 0) })), cols }
  }, [cells, projects, categories, t])

  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        {t('finance.costs.title')}
      </Title>
      {rows.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('finance.costs.empty')}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table striped withColumnBorders fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('finance.costs.project')}</Table.Th>
                {cols.map((k) => (
                  <Table.Th key={k.key} ta="right" c={k.key === NO_CATEGORY ? 'dimmed' : undefined} style={{ whiteSpace: 'nowrap' }}>
                    {k.label}
                  </Table.Th>
                ))}
                <Table.Th ta="right">{t('finance.costs.total')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.key}>
                  <Table.Td c={r.color} style={{ whiteSpace: 'nowrap' }}>
                    {r.label}
                  </Table.Td>
                  {r.cells.map((v, idx) => (
                    <Table.Td key={cols[idx]!.key} ta="right" c={v ? undefined : 'dimmed'} style={NUM}>
                      {v ? money(v) : '·'}
                    </Table.Td>
                  ))}
                  <Table.Td ta="right" fw={600} style={NUM}>
                    {money(r.cells.reduce((s, v) => s + v, 0))}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={600}>
                <Table.Td>{t('finance.costs.total')}</Table.Td>
                {cols.map((k, idx) => (
                  <Table.Td key={k.key} ta="right" style={NUM}>
                    {money(rows.reduce((s, r) => s + r.cells[idx]!, 0))}
                  </Table.Td>
                ))}
                <Table.Td ta="right" style={NUM}>
                  {money(plan.costs.net)}
                </Table.Td>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}
      {missingAmount > 0 && (
        <Text size="xs" c="orange.8" mt="xs">
          {t('finance.costs.missingAmount', { count: missingAmount })}
        </Text>
      )}
      {foreign > 0 && (
        <Text size="xs" c="orange.8" mt={4}>
          {t('finance.costs.foreign', { count: foreign })}
        </Text>
      )}
      {invoices.length > 0 && (
        <Accordion mt="sm" variant="contained" chevronPosition="left">
          <Accordion.Item value="list">
            <Accordion.Control>
              <Text size="sm">{t('finance.costs.list', { count: invoices.length })}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Table.ScrollContainer minWidth={800}>
                <Table fz="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('finance.costs.date')}</Table.Th>
                      <Table.Th>{t('finance.costs.seller')}</Table.Th>
                      <Table.Th>{t('finance.costs.number')}</Table.Th>
                      <Table.Th>{t('finance.costs.category')}</Table.Th>
                      <Table.Th>{t('finance.costs.allocation')}</Table.Th>
                      <Table.Th>{t('finance.costs.status')}</Table.Th>
                      <Table.Th ta="right">{t('finance.costs.net')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {invoices.map((i) => (
                      <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(i.id)}>
                        <Table.Td style={NUM}>{formatDate(i.date)}</Table.Td>
                        <Table.Td>{i.sellerName ?? '—'}</Table.Td>
                        <Table.Td>{i.number ?? '—'}</Table.Td>
                        <Table.Td c={i.categoryName ? undefined : 'dimmed'}>{i.categoryName ?? t('finance.costs.noCategory')}</Table.Td>
                        <Table.Td>{i.allocation}</Table.Td>
                        <Table.Td>
                          <Badge size="sm" variant="light" color={i.status === 'approved' ? 'teal' : i.status === 'rejected' ? 'red' : i.status === 'pending' ? 'yellow' : 'gray'}>
                            {t(`invoices.status.${i.status}`)}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right" c={i.netPrice == null ? 'orange.8' : undefined} style={NUM}>
                          {formatMoney(i.netPrice, i.currency)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Card>
  )
}

function StaffSection({ plan }: { plan: FinancePlanResponse }) {
  const { t } = useTranslation()
  const { rows } = plan.staff
  const basis = (r: FinanceStaffRow) => {
    if (r.missingPay) return null
    if (r.payBasis === 'hourly') return t('finance.staff.hourly', { amount: money(r.payAmount!), hours: r.hours })
    return t('finance.staff.monthly', { amount: money(r.payAmount!) })
  }
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t('finance.staff.title')}</Title>
        <Tooltip label={t('finance.staff.hint')} multiline w={340}>
          <IconInfoCircle size={18} color="var(--mantine-color-dimmed)" />
        </Tooltip>
      </Group>
      {rows === null ? (
        <Stack gap={4}>
          <Text size="sm" style={NUM}>
            {t('finance.staff.pay')}: {money(plan.staff.pay)} · {t('finance.staff.employer')}: {money(plan.staff.employer)} · <b>{money(plan.staff.total)}</b>
          </Text>
          <Text size="xs" c="dimmed">
            {t('finance.staff.hiddenRows')}
          </Text>
        </Stack>
      ) : rows.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('finance.staff.empty')}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('finance.staff.name')}</Table.Th>
                <Table.Th>{t('finance.staff.contract')}</Table.Th>
                <Table.Th>{t('finance.staff.basis')}</Table.Th>
                <Table.Th ta="right">{t('finance.staff.pay')}</Table.Th>
                <Table.Th ta="right">{t('finance.staff.employer')}</Table.Th>
                <Table.Th ta="right">{t('finance.staff.total')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.employeeId} c={r.invoiced ? 'dimmed' : undefined}>
                  <Table.Td>
                    <Text size="sm">{r.name}</Text>
                    {r.position && (
                      <Text size="xs" c="dimmed">
                        {r.position}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {r.contractType ? t(`employees.contractType.${r.contractType}`) : '—'}
                    {r.fraction < 1 && (
                      <Badge ml={6} size="xs" variant="outline">
                        {t('finance.staff.fraction', { pct: Math.round(r.fraction * 100) })}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td style={NUM}>
                    {r.missingPay ? (
                      <Text size="sm" c="orange.8">
                        {t('finance.staff.missingPay')}
                      </Text>
                    ) : (
                      basis(r)
                    )}
                  </Table.Td>
                  {r.invoiced ? (
                    <Table.Td colSpan={3} ta="right">
                      <Text size="xs" c="dimmed">
                        {t('finance.staff.invoiced')}
                      </Text>
                    </Table.Td>
                  ) : (
                    <>
                      <Table.Td ta="right" style={NUM}>
                        {money(r.pay)}
                      </Table.Td>
                      <Table.Td ta="right" style={NUM} c={r.employerCost ? undefined : 'dimmed'}>
                        {r.employerCost ? `${money(r.employerCost)} (${r.employerRate.toLocaleString('pl-PL')}%)` : '—'}
                      </Table.Td>
                      <Table.Td ta="right" fw={600} style={NUM}>
                        {money(r.total)}
                      </Table.Td>
                    </>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={600}>
                <Table.Td colSpan={3}>{t('finance.costs.total')}</Table.Td>
                <Table.Td ta="right" style={NUM}>
                  {money(plan.staff.pay)}
                </Table.Td>
                <Table.Td ta="right" style={NUM}>
                  {money(plan.staff.employer)}
                </Table.Td>
                <Table.Td ta="right" style={NUM}>
                  {money(plan.staff.total)}
                </Table.Td>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}

/**
 * Plan finansowy (Finanse): jeden miesiąc na ekranie — przychody z faktur sprzedażowych inFakt, koszty z faktur
 * kosztowych w podziale na projekty i kategorie oraz stałe koszty pracownicze; nad nimi pasek całego roku.
 */
export function FinancePlanPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [month, setMonth] = useState(() => todayWarsaw().slice(0, 7))
  const [open, setOpen] = useState<string | null>(null)
  // Widok miesiąca albo edycja planu całego roku (siatka); przy niezapisanych zmianach w siatce nawigacja jest zablokowana.
  const [view, setView] = useState<'month' | 'year'>('month')
  const [dirty, setDirty] = useState(false)
  const step = view === 'year' ? 12 : 1
  const q = useFinancePlan(month)
  const sync = useSyncInvoices()
  const plan = q.data

  const runSync = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => {
        notifications.show({ color: 'green', message: t('finance.synced', { created: r.created, updated: r.updated, salesCreated: r.sales?.created ?? 0, salesUpdated: r.sales?.updated ?? 0 }) })
        if (r.salesError) notifications.show({ color: 'orange', autoClose: false, message: t('finance.salesError', { error: t(r.salesError === 'infakt_unauthorized' ? 'finance.salesUnauthorized' : 'finance.salesFailed') }) })
      },
      onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
    })

  const margin = plan && plan.revenue.net > 0 ? Math.round((plan.result / plan.revenue.net) * 1000) / 10 : null

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>{t('finance.title')}</Title>
          {plan && (
            <Text size="xs" c="dimmed">
              {plan.sales.lastSync ? t('finance.lastSync', { at: formatDateTime(plan.sales.lastSync) }) : t('finance.neverSynced')}
            </Text>
          )}
        </Stack>
        <Group gap="xs" align="flex-end">
          <SegmentedControl
            value={view}
            disabled={dirty}
            onChange={(v) => setView(v as 'month' | 'year')}
            data={[
              { value: 'month', label: t('finance.view.month') },
              { value: 'year', label: t('finance.view.year') },
            ]}
          />
          <Tooltip label={t('finance.yearPlan.saveFirst')} disabled={!dirty}>
            <Group gap="xs" wrap="nowrap">
              <ActionIcon variant="default" size="lg" disabled={dirty} aria-label={t(view === 'year' ? 'finance.prevYear' : 'finance.prevMonth')} onClick={() => setMonth((m) => shift(m, -step))}>
                <IconChevronLeft size={18} />
              </ActionIcon>
              {view === 'year' ? (
                <YearPickerInput w={110} aria-label={t('finance.yearLabel')} disabled={dirty} value={dayjs(`${month}-01`).toDate()} onChange={(d) => d && setMonth(`${dayjs(d).format('YYYY')}-${month.slice(5)}`)} />
              ) : (
                <MonthPickerInput
                  w={170}
                  aria-label={t('finance.month')}
                  valueFormat="MMMM YYYY"
                  locale="pl"
                  value={dayjs(`${month}-01`).toDate()}
                  onChange={(d) => d && setMonth(dayjs(d).format('YYYY-MM'))}
                />
              )}
              <ActionIcon variant="default" size="lg" disabled={dirty} aria-label={t(view === 'year' ? 'finance.nextYear' : 'finance.nextMonth')} onClick={() => setMonth((m) => shift(m, step))}>
                <IconChevronRight size={18} />
              </ActionIcon>
            </Group>
          </Tooltip>
          {can('invoices', 'create') && (
            <Button leftSection={<IconRefresh size={16} />} loading={sync.isPending} disabled={plan && !plan.sales.configured} onClick={runSync}>
              {t('finance.sync')}
            </Button>
          )}
        </Group>
      </Group>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      {!plan ? (
        <Loader />
      ) : view === 'year' ? (
        <>
          <YearPlanEditor plan={plan} onDirtyChange={setDirty} />
          <FixedCostsSection plan={plan} />
        </>
      ) : (
        <>
          <YearStrip plan={plan} onPick={setMonth} />
          <Group justify="flex-end" mt={-8}>
            <Button size="xs" variant="subtle" onClick={() => setView('year')}>
              {t('finance.yearPlan.open')}
            </Button>
          </Group>
          <Title order={3} tt="capitalize">
            {monthLabel(plan.month)}
          </Title>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
            <SummaryCard label={t('finance.cards.revenue')} value={money(plan.revenue.net)} sub={t('finance.cards.planned', { amount: money(plan.planned.revenue) })} />
            <SummaryCard
              label={t('finance.cards.invoiceCosts')}
              value={money(plan.costs.net)}
              sub={t('finance.cards.plannedCosts', { amount: money(plan.planned.costs), fixed: money(plan.fixed.total) })}
            />
            <SummaryCard label={t('finance.cards.staffCosts')} value={money(plan.staff.total)} sub={t('finance.cards.staffCount', { count: plan.staff.count })} />
            <SummaryCard
              label={t('finance.cards.result')}
              value={money(plan.result)}
              color={resultColor(plan.result)}
              sub={[margin != null ? t('finance.cards.margin', { pct: margin.toLocaleString('pl-PL') }) : null, t('finance.cards.planned', { amount: money(plan.planned.result) })].filter(Boolean).join(' · ')}
            />
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            {t('finance.hint')}
          </Text>
          <PlannedSection plan={plan} />
          <RevenueSection plan={plan} />
          <CostsSection plan={plan} onOpen={setOpen} />
          <FixedCostsSection plan={plan} />
          <StaffSection plan={plan} />
        </>
      )}
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
    </Stack>
  )
}
