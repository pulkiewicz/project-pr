import { ActionIcon, Badge, Button, Card, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Table, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fixedCostActive, type FinanceFixedCostDto, type FinancePlanItemDto, type FinancePlanResponse, type PlanItemKind } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useCostCategories } from '../invoices/api'
import { formatMoney } from '../invoices/status'
import { useCreateFixedCost, useCreatePlanItem, useDeleteFixedCost, useDeletePlanItem, useUpdateFixedCost, useUpdatePlanItem } from './api'

const NUM = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const
const money = (cents: number) => formatMoney(cents, 'PLN')
const monthDate = (m: string | null) => (m ? dayjs(`${m}-01`).toDate() : null)
const toMonth = (d: Date | string | null) => (d ? dayjs(d).format('YYYY-MM') : null)
const monthLabel = (m: string) => dayjs(`${m}-01`).locale('pl').format('MMMM YYYY')
const toCents = (zl: number | string) => Math.round(Number(zl) * 100)

/** Wspólne pola: projekt i kategoria (słownik z Ustawień, tylko aktywne). */
function useOptions() {
  const me = useMe()
  const categories = useCostCategories().data ?? []
  return {
    projects: me.projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
    categories: categories.filter((k) => k.active).map((k) => ({ value: k.id, label: k.name })),
  }
}

const notifyError = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

function confirmDelete(t: (k: string, o?: Record<string, unknown>) => string, name: string, onConfirm: () => void) {
  modals.openConfirmModal({
    title: t('finance.delete.title'),
    children: <Text size="sm">{t('finance.delete.body', { name })}</Text>,
    labels: { confirm: t('finance.delete.confirm'), cancel: t('app.cancel') },
    confirmProps: { color: 'red' },
    onConfirm,
  })
}

// ---------------- Pozycje planowane ----------------

function PlanItemModal({ month, item, onClose }: { month: string; item: FinancePlanItemDto | 'new-revenue' | 'new-cost'; onClose: () => void }) {
  const { t } = useTranslation()
  const opts = useOptions()
  const create = useCreatePlanItem()
  const update = useUpdatePlanItem()
  const editing = typeof item === 'object' ? item : null
  const [kind, setKind] = useState<PlanItemKind>(editing?.kind ?? (item === 'new-revenue' ? 'revenue' : 'cost'))
  const [name, setName] = useState(editing?.name ?? '')
  const [amount, setAmount] = useState<number | string>(editing ? editing.amount / 100 : '')
  const [itemMonth, setItemMonth] = useState(editing?.month ?? month)
  const [repeatUntil, setRepeatUntil] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(editing?.projectId ?? null)
  const [categoryId, setCategoryId] = useState<string | null>(editing?.costCategoryId ?? null)
  const [note, setNote] = useState(editing?.note ?? '')
  const valid = name.trim() && Number(amount) > 0 && (!repeatUntil || repeatUntil >= itemMonth)

  const save = () => {
    const data = { kind, name: name.trim(), amount: toCents(amount), projectId, costCategoryId: kind === 'cost' ? categoryId : null, note: note.trim() || null, month: itemMonth }
    if (editing) update.mutate({ id: editing.id, data: { ...data, version: editing.version } }, { onSuccess: onClose, onError: notifyError })
    else
      create.mutate(
        { ...data, repeatUntil },
        {
          onSuccess: (r) => {
            if (r.created > 1) notifications.show({ color: 'green', message: t('finance.plan.createdMany', { count: r.created }) })
            onClose()
          },
          onError: notifyError,
        },
      )
  }

  return (
    <Modal opened onClose={onClose} title={editing ? t('finance.plan.edit') : t('finance.plan.add')}>
      <Stack>
        <SegmentedControl
          value={kind}
          onChange={(v) => setKind(v as PlanItemKind)}
          data={[
            { value: 'revenue', label: t('finance.plan.revenue') },
            { value: 'cost', label: t('finance.plan.cost') },
          ]}
        />
        <TextInput label={t('finance.plan.name')} placeholder={t(kind === 'revenue' ? 'finance.plan.namePlaceholderRevenue' : 'finance.plan.namePlaceholderCost')} required maxLength={200} value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <NumberInput label={t('finance.plan.amount')} required min={0.01} decimalScale={2} thousandSeparator=" " decimalSeparator="," suffix=" zł" value={amount} onChange={setAmount} />
        <Group grow>
          <MonthPickerInput label={t('finance.plan.month')} valueFormat="MMMM YYYY" locale="pl" value={monthDate(itemMonth)} onChange={(d) => d && setItemMonth(toMonth(d)!)} />
          {!editing && (
            <MonthPickerInput
              label={t('finance.plan.repeatUntil')}
              placeholder={t('finance.plan.noRepeat')}
              valueFormat="MMMM YYYY"
              locale="pl"
              clearable
              minDate={monthDate(itemMonth)!}
              maxDate={dayjs(`${itemMonth}-01`).add(35, 'month').toDate()}
              value={monthDate(repeatUntil)}
              onChange={(d) => setRepeatUntil(toMonth(d))}
            />
          )}
        </Group>
        <Select label={t('finance.plan.project')} placeholder={t('finance.plan.noProject')} clearable searchable data={opts.projects} value={projectId} onChange={setProjectId} />
        {kind === 'cost' && <Select label={t('finance.plan.category')} placeholder={t('finance.costs.noCategory')} clearable searchable data={opts.categories} value={categoryId} onChange={setCategoryId} />}
        <Textarea label={t('finance.plan.note')} autosize minRows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button disabled={!valid} loading={create.isPending || update.isPending} onClick={save}>
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Plan: przychody i koszty wpisane ręcznie na wybrany miesiąc, obok wykonania z inFakt. */
export function PlannedSection({ plan }: { plan: FinancePlanResponse }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const del = useDeletePlanItem()
  const [editing, setEditing] = useState<FinancePlanItemDto | 'new-revenue' | 'new-cost' | null>(null)
  const { items } = plan.planned
  const groups = (['revenue', 'cost'] as const).map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) }))
  const actual = { revenue: plan.revenue.net, cost: plan.costs.net }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t('finance.plan.title')}</Title>
        {can('financePlan', 'create') && (
          <Group gap="xs">
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new-revenue')}>
              {t('finance.plan.addRevenue')}
            </Button>
            <Button size="xs" variant="light" color="orange" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new-cost')}>
              {t('finance.plan.addCost')}
            </Button>
          </Group>
        )}
      </Group>
      <Table.ScrollContainer minWidth={700}>
        <Table fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('finance.plan.name')}</Table.Th>
              <Table.Th>{t('finance.plan.project')}</Table.Th>
              <Table.Th>{t('finance.plan.category')}</Table.Th>
              <Table.Th ta="right">{t('finance.plan.amount')}</Table.Th>
              <Table.Th w={70} />
            </Table.Tr>
          </Table.Thead>
          {groups.map((g) => {
            const planned = sum(g.items.map((i) => i.amount))
            return (
              <Table.Tbody key={g.kind}>
                <Table.Tr bg="var(--mantine-color-gray-light)">
                  <Table.Td colSpan={3} fw={600}>
                    {t(g.kind === 'revenue' ? 'finance.plan.revenues' : 'finance.plan.costs')}
                  </Table.Td>
                  <Table.Td ta="right" fw={600} style={NUM}>
                    {money(planned)}
                  </Table.Td>
                  <Table.Td />
                </Table.Tr>
                {g.items.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>
                      <Text size="sm">{i.name}</Text>
                      {i.note && (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {i.note}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{i.projectCode ?? <Text span c="dimmed" size="sm">—</Text>}</Table.Td>
                    <Table.Td>{i.kind === 'cost' ? (i.costCategoryName ?? <Text span c="dimmed" size="sm">{t('finance.costs.noCategory')}</Text>) : null}</Table.Td>
                    <Table.Td ta="right" style={NUM}>
                      {money(i.amount)}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        {can('financePlan', 'edit') && (
                          <ActionIcon size="sm" variant="subtle" aria-label={t('finance.plan.edit')} onClick={() => setEditing(i)}>
                            <IconPencil size={14} />
                          </ActionIcon>
                        )}
                        {can('financePlan', 'delete') && (
                          <ActionIcon size="sm" variant="subtle" color="red" aria-label={t('finance.delete.confirm')} onClick={() => confirmDelete(t, i.name, () => del.mutate(i.id, { onError: notifyError }))}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {g.items.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text size="xs" c="dimmed">
                        {t('finance.plan.empty')}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    <Text size="xs" c="dimmed">
                      {t('finance.plan.actual')}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" style={NUM}>
                    <Text size="xs" c="dimmed">
                      {money(actual[g.kind])}
                      {planned > 0 && ` (${Math.round((actual[g.kind] / planned) * 100)}%)`}
                    </Text>
                  </Table.Td>
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            )
          })}
        </Table>
      </Table.ScrollContainer>
      {editing && <PlanItemModal month={plan.month} item={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

// ---------------- Koszty stałe niepracownicze ----------------

function FixedCostModal({ month, cost, onClose }: { month: string; cost: FinanceFixedCostDto | null; onClose: () => void }) {
  const { t } = useTranslation()
  const opts = useOptions()
  const create = useCreateFixedCost()
  const update = useUpdateFixedCost()
  const [name, setName] = useState(cost?.name ?? '')
  const [amount, setAmount] = useState<number | string>(cost ? cost.amount / 100 : '')
  const [startMonth, setStartMonth] = useState(cost?.startMonth ?? month)
  const [endMonth, setEndMonth] = useState<string | null>(cost?.endMonth ?? null)
  const [projectId, setProjectId] = useState<string | null>(cost?.projectId ?? null)
  const [categoryId, setCategoryId] = useState<string | null>(cost?.costCategoryId ?? null)
  const [note, setNote] = useState(cost?.note ?? '')
  const valid = name.trim() && Number(amount) > 0 && (!endMonth || endMonth >= startMonth)

  const save = () => {
    const data = { name: name.trim(), amount: toCents(amount), startMonth, endMonth, projectId, costCategoryId: categoryId, note: note.trim() || null }
    if (cost) update.mutate({ id: cost.id, data: { ...data, version: cost.version } }, { onSuccess: onClose, onError: notifyError })
    else create.mutate(data, { onSuccess: onClose, onError: notifyError })
  }

  return (
    <Modal opened onClose={onClose} title={cost ? t('finance.fixed.edit') : t('finance.fixed.add')}>
      <Stack>
        <TextInput label={t('finance.fixed.name')} placeholder={t('finance.fixed.namePlaceholder')} required maxLength={200} value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <NumberInput label={t('finance.fixed.amount')} required min={0.01} decimalScale={2} thousandSeparator=" " decimalSeparator="," suffix=" zł" value={amount} onChange={setAmount} />
        <Group grow>
          <MonthPickerInput label={t('finance.fixed.from')} valueFormat="MMMM YYYY" locale="pl" value={monthDate(startMonth)} onChange={(d) => d && setStartMonth(toMonth(d)!)} />
          <MonthPickerInput label={t('finance.fixed.to')} placeholder={t('finance.fixed.indefinite')} valueFormat="MMMM YYYY" locale="pl" clearable minDate={monthDate(startMonth)!} value={monthDate(endMonth)} onChange={(d) => setEndMonth(toMonth(d))} />
        </Group>
        <Select label={t('finance.plan.project')} placeholder={t('finance.plan.noProject')} clearable searchable data={opts.projects} value={projectId} onChange={setProjectId} />
        <Select label={t('finance.plan.category')} placeholder={t('finance.costs.noCategory')} clearable searchable data={opts.categories} value={categoryId} onChange={setCategoryId} />
        <Textarea label={t('finance.plan.note')} autosize minRows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button disabled={!valid} loading={create.isPending || update.isPending} onClick={save}>
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Koszty stałe niepracownicze: lista wszystkich (aktywne w miesiącu pogrubione, pozostałe wyszarzone). */
export function FixedCostsSection({ plan }: { plan: FinancePlanResponse }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const del = useDeleteFixedCost()
  const [editing, setEditing] = useState<FinanceFixedCostDto | 'new' | null>(null)
  const { all, total } = plan.fixed
  // Najpierw obowiązujące w miesiącu, potem pozostałe.
  const rows = [...all].sort((a, b) => Number(fixedCostActive(b, plan.month)) - Number(fixedCostActive(a, plan.month)))

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Stack gap={0}>
          <Title order={4}>{t('finance.fixed.title')}</Title>
          <Text size="xs" c="dimmed">
            {t('finance.fixed.hint')}
          </Text>
        </Stack>
        {can('financePlan', 'create') && (
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
            {t('finance.fixed.add')}
          </Button>
        )}
      </Group>
      {rows.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('finance.fixed.empty')}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table fz="sm" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('finance.fixed.name')}</Table.Th>
                <Table.Th>{t('finance.fixed.period')}</Table.Th>
                <Table.Th>{t('finance.plan.project')}</Table.Th>
                <Table.Th>{t('finance.plan.category')}</Table.Th>
                <Table.Th ta="right">{t('finance.fixed.amount')}</Table.Th>
                <Table.Th w={70} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((f) => {
                const active = fixedCostActive(f, plan.month)
                return (
                  <Table.Tr key={f.id} c={active ? undefined : 'dimmed'}>
                    <Table.Td>
                      <Text size="sm" fw={active ? 500 : undefined}>
                        {f.name}
                      </Text>
                      {f.note && (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {f.note}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {monthLabel(f.startMonth)} – {f.endMonth ? monthLabel(f.endMonth) : t('finance.fixed.indefinite')}
                      {!active && (
                        <Badge ml={6} size="xs" variant="outline" color="gray">
                          {t('finance.fixed.inactive')}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{f.projectCode ?? '—'}</Table.Td>
                    <Table.Td>{f.costCategoryName ?? '—'}</Table.Td>
                    <Table.Td ta="right" style={NUM}>
                      {money(f.amount)}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        {can('financePlan', 'edit') && (
                          <Tooltip label={t('finance.fixed.edit')}>
                            <ActionIcon size="sm" variant="subtle" aria-label={t('finance.fixed.edit')} onClick={() => setEditing(f)}>
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {can('financePlan', 'delete') && (
                          <ActionIcon size="sm" variant="subtle" color="red" aria-label={t('finance.delete.confirm')} onClick={() => confirmDelete(t, f.name, () => del.mutate(f.id, { onError: notifyError }))}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={600}>
                <Table.Td colSpan={4}>{t('finance.fixed.totalMonth')}</Table.Td>
                <Table.Td ta="right" style={NUM}>
                  {money(total)}
                </Table.Td>
                <Table.Td />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}
      {editing && <FixedCostModal month={plan.month} cost={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
