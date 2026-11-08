import { ActionIcon, Alert, Button, Card, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowBarToRight, IconPlus, IconTrash } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { planLineKey, type FinancePlanResponse, type PlanItemKind } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useCostCategories } from '../invoices/api'
import { useSavePlanYear } from './api'

const NUM = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const
const wholePln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 })
const short = (cents: number) => (cents ? wholePln.format(Math.round(cents / 100)) : '·')
const resultColor = (v: number) => (v < 0 ? 'red.7' : v > 0 ? 'teal.7' : undefined)

interface Line {
  /** Lokalny identyfikator wiersza (React key). */
  id: string
  kind: PlanItemKind
  name: string
  projectId: string | null
  costCategoryId: string | null
  /** Miesiąc → kwota w zł (jak w polu), '' = brak. */
  amounts: Record<string, number | ''>
}

let seq = 0
const newId = () => `l${++seq}`
const cents = (v: number | '' | undefined) => (v === '' || v == null ? 0 : Math.round(Number(v) * 100))

/** Pozycje roku → wiersze siatki (pozycje tego samego wiersza w jednym miesiącu są sumowane). */
function toLines(plan: FinancePlanResponse): Line[] {
  const byKey = new Map<string, Line>()
  for (const i of plan.planned.yearItems) {
    const key = planLineKey(i)
    const line = byKey.get(key) ?? { id: newId(), kind: i.kind, name: i.name, projectId: i.projectId, costCategoryId: i.kind === 'cost' ? i.costCategoryId : null, amounts: {} }
    line.amounts[i.month] = (cents(line.amounts[i.month]) + i.amount) / 100
    byKey.set(key, line)
  }
  return [...byKey.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'pl') : a.kind === 'revenue' ? -1 : 1))
}

/** Porównywalny zapis stanu (wykrywanie niezapisanych zmian). */
const snapshot = (lines: Line[]) =>
  JSON.stringify(lines.map((l) => [l.kind, l.name.trim(), l.projectId, l.costCategoryId, Object.entries(l.amounts).filter(([, v]) => cents(v) > 0).map(([m, v]) => [m, cents(v)]).sort()]))

/**
 * Edycja planu całego roku: wiersze (przychody i koszty) × 12 miesięcy, sumy na bieżąco, pod spodem koszty stałe,
 * pracownicze i wynik planowany (obok wyniku z wykonania). Zapis całego roku jednym przyciskiem.
 */
export function YearPlanEditor({ plan, onDirtyChange }: { plan: FinancePlanResponse; onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const categories = useCostCategories().data ?? []
  const save = useSavePlanYear()
  const editable = can('invoices', 'edit')
  const year = plan.month.slice(0, 4)
  const months = plan.year.map((m) => m.month)

  const initial = useMemo(() => toLines(plan), [plan])
  const [lines, setLines] = useState<Line[]>(initial)
  const [base, setBase] = useState(() => snapshot(initial))
  const dirty = snapshot(lines) !== base
  // Nowe dane z serwera (zapis, inny rok) — siatka od nowa, o ile nie ma niezapisanych zmian.
  useEffect(() => {
    if (!dirty) {
      setLines(initial)
      setBase(snapshot(initial))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tylko przy nowych danych
  }, [initial])
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const projectOptions = me.projects.map((p) => ({ value: p.id, label: p.code }))
  const categoryOptions = categories.filter((k) => k.active || lines.some((l) => l.costCategoryId === k.id)).map((k) => ({ value: k.id, label: k.name }))

  const update = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const setAmount = (id: string, month: string, v: number | '') => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, amounts: { ...l.amounts, [month]: v } } : l)))
  /** Kwota z pierwszego wypełnionego miesiąca do wszystkich kolejnych. */
  const fillRight = (l: Line) => {
    const from = months.findIndex((m) => cents(l.amounts[m]) > 0)
    if (from < 0) return
    const v = l.amounts[months[from]!]!
    update(l.id, { amounts: { ...l.amounts, ...Object.fromEntries(months.slice(from).map((m) => [m, v])) } })
  }
  const addLine = (kind: PlanItemKind) => setLines((ls) => [...ls, { id: newId(), kind, name: '', projectId: null, costCategoryId: null, amounts: {} }])

  const keys = lines.map((l) => planLineKey(l))
  const duplicate = keys.some((k, i) => keys.indexOf(k) !== i)
  const unnamed = lines.some((l) => !l.name.trim())

  const submit = () =>
    save.mutate(
      {
        year,
        lines: lines.map((l) => ({
          kind: l.kind,
          name: l.name.trim(),
          projectId: l.projectId,
          costCategoryId: l.kind === 'cost' ? l.costCategoryId : null,
          amounts: Object.fromEntries(Object.entries(l.amounts).filter(([, v]) => cents(v) > 0).map(([m, v]) => [m, cents(v)])),
        })),
      },
      {
        onSuccess: (r) => {
          setBase(snapshot(lines))
          notifications.show({ color: 'green', message: t('finance.yearPlan.saved', { ...r }) })
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )

  const sumKind = (kind: PlanItemKind, m: string) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + cents(l.amounts[m]), 0)
  const rowTotal = (l: Line) => months.reduce((s, m) => s + cents(l.amounts[m]), 0)
  const totalOf = (f: (m: string) => number) => months.reduce((s, m) => s + f(m), 0)
  const summary = new Map(plan.year.map((s) => [s.month, s]))
  const plannedResult = (m: string) => sumKind('revenue', m) - sumKind('cost', m) - summary.get(m)!.fixedCosts - summary.get(m)!.staffCosts

  const group = (kind: PlanItemKind) => {
    const rows = lines.filter((l) => l.kind === kind)
    return (
      <Table.Tbody key={kind}>
        <Table.Tr bg="var(--mantine-color-gray-light)">
          <Table.Td colSpan={2} fw={600}>
            <Group justify="space-between" wrap="nowrap">
              {t(kind === 'revenue' ? 'finance.plan.revenues' : 'finance.plan.costs')}
              {editable && (
                <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => addLine(kind)}>
                  {t('finance.yearPlan.addLine')}
                </Button>
              )}
            </Group>
          </Table.Td>
          {months.map((m) => (
            <Table.Td key={m} ta="right" fw={600} style={NUM}>
              {short(sumKind(kind, m))}
            </Table.Td>
          ))}
          <Table.Td ta="right" fw={600} style={NUM}>
            {short(totalOf((m) => sumKind(kind, m)))}
          </Table.Td>
          <Table.Td />
        </Table.Tr>
        {rows.map((l) => (
          <Table.Tr key={l.id}>
            <Table.Td style={{ position: 'sticky', left: 0, background: 'var(--mantine-color-body)', zIndex: 1 }}>
              <TextInput
                size="xs"
                w={190}
                placeholder={t('finance.plan.name')}
                aria-label={t('finance.plan.name')}
                value={l.name}
                readOnly={!editable}
                error={!l.name.trim() || keys.filter((k) => k === planLineKey(l)).length > 1}
                onChange={(e) => update(l.id, { name: e.currentTarget.value })}
              />
            </Table.Td>
            <Table.Td>
              <Stack gap={2} w={140}>
                <Select size="xs" placeholder={t('finance.plan.noProject')} aria-label={t('finance.plan.project')} clearable searchable data={projectOptions} value={l.projectId} readOnly={!editable} onChange={(v) => update(l.id, { projectId: v })} />
                {kind === 'cost' && (
                  <Select size="xs" placeholder={t('finance.costs.noCategory')} aria-label={t('finance.plan.category')} clearable searchable data={categoryOptions} value={l.costCategoryId} readOnly={!editable} onChange={(v) => update(l.id, { costCategoryId: v })} />
                )}
              </Stack>
            </Table.Td>
            {months.map((m) => (
              <Table.Td key={m} p={2}>
                <NumberInput
                  size="xs"
                  w={92}
                  hideControls
                  min={0}
                  decimalScale={2}
                  thousandSeparator=" "
                  decimalSeparator=","
                  aria-label={`${l.name || t('finance.plan.name')} — ${dayjs(`${m}-01`).locale('pl').format('MMMM')}`}
                  styles={{ input: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
                  value={l.amounts[m] ?? ''}
                  readOnly={!editable}
                  onChange={(v) => setAmount(l.id, m, v === '' ? '' : Number(v))}
                />
              </Table.Td>
            ))}
            <Table.Td ta="right" fw={500} style={NUM}>
              {short(rowTotal(l))}
            </Table.Td>
            <Table.Td>
              {editable && (
                <Group gap={0} wrap="nowrap">
                  <Tooltip label={t('finance.yearPlan.fillRight')}>
                    <ActionIcon size="sm" variant="subtle" aria-label={t('finance.yearPlan.fillRight')} onClick={() => fillRight(l)}>
                      <IconArrowBarToRight size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <ActionIcon size="sm" variant="subtle" color="red" aria-label={t('finance.yearPlan.removeLine')} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
        {rows.length === 0 && (
          <Table.Tr>
            <Table.Td colSpan={16}>
              <Text size="xs" c="dimmed">
                {t('finance.plan.empty')}
              </Text>
            </Table.Td>
          </Table.Tr>
        )}
      </Table.Tbody>
    )
  }

  const readOnlyRow = (label: string, f: (m: string) => number, opts: { bold?: boolean; color?: boolean; dimmed?: boolean } = {}) => (
    <Table.Tr fw={opts.bold ? 600 : undefined}>
      <Table.Td colSpan={2} c={opts.dimmed ? 'dimmed' : undefined}>
        {label}
      </Table.Td>
      {months.map((m) => (
        <Table.Td key={m} ta="right" c={opts.color ? resultColor(f(m)) : opts.dimmed ? 'dimmed' : undefined} style={NUM}>
          {short(f(m))}
        </Table.Td>
      ))}
      <Table.Td ta="right" c={opts.color ? resultColor(totalOf(f)) : opts.dimmed ? 'dimmed' : undefined} style={NUM}>
        {short(totalOf(f))}
      </Table.Td>
      <Table.Td />
    </Table.Tr>
  )

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Stack gap={0}>
          <Title order={4}>{t('finance.yearPlan.title', { year })}</Title>
          <Text size="xs" c="dimmed">
            {t('finance.yearPlan.hint')}
          </Text>
        </Stack>
        {editable && (
          <Group gap="xs">
            {dirty && (
              <Button variant="default" onClick={() => setLines(initial)}>
                {t('finance.yearPlan.discard')}
              </Button>
            )}
            <Button disabled={!dirty || duplicate || unnamed} loading={save.isPending} onClick={submit}>
              {t('finance.yearPlan.save')}
            </Button>
          </Group>
        )}
      </Group>
      {(duplicate || unnamed) && (
        <Alert color="orange" variant="light" py={6} mb="sm">
          <Text size="sm">{t(duplicate ? 'finance.yearPlan.duplicate' : 'finance.yearPlan.unnamed')}</Text>
        </Alert>
      )}
      <Table.ScrollContainer minWidth={1650}>
        <Table fz="xs" verticalSpacing={4} horizontalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ position: 'sticky', left: 0, background: 'var(--mantine-color-body)', zIndex: 1 }}>{t('finance.plan.name')}</Table.Th>
              <Table.Th>
                {t('finance.plan.project')} / {t('finance.plan.category')}
              </Table.Th>
              {months.map((m) => (
                <Table.Th key={m} ta="right" tt="capitalize">
                  {dayjs(`${m}-01`).locale('pl').format('MMM')}
                </Table.Th>
              ))}
              <Table.Th ta="right">{t('finance.year.total')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          {group('revenue')}
          {group('cost')}
          <Table.Tbody style={{ borderTop: '2px solid var(--mantine-color-default-border)' }}>
            {readOnlyRow(t('finance.year.fixedCosts'), (m) => -summary.get(m)!.fixedCosts, { dimmed: true })}
            {readOnlyRow(t('finance.year.staffCosts'), (m) => -summary.get(m)!.staffCosts, { dimmed: true })}
            {readOnlyRow(t('finance.year.plannedResult'), plannedResult, { bold: true, color: true })}
            {readOnlyRow(t('finance.year.result'), (m) => summary.get(m)!.result, { color: true, dimmed: true })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {dirty && (
        <Text size="xs" c="orange.8" mt="xs">
          {t('finance.yearPlan.unsaved')}
        </Text>
      )}
    </Card>
  )
}

