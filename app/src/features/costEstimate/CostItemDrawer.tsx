import { Alert, Autocomplete, Button, Divider, Drawer, Group, NumberInput, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconInfoCircle, IconSubtask } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COST_BUDGETS, COST_CATEGORIES, COST_CURRENCIES, quoteInPln, type CostBudget, type CostCurrency, type CostEstimateResponse, type CostForecastMode, type CostItemDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatNumber, formatPLN } from '../../lib/format'
import { useSaveCostItem } from './api'
import { CostComments } from './CostComments'

/** `item` — edycja; `parent` — podpozycja (nowa lub edytowana). */
export interface CostDrawerState {
  item?: CostItemDto
  parent?: CostItemDto
}

interface Form {
  category: string
  name: string
  budget: CostBudget
  estimate: number | null
  quoteAmount: number | null
  quoteCurrency: CostCurrency
  actual: number | null
  forecastMode: CostForecastMode
  forecastManual: number | null
  supplier: string | null
  notes: string | null
  inactive: boolean
  inactiveReason: string | null
}

const EMPTY: Form = { category: '', name: '', budget: 'Envcheck', estimate: null, quoteAmount: null, quoteCurrency: 'EUR', actual: null, forecastMode: 'auto', forecastManual: null, supplier: null, notes: null, inactive: false, inactiveReason: null }
const numOrNull = (v: string | number) => (v === '' || v == null ? null : Number(v))

function Money({ label, value, onChange, disabled, description, suffix = ' zł' }: { label: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean; description?: string; suffix?: string }) {
  return (
    <NumberInput
      label={label}
      description={description}
      value={value ?? ''}
      onChange={(v) => onChange(numOrNull(v))}
      disabled={disabled}
      thousandSeparator=" "
      decimalSeparator=","
      decimalScale={2}
      suffix={suffix}
      hideControls
    />
  )
}

export function CostItemDrawer({ state, data, categories, onClose, onAddChild }: { state: CostDrawerState | null; data: CostEstimateResponse; categories: string[]; onClose: () => void; onAddChild: (parent: CostItemDto) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const save = useSaveCostItem()
  const [f, setF] = useState<Form>(EMPTY)
  const item = state?.item
  const parent = state?.parent
  const isChild = !!parent
  // Aktualna wersja z cache (np. po dodaniu podpozycji z poziomu szuflady).
  const current = item ? (data.items.find((i) => i.id === item.id) ?? item) : undefined
  const hasChildren = (current?.childCount ?? 0) > 0
  const children = current ? data.items.filter((i) => i.parentId === current.id) : []

  useEffect(() => {
    if (!state) return
    if (state.item) {
      const i = state.item
      setF({ category: i.category, name: i.name, budget: i.budget, estimate: i.estimate, quoteAmount: i.quoteAmount, quoteCurrency: i.quoteCurrency, actual: i.actual, forecastMode: i.forecastMode, forecastManual: i.forecastManual, supplier: i.supplier, notes: i.notes, inactive: i.inactive, inactiveReason: i.inactiveReason })
    } else if (state.parent) setF({ ...EMPTY, category: state.parent.category, budget: 'Envcheck' })
    else setF(EMPTY)
  }, [state])

  const editable = item ? can('costEstimate', 'edit') : can('costEstimate', 'create')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const quotePln = quoteInPln(f, data.settings.eurRate)

  const title = item ? t(isChild ? 'costEstimate.drawer.editChild' : 'costEstimate.drawer.edit') : t(isChild ? 'costEstimate.drawer.newChild' : 'costEstimate.drawer.new')

  const submit = () => {
    const payload = { ...f, supplier: f.supplier || null, notes: f.notes || null }
    save.mutate(
      item ? { id: item.id, version: current?.version ?? item.version, data: payload } : { data: { ...payload, parentId: parent?.id ?? null } },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('app.saved') })
          onClose()
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )
  }

  const allocated = current?.childrenEstimate ?? 0
  const over = allocated - (f.estimate ?? 0)

  return (
    <Drawer opened={!!state} onClose={onClose} position="right" size="lg" title={<Text fw={600}>{title}</Text>}>
      <Stack gap="sm">
        {isChild && (
          <Alert variant="light" icon={<IconSubtask size={16} />} p="xs">
            {t('costEstimate.children.inherit', { parent: `${parent.name} (${parent.category})` })}
          </Alert>
        )}
        <TextInput label={t('costEstimate.col.name')} required value={f.name} onChange={(e) => set('name', e.currentTarget.value)} disabled={!editable} data-autofocus />
        {!isChild && (
          <SimpleGrid cols={2}>
            <Autocomplete
              label={t('costEstimate.col.category')}
              required
              data={[...new Set([...COST_CATEGORIES, ...categories])]}
              value={f.category}
              onChange={(v) => set('category', v)}
              disabled={!editable}
            />
            <Select
              label={t('costEstimate.col.budget')}
              data={COST_BUDGETS.map((b) => ({ value: b, label: t(`costEstimate.budget.${b}`), disabled: hasChildren && b !== 'Envcheck' }))}
              value={f.budget}
              onChange={(v) => v && set('budget', v as CostBudget)}
              allowDeselect={false}
              disabled={!editable}
            />
          </SimpleGrid>
        )}
        <Money
          label={t('costEstimate.col.estimate')}
          description={t(isChild ? 'costEstimate.drawer.childEstimateHint' : 'costEstimate.drawer.estimateHint')}
          value={f.estimate}
          onChange={(v) => set('estimate', v)}
          disabled={!editable}
        />
        {hasChildren ? (
          <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} p="xs">
            <Stack gap={2}>
              <Text size="sm">{t('costEstimate.children.rollupHint')}</Text>
              <Text size="sm">
                {t('costEstimate.children.allocated', { allocated: formatPLN(allocated), estimate: formatPLN(f.estimate ?? 0) })}
                {current?.unallocated ? ` · ${t('costEstimate.children.unallocated', { amount: formatPLN(current.unallocated) })}` : ''}
              </Text>
              {over > 0.005 && (
                <Text size="sm" c="red.7">
                  {t('costEstimate.children.over', { amount: formatPLN(over) })}
                </Text>
              )}
            </Stack>
          </Alert>
        ) : (
          <>
            <Group grow align="flex-start">
              <Money
                label={t('costEstimate.drawer.quoteAmount')}
                value={f.quoteAmount}
                onChange={(v) => set('quoteAmount', v)}
                disabled={!editable}
                suffix={` ${f.quoteCurrency === 'EUR' ? '€' : 'zł'}`}
                description={f.quoteCurrency === 'EUR' && quotePln != null ? t('costEstimate.drawer.quoteConverted', { amount: formatPLN(quotePln), rate: data.settings.eurRate.toLocaleString('pl-PL') }) : undefined}
              />
              <Select
                label={t('costEstimate.drawer.currency')}
                data={[...COST_CURRENCIES]}
                value={f.quoteCurrency}
                onChange={(v) => v && set('quoteCurrency', v as CostCurrency)}
                allowDeselect={false}
                disabled={!editable}
                maw={110}
              />
            </Group>
            <Money label={t('costEstimate.col.actual')} description={t('costEstimate.drawer.actualHint')} value={f.actual} onChange={(v) => set('actual', v)} disabled={!editable} />
          </>
        )}
        <Select
          label={t('costEstimate.forecastMode.label')}
          data={(hasChildren ? (['auto', 'manual'] as const) : (['auto', 'estimate', 'manual'] as const)).map((m) => ({
            value: m,
            label: t(hasChildren && m === 'auto' ? 'costEstimate.forecastMode.autoParent' : `costEstimate.forecastMode.${m}`),
          }))}
          value={hasChildren && f.forecastMode === 'estimate' ? 'auto' : f.forecastMode}
          onChange={(v) => v && set('forecastMode', v as CostForecastMode)}
          allowDeselect={false}
          disabled={!editable}
        />
        {f.forecastMode === 'manual' && <Money label={t('costEstimate.drawer.forecastManual')} value={f.forecastManual} onChange={(v) => set('forecastManual', v)} disabled={!editable} />}
        <Switch
          color="orange"
          label={t('costEstimate.inactive.switch')}
          checked={f.inactive}
          onChange={(e) => {
            const on = e.currentTarget.checked
            setF((x) => ({ ...x, inactive: on, inactiveReason: on ? x.inactiveReason : null }))
          }}
          disabled={!editable}
        />
        {f.inactive && (
          <Textarea
            label={t('costEstimate.inactive.reason')}
            required
            autosize
            minRows={2}
            value={f.inactiveReason ?? ''}
            onChange={(e) => set('inactiveReason', e.currentTarget.value || null)}
            disabled={!editable}
          />
        )}
        <TextInput label={t('costEstimate.col.supplier')} value={f.supplier ?? ''} onChange={(e) => set('supplier', e.currentTarget.value || null)} disabled={!editable} />
        <Textarea label={t('costEstimate.col.notes')} autosize minRows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value || null)} disabled={!editable} />

        {current && !isChild && (
          <>
            <Divider label={t('costEstimate.children.count', { count: children.length })} labelPosition="left" />
            {current.budget !== 'Envcheck' ? (
              <Text size="xs" c="dimmed">
                {t('costEstimate.children.onlyEnvcheck')}
              </Text>
            ) : (
              <>
                {children.length > 0 && (
                  <Table fz="xs" verticalSpacing={2}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('costEstimate.col.name')}</Table.Th>
                        <Table.Th ta="right">{t('costEstimate.col.estimate')}</Table.Th>
                        <Table.Th ta="right">{t('costEstimate.col.quotePln')}</Table.Th>
                        <Table.Th ta="right">{t('costEstimate.col.actual')}</Table.Th>
                        <Table.Th ta="right">{t('costEstimate.col.forecast')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {children.map((c) => (
                        <Table.Tr key={c.id}>
                          <Table.Td>{c.name}</Table.Td>
                          <Table.Td ta="right" c={c.estimate == null ? 'dimmed' : undefined}>{c.allocatedEstimate == null ? '—' : `${c.estimate == null ? '≈ ' : ''}${formatNumber(c.allocatedEstimate)}`}</Table.Td>
                          <Table.Td ta="right">{c.quotePln == null ? '—' : formatNumber(c.quotePln)}</Table.Td>
                          <Table.Td ta="right">{c.actual == null ? '—' : formatNumber(c.actual)}</Table.Td>
                          <Table.Td ta="right">{formatNumber(c.forecast)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
                {can('costEstimate', 'create') && (
                  <Button variant="light" size="xs" leftSection={<IconSubtask size={14} />} onClick={() => onAddChild(current)} w="fit-content">
                    {t('costEstimate.addChild')}
                  </Button>
                )}
              </>
            )}
          </>
        )}

        {current && (
          <>
            <Divider label={t('costEstimate.comments.title', { count: current.commentCount })} labelPosition="left" />
            <CostComments itemId={current.id} />
          </>
        )}

        {editable && (
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              {t('app.cancel')}
            </Button>
            <Button onClick={submit} loading={save.isPending} disabled={!f.name.trim() || !f.category.trim() || (f.inactive && !f.inactiveReason?.trim())}>
              {t('app.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Drawer>
  )
}
