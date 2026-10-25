import { ActionIcon, Badge, Button, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import { format } from 'date-fns'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COMPONENT_CATEGORIES, type ComponentCategory, type ComponentDto, type ComponentInput } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatPLN } from '../../lib/format'
import { useComponents, useDeleteComponent, useSaveComponent } from './api'

const EMPTY: ComponentInput = { category: 'compressor', name: '' }

function ComponentModal({ item, opened, onClose }: { item: ComponentDto | null; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const save = useSaveComponent()
  const [f, setF] = useState<ComponentInput>(EMPTY)
  useEffect(() => {
    if (!opened) return
    if (item) {
      const { id: _i, priceStale: _s, version: _v, updatedAt: _u, ...rest } = item
      setF(rest)
    } else setF(EMPTY)
  }, [opened, item])
  const editable = item ? can('quoteKnowledge', 'edit') : can('quoteKnowledge', 'create')
  const priceEditable = editable && can('quotesCost', 'edit')
  const text = (k: 'name' | 'manufacturer' | 'partNo' | 'supplier' | 'unit' | 'refrigerant', label: string, required = false) => (
    <TextInput label={label} required={required} disabled={!editable} value={(f[k] as string | null | undefined) ?? ''} onChange={(e) => setF({ ...f, [k]: e.currentTarget.value || (required ? '' : null) })} />
  )
  const numField = (k: 'capacityW' | 'evapTempC', label: string) => (
    <NumberInput label={label} decimalSeparator="," disabled={!editable} value={f[k] ?? ''} onChange={(v) => setF({ ...f, [k]: v === '' ? null : Number(v) })} />
  )
  return (
    <Modal opened={opened} onClose={onClose} title={t('catalog.edit')} size="lg">
      <Stack gap="sm">
        <Select label={t('catalog.category')} allowDeselect={false} disabled={!editable} data={COMPONENT_CATEGORIES.map((c) => ({ value: c, label: t(`catalog.categoryName.${c}`) }))} value={f.category} onChange={(v) => v && setF({ ...f, category: v as ComponentCategory })} />
        {text('name', t('catalog.name'), true)}
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {text('manufacturer', t('catalog.manufacturer'))}
          {text('partNo', t('catalog.partNo'))}
          {text('supplier', t('catalog.supplier'))}
          {text('unit', t('catalog.unit'))}
          {can('quotesCost', 'view') && (
            <NumberInput label={t('catalog.price')} min={0} thousandSeparator=" " decimalSeparator="," disabled={!priceEditable} value={f.price ?? ''} onChange={(v) => setF({ ...f, price: v === '' ? null : Number(v) })} />
          )}
          <DateInput label={t('catalog.priceDate')} valueFormat="DD.MM.YYYY" clearable disabled={!priceEditable} value={f.priceDate ? new Date(`${f.priceDate}T00:00:00`) : null} onChange={(v) => setF({ ...f, priceDate: v ? format(new Date(v), 'yyyy-MM-dd') : null })} />
          {numField('capacityW', t('catalog.capacityW'))}
          {numField('evapTempC', t('catalog.evapTempC'))}
          {text('refrigerant', t('catalog.refrigerant'))}
        </SimpleGrid>
        <Textarea label={t('catalog.notes')} autosize minRows={2} disabled={!editable} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.currentTarget.value || null })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          {editable && (
            <Button
              disabled={!f.name.trim()}
              loading={save.isPending}
              onClick={() => {
                // Bez uprawnienia do kosztów nie wysyłamy ceny (API odrzuciłoby zmianę).
                const { price: _p, priceDate: _d, ...rest } = f
                const data = priceEditable ? f : rest
                save.mutate({ id: item?.id, version: item?.version, data }, { onSuccess: onClose, onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })
              }}
            >
              {t('app.save')}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  )
}

export function CatalogTab() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useComponents()
  const del = useDeleteComponent()
  const [open, setOpen] = useState<ComponentDto | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const items = useMemo(() => {
    const s = search.trim().toLocaleLowerCase('pl')
    return (q.data ?? []).filter((c) => (!category || c.category === category) && (!s || [c.name, c.manufacturer, c.partNo].some((v) => v?.toLocaleLowerCase('pl').includes(s))))
  }, [q.data, search, category])
  const columns = useMemo<MRT_ColumnDef<ComponentDto>[]>(
    () => [
      { accessorKey: 'category', header: t('catalog.category'), size: 150, Cell: ({ cell }) => t(`catalog.categoryName.${cell.getValue<string>()}`) },
      { accessorKey: 'name', header: t('catalog.name'), size: 240, grow: true },
      { accessorKey: 'manufacturer', header: t('catalog.manufacturer'), size: 140 },
      { accessorKey: 'capacityW', header: t('catalog.capacityW'), size: 120, Cell: ({ row }) => (row.original.capacityW != null ? `${row.original.capacityW} W${row.original.evapTempC != null ? ` @ ${row.original.evapTempC} °C` : ''}` : '') },
      {
        accessorKey: 'price',
        header: t('catalog.price'),
        size: 150,
        Cell: ({ row }) => (
          <Group gap={4} wrap="nowrap">
            <Text size="sm">{row.original.price != null ? formatPLN(row.original.price) : ''}</Text>
            {row.original.priceStale && (
              <Badge size="xs" color="orange" variant="light">
                {t('catalog.priceStale')}
              </Badge>
            )}
          </Group>
        ),
      },
      { accessorKey: 'priceDate', header: t('catalog.priceDate'), size: 110, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      {
        id: 'actions',
        header: '',
        size: 50,
        Cell: ({ row }) =>
          can('quoteKnowledge', 'delete') && (
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              aria-label={t('app.delete')}
              onClick={(e) => {
                e.stopPropagation()
                modals.openConfirmModal({
                  title: t('catalog.deleteConfirm', { name: row.original.name }),
                  labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
                  confirmProps: { color: 'red' },
                  onConfirm: () => del.mutate(row.original.id),
                })
              }}
            >
              <IconTrash size={14} />
            </ActionIcon>
          ),
      },
    ],
    [t, can, del],
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
    mantineTableBodyRowProps: ({ row }) => ({ onClick: () => setOpen(row.original), style: { cursor: 'pointer' } }),
    getRowId: (r) => r.id,
    renderEmptyRowsFallback: () => (
      <Text c="dimmed" p="md">
        {t('catalog.empty')}
      </Text>
    ),
  })
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <TextInput w={260} leftSection={<IconSearch size={16} />} placeholder={t('catalog.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Select w={220} clearable placeholder={t('catalog.category')} data={COMPONENT_CATEGORIES.map((c) => ({ value: c, label: t(`catalog.categoryName.${c}`) }))} value={category} onChange={setCategory} />
        </Group>
        {can('quoteKnowledge', 'create') && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen('new')}>
            {t('catalog.add')}
          </Button>
        )}
      </Group>
      <MantineReactTable table={table} />
      <ComponentModal item={open === 'new' ? null : open} opened={!!open} onClose={() => setOpen(null)} />
    </Stack>
  )
}
