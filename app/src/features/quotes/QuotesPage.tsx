import { Alert, Badge, Button, Group, Loader, Modal, SegmentedControl, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { QuoteListItemDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatPLNWhole } from '../../lib/format'
import { useOpportunities } from '../crm/api'
import { useCreateQuote, useQuotes } from './api'
import { QuoteEditor } from './QuoteEditor'

const STATUS_COLOR = { draft: 'gray', approved: 'green', sent: 'blue', imported: 'violet' } as const

/** Nowa wycena: krok 1 (szansa z CRM) i krok 4 (baza: pusta, profil, poprzednia wycena). */
export function NewQuoteModal({ opened, onClose, opportunityId }: { opened: boolean; onClose: () => void; opportunityId?: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const opps = useOpportunities()
  const profiles = useQuotes('profile')
  const previous = useQuotes('quote')
  const create = useCreateQuote()
  const [opp, setOpp] = useState<string | null>(opportunityId ?? null)
  const [basis, setBasis] = useState<'empty' | 'profile' | 'previous'>('profile')
  const [baseId, setBaseId] = useState<string | null>(null)
  useEffect(() => {
    if (opened) {
      setOpp(opportunityId ?? null)
      setBaseId(null)
    }
  }, [opened, opportunityId])

  const oppData = (opps.data ?? []).filter((o) => !['lost', 'on_hold'].includes(o.stage) || o.id === opp).map((o) => ({ value: o.id, label: `${o.code} · ${o.name}${o.companyName ? ` (${o.companyName})` : ''}` }))
  const baseData =
    basis === 'profile'
      ? (profiles.data ?? []).map((p) => ({ value: p.id, label: p.name ?? '' }))
      : (previous.data ?? []).map((q) => ({ value: q.id, label: `${q.opportunityCode} rew. ${q.revision} · ${q.opportunityName ?? ''}${q.net != null ? ` · ${formatPLNWhole(q.net)}` : ''}` }))

  return (
    <Modal opened={opened} onClose={onClose} title={t('quotes.new')} size="lg">
      <Stack>
        <Select label={t('quotes.opportunity')} placeholder={t('quotes.chooseOpportunity')} searchable selectFirstOptionOnChange required data={oppData} value={opp} onChange={setOpp} data-testid="new-quote-opportunity" />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {t('quotes.basisLabel')}
          </Text>
          <SegmentedControl
            data={(['profile', 'previous', 'empty'] as const).map((b) => ({ value: b, label: t(`quotes.basis.${b}`) }))}
            value={basis}
            onChange={(v) => {
              setBasis(v as typeof basis)
              setBaseId(null)
            }}
          />
        </Stack>
        {basis !== 'empty' && (
          <Select
            placeholder={t(basis === 'profile' ? 'quotes.chooseProfile' : 'quotes.choosePrevious')}
            searchable
            selectFirstOptionOnChange
            data={baseData}
            value={baseId}
            onChange={setBaseId}
            data-testid="new-quote-base"
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            disabled={!opp || (basis !== 'empty' && !baseId)}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { kind: 'quote', opportunityId: opp, basedOnId: basis === 'empty' ? null : baseId },
                {
                  onSuccess: (q) => {
                    onClose()
                    navigate(`/wyceny/${q.id}`)
                  },
                  onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                },
              )
            }
          >
            {t('quotes.new')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function QuotesList() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = useQuotes('quote')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(params.has('nowa'))
  const items = useMemo(() => {
    const s = search.trim().toLocaleLowerCase('pl')
    return (q.data ?? []).filter((x) => !s || [x.opportunityCode, x.opportunityName, x.companyName].some((v) => v?.toLocaleLowerCase('pl').includes(s)))
  }, [q.data, search])

  const columns = useMemo<MRT_ColumnDef<QuoteListItemDto>[]>(
    () => [
      { accessorKey: 'opportunityCode', header: t('crm.code'), size: 90 },
      { accessorKey: 'revision', header: t('quotes.revision'), size: 70 },
      { accessorKey: 'opportunityName', header: t('quotes.opportunity'), size: 260, grow: true },
      { accessorKey: 'companyName', header: t('quotes.company'), size: 180 },
      { accessorKey: 'status', header: t('quotes.statusLabel'), size: 150, Cell: ({ row }) => <Badge variant="light" color={STATUS_COLOR[row.original.status]}>{t(`quotes.status.${row.original.status}`)}</Badge> },
      { accessorKey: 'basedOnLabel', header: t('quotes.basedOn'), size: 190 },
      { accessorKey: 'cost', header: t('quotes.cost'), size: 120, Cell: ({ cell }) => (cell.getValue<number | null>() != null ? formatPLNWhole(cell.getValue<number>()) : '') },
      { accessorKey: 'net', header: t('quotes.net'), size: 120, Cell: ({ cell }) => (cell.getValue<number | null>() != null ? formatPLNWhole(cell.getValue<number>()) : '') },
      { accessorKey: 'updatedAt', header: t('quotes.updated'), size: 150, Cell: ({ row }) => `${formatDateTime(row.original.updatedAt)}` },
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
    mantineTableContainerProps: { style: { maxHeight: 'calc(100vh - 260px)' } },
    mantineTableBodyRowProps: ({ row }) => ({ onClick: () => navigate(`/wyceny/${row.original.id}`), style: { cursor: 'pointer' } }),
    getRowId: (r) => r.id,
  })

  if (q.isLoading) return <Loader />
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('quotes.title')}</Title>
        {can('quotes', 'create') && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
            {t('quotes.new')}
          </Button>
        )}
      </Group>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      <TextInput w={280} leftSection={<IconSearch size={16} />} placeholder={t('crm.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
      <MantineReactTable table={table} />
      <NewQuoteModal
        opened={open}
        opportunityId={params.get('szansa')}
        onClose={() => {
          setOpen(false)
          if (params.has('nowa')) setParams({}, { replace: true })
        }}
      />
    </Stack>
  )
}

/** `/wyceny` — lista; `/wyceny/{id}` — edytor. `?nowa&szansa={id}` otwiera nową wycenę dla szansy. */
export function QuotesPage() {
  const { id } = useParams()
  return id ? <QuoteEditor key={id} id={id} /> : <QuotesList />
}
