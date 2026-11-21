import { ActionIcon, Alert, Badge, Box, Button, Group, Loader, Menu, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconDownload,
  IconLock,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShoppingCart,
  IconStar,
  IconSubtask,
  IconTrash,
} from '@tabler/icons-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { compareCategories, type CostBudget, type CostEstimateResponse, type CostItemDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatNumber, formatPLN, formatPLNWhole } from '../../lib/format'
import { useProjectId } from '../hrf/api'
import { useCostEstimate, useDeleteCostItem, useMoveCostItem } from './api'
import { CostItemDrawer, type CostDrawerState } from './CostItemDrawer'
import { CostSettingsDrawer } from './CostSettingsDrawer'
import { CostSummary } from './CostSummary'

const num = (v: number | null | undefined) => (v == null ? '—' : formatNumber(v))
const pct = (v: number | null | undefined) => (v == null ? '' : `${(v * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`)
const diffColor = (d: number) => (d > 0.005 ? 'red.7' : d < -0.005 ? 'green.7' : undefined)

function Card({ label, value, sub, color }: { label: string; value: string; sub?: ReactNode; color?: string }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={color}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Paper>
  )
}

function Cards({ data }: { data: CostEstimateResponse }) {
  const { t } = useTranslation()
  const env = data.summary.envcheck
  const diff = env.forecast - env.estimate
  const quoted = data.items.filter((i) => i.budget === 'Envcheck' && i.quotePln != null && !i.parentId).length
  const k = data.summary.contract
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: k ? 5 : 4 }}>
      <Card label={t('costEstimate.cards.estimate')} value={formatPLNWhole(env.estimate)} />
      <Card label={t('costEstimate.cards.quote')} value={formatPLNWhole(env.quote)} sub={t('costEstimate.cards.quoteHint', { count: quoted })} />
      <Card label={t('costEstimate.cards.actual')} value={formatPLNWhole(env.actual)} />
      <Card
        label={t('costEstimate.cards.forecast')}
        value={formatPLNWhole(env.forecast)}
        sub={<Text span inherit c={diffColor(diff)}>{t('costEstimate.cards.diff', { sign: diff > 0 ? '+' : diff < 0 ? '−' : '', amount: formatPLNWhole(Math.abs(diff)) })}</Text>}
      />
      {k && (
        <Card
          label={t('costEstimate.cards.result')}
          value={formatPLNWhole(k.resultForecast)}
          color={k.resultForecast < 0 ? 'red.7' : 'green.8'}
          sub={t('costEstimate.cards.resultHint', { amount: formatPLNWhole(k.result) })}
        />
      )}
    </SimpleGrid>
  )
}

export function CostEstimatePage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const pid = useProjectId()
  const q = useCostEstimate()
  const del = useDeleteCostItem()
  const move = useMoveCostItem()
  const [drawer, setDrawer] = useState<CostDrawerState | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [budget, setBudget] = useState<'all' | CostBudget>('all')
  const [category, setCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const data = q.data
  const canEdit = can('costEstimate', 'edit')
  const canCreate = can('costEstimate', 'create')
  const canDelete = can('costEstimate', 'delete')

  const categories = useMemo(() => [...new Set((data?.items ?? []).map((i) => i.category))].sort(compareCategories), [data])

  /** Pozycje główne po filtrach; podpozycja pasująca do wyszukiwania pokazuje też swoją pozycję. */
  const { tops, childrenOf } = useMemo(() => {
    const items = data?.items ?? []
    const childrenOf = new Map<string, CostItemDto[]>()
    for (const i of items) if (i.parentId) childrenOf.set(i.parentId, [...(childrenOf.get(i.parentId) ?? []), i])
    const s = search.trim().toLocaleLowerCase('pl')
    const match = (i: CostItemDto) => !s || [i.name, i.supplier, i.notes].some((x) => x?.toLocaleLowerCase('pl').includes(s))
    const tops = items.filter(
      (i) =>
        !i.parentId &&
        (budget === 'all' || i.budget === budget) &&
        (!category || i.category === category) &&
        (match(i) || (childrenOf.get(i.id) ?? []).some(match)),
    )
    return { tops, childrenOf }
  }, [data, budget, category, search])

  if (q.isLoading) return <Loader />
  if (!data) return <Alert color="red">{errorMessage(q.error)}</Alert>

  const totals = {
    estimate: tops.reduce((s, i) => s + (i.estimate ?? 0), 0),
    quote: tops.reduce((s, i) => s + (i.quotePln ?? 0), 0),
    actual: tops.reduce((s, i) => s + (i.actualTotal ?? 0), 0),
    forecast: tops.reduce((s, i) => s + i.forecast, 0),
  }

  const toggle = (id: string) => setCollapsed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])))
  const allParents = tops.filter((i) => i.childCount > 0).map((i) => i.id)
  const anyExpanded = allParents.some((id) => !collapsed.has(id))

  const confirmDelete = (i: CostItemDto) =>
    modals.openConfirmModal({
      title: t('costEstimate.drawer.delete'),
      children: (
        <Stack gap={4}>
          <Text size="sm">{t('costEstimate.drawer.deleteConfirm', { name: i.name })}</Text>
          {i.childCount > 0 && (
            <Text size="sm" c="red.7">
              {t('costEstimate.drawer.deleteChildren', { count: i.childCount })}
            </Text>
          )}
        </Stack>
      ),
      labels: { confirm: t('costEstimate.drawer.delete'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(i.id, { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) }),
    })

  const doMove = (i: CostItemDto, direction: 'up' | 'down') => move.mutate({ id: i.id, direction }, { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })

  const rowMenu = (i: CostItemDto) =>
    (canEdit || canCreate || canDelete) && (
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={(e) => e.stopPropagation()} aria-label="menu">
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
          {canCreate && !i.parentId && i.budget === 'Envcheck' && (
            <Menu.Item leftSection={<IconSubtask size={14} />} onClick={() => setDrawer({ parent: i })}>
              {t('costEstimate.addChild')}
            </Menu.Item>
          )}
          {canEdit && (
            <>
              <Menu.Item leftSection={<IconArrowUp size={14} />} onClick={() => doMove(i, 'up')}>
                {t('costEstimate.drawer.moveUp')}
              </Menu.Item>
              <Menu.Item leftSection={<IconArrowDown size={14} />} onClick={() => doMove(i, 'down')}>
                {t('costEstimate.drawer.moveDown')}
              </Menu.Item>
            </>
          )}
          {canDelete && (
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDelete(i)}>
              {t('costEstimate.drawer.delete')}
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
    )

  const purchaseBadges = (i: CostItemDto) =>
    i.purchase && (
      <Tooltip label={`${t('costEstimate.purchase.fromPlan')}${i.purchase.hrfTaskCode ? ` · HRF ${i.purchase.hrfTaskCode}` : ''}`}>
        <Group gap={4} wrap="nowrap" w="fit-content">
          {i.purchase.isCritical && (
            <Badge size="xs" color="orange" variant="filled" leftSection={<IconStar size={10} />} style={{ flexShrink: 0, maxWidth: 'none' }}>
              {t('costEstimate.purchase.critical')}
            </Badge>
          )}
          <Badge size="xs" variant="outline" color="gray" leftSection={<IconShoppingCart size={10} />} style={{ flexShrink: 0, maxWidth: 'none' }}>
            {t(`purchases.status.${i.purchase.status}`)}
          </Badge>
        </Group>
      </Tooltip>
    )

  const modeBadge = (i: CostItemDto) =>
    i.forecastMode !== 'auto' && (
      <Badge size="xs" variant="light" color={i.forecastMode === 'manual' ? 'grape' : 'orange'} style={{ flexShrink: 0, maxWidth: 'none' }}>
        {t(i.forecastMode === 'manual' ? 'costEstimate.forecastMode.badgeManual' : 'costEstimate.forecastMode.badgeEstimate')}
      </Badge>
    )

  const row = (i: CostItemDto) => {
    const child = !!i.parentId
    const diff = i.forecast - (i.allocatedEstimate ?? 0)
    const open = !collapsed.has(i.id)
    return (
      <Table.Tr key={i.id} onClick={() => setDrawer({ item: i, parent: child ? data.items.find((p) => p.id === i.parentId) : undefined })} style={{ cursor: 'pointer' }} bg={child ? 'var(--mantine-color-gray-0)' : undefined}>
        <Table.Td>
          <Group gap={4} wrap="nowrap" pl={child ? 28 : 0}>
            {!child &&
              (i.childCount > 0 ? (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(i.id)
                  }}
                  aria-label="toggle"
                >
                  {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                </ActionIcon>
              ) : (
                <Box w={18} />
              ))}
            <Stack gap={0}>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" fw={i.childCount ? 600 : undefined}>
                  {child ? '↳ ' : ''}
                  {i.name}
                </Text>
                {modeBadge(i)}
              </Group>
              {purchaseBadges(i)}
              {(!child || i.supplier || i.notes) && (
                <Text size="xs" c="dimmed" lineClamp={1} maw={520}>
                  {[child ? null : i.category, i.childCount > 0 ? t('costEstimate.children.count', { count: i.childCount }) : null, i.supplier, i.notes].filter(Boolean).join(' · ')}
                </Text>
              )}
            </Stack>
          </Group>
        </Table.Td>
        <Table.Td>{!child && <Badge variant="light" size="sm" color={i.budget === 'Envcheck' ? 'navy' : 'teal'} style={{ flexShrink: 0, maxWidth: 'none' }}>{t(`costEstimate.budget.${i.budget}`)}</Badge>}</Table.Td>
        <Table.Td ta="right">
          {i.estimate == null && i.allocatedEstimate != null ? (
            <Tooltip label={t('costEstimate.children.implicit')}>
              <Text size="sm" c="dimmed" fs="italic">
                ≈ {num(i.allocatedEstimate)}
              </Text>
            </Tooltip>
          ) : (
            num(i.estimate)
          )}
        </Table.Td>
        <Table.Td ta="right">
          <Text size="xs" c="dimmed">
            {child ? '' : pct(i.share)}
          </Text>
        </Table.Td>
        <Table.Td ta="right">
          {i.childCount === 0 && i.quoteAmount != null && i.quoteCurrency === 'EUR' ? (
            <Tooltip label={`${formatNumber(i.quoteAmount)} EUR × ${data.settings.eurRate.toLocaleString('pl-PL')}`}>
              <Text size="sm">{num(i.quotePln)}</Text>
            </Tooltip>
          ) : (
            num(i.quotePln)
          )}
        </Table.Td>
        <Table.Td ta="right">{num(i.actualTotal)}</Table.Td>
        <Table.Td ta="right" fw={600}>
          {num(i.forecast)}
        </Table.Td>
        <Table.Td ta="right">
          <Text size="sm" c={diffColor(diff)}>
            {Math.abs(diff) < 0.005 ? '—' : `${diff > 0 ? '+' : '−'}${formatNumber(Math.abs(diff))}`}
          </Text>
        </Table.Td>
        <Table.Td onClick={(e) => e.stopPropagation()}>{rowMenu(i)}</Table.Td>
      </Table.Tr>
    )
  }

  const unallocatedRow = (i: CostItemDto) =>
    i.unallocated != null &&
    i.unallocated > 0.005 && (
      <Table.Tr key={`${i.id}-rest`} bg="var(--mantine-color-gray-0)">
        <Table.Td>
          <Text size="xs" c="dimmed" fs="italic" pl={28}>
            {t('costEstimate.children.unallocated', { amount: formatPLN(i.unallocated) })}
          </Text>
        </Table.Td>
        <Table.Td />
        <Table.Td ta="right">
          <Text size="xs" c="dimmed">
            {num(i.unallocated)}
          </Text>
        </Table.Td>
        <Table.Td colSpan={3} />
        <Table.Td ta="right">
          <Text size="xs" c="dimmed">
            {num(i.unallocated)}
          </Text>
        </Table.Td>
        <Table.Td colSpan={2} />
      </Table.Tr>
    )

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Title order={2}>{t('costEstimate.title')}</Title>
          <Tooltip label={t('costEstimate.internalHint')}>
            <Badge variant="light" color="red" leftSection={<IconLock size={12} />}>
              W
            </Badge>
          </Tooltip>
        </Group>
        <Group gap="xs">
          {canCreate && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDrawer({})}>
              {t('costEstimate.add')}
            </Button>
          )}
          {canEdit && (
            <Button variant="light" leftSection={<IconSettings size={16} />} onClick={() => setSettingsOpen(true)}>
              {t('costEstimate.settings')}
            </Button>
          )}
          {can('costEstimate', 'export') && (
            <Button
              variant="light"
              leftSection={<IconDownload size={16} />}
              onClick={() => downloadFile(`/projects/${pid}/cost-estimate/export.xlsx`, 'kosztorys.xlsx').catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))}
            >
              {t('costEstimate.export')}
            </Button>
          )}
        </Group>
      </Group>
      <Cards data={data} />
      <Tabs defaultValue="items" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="items">{t('costEstimate.tabs.items')}</Tabs.Tab>
          <Tabs.Tab value="summary">{t('costEstimate.tabs.summary')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="items" pt="sm">
          <Stack gap="sm">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <SegmentedControl
                value={budget}
                onChange={(v) => setBudget(v as typeof budget)}
                data={[
                  { value: 'all', label: t('costEstimate.filter.all') },
                  { value: 'Envcheck', label: 'Envcheck' },
                  { value: 'Arsanit', label: 'Arsanit' },
                ]}
              />
              <Select w={240} placeholder={t('costEstimate.filter.category')} data={categories} value={category} onChange={setCategory} clearable />
              <TextInput w={240} placeholder={t('costEstimate.filter.search')} leftSection={<IconSearch size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
              {allParents.length > 0 && (
                <Button variant="subtle" size="compact-sm" onClick={() => setCollapsed(anyExpanded ? new Set(allParents) : new Set())}>
                  {t(anyExpanded ? 'costEstimate.filter.collapseAll' : 'costEstimate.filter.expandAll')}
                </Button>
              )}
            </Group>
            {!data.items.length ? (
              <Text c="dimmed">{t('costEstimate.empty')}</Text>
            ) : (
              <Table.ScrollContainer minWidth={1000} maxHeight="calc(100vh - 360px)">
                <Table stickyHeader highlightOnHover verticalSpacing={4} fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('costEstimate.col.name')}</Table.Th>
                      <Table.Th w={118}>{t('costEstimate.col.budget')}</Table.Th>
                      <Table.Th w={120} ta="right">{t('costEstimate.col.estimate')}</Table.Th>
                      <Table.Th w={70} ta="right">{t('costEstimate.col.share')}</Table.Th>
                      <Table.Th w={120} ta="right">{t('costEstimate.col.quotePln')}</Table.Th>
                      <Table.Th w={120} ta="right">{t('costEstimate.col.actual')}</Table.Th>
                      <Table.Th w={120} ta="right">{t('costEstimate.col.forecast')}</Table.Th>
                      <Table.Th w={120} ta="right">{t('costEstimate.col.diff')}</Table.Th>
                      <Table.Th w={36} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {tops.flatMap((i) => [row(i), ...(collapsed.has(i.id) ? [] : [...(childrenOf.get(i.id) ?? []).map(row), unallocatedRow(i)])])}
                  </Table.Tbody>
                  <Table.Tfoot>
                    <Table.Tr fw={700}>
                      <Table.Td colSpan={2}>{t('costEstimate.col.total')}</Table.Td>
                      <Table.Td ta="right">{num(totals.estimate)}</Table.Td>
                      <Table.Td />
                      <Table.Td ta="right">{num(totals.quote)}</Table.Td>
                      <Table.Td ta="right">{num(totals.actual)}</Table.Td>
                      <Table.Td ta="right">{num(totals.forecast)}</Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={700} c={diffColor(totals.forecast - totals.estimate)}>
                          {num(totals.forecast - totals.estimate)}
                        </Text>
                      </Table.Td>
                      <Table.Td />
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="summary" pt="sm">
          <CostSummary data={data} />
        </Tabs.Panel>
      </Tabs>
      <CostItemDrawer state={drawer} data={data} categories={categories} onClose={() => setDrawer(null)} onAddChild={(parent) => setDrawer({ parent })} />
      <CostSettingsDrawer opened={settingsOpen} settings={data.settings} onClose={() => setSettingsOpen(false)} />
    </Stack>
  )
}
