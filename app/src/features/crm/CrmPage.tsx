import { Alert, Badge, Button, Group, Loader, MultiSelect, SegmentedControl, Select, Stack, Switch, Tabs, Text, TextInput, Title } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconPlus, IconSearch } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { OPPORTUNITY_STAGES, OPPORTUNITY_TYPES, type CompanyDto, type OpportunityDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatPLNWhole } from '../../lib/format'
import { useCompanies, useOpportunities, useOwners } from './api'
import { CompanyDrawer } from './CompanyDrawer'
import { KanbanBoard } from './KanbanBoard'
import { OpportunityDrawer } from './OpportunityDrawer'
import { NoResponseBadge, StageBadge } from './stage'

export const CRM_COMPANIES_PATH = '/crm/firmy'

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('pl')

function OpportunitiesTab({ onOpen }: { onOpen: (id: string | 'new') => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useOpportunities()
  const owners = useOwners()
  const [view, setView] = useLocalStorage<'kanban' | 'list'>({ key: 'crm_view', defaultValue: 'kanban' })
  const [search, setSearch] = useState('')
  const [stages, setStages] = useState<string[]>([])
  const [owner, setOwner] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [onlyNoResponse, setOnlyNoResponse] = useState(false)

  const items = useMemo(() => {
    const s = norm(search.trim())
    return (q.data ?? []).filter(
      (o) =>
        (!s || norm(o.code).includes(s) || norm(o.name).includes(s) || norm(o.companyName).includes(s)) &&
        (view === 'kanban' || !stages.length || stages.includes(o.stage)) &&
        (!owner || o.ownerId === owner) &&
        (!type || o.type === type) &&
        (!onlyNoResponse || o.noResponse),
    )
  }, [q.data, search, stages, owner, type, onlyNoResponse, view])

  const columns = useMemo<MRT_ColumnDef<OpportunityDto>[]>(
    () => [
      { accessorKey: 'code', header: t('crm.code'), size: 90 },
      { accessorKey: 'name', header: t('crm.name'), size: 260, grow: true },
      { accessorKey: 'companyName', header: t('crm.company'), size: 180 },
      {
        accessorKey: 'stage',
        header: t('crm.stageLabel'),
        size: 170,
        Cell: ({ row }) => (
          <Group gap={4} wrap="nowrap">
            <StageBadge stage={row.original.stage} />
            {row.original.noResponse && <NoResponseBadge />}
          </Group>
        ),
      },
      { accessorKey: 'value', header: t('crm.value'), size: 130, Cell: ({ cell }) => (cell.getValue<number | null>() != null ? formatPLNWhole(cell.getValue<number>()) : '') },
      { accessorKey: 'type', header: t('crm.typeLabel'), size: 150, Cell: ({ cell }) => (cell.getValue<string | null>() ? t(`crm.type.${cell.getValue<string>()}`) : '') },
      { accessorKey: 'ownerName', header: t('crm.owner'), size: 140 },
      { accessorKey: 'submissionDeadline', header: t('crm.submissionDeadline'), size: 125, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      {
        accessorKey: 'nextStep',
        header: t('crm.nextStep'),
        size: 220,
        Cell: ({ row }) => (
          <Text size="sm" lineClamp={2}>
            {row.original.nextStepDate ? `${formatDate(row.original.nextStepDate)} · ` : ''}
            {row.original.nextStep ?? ''}
          </Text>
        ),
      },
      { accessorKey: 'projectCode', header: t('crm.project'), size: 90, Cell: ({ cell }) => cell.getValue<string | null>() && <Badge variant="light" color="green">{cell.getValue<string>()}</Badge> },
    ],
    [t],
  )

  const table = useMantineReactTable({
    columns,
    data: items,
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

  if (q.isLoading) return <Loader />
  const total = items.filter((o) => !['lost', 'on_hold'].includes(o.stage)).reduce((s, o) => s + (o.value ?? 0), 0)

  return (
    <Stack>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      <Group gap="sm" align="flex-end" wrap="wrap">
        <SegmentedControl
          data={[
            { value: 'kanban', label: t('crm.view.kanban') },
            { value: 'list', label: t('crm.view.list') },
          ]}
          value={view}
          onChange={(v) => setView(v as 'kanban' | 'list')}
        />
        <TextInput w={240} leftSection={<IconSearch size={16} />} placeholder={t('crm.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} aria-label={t('crm.search')} />
        {view === 'list' && (
          <MultiSelect w={240} placeholder={t('crm.stageLabel')} data={OPPORTUNITY_STAGES.map((s) => ({ value: s, label: t(`crm.stage.${s}`) }))} value={stages} onChange={setStages} clearable />
        )}
        <Select w={180} placeholder={t('crm.owner')} clearable data={owners.data?.map((u) => ({ value: u.id, label: u.name })) ?? []} value={owner} onChange={setOwner} />
        <Select w={190} placeholder={t('crm.typeLabel')} clearable data={OPPORTUNITY_TYPES.map((x) => ({ value: x, label: t(`crm.type.${x}`) }))} value={type} onChange={setType} />
        <Switch label={t('crm.onlyNoResponse')} checked={onlyNoResponse} onChange={(e) => setOnlyNoResponse(e.currentTarget.checked)} />
        <Group gap="xs" ml="auto">
          {can('crm', 'export') && (
            <Button
              variant="light"
              leftSection={<IconDownload size={16} />}
              onClick={() => downloadFile('/crm/opportunities/export.xlsx', 'szanse-crm.xlsx').catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))}
            >
              {t('crm.export')}
            </Button>
          )}
          {can('crm', 'create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => onOpen('new')}>
              {t('crm.addOpportunity')}
            </Button>
          )}
        </Group>
      </Group>
      {view === 'kanban' ? <KanbanBoard items={items} onOpen={onOpen} /> : <MantineReactTable table={table} />}
      {view === 'list' && total > 0 && (
        <Text size="sm" c="dimmed" ta="right">
          {t('crm.sum')}: {formatPLNWhole(total)}
        </Text>
      )}
    </Stack>
  )
}

function CompaniesTab({ onOpen }: { onOpen: (id: string | 'new') => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useCompanies()
  const [search, setSearch] = useState('')
  const items = useMemo(() => {
    const s = norm(search.trim())
    return (q.data ?? []).filter((c) => !s || norm(c.name).includes(s) || (c.nip ?? '').includes(s))
  }, [q.data, search])

  const columns = useMemo<MRT_ColumnDef<CompanyDto>[]>(
    () => [
      { accessorKey: 'name', header: t('crm.name'), size: 260, grow: true },
      { accessorKey: 'nip', header: t('crm.nip'), size: 120 },
      { accessorKey: 'industry', header: t('crm.industry'), size: 160 },
      { accessorKey: 'address', header: t('crm.address'), size: 240 },
      { id: 'opps', header: t('crm.opportunityCount'), size: 130, Cell: ({ row }) => `${row.original.opportunityCount} (${row.original.openOpportunityCount})` },
    ],
    [t],
  )
  const table = useMantineReactTable({
    columns,
    data: items,
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

  if (q.isLoading) return <Loader />
  return (
    <Stack>
      <Group justify="space-between">
        <TextInput w={280} leftSection={<IconSearch size={16} />} placeholder={`${t('crm.name')} / ${t('crm.nip')}`} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        {can('crm', 'create') && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => onOpen('new')}>
            {t('crm.addCompany')}
          </Button>
        )}
      </Group>
      <MantineReactTable table={table} />
    </Stack>
  )
}

export function CrmPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const tab = location.pathname.startsWith(CRM_COMPANIES_PATH) ? 'companies' : 'opportunities'
  // `?szansa={id}` — bezpośredni link do karty szansy (np. z pulpitu).
  const [params, setParams] = useSearchParams()
  const [opp, setOppState] = useState<string | 'new' | null>(params.get('szansa'))
  const setOpp = (v: string | 'new' | null) => {
    setOppState(v)
    if (params.has('szansa')) setParams({}, { replace: true })
  }
  const [company, setCompany] = useState<string | 'new' | null>(null)

  return (
    <Stack>
      <Title order={2}>{t('crm.title')}</Title>
      <Tabs value={tab} onChange={(v) => navigate(v === 'companies' ? CRM_COMPANIES_PATH : '/crm')} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="opportunities">{t('crm.tabs.opportunities')}</Tabs.Tab>
          <Tabs.Tab value="companies">{t('crm.tabs.companies')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="opportunities" pt="sm">
          <OpportunitiesTab onOpen={setOpp} />
        </Tabs.Panel>
        <Tabs.Panel value="companies" pt="sm">
          <CompaniesTab onOpen={setCompany} />
        </Tabs.Panel>
      </Tabs>
      <OpportunityDrawer id={opp === 'new' ? null : opp} opened={!!opp} onClose={() => setOpp(null)} onCreated={(id) => setOpp(id)} />
      <CompanyDrawer
        id={company === 'new' ? null : company}
        opened={!!company}
        onClose={() => setCompany(null)}
        onOpenOpportunity={(id) => {
          setCompany(null)
          setOpp(id)
        }}
      />
    </Stack>
  )
}
