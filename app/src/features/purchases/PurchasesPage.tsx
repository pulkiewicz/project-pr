import { Alert, Badge, Box, Button, Group, Loader, MultiSelect, Stack, Switch, Tabs, Text, Title, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconDownload, IconPlus, IconStar } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PURCHASE_PARTIES, PURCHASE_STATUSES, type PurchaseItemDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, todayWarsaw } from '../../lib/format'
import { useProjectId } from '../hrf/api'
import { usePurchases } from './api'
import { PurchaseDrawer } from './PurchaseDrawer'

function Alerts({ item }: { item: PurchaseItemDto }) {
  const { t } = useTranslation()
  return (
    <Stack gap={2}>
      {item.alerts.map((a) => (
        <Group key={a.code} gap={4} wrap="nowrap" align="flex-start">
          <IconAlertTriangle size={14} color={`var(--mantine-color-${a.severity === 'red' ? 'red' : 'yellow'}-6)`} style={{ flexShrink: 0, marginTop: 2 }} />
          <Text size="xs" c={a.severity === 'red' ? 'red.7' : 'yellow.8'}>
            {t(`purchases.alert.${a.code}`, { count: a.days })}
          </Text>
        </Group>
      ))}
    </Stack>
  )
}

/** Oś czasu komponentów krytycznych: ▲ zamówić do → ● data potrzeby → ■ potwierdzona dostawa. */
function CriticalTimeline({ items }: { items: PurchaseItemDto[] }) {
  const { t } = useTranslation()
  const dates = items.flatMap((i) => [i.orderByDate, i.needDate, i.confirmedDeliveryDate].filter(Boolean) as string[])
  const today = todayWarsaw()
  if (!items.length) return <Text c="dimmed" size="sm">{t('purchases.noItems')}</Text>
  const min = [today, ...dates].sort()[0]!
  const max = [today, ...dates].sort().at(-1)!
  const span = Math.max(1, (new Date(max).getTime() - new Date(min).getTime()) / 86_400_000)
  const pos = (d: string) => ((new Date(d).getTime() - new Date(min).getTime()) / 86_400_000 / span) * 100
  const marker = (d: string | null, shape: 'tri' | 'dot' | 'sq', color: string, label: string) =>
    d && (
      <Tooltip label={`${label}: ${formatDate(d)}`}>
        <Box
          pos="absolute"
          top={shape === 'tri' ? 1 : 3}
          left={`calc(${pos(d)}% - 6px)`}
          w={12}
          h={12}
          style={{
            background: color,
            borderRadius: shape === 'dot' ? '50%' : shape === 'sq' ? 2 : 0,
            clipPath: shape === 'tri' ? 'polygon(50% 0, 100% 100%, 0 100%)' : undefined,
            zIndex: 2,
          }}
        />
      </Tooltip>
    )
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed">
        {t('purchases.timelineHint')} · {formatDate(min)} – {formatDate(max)}
      </Text>
      {items.map((i) => {
        const red = i.alerts.some((a) => a.severity === 'red')
        return (
          <Group key={i.id} gap="sm" wrap="nowrap">
            <Text size="sm" w={{ base: 130, sm: 260 }} truncate fw={500} c={red ? 'red' : undefined}>
              {i.name}
            </Text>
            <Box pos="relative" h={18} style={{ flex: 1 }} bg="gray.1">
              <Box pos="absolute" top={0} bottom={0} left={`${pos(today)}%`} w={2} bg="green.6" />
              {i.orderByDate && i.needDate && <Box pos="absolute" top={8} h={2} left={`${pos(i.orderByDate)}%`} w={`${pos(i.needDate) - pos(i.orderByDate)}%`} bg="gray.5" />}
              {marker(i.orderByDate, 'tri', 'var(--mantine-color-navy-7)', t('purchases.orderBy'))}
              {marker(i.needDate, 'dot', 'var(--mantine-color-orange-6)', t('purchases.needDate'))}
              {marker(i.confirmedDeliveryDate, 'sq', red ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-green-6)', t('purchases.confirmedDelivery'))}
            </Box>
            {!i.needDate && (
              <Text size="xs" c="dimmed" visibleFrom="sm">
                {t('purchases.noTask')}
              </Text>
            )}
          </Group>
        )
      })}
    </Stack>
  )
}

export function PurchasesPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const pid = useProjectId()
  const q = usePurchases()
  const [open, setOpen] = useState<PurchaseItemDto | 'new' | null>(null)
  const [parties, setParties] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [onlyAlerts, setOnlyAlerts] = useState(false)
  const [onlyCritical, setOnlyCritical] = useState(false)

  const items = useMemo(
    () =>
      (q.data?.items ?? []).filter(
        (i) =>
          (!parties.length || parties.includes(i.party)) &&
          (!statuses.length || statuses.includes(i.status)) &&
          (!onlyAlerts || i.alerts.length > 0) &&
          (!onlyCritical || i.isCritical),
      ),
    [q.data, parties, statuses, onlyAlerts, onlyCritical],
  )

  const columns = useMemo<MRT_ColumnDef<PurchaseItemDto>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('purchases.name'),
        size: 200,
        grow: true,
        Cell: ({ row }) => (
          <Group gap={4} wrap="nowrap">
            {row.original.isCritical && <IconStar size={14} color="var(--mantine-color-orange-6)" />}
            <Text size="sm">{row.original.name}</Text>
          </Group>
        ),
      },
      { accessorKey: 'party', header: t('purchases.col.party'), size: 105, Cell: ({ cell }) => t(`parties.${cell.getValue<string>()}`) },
      { accessorKey: 'hrfTaskCode', header: 'HRF', size: 85 },
      { accessorKey: 'leadTimeWeeks', header: t('purchases.col.leadTime'), size: 110 },
      { accessorKey: 'orderByDate', header: t('purchases.col.orderBy'), size: 125, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'needDate', header: t('purchases.col.needDate'), size: 120, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'confirmedDeliveryDate', header: t('purchases.col.confirmed'), size: 115, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'status', header: t('purchases.col.status'), size: 140, Cell: ({ cell }) => <Badge variant="light">{t(`purchases.status.${cell.getValue<string>()}`)}</Badge> },
      { id: 'alerts', header: t('purchases.alerts'), size: 250, mantineTableBodyCellProps: { style: { whiteSpace: 'normal' } }, Cell: ({ row }) => <Alerts item={row.original} /> },
    ],
    [t],
  )

  const table = useMantineReactTable({
    columns,
    data: items,
    localization: MRT_Localization_PL,
    layoutMode: 'grid',
    enableColumnActions: false,
    initialState: { density: 'xs' },
    enablePagination: false,
    enableStickyHeader: true,
    mantineTableContainerProps: { style: { maxHeight: 'calc(100vh - 320px)' } },
    mantineTableBodyRowProps: ({ row }) => ({ onClick: () => setOpen(row.original), style: { cursor: 'pointer' } }),
    getRowId: (r) => r.id,
  })

  if (q.isLoading) return <Loader />

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>{t('purchases.title')}</Title>
        <Group gap="xs">
          {can('purchases', 'create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen('new')}>
              {t('purchases.add')}
            </Button>
          )}
          {can('purchases', 'export') && (
            <Button
              variant="light"
              leftSection={<IconDownload size={16} />}
              onClick={() => downloadFile(`/projects/${pid}/purchases/export.xlsx`, 'plan-zakupow.xlsx').catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))}
            >
              {t('purchases.export')}
            </Button>
          )}
        </Group>
      </Group>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      <Group gap="sm" align="flex-end" wrap="wrap">
        <MultiSelect w={200} label={t('purchases.party')} data={PURCHASE_PARTIES.map((p) => ({ value: p, label: t(`parties.${p}`) }))} value={parties} onChange={setParties} clearable />
        <MultiSelect w={260} label={t('purchases.statusLabel')} data={PURCHASE_STATUSES.map((s) => ({ value: s, label: t(`purchases.status.${s}`) }))} value={statuses} onChange={setStatuses} clearable />
        <Switch label={t('purchases.onlyAlerts')} checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.currentTarget.checked)} />
        <Switch label={t('purchases.onlyCritical')} checked={onlyCritical} onChange={(e) => setOnlyCritical(e.currentTarget.checked)} />
      </Group>
      <Tabs defaultValue="list" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="list">{t('purchases.tabs.list')}</Tabs.Tab>
          <Tabs.Tab value="critical">{t('purchases.tabs.critical')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="list" pt="sm">
          <MantineReactTable table={table} />
        </Tabs.Panel>
        <Tabs.Panel value="critical" pt="sm">
          <CriticalTimeline items={items.filter((i) => i.isCritical)} />
        </Tabs.Panel>
      </Tabs>
      <PurchaseDrawer opened={!!open} item={open === 'new' ? null : open} defaultBuffer={q.data?.defaultBufferDays ?? 5} onClose={() => setOpen(null)} />
    </Stack>
  )
}
