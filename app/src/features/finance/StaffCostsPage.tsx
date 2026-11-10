import { Accordion, ActionIcon, Alert, Badge, Box, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { YearPickerInput } from '@mantine/dates'
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconInfoCircle } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STAFF_GROUPS, type StaffCostCell, type StaffCostRow, type StaffCostsResponse, type StaffGroup, type StaffIssue, type StaffIssueSeverity } from '#shared'
import { errorMessage } from '../../lib/errors'
import { formatDate, todayWarsaw } from '../../lib/format'
import { formatMoney } from '../invoices/status'
import { useStaffCosts } from './api'

const NUM = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const
const wholePln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 })
const short = (cents: number) => wholePln.format(Math.round(cents / 100))
const monthLabel = (m: string, fmt = 'MMM') => dayjs(`${m}-01`).locale('pl').format(fmt)
const GROUP_COLOR: Record<StaffGroup, string> = { employment: 'blue', mandate: 'teal', b2b: 'grape', other: 'gray' }
const SEVERITY_RANK: Record<StaffIssueSeverity, number> = { red: 0, orange: 1, yellow: 2, gray: 3 }
const SEVERITY_COLOR: Record<StaffIssueSeverity, string> = { red: 'red', orange: 'orange', yellow: 'yellow', gray: 'gray' }
const FORECAST_BG = 'var(--mantine-color-gray-light)'
const HATCH = 'repeating-linear-gradient(135deg, transparent 0 5px, var(--mantine-color-gray-light-hover) 5px 7px)'
const STICKY = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--mantine-color-body)', minWidth: 230 } as const

type Mode = 'contracts' | 'extended'
type Val = { amount: number; employer: number }

/** Kwota komórki w wybranym trybie: po końcu umowy — prognoza po przedłużeniu (tylko tryb „extended”). */
const val = (c: StaffCostCell, mode: Mode): Val => (mode === 'extended' && c.extended ? c.extended : { amount: c.amount, employer: c.employer })
const add = (a: Val, b: Val): Val => ({ amount: a.amount + b.amount, employer: a.employer + b.employer })
const ZERO: Val = { amount: 0, employer: 0 }

function worstIssue(issues: StaffIssue[]): StaffIssue | null {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0] ?? null
}

function useIssueText() {
  const { t } = useTranslation()
  return (i: StaffIssue, today: string) =>
    t(`staffCosts.issue.${i.code}`, {
      date: i.date ? formatDate(i.date) : '',
      month: i.month ? monthLabel(i.month, 'MMMM YYYY') : '',
      days: i.date ? dayjs(i.date).diff(dayjs(today), 'day') : 0,
    })
}

function CellTip({ row, c, mode }: { row: StaffCostRow; c: StaffCostCell; mode: Mode }) {
  const { t } = useTranslation()
  const v = val(c, mode)
  const lines: string[] = []
  if (c.source === 'forecast') lines.push(row.forecastBasis === 'avg' ? t('staffCosts.tip.forecastAvg') : row.group === 'employment' ? t('staffCosts.tip.forecast') : t('staffCosts.tip.forecastCard'))
  else if (c.source) lines.push(t(`staffCosts.tip.${c.source}`))
  for (const m of c.marks) {
    const date = m === 'contract_start' ? row.contractStart : m === 'contract_end' ? row.contractEnd : m === 'student_end' ? row.studentUntil : null
    lines.push(t(`staffCosts.mark.${m}`, { date: date ? formatDate(date) : '' }))
  }
  if (c.extended) lines.push(t('staffCosts.tip.extended', { amount: formatMoney(c.extended.amount) }))
  if (v.employer) lines.push(t('staffCosts.tip.employer', { amount: formatMoney(v.employer) }))
  if (c.paid && row.group === 'employment') lines.push(t('staffCosts.tip.paid', { amount: formatMoney(c.paid) }))
  return (
    <Stack gap={2}>
      {lines.map((l, i) => (
        <Text key={i} size="xs">
          {l}
        </Text>
      ))}
      {c.docs.map((d, i) => (
        <Text key={`d${i}`} size="xs" c="dimmed" maw={360} truncate>
          {formatDate(d.date)} · {formatMoney(d.amount)} · {d.label}
        </Text>
      ))}
    </Stack>
  )
}

function PersonRows({ row, data, mode }: { row: StaffCostRow; data: StaffCostsResponse; mode: Mode }) {
  const { t } = useTranslation()
  const issueText = useIssueText()
  const worst = worstIssue(row.issues)
  const vals = row.cells.map((c) => val(c, mode))
  const total = vals.reduce(add, ZERO)
  return (
    <>
      <Table.Tr>
        <Table.Td style={STICKY}>
          <Group gap={6} wrap="nowrap">
            <Badge size="xs" variant="light" color={GROUP_COLOR[row.group]} w={42}>
              {row.contractType ? t(`employees.contractShort.${row.contractType}`) : '—'}
            </Badge>
            <Box miw={0}>
              <Text size="sm" fw={500} truncate c={row.isActive ? undefined : 'dimmed'}>
                {row.name}
              </Text>
              <Tooltip label={row.issues.map((i) => issueText(i, data.today)).join(' ')} disabled={!row.issues.length} multiline w={320}>
                <Text size="xs" c={worst ? SEVERITY_COLOR[worst.severity] : 'dimmed'} fw={worst && worst.severity !== 'gray' ? 600 : undefined}>
                  {row.contractEnd ? t('staffCosts.until', { date: formatDate(row.contractEnd) }) : t('staffCosts.indefinite')}
                  {worst && worst.severity !== 'yellow' && <IconAlertTriangle size={11} style={{ marginLeft: 4, verticalAlign: -1 }} />}
                </Text>
              </Tooltip>
            </Box>
          </Group>
        </Table.Td>
        {row.cells.map((c, i) => {
          const v = vals[i]!
          const forecast = c.month >= data.currentMonth
          const ext = mode === 'extended' && !!c.extended
          const late = c.marks.includes('paid_after_end')
          const after = c.marks.includes('after_end') && !ext
          return (
            <Table.Td
              key={c.month}
              ta="right"
              style={{
                background: late ? 'var(--mantine-color-red-light)' : after ? HATCH : forecast ? FORECAST_BG : undefined,
                borderRight: c.marks.includes('contract_end') ? '3px solid var(--mantine-color-orange-6)' : undefined,
              }}
            >
              <Tooltip label={<CellTip row={row} c={c} mode={mode} />} disabled={!c.source && !c.marks.length && !c.extended} withinPortal>
                <Text size="sm" span fs={forecast ? 'italic' : undefined} c={ext ? 'orange.8' : v.amount ? (forecast ? 'dimmed' : undefined) : 'dimmed'}>
                  {v.amount ? short(v.amount) : '·'}
                </Text>
              </Tooltip>
            </Table.Td>
          )
        })}
        <Table.Td ta="right" fw={600}>
          {short(total.amount)}
        </Table.Td>
      </Table.Tr>
      {total.employer > 0 && (
        <Table.Tr>
          <Table.Td style={STICKY}>
            <Text size="xs" c="dimmed" pl={48}>
              + {t('staffCosts.employerRow')}
            </Text>
          </Table.Td>
          {vals.map((v, i) => (
            <Table.Td key={i} ta="right" style={{ background: row.cells[i]!.month >= data.currentMonth ? FORECAST_BG : undefined }}>
              <Text size="xs" c="dimmed" span>
                {v.employer ? short(v.employer) : ''}
              </Text>
            </Table.Td>
          ))}
          <Table.Td ta="right">
            <Text size="xs" c="dimmed" span>
              {short(total.employer)}
            </Text>
          </Table.Td>
        </Table.Tr>
      )}
    </>
  )
}

function SumRows({ label, values, data, color, bold }: { label: string; values: Val[]; data: StaffCostsResponse; color?: string; bold?: boolean }) {
  const { t } = useTranslation()
  const total = values.reduce(add, ZERO)
  const line = (name: string, pick: (v: Val) => number, strong: boolean) => (
    <Table.Tr fw={strong ? 700 : 500} bg={bold ? 'var(--mantine-color-default-hover)' : undefined}>
      <Table.Td style={{ ...STICKY, background: bold ? 'var(--mantine-color-default-hover)' : STICKY.background }}>
        <Text size="sm" fw={strong ? 700 : 500} c={color}>
          {name}
        </Text>
      </Table.Td>
      {values.map((v, i) => (
        <Table.Td key={i} ta="right" style={{ background: data.months[i]! >= data.currentMonth ? FORECAST_BG : undefined }}>
          <Text size="sm" span fw={strong ? 700 : 500} fs={data.months[i]! >= data.currentMonth ? 'italic' : undefined}>
            {pick(v) ? short(pick(v)) : '·'}
          </Text>
        </Table.Td>
      ))}
      <Table.Td ta="right">{short(pick(total))}</Table.Td>
    </Table.Tr>
  )
  return (
    <>
      {line(`${label} — ${t('staffCosts.groupPay').toLowerCase()}`, (v) => v.amount, false)}
      {line(`${label} — ${t('staffCosts.groupEmployer').toLowerCase()}`, (v) => v.employer, false)}
      {line(`${label} — ${t('staffCosts.groupTotal').toLowerCase()}`, (v) => v.amount + v.employer, true)}
    </>
  )
}

/** Słupki: koszt miesiąca (wynagrodzenie + pracodawca) wg grup; prognoza półprzezroczysta. */
function MonthBars({ data, perGroup }: { data: StaffCostsResponse; perGroup: Record<StaffGroup, Val[]> }) {
  const { t } = useTranslation()
  const totals = data.months.map((_, i) => STAFF_GROUPS.reduce((s, g) => s + perGroup[g][i]!.amount + perGroup[g][i]!.employer, 0))
  const max = Math.max(1, ...totals)
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text size="sm" fw={600}>
          {t('staffCosts.chart')}
        </Text>
        <Group gap="sm">
          {STAFF_GROUPS.filter((g) => perGroup[g].some((v) => v.amount)).map((g) => (
            <Group key={g} gap={4}>
              <Box w={10} h={10} bg={`${GROUP_COLOR[g]}.6`} style={{ borderRadius: 2 }} />
              <Text size="xs">{t(`staffCosts.group.${g}`)}</Text>
            </Group>
          ))}
          <Text size="xs" c="dimmed" fs="italic">
            ░ {t('staffCosts.forecast')}
          </Text>
        </Group>
      </Group>
      <Group gap={6} align="flex-end" wrap="nowrap" h={150}>
        {data.months.map((m, i) => (
          <Tooltip key={m} label={`${monthLabel(m, 'MMMM YYYY')}: ${formatMoney(totals[i]!)}`}>
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }} align="stretch" justify="flex-end" h="100%">
              <Text size="10px" ta="center" c="dimmed" style={NUM}>
                {totals[i] ? `${Math.round(totals[i]! / 100_000)}k` : ''}
              </Text>
              <Stack gap={0} justify="flex-end" style={{ height: `${(totals[i]! / max) * 110}px`, opacity: m >= data.currentMonth ? 0.45 : 1, borderRadius: 3, overflow: 'hidden' }}>
                {[...STAFF_GROUPS].reverse().map((g) => {
                  const v = perGroup[g][i]!.amount + perGroup[g][i]!.employer
                  return v ? <Box key={g} bg={`${GROUP_COLOR[g]}.6`} style={{ flex: v }} /> : null
                })}
              </Stack>
              <Text size="xs" ta="center" fw={m === data.currentMonth ? 700 : undefined}>
                {monthLabel(m)}
              </Text>
            </Stack>
          </Tooltip>
        ))}
      </Group>
    </Card>
  )
}

export function StaffCostsPage() {
  const { t } = useTranslation()
  const issueText = useIssueText()
  const [year, setYear] = useState(() => todayWarsaw().slice(0, 4))
  const [mode, setMode] = useState<Mode>('contracts')
  const q = useStaffCosts(year)
  const data = q.data

  const calc = useMemo(() => {
    if (!data) return null
    const empty = () => data.months.map(() => ZERO)
    const perGroup = Object.fromEntries(STAFF_GROUPS.map((g) => [g, empty()])) as Record<StaffGroup, Val[]>
    for (const r of data.rows) r.cells.forEach((c, i) => (perGroup[r.group][i] = add(perGroup[r.group][i]!, val(c, mode))))
    const all = data.months.map((_, i) => STAFF_GROUPS.reduce((s, g) => add(s, perGroup[g][i]!), ZERO))
    const headcount = data.months.map((_, i) => data.rows.filter((r) => val(r.cells[i]!, mode).amount > 0).length)
    const cost = (v: Val) => v.amount + v.employer
    const actualIdx = data.months.map((m, i) => (m < data.currentMonth ? i : -1)).filter((i) => i >= 0)
    const actual = actualIdx.reduce((s, i) => s + cost(all[i]!), 0)
    const forecast = data.months.reduce((s, m, i) => (m >= data.currentMonth ? s + cost(all[i]!) : s), 0)
    const issues = data.rows.flatMap((r) => r.issues.map((i) => ({ row: r, issue: i }))).sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity])
    // Wyliczone koszty bez B2B (do porównania z wyciągami).
    const nonB2b = data.months.map((_, i) => cost(perGroup.employment[i]!) + cost(perGroup.mandate[i]!) + cost(perGroup.other[i]!))
    return { perGroup, all, headcount, actual, forecast, actualMonths: actualIdx.length, issues, nonB2b }
  }, [data, mode])

  if (q.isLoading) return <Loader />
  if (q.error || !data || !calc) return <Alert color="red">{errorMessage(q.error)}</Alert>

  const nextIdx = data.months.findIndex((m) => m >= data.currentMonth)
  const nextOf = (g: StaffGroup) => (nextIdx >= 0 ? short(calc.perGroup[g][nextIdx]!.amount + calc.perGroup[g][nextIdx]!.employer) : '—')
  const urgent = calc.issues.filter((i) => i.issue.severity === 'red' || i.issue.severity === 'orange').length

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Title order={2}>{t('staffCosts.title')}</Title>
          <Tooltip label={t('staffCosts.hint')} multiline w={440}>
            <IconInfoCircle size={18} color="var(--mantine-color-dimmed)" />
          </Tooltip>
        </Group>
        <Group gap="xs">
          <SegmentedControl size="xs" value={mode} onChange={(v) => setMode(v as Mode)} data={(['contracts', 'extended'] as const).map((m) => ({ value: m, label: t(`staffCosts.mode.${m}`) }))} />
          <ActionIcon variant="default" aria-label={t('staffCosts.prevYear')} onClick={() => setYear(String(Number(year) - 1))}>
            <IconChevronLeft size={16} />
          </ActionIcon>
          <YearPickerInput size="xs" w={90} value={dayjs(`${year}-01-01`).toDate()} onChange={(d) => d && setYear(dayjs(d).format('YYYY'))} />
          <ActionIcon variant="default" aria-label={t('staffCosts.nextYear')} onClick={() => setYear(String(Number(year) + 1))}>
            <IconChevronRight size={16} />
          </ActionIcon>
          {q.isFetching && <Loader size="xs" />}
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        <Card withBorder padding="sm">
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.year', { year })}
          </Text>
          <Text size="xl" fw={700} style={NUM}>
            {short(calc.actual + calc.forecast)}
          </Text>
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.yearSub', { actual: short(calc.actual), forecast: short(calc.forecast) })}
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.avg')}
          </Text>
          <Text size="xl" fw={700} style={NUM}>
            {calc.actualMonths ? short(calc.actual / calc.actualMonths) : '—'}
          </Text>
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.avgSub', { count: calc.actualMonths })}
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.next', { month: nextIdx >= 0 ? monthLabel(data.months[nextIdx]!, 'MMMM') : '—' })}
          </Text>
          <Text size="xl" fw={700} style={NUM}>
            {nextIdx >= 0 ? short(calc.all[nextIdx]!.amount + calc.all[nextIdx]!.employer) : '—'}
          </Text>
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.nextSub', { employment: nextOf('employment'), mandate: nextOf('mandate'), b2b: nextOf('b2b') })}
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.issues')}
          </Text>
          <Text size="xl" fw={700} c={urgent ? 'red.7' : undefined}>
            {calc.issues.length}
          </Text>
          <Text size="xs" c="dimmed">
            {t('staffCosts.cards.issuesSub', { count: urgent })}
          </Text>
        </Card>
      </SimpleGrid>

      {data.missingContract.length > 0 && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          {t('staffCosts.missingContract', { names: data.missingContract.join(', ') })}
        </Alert>
      )}

      {calc.issues.length > 0 && (
        <Card withBorder padding="sm">
          <Text size="sm" fw={600} mb="xs">
            {t('staffCosts.issuesTitle')}
          </Text>
          <Stack gap={4}>
            {calc.issues.map(({ row, issue }, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Badge size="xs" color={SEVERITY_COLOR[issue.severity]} variant={issue.severity === 'red' ? 'filled' : 'light'} w={14} p={0} circle>
                  {' '}
                </Badge>
                <Text size="sm" fw={500} miw={180}>
                  {row.name}{' '}
                  <Text span size="xs" c="dimmed">
                    {row.contractType ? t(`employees.contractShort.${row.contractType}`) : ''}
                  </Text>
                </Text>
                <Text size="sm">{issueText(issue, data.today)}</Text>
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      <MonthBars data={data} perGroup={calc.perGroup} />

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={1300}>
          <Table fz="sm" verticalSpacing={3} horizontalSpacing={6} style={NUM} withColumnBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={STICKY}>{t('staffCosts.col.person')}</Table.Th>
                {data.months.map((m) => (
                  <Table.Th key={m} ta="right" style={{ background: m >= data.currentMonth ? FORECAST_BG : undefined }}>
                    <Text size="sm" fw={m === data.currentMonth ? 800 : 600} span>
                      {monthLabel(m)}
                    </Text>
                    {m >= data.currentMonth && (
                      <Text size="10px" c="dimmed" fs="italic">
                        {t('staffCosts.forecast')}
                      </Text>
                    )}
                  </Table.Th>
                ))}
                <Table.Th ta="right">{t('staffCosts.col.total')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={14}>
                    <Text c="dimmed" size="sm" p="sm">
                      {t('staffCosts.empty')}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {STAFF_GROUPS.map((g) => {
                const rows = data.rows.filter((r) => r.group === g)
                if (!rows.length) return null
                return (
                  <Fragment key={g}>
                    <Table.Tr>
                      <Table.Td colSpan={14} bg={`var(--mantine-color-${GROUP_COLOR[g]}-light)`} style={{ borderTop: '2px solid var(--mantine-color-default-border)' }}>
                        <Text fw={700} size="sm" c={`${GROUP_COLOR[g]}.8`} style={{ position: 'sticky', left: 8, display: 'inline-block' }}>
                          {t(`staffCosts.group.${g}`)} ({rows.length}) <Text span size="xs" c="dimmed" fw={400}>— {t(`staffCosts.source.${g}`)}</Text>
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                    {rows.map((r) => (
                      <PersonRows key={r.employeeId} row={r} data={data} mode={mode} />
                    ))}
                    <SumRows label={t(`staffCosts.group.${g}`)} values={calc.perGroup[g]} data={data} color={`${GROUP_COLOR[g]}.8`} />
                  </Fragment>
                )
              })}
              {data.rows.length > 0 && (
                <>
                  <Table.Tr>
                    <Table.Td colSpan={14} style={{ borderTop: '3px double var(--mantine-color-default-border)' }}>
                      <Text fw={700} size="sm" style={{ position: 'sticky', left: 8, display: 'inline-block' }}>
                        {t('staffCosts.allTitle')}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                  <SumRows label={t('staffCosts.allTitle')} values={calc.all} data={data} bold />
                  <Table.Tr>
                    <Table.Td style={STICKY}>
                      <Text size="sm" c="dimmed">
                        {t('staffCosts.headcount')}
                      </Text>
                    </Table.Td>
                    {calc.headcount.map((n, i) => (
                      <Table.Td key={i} ta="right" c="dimmed">
                        {n || '·'}
                      </Table.Td>
                    ))}
                    <Table.Td />
                  </Table.Tr>
                </>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Card withBorder padding="sm">
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={600}>
            {t('staffCosts.bankTitle')}
          </Text>
          <Text size="xs" c="dimmed">
            {data.bankUntil ? t('staffCosts.bankUntil', { date: formatDate(data.bankUntil) }) : t('staffCosts.noBank')}
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={1100}>
          <Table fz="xs" verticalSpacing={3} horizontalSpacing={6} style={NUM}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                {data.months.map((m) => (
                  <Table.Th key={m} ta="right">
                    {monthLabel(m)}
                  </Table.Th>
                ))}
                <Table.Th ta="right">{t('staffCosts.col.total')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(['salaries', 'zus', 'pit'] as const).map((k) => (
                <Table.Tr key={k}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{t(`staffCosts.bank.${k}`)}</Table.Td>
                  {data.bank.map((b) => (
                    <Table.Td key={b.month} ta="right" c={b[k] ? undefined : 'dimmed'}>
                      {b[k] ? short(b[k]) : '·'}
                    </Table.Td>
                  ))}
                  <Table.Td ta="right">{short(data.bank.reduce((s, b) => s + b[k], 0))}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr fw={600}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{t('staffCosts.bank.computed')}</Table.Td>
                {calc.nonB2b.map((v, i) => (
                  <Table.Td key={i} ta="right" c="dimmed" fs={data.months[i]! >= data.currentMonth ? 'italic' : undefined}>
                    {v ? short(v) : '·'}
                  </Table.Td>
                ))}
                <Table.Td ta="right" c="dimmed">
                  {short(calc.nonB2b.reduce((s, v) => s + v, 0))}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      {data.unmatched.length > 0 && (
        <Accordion variant="contained">
          <Accordion.Item value="unmatched">
            <Accordion.Control icon={<IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />}>{t('staffCosts.unmatchedTitle', { count: data.unmatched.length })}</Accordion.Control>
            <Accordion.Panel>
              <Text size="xs" c="dimmed" mb="xs">
                {t('staffCosts.unmatchedHint')}
              </Text>
              <Table fz="xs" style={NUM}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('staffCosts.doc.date')}</Table.Th>
                    <Table.Th>{t('staffCosts.doc.name')}</Table.Th>
                    <Table.Th>{t('staffCosts.doc.title')}</Table.Th>
                    <Table.Th ta="right">{t('staffCosts.doc.amount')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.unmatched.map((u, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{formatDate(u.date)}</Table.Td>
                      <Table.Td>{u.name ?? '—'}</Table.Td>
                      <Table.Td>{u.title ?? '—'}</Table.Td>
                      <Table.Td ta="right">{formatMoney(u.amount)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Stack>
  )
}
