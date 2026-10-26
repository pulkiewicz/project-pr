import { Alert, Badge, Button, Group, Loader, MultiSelect, Select, Stack, Switch, Table, Tabs, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconRefresh, IconSearch } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { INVOICE_STATUSES, type InvoiceDto } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime } from '../../lib/format'
import { useInvoices, useSyncInvoices } from './api'
import { InvoiceDrawer } from './InvoiceDrawer'
import { InvoiceStatusBadge, formatMoney } from './status'

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('pl')

function ListTab({ items, onOpen }: { items: InvoiceDto[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const me = useMe()
  const [search, setSearch] = useState('')
  const [statuses, setStatuses] = useState<string[]>(['new', 'pending', 'rejected'])
  const [project, setProject] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const [missing, setMissing] = useState(false)

  const filtered = useMemo(() => {
    const s = norm(search.trim())
    return items.filter(
      (i) =>
        (!s || norm(i.number).includes(s) || norm(i.sellerName).includes(s) || norm(i.description).includes(s) || norm(i.category).includes(s)) &&
        (!missing || i.netPrice == null || !i.number || !i.sellerName) &&
        (!statuses.length || statuses.includes(i.status)) &&
        (!project || (project === 'general' ? i.allocatedShare < 100 : i.allocations.some((a) => a.projectId === project))) &&
        (!mine || (i.status === 'pending' && i.submittedBy !== me.user.id)),
    )
  }, [items, search, statuses, project, mine, missing, me.user.id])

  const columns = useMemo<MRT_ColumnDef<InvoiceDto>[]>(
    () => [
      {
        // Pliki bez daty wystawienia — data dodania do inFakt (szara).
        id: 'date',
        accessorFn: (r) => r.issueDate ?? r.infaktCreatedAt?.slice(0, 10) ?? '',
        header: t('invoices.date'),
        size: 110,
        Cell: ({ row }) =>
          row.original.issueDate ? (
            formatDate(row.original.issueDate)
          ) : (
            <Text size="sm" c="dimmed" title={t('invoices.addedAt')}>
              {formatDate(row.original.infaktCreatedAt)}
            </Text>
          ),
      },
      {
        id: 'number',
        accessorFn: (r) => r.number ?? r.description ?? '',
        header: t('invoices.number'),
        size: 170,
        Cell: ({ row }) =>
          row.original.number ?? (
            <Text size="sm" c="dimmed" fs="italic">
              {row.original.description ?? t('invoices.fileNoData')}
            </Text>
          ),
      },
      { accessorKey: 'sellerName', header: t('invoices.seller'), size: 220, grow: true },
      {
        accessorKey: 'netPrice',
        header: t('invoices.net'),
        size: 130,
        mantineTableBodyCellProps: { align: 'right' },
        Cell: ({ row }) => formatMoney(row.original.netPrice, row.original.currency),
      },
      {
        accessorKey: 'grossPrice',
        header: t('invoices.gross'),
        size: 130,
        mantineTableBodyCellProps: { align: 'right' },
        Cell: ({ row }) => formatMoney(row.original.grossPrice, row.original.currency),
      },
      {
        id: 'projects',
        header: t('invoices.projects'),
        size: 220,
        enableSorting: false,
        Cell: ({ row }) => (
          <Group gap={4}>
            {row.original.allocations.map((a) => (
              <Badge key={a.projectId} variant="light" title={a.projectName}>
                {a.projectCode} {a.share.toLocaleString('pl-PL')}%
              </Badge>
            ))}
            {row.original.allocatedShare < 100 && row.original.allocatedShare > 0 && (
              <Badge variant="outline" color="gray">
                {t('invoices.general')} {(Math.round((100 - row.original.allocatedShare) * 100) / 100).toLocaleString('pl-PL')}%
              </Badge>
            )}
          </Group>
        ),
      },
      { accessorKey: 'status', header: t('invoices.statusLabel'), size: 165, Cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} /> },
    ],
    [t],
  )

  const table = useMantineReactTable({
    columns,
    data: filtered,
    localization: MRT_Localization_PL,
    layoutMode: 'grid',
    enableColumnActions: false,
    enableGlobalFilter: false,
    initialState: { density: 'xs' },
    enablePagination: false,
    enableStickyHeader: true,
    mantineTableContainerProps: { style: { maxHeight: 'calc(100vh - 330px)' } },
    mantineTableBodyRowProps: ({ row }) => ({ onClick: () => onOpen(row.original.id), style: { cursor: 'pointer' } }),
    getRowId: (r) => r.id,
  })

  return (
    <Stack>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput w={260} leftSection={<IconSearch size={16} />} placeholder={t('invoices.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} aria-label={t('invoices.search')} />
        <MultiSelect w={340} placeholder={t('invoices.statusLabel')} data={INVOICE_STATUSES.map((s) => ({ value: s, label: t(`invoices.status.${s}`) }))} value={statuses} onChange={setStatuses} clearable />
        <Select
          w={240}
          placeholder={t('invoices.project')}
          clearable
          searchable
          data={[{ value: 'general', label: t('invoices.general') }, ...me.projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          value={project}
          onChange={setProject}
        />
        <Switch label={t('invoices.onlyMine')} checked={mine} onChange={(e) => setMine(e.currentTarget.checked)} />
        <Switch label={t('invoices.onlyMissing')} checked={missing} onChange={(e) => setMissing(e.currentTarget.checked)} />
      </Group>
      <MantineReactTable table={table} />
    </Stack>
  )
}

/** Koszty netto per projekt i waluta: zaakceptowane i w toku (wysłane, odrzucone, przypisane). */
function ProjectsTab({ items }: { items: InvoiceDto[] }) {
  const { t } = useTranslation()
  const me = useMe()
  const rows = useMemo(() => {
    const acc = new Map<string, { label: string; currency: string; approved: number; other: number; count: number }>()
    const add = (projectKey: string, label: string, currency: string, cents: number, approved: boolean) => {
      const key = `${projectKey}|${currency}`
      const r = acc.get(key) ?? { label, currency, approved: 0, other: 0, count: 0 }
      if (approved) r.approved += cents
      else r.other += cents
      r.count += 1
      acc.set(key, r)
    }
    for (const i of items) {
      if (i.netPrice == null) continue
      // Nieprzypisane jeszcze faktury nie są „kosztem ogólnym” — pomijamy, dopóki ktoś ich nie przypisze.
      if (i.status === 'new' && i.allocatedShare === 0) continue
      const approved = i.status === 'approved'
      for (const a of i.allocations) add(a.projectId, `${a.projectCode} — ${a.projectName}`, i.currency, a.netAmount ?? 0, approved)
      const rest = i.netPrice - i.allocations.reduce((s, a) => s + (a.netAmount ?? 0), 0)
      if (rest > 0) add('general', t('invoices.general'), i.currency, rest, approved)
    }
    // Projekty w kolejności z menu, „Ogólne” na końcu; w obrębie projektu PLN przed walutami obcymi.
    const order = new Map<string, number>(me.projects.map((p, idx) => [p.id, idx]))
    const rank = (key: string) => {
      const [project, currency] = key.split('|')
      return [project === 'general' ? Infinity : (order.get(project!) ?? 0), currency === 'PLN' ? '' : currency!] as const
    }
    return [...acc.entries()].sort(([a], [b]) => {
      const [pa, ca] = rank(a)
      const [pb, cb] = rank(b)
      return pa - pb || ca.localeCompare(cb)
    })
  }, [items, me.projects, t])

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('invoices.perProject.hint')}
      </Text>
      <Table withTableBorder striped fz="sm" maw={820}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('invoices.project')}</Table.Th>
            <Table.Th ta="right">{t('invoices.perProject.approved')}</Table.Th>
            <Table.Th ta="right">{t('invoices.perProject.other')}</Table.Th>
            <Table.Th ta="right">{t('invoices.perProject.count')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(([key, r]) => (
            <Table.Tr key={key}>
              <Table.Td>{r.label}</Table.Td>
              <Table.Td ta="right" fw={600}>
                {formatMoney(r.approved, r.currency)}
              </Table.Td>
              <Table.Td ta="right" c="dimmed">
                {formatMoney(r.other, r.currency)}
              </Table.Td>
              <Table.Td ta="right">{r.count}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

export function InvoicesPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useInvoices()
  const sync = useSyncInvoices()
  const [params, setParams] = useSearchParams()
  const [open, setOpenState] = useState<string | null>(params.get('faktura'))
  const setOpen = (v: string | null) => {
    setOpenState(v)
    if (params.has('faktura')) setParams({}, { replace: true })
  }

  const data = q.data
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>{t('invoices.title')}</Title>
          {data && (
            <Text size="xs" c="dimmed">
              {data.lastSync ? t('invoices.lastSync', { at: formatDateTime(data.lastSync.at), by: data.lastSync.by ? ` · ${data.lastSync.by}` : '' }) : t('invoices.neverSynced')}
            </Text>
          )}
        </Stack>
        <Group gap="xs">
          {can('invoices', 'export') && (
            <Button
              variant="light"
              leftSection={<IconDownload size={16} />}
              onClick={() => downloadFile('/invoices/export.xlsx', 'faktury-projekty.xlsx').catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))}
            >
              {t('invoices.export')}
            </Button>
          )}
          {can('invoices', 'create') && (
            <Button
              leftSection={<IconRefresh size={16} />}
              loading={sync.isPending}
              disabled={data && !data.configured}
              onClick={() =>
                sync.mutate(undefined, {
                  onSuccess: (r) => notifications.show({ color: 'green', message: t('invoices.synced', { ...r }) }),
                  onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                })
              }
            >
              {t('invoices.sync')}
            </Button>
          )}
        </Group>
      </Group>
      {data && !data.configured && <Alert color="yellow">{t('invoices.notConfigured')}</Alert>}
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      {q.isLoading || !data ? (
        <Loader />
      ) : (
        <Tabs defaultValue="list" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="list">{t('invoices.tabs.list')}</Tabs.Tab>
            <Tabs.Tab value="projects">{t('invoices.tabs.projects')}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="list" pt="sm">
            <ListTab items={data.items} onOpen={setOpen} />
          </Tabs.Panel>
          <Tabs.Panel value="projects" pt="sm">
            <ProjectsTab items={data.items} />
          </Tabs.Panel>
        </Tabs>
      )}
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
    </Stack>
  )
}
