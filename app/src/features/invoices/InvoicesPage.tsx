import { Alert, Badge, Button, Group, Loader, Modal, SegmentedControl, Select, Stack, Switch, Table, Tabs, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconRefresh, IconSearch, IconSend } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef, type MRT_RowSelectionState } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'
import { INVOICE_EDITABLE, invoiceDueState, type CostCategoryDto, type InvoiceDto, type InvoiceSyncResult } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime, todayWarsaw } from '../../lib/format'
import { fromDate, toDate } from '../management/common'
import { BankTab } from './BankTab'
import { useBankCosts } from './bankApi'
import { useBulkAllocation, useBulkCategory, useBulkSubmit, useCostCategories, useInvoices, useSaveAllocation, useSetInvoiceCategory, useSyncInvoices } from './api'
import { CommentModal, InvoiceDrawer } from './InvoiceDrawer'
import { DISPLAY_STATUSES, InvoiceStatusBadge, PaymentDot, displayStatus, formatMoney } from './status'

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('pl')

function AllocationBadges({ inv }: { inv: InvoiceDto }) {
  const { t } = useTranslation()
  return (
    <Group gap={4}>
      {inv.allocations.map((a) => (
        <Badge key={a.projectId} variant="light" title={a.projectName}>
          {a.projectCode} {a.share.toLocaleString('pl-PL')}%
        </Badge>
      ))}
      {inv.general && (
        <Badge variant="outline" color="gray" title={t('invoices.generalHint')}>
          {t('invoices.general')} 100%
        </Badge>
      )}
      {inv.allocatedShare < 100 && inv.allocatedShare > 0 && (
        <Badge variant="outline" color="gray">
          {t('invoices.general')} {(Math.round((100 - inv.allocatedShare) * 100) / 100).toLocaleString('pl-PL')}%
        </Badge>
      )}
    </Group>
  )
}

/** Edycja w wierszu: faktura do przypisania / odrzucona, bez podziału na kilka projektów. */
function inlineEditable(inv: InvoiceDto, canEdit: boolean) {
  const split = inv.allocations.length > 1 || (inv.allocations.length === 1 && inv.allocations[0]!.share !== 100)
  return canEdit && INVOICE_EDITABLE.includes(inv.status) && !split
}

/** Opis kosztu w projekcie — w wierszu, zapis po wyjściu z pola lub Enterze. Bez projektu (koszty ogólne) nieaktywny. */
function DescriptionCell({ inv }: { inv: InvoiceDto }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const save = useSaveAllocation()
  const current = inv.allocations.map((a) => a.description).filter(Boolean).join('; ')
  const [value, setValue] = useState(current)
  useEffect(() => setValue(current), [current])
  if (!inlineEditable(inv, can('invoices', 'edit'))) {
    return (
      <Text size="sm" lineClamp={2} title={current}>
        {current}
      </Text>
    )
  }
  const alloc = inv.allocations[0]
  const commit = () => {
    if (!alloc || value.trim() === current) return
    save.mutate(
      { id: inv.id, data: { allocations: [{ projectId: alloc.projectId, share: 100, description: value.trim() || null }], version: inv.version } },
      { onError: (e) => (setValue(current), notifications.show({ color: 'red', message: errorMessage(e) })) },
    )
  }
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ width: '100%' }}>
      <TextInput
        size="xs"
        maxLength={500}
        disabled={!alloc || save.isPending}
        placeholder={alloc ? t('invoices.allocationDescription') : t('invoices.descriptionNeedsProject')}
        aria-label={t('invoices.allocationDescription')}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setValue(current)
        }}
        rightSection={save.isPending ? <Loader size={12} /> : undefined}
      />
    </div>
  )
}

const GENERAL = '__general'

/**
 * Przypisanie z listy: jeden projekt = 100% (najczęstszy przypadek) albo koszty ogólne (bez projektu). Podział na kilka projektów
 * i faktury po wysłaniu do akceptacji — tylko odznaki; edycja w karcie faktury.
 */
function ProjectCell({ inv, options }: { inv: InvoiceDto; options: { value: string; label: string }[] }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const save = useSaveAllocation()
  if (!inlineEditable(inv, can('invoices', 'edit'))) return <AllocationBadges inv={inv} />
  const description = inv.allocations[0]?.description ?? null
  return (
    // Zdarzenia z listy rozwijanej (portal) wędrują w drzewie Reacta do wiersza — bez tego kliknięcie otwierałoby kartę.
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ width: '100%' }}>
      <Select
        size="xs"
        searchable
        clearable
        placeholder={t('invoices.assignProject')}
        aria-label={t('invoices.project')}
        data={[{ value: GENERAL, label: t('invoices.generalShort') }, ...options]}
        value={inv.allocations[0]?.projectId ?? (inv.general ? GENERAL : null)}
        disabled={save.isPending}
        rightSection={save.isPending ? <Loader size={12} /> : undefined}
        comboboxProps={{ withinPortal: true }}
        onChange={(v) =>
          save.mutate(
            { id: inv.id, data: { allocations: v && v !== GENERAL ? [{ projectId: v, share: 100, description }] : [], general: v === GENERAL, version: inv.version } },
            { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
          )
        }
      />
    </div>
  )
}

/** Kategoria kosztu — wybór w wierszu (w każdym statusie); wyłączone kategorie tylko pokazywane. */
function CategoryCell({ inv, categories }: { inv: InvoiceDto; categories: CostCategoryDto[] }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const set = useSetInvoiceCategory()
  if (!can('invoices', 'edit')) return <Text size="sm">{inv.costCategoryName ?? ''}</Text>
  const data = categories.filter((k) => k.active || k.id === inv.costCategoryId).map((k) => ({ value: k.id, label: k.active ? k.name : `${k.name} ${t('invoices.categoryInactive')}` }))
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ width: '100%' }}>
      <Select
        size="xs"
        searchable
        clearable
        placeholder={t('invoices.categoryPick')}
        aria-label={t('invoices.category')}
        data={data}
        value={inv.costCategoryId}
        disabled={set.isPending}
        rightSection={set.isPending ? <Loader size={12} /> : undefined}
        comboboxProps={{ withinPortal: true }}
        onChange={(v) => set.mutate({ id: inv.id, costCategoryId: v }, { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}
      />
    </div>
  )
}

/** Zbiorcza zmiana przypisania zaznaczonych faktur: jeden projekt (100%) albo koszty ogólne. */
function BulkBar({ ids, options, categories, onDone }: { ids: string[]; options: { value: string; label: string }[]; categories: CostCategoryDto[]; onDone: () => void }) {
  const { t } = useTranslation()
  const bulk = useBulkAllocation()
  const bulkCategory = useBulkCategory()
  const bulkSubmit = useBulkSubmit()
  const [submitting, setSubmitting] = useState(false)
  const [category, setCategory] = useState<string | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  return (
    <Group gap="xs" px="xs" py={4} bg="var(--mantine-color-blue-light)" style={{ borderRadius: 'var(--mantine-radius-sm)' }} wrap="nowrap">
      <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
        {t('invoices.bulk.selected', { count: ids.length })}
      </Text>
      <Select
        w={240}
        size="xs"
        searchable
        aria-label={t('invoices.bulk.project')}
        placeholder={t('invoices.bulk.project')}
        data={[{ value: GENERAL, label: t('invoices.generalHint') }, ...options]}
        value={project}
        onChange={setProject}
      />
      <TextInput w={220} size="xs" aria-label={t('invoices.allocationDescription')} placeholder={t('invoices.bulk.descriptionKeep')} maxLength={500} value={description} onChange={(e) => setDescription(e.currentTarget.value)} disabled={project === GENERAL} />
      <Button
        size="xs"
        disabled={!project}
        loading={bulk.isPending}
        onClick={() =>
          bulk.mutate(
            { ids, projectId: project === GENERAL ? null : project, ...(description.trim() ? { description: description.trim() } : {}) },
            {
              onSuccess: (r) => {
                notifications.show({ color: r.skipped ? 'yellow' : 'green', message: t('invoices.bulk.done', { updated: r.updated, skipped: r.skipped }) })
                setProject(null)
                setDescription('')
                onDone()
              },
              onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
            },
          )
        }
      >
        {t('invoices.bulk.apply')}
      </Button>
      <Select
        w={190}
        size="xs"
        searchable
        aria-label={t('invoices.category')}
        placeholder={t('invoices.category')}
        data={[{ value: NO_CATEGORY, label: t('invoices.categoryNone') }, ...categories.filter((k) => k.active).map((k) => ({ value: k.id, label: k.name }))]}
        value={category}
        onChange={setCategory}
      />
      <Button
        size="xs"
        variant="light"
        disabled={!category}
        loading={bulkCategory.isPending}
        onClick={() =>
          bulkCategory.mutate(
            { ids, costCategoryId: category === NO_CATEGORY ? null : category },
            {
              onSuccess: (r) => {
                notifications.show({ color: 'green', message: t('invoices.bulk.categoryDone', { updated: r.updated }) })
                setCategory(null)
              },
              onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
            },
          )
        }
      >
        {t('invoices.bulk.setCategory')}
      </Button>
      <Button
        size="xs"
        variant="light"
        color="yellow"
        leftSection={<IconSend size={14} />}
        onClick={() => setSubmitting(true)}
      >
        {t('invoices.bulk.submit')}
      </Button>
      <CommentModal
        action={submitting ? 'submit' : null}
        title={`${t('invoices.bulk.submit')} — ${t('invoices.bulk.selected', { count: ids.length })}`}
        loading={bulkSubmit.isPending}
        onClose={() => setSubmitting(false)}
        onConfirm={(comment, approverId) =>
          bulkSubmit.mutate(
            { ids, approverId: approverId!, comment: comment || null },
            {
              onSuccess: (r) => {
                notifications.show({ color: r.skipped ? 'yellow' : 'green', message: t('invoices.bulk.submitDone', { updated: r.updated, skipped: r.skipped }) })
                setSubmitting(false)
                onDone()
              },
              onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
            },
          )
        }
      />
      <Button size="xs" variant="subtle" onClick={onDone}>
        {t('invoices.bulk.clear')}
      </Button>
    </Group>
  )
}

const NO_CATEGORY = '__none'

/** Filtr kolumny „lista wyboru” (kilka wartości): pusty = bez filtra. */
const anyOf = (value: string, filter: unknown) => !Array.isArray(filter) || !filter.length || filter.includes(value)

function ListTab({ items, onOpen }: { items: InvoiceDto[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const canEdit = can('invoices', 'edit')
  const me = useMe()
  const [selection, setSelection] = useState<MRT_RowSelectionState>({})
  const [search, setSearch] = useState('')
  const categoriesQ = useCostCategories()
  const categories = useMemo(() => categoriesQ.data ?? [], [categoriesQ.data])
  const [missing, setMissing] = useState(false)
  // Miesiące kosztu (wystawienie, a dla plików bez daty — dodanie do inFakt); kilka naraz, np. kwartał.
  const monthOptions = useMemo(
    () =>
      [...new Set(items.map(costMonth).filter(Boolean))]
        .sort()
        .reverse()
        .map((m) => ({ value: m, label: dayjs(`${m}-01`).locale('pl').format('MMMM YYYY') })),
    [items],
  )

  // Wyszukiwarka i przełączniki (pasek narzędzi tabeli); pozostałe filtry — w kolumnach tabeli (ikona filtra).
  const filtered = useMemo(() => {
    const s = norm(search.trim())
    return items.filter(
      (i) =>
        (!s || [i.number, i.sellerName, i.description, i.category, i.costCategoryName, ...i.allocations.map((a) => a.description)].some((x) => norm(x).includes(s))) &&
        (!missing || i.netPrice == null || !i.number || !i.sellerName),
    )
  }, [items, search, missing])

  const projectOptions = useMemo(() => me.projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })), [me.projects])

  const columns = useMemo<MRT_ColumnDef<InvoiceDto>[]>(() => {
    const statusOptions = DISPLAY_STATUSES.map((s) => ({ value: s, label: t(`invoices.status.${s}`) }))
    const projectFilterOptions = [{ value: 'unassigned', label: t('invoices.unassigned') }, { value: 'general', label: t('invoices.general') }, ...projectOptions]
    const categoryOptions = [{ value: NO_CATEGORY, label: t('invoices.categoryNone') }, ...categories.map((k) => ({ value: k.id, label: k.name }))]
    const labelOf = (opts: { value: string; label: string }[]) => (v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v)
    return [
      {
        // Kropka statusu płatności na początku wiersza (przed datą) — opis w podpowiedzi, bez filtra.
        id: 'payment',
        accessorFn: (r) => ({ paid: 2, due: 1, overdue: 0 })[invoiceDueState(r, todayWarsaw())],
        header: t('invoices.pay.label'),
        Header: () => null,
        size: 40,
        enableColumnFilter: false,
        mantineTableBodyCellProps: { align: 'center' },
        Cell: ({ row }) => <PaymentDot inv={row.original} />,
      },
      {
        // Pliki bez daty wystawienia — data dodania do inFakt (szara). Filtr: miesiące kosztu.
        id: 'date',
        accessorFn: (r) => r.issueDate ?? r.infaktCreatedAt?.slice(0, 10) ?? '',
        header: t('invoices.date'),
        size: 100,
        filterVariant: 'multi-select',
        mantineFilterMultiSelectProps: { data: monthOptions, placeholder: t('invoices.month'), searchable: true },
        filterFn: (row, _id, value) => anyOf(costMonth(row.original), value),
        filterTooltipValueFn: labelOf(monthOptions),
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
        size: 140,
        Cell: ({ row }) =>
          row.original.number ?? (
            <Text size="sm" c="dimmed" fs="italic">
              {row.original.description ?? t('invoices.fileNoData')}
            </Text>
          ),
      },
      { accessorKey: 'sellerName', header: t('invoices.seller'), size: 160, grow: true },
      {
        accessorKey: 'netPrice',
        header: t('invoices.net'),
        size: 115,
        mantineTableBodyCellProps: { align: 'right' },
        Cell: ({ row }) => formatMoney(row.original.netPrice, row.original.currency),
      },
      {
        accessorKey: 'grossPrice',
        header: t('invoices.gross'),
        size: 115,
        mantineTableBodyCellProps: { align: 'right' },
        Cell: ({ row }) => formatMoney(row.original.grossPrice, row.original.currency),
      },
      {
        id: 'projects',
        accessorFn: (r) => r.allocations.map((a) => a.projectId).join(','),
        header: t('invoices.projects'),
        size: 210,
        enableSorting: false,
        filterVariant: 'select',
        mantineFilterSelectProps: { data: projectFilterOptions, placeholder: t('invoices.project'), searchable: true },
        filterFn: ({ original: i }, _id, project) =>
          !project ||
          (project === 'general'
            ? i.general || (i.allocatedShare > 0 && i.allocatedShare < 100)
            : project === 'unassigned'
              ? !i.allocations.length && !i.general
              : i.allocations.some((a) => a.projectId === project)),
        filterTooltipValueFn: labelOf(projectFilterOptions),
        Cell: ({ row }) => <ProjectCell inv={row.original} options={projectOptions} />,
      },
      {
        id: 'category',
        accessorFn: (r) => r.costCategoryName ?? '',
        header: t('invoices.category'),
        size: 170,
        filterVariant: 'multi-select',
        mantineFilterMultiSelectProps: { data: categoryOptions, placeholder: t('invoices.category'), searchable: true },
        filterFn: (row, _id, value) => anyOf(row.original.costCategoryId ?? NO_CATEGORY, value),
        filterTooltipValueFn: labelOf(categoryOptions),
        Cell: ({ row }) => <CategoryCell inv={row.original} categories={categories} />,
      },
      {
        id: 'description',
        accessorFn: (r) => r.allocations.map((a) => a.description).filter(Boolean).join('; '),
        header: t('invoices.allocationDescription'),
        size: 190,
        enableSorting: false,
        Cell: ({ row }) => <DescriptionCell inv={row.original} />,
      },
      {
        id: 'status',
        accessorFn: displayStatus,
        header: t('invoices.statusLabel'),
        size: 170,
        filterVariant: 'multi-select',
        mantineFilterMultiSelectProps: { data: statusOptions, placeholder: t('invoices.statusLabel') },
        filterFn: (row, _id, value) => anyOf(displayStatus(row.original), value),
        filterTooltipValueFn: labelOf(statusOptions),
        Cell: ({ row }) => <InvoiceStatusBadge inv={row.original} />,
      },
    ]
  }, [t, projectOptions, categories, monthOptions])

  const table = useMantineReactTable({
    columns,
    data: filtered,
    localization: MRT_Localization_PL,
    layoutMode: 'grid',
    enableColumnActions: false,
    enableGlobalFilter: false,
    // Filtr kolumny otwiera się w okienku po kliknięciu ikony w nagłówku (bez wiersza filtrów pod nagłówkiem).
    columnFilterDisplayMode: 'popover',
    // Brutto i opis kosztu domyślnie ukryte (miejsce); opis edytuje się w karcie faktury, kolumny do włączenia w menu kolumn.
    // Domyślnie faktury w toku (bez zaakceptowanych i rozliczonych) — filtr kolumny Status.
    initialState: {
      density: 'xs',
      columnVisibility: { grossPrice: false, description: false },
      columnFilters: [{ id: 'status', value: ['new', 'assigned', 'pending', 'rejected'] }],
    },
    enablePagination: false,
    enableStickyHeader: true,
    mantineTableContainerProps: { style: { maxHeight: 'calc(100vh - 270px)' } },
    mantineTableBodyRowProps: ({ row }) => ({ onClick: () => onOpen(row.original.id), style: { cursor: 'pointer' } }),
    getRowId: (r) => r.id,
    // Zaznaczać można faktury, których przypisanie da się zmienić (do przypisania / odrzucone).
    enableRowSelection: (row) => canEdit && INVOICE_EDITABLE.includes(row.original.status),
    enableSelectAll: canEdit,
    onRowSelectionChange: setSelection,
    state: { rowSelection: selection },
    mantineSelectCheckboxProps: { onClick: (e) => e.stopPropagation() },
    // Pasek zbiorczy w pasku narzędzi tabeli (stała wysokość — zaznaczenie nie przesuwa wierszy).
    positionToolbarAlertBanner: 'none',
    renderTopToolbarCustomActions: ({ table }) => {
      // Zaznaczone i nadal widoczne po filtrach.
      const selectedIds = table.getFilteredRowModel().rows.filter((r) => selection[r.id]).map((r) => r.id)
      return (
        <Group gap="sm" wrap="wrap">
          <TextInput w={240} size="xs" leftSection={<IconSearch size={14} />} placeholder={t('invoices.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} aria-label={t('invoices.search')} />
          <Switch size="xs" label={t('invoices.onlyMissing')} checked={missing} onChange={(e) => setMissing(e.currentTarget.checked)} />
          {selectedIds.length > 0 ? (
            <BulkBar ids={selectedIds} options={projectOptions} categories={categories} onDone={() => setSelection({})} />
          ) : (
            canEdit && (
              <Text size="xs" c="dimmed">
                {t('invoices.bulk.hint')}
              </Text>
            )
          )}
        </Group>
      )
    },
  })

  return <MantineReactTable table={table} />
}

type CostRowKind = 'project' | 'staff' | 'general' | 'unassigned'
interface CostRow {
  kind: CostRowKind
  label: string
  currency: string
  byMonth: Map<string, number>
  total: number
  invoices: Set<string>
}

/** Miesiąc kosztu: data wystawienia, a dla plików bez niej — data dodania do inFakt. */
const costMonth = (i: InvoiceDto) => (i.issueDate ?? i.infaktCreatedAt?.slice(0, 10) ?? '').slice(0, 7)

/**
 * Koszty netto po miesiącach: projekty, koszty ogólne (świadome i reszta z podziału %) oraz faktury nieprzypisane.
 * Kwoty w walucie faktury; „Wszystkie” — każdy status, „Zaakceptowane” — tylko po akceptacji.
 */
function ProjectsTab({ items }: { items: InvoiceDto[] }) {
  const { t } = useTranslation()
  const me = useMe()
  const [scope, setScope] = useState<'all' | 'approved'>('all')
  const bankCosts = useBankCosts()
  const staff = useCostCategories().data?.find((k) => k.staff)
  const payments = useMemo(() => bankCosts.data ?? [], [bankCosts.data])
  const years = useMemo(
    () => [...new Set([...items.map((i) => costMonth(i).slice(0, 4)), ...payments.map((p) => p.bookingDate.slice(0, 4))].filter(Boolean))].sort().reverse(),
    [items, payments],
  )
  const [year, setYear] = useState<string | null>(null)
  const activeYear = year ?? years[0] ?? null

  const { rows, months, skipped } = useMemo(() => {
    const acc = new Map<string, CostRow>()
    const monthsSet = new Set<string>()
    let skipped = 0
    const add = (kind: CostRowKind, key: string, label: string, i: { id: string; currency: string }, month: string, cents: number) => {
      const k = `${key}|${i.currency}`
      const r = acc.get(k) ?? { kind, label, currency: i.currency, byMonth: new Map(), total: 0, invoices: new Set() }
      r.byMonth.set(month, (r.byMonth.get(month) ?? 0) + cents)
      r.total += cents
      r.invoices.add(i.id)
      acc.set(k, r)
    }
    const inYear = (month: string) => !activeYear || year === 'all' || month.startsWith(activeYear)
    for (const i of items) {
      if (scope === 'approved' && i.status !== 'approved') continue
      const month = costMonth(i)
      if (!inYear(month)) continue
      if (i.netPrice == null) {
        skipped += 1
        continue
      }
      monthsSet.add(month)
      for (const a of i.allocations) add('project', a.projectId, `${a.projectCode} — ${a.projectName}`, i, month, a.netAmount ?? 0)
      const rest = i.netPrice - i.allocations.reduce((s, a) => s + (a.netAmount ?? 0), 0)
      if (rest === 0) continue
      // Część bez projektu z kategorią „Pracownicze” — osobna kolumna; bez projektów i bez decyzji „koszty ogólne” —
      // nieprzypisana; reszta z podziału % albo świadomy wybór — ogólne.
      if (staff && i.costCategoryId === staff.id) add('staff', 'staff', staff.name, i, month, rest)
      else if (!i.allocations.length && !i.general) add('unassigned', 'unassigned', t('invoices.perProject.unassigned'), i, month, rest)
      else add('general', 'general', t('invoices.general'), i, month, rest)
    }
    // Płatności z wyciągów oznaczone „bez faktury” — netto wg stawki VAT, miesiąc operacji (bez akceptacji, więc w obu zakresach).
    for (const p of payments) {
      const month = p.bookingDate.slice(0, 7)
      if (!inYear(month)) continue
      monthsSet.add(month)
      if (p.projectId) add('project', p.projectId, `${p.projectCode} — ${p.projectName}`, p, month, p.net)
      else if (staff && p.costCategoryId === staff.id) add('staff', 'staff', staff.name, p, month, p.net)
      else if (p.general) add('general', 'general', t('invoices.general'), p, month, p.net)
      else add('unassigned', 'unassigned', t('invoices.perProject.unassigned'), p, month, p.net)
    }
    // Projekty w kolejności z menu, potem „Pracownicze”, „Ogólne” i „Nieprzypisane”; w obrębie grupy PLN przed walutami obcymi.
    const order = new Map<string, number>(me.projects.map((p, idx) => [p.id, idx]))
    const GROUP: Record<CostRowKind, number> = { project: 0, staff: 1e6, general: 1e6 + 1, unassigned: 1e6 + 2 }
    const rank = (key: string, r: CostRow) => [r.kind === 'project' ? (order.get(key.split('|')[0]!) ?? 0) : GROUP[r.kind], r.currency === 'PLN' ? '' : r.currency] as const
    const rows = [...acc.entries()].sort(([ka, a], [kb, b]) => {
      const [pa, ca] = rank(ka, a)
      const [pb, cb] = rank(kb, b)
      return pa - pb || ca.localeCompare(cb)
    })
    return { rows, months: [...monthsSet].sort(), skipped }
  }, [items, payments, staff, scope, activeYear, year, me.projects, t])

  // Wiersz „Razem” tylko dla PLN (sumowanie walut nie ma sensu).
  const pln = rows.filter(([, r]) => r.currency === 'PLN')
  const monthLabel = (m: string) => dayjs(`${m}-01`).locale('pl').format('MMM YYYY')

  return (
    <Stack>
      <Group gap="sm" wrap="wrap">
        <SegmentedControl
          size="xs"
          value={scope}
          onChange={(v) => setScope(v as 'all' | 'approved')}
          data={[
            { value: 'all', label: t('invoices.perProject.all') },
            { value: 'approved', label: t('invoices.perProject.approvedOnly') },
          ]}
        />
        {years.length > 0 && (
          <Select
            size="xs"
            w={150}
            allowDeselect={false}
            aria-label={t('invoices.perProject.year')}
            data={[...years.map((y) => ({ value: y, label: y })), { value: 'all', label: t('invoices.perProject.allYears') }]}
            value={year ?? activeYear}
            onChange={setYear}
          />
        )}
        <Text size="sm" c="dimmed">
          {t('invoices.perProject.hint')}
        </Text>
      </Group>
      {skipped > 0 && (
        <Text size="xs" c="orange.8">
          {t('invoices.perProject.skipped', { count: skipped })}
        </Text>
      )}
      {/* Projekty w kolumnach, miesiące w wierszach; przy wielu projektach tabela przewija się w poziomie. */}
      <Table.ScrollContainer minWidth={600}>
        <Table withTableBorder striped fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('invoices.perProject.month')}</Table.Th>
              {rows.map(([key, r]) => (
                <Table.Th key={key} ta="right" c={r.kind === 'unassigned' ? 'orange.8' : r.kind === 'general' ? 'dimmed' : undefined} style={{ whiteSpace: 'nowrap' }}>
                  {r.label}
                  {r.currency !== 'PLN' ? ` (${r.currency})` : ''}
                </Table.Th>
              ))}
              {pln.length > 0 && <Table.Th ta="right">{t('invoices.perProject.sumPln')}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {months.map((m) => (
              <Table.Tr key={m}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{monthLabel(m)}</Table.Td>
                {rows.map(([key, r]) => (
                  <Table.Td key={key} ta="right" c={r.byMonth.get(m) ? undefined : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                    {r.byMonth.get(m) ? formatMoney(r.byMonth.get(m)!, r.currency) : '·'}
                  </Table.Td>
                ))}
                {pln.length > 0 && (
                  <Table.Td ta="right" fw={600} style={{ whiteSpace: 'nowrap' }}>
                    {formatMoney(pln.reduce((s, [, r]) => s + (r.byMonth.get(m) ?? 0), 0), 'PLN')}
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
          {rows.length > 0 && (
            <Table.Tfoot>
              <Table.Tr style={{ fontWeight: 600 }}>
                <Table.Td>{t('invoices.perProject.total')}</Table.Td>
                {rows.map(([key, r]) => (
                  <Table.Td key={key} ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {formatMoney(r.total, r.currency)}
                  </Table.Td>
                ))}
                {pln.length > 0 && (
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {formatMoney(pln.reduce((s, [, r]) => s + r.total, 0), 'PLN')}
                  </Table.Td>
                )}
              </Table.Tr>
              <Table.Tr>
                <Table.Td>{t('invoices.perProject.count')}</Table.Td>
                {rows.map(([key, r]) => (
                  <Table.Td key={key} ta="right">
                    {r.invoices.size}
                  </Table.Td>
                ))}
                {pln.length > 0 && <Table.Td />}
              </Table.Tr>
            </Table.Tfoot>
          )}
        </Table>
      </Table.ScrollContainer>
      {!rows.length && <Text c="dimmed">{t('invoices.perProject.empty')}</Text>}
    </Stack>
  )
}

const iso = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD')

/** Eksport XLSX za wybrany okres (domyślnie poprzedni miesiąc — typowe rozliczenie z księgowością). */
function ExportModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const prev = dayjs().subtract(1, 'month')
  const [from, setFrom] = useState<string | null>(iso(prev.startOf('month')))
  const [to, setTo] = useState<string | null>(iso(prev.endOf('month')))
  const [loading, setLoading] = useState(false)
  const preset = (a: dayjs.Dayjs, b: dayjs.Dayjs) => (setFrom(iso(a)), setTo(iso(b)))
  const invalid = !!from && !!to && from > to
  const run = () => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const name = from || to ? `faktury-projekty-${from ?? 'start'}_${to ?? 'dzis'}.xlsx` : 'faktury-projekty.xlsx'
    setLoading(true)
    downloadFile(`/invoices/export.xlsx${q.size ? `?${q}` : ''}`, name)
      .then(onClose)
      .catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))
      .finally(() => setLoading(false))
  }
  const now = dayjs()
  return (
    <Modal opened={opened} onClose={onClose} title={t('invoices.exportModal.title')}>
      <Stack>
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={() => preset(prev.startOf('month'), prev.endOf('month'))}>
            {t('invoices.exportModal.prevMonth')}
          </Button>
          <Button size="xs" variant="light" onClick={() => preset(now.startOf('month'), now.endOf('month'))}>
            {t('invoices.exportModal.thisMonth')}
          </Button>
          <Button size="xs" variant="light" onClick={() => preset(now.startOf('year'), now.endOf('year'))}>
            {t('invoices.exportModal.thisYear')}
          </Button>
        </Group>
        <Group grow>
          <DateInput label={t('invoices.exportModal.from')} valueFormat="DD.MM.YYYY" clearable value={toDate(from)} onChange={(d) => setFrom(fromDate(d))} />
          <DateInput label={t('invoices.exportModal.to')} valueFormat="DD.MM.YYYY" clearable value={toDate(to)} onChange={(d) => setTo(fromDate(d))} error={invalid ? t('validation.dateRange') : undefined} />
        </Group>
        <Text size="xs" c="dimmed">
          {t('invoices.exportModal.hint')}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button leftSection={<IconDownload size={16} />} loading={loading} disabled={invalid} onClick={run}>
            {t('invoices.exportModal.run')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Komunikat po synchronizacji: koszty z inFakt i wynik dopasowania Rozliczeń. */
const syncMessage = (t: (k: string, o?: Record<string, unknown>) => string, r: InvoiceSyncResult) =>
  [t('invoices.synced', { ...r }), r.match ? t('invoices.syncedMatch', { ...r.match }) : null].filter(Boolean).join(' · ')

export function InvoicesPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useInvoices()
  const sync = useSyncInvoices()
  const [exporting, setExporting] = useState(false)
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<string | null>('list')
  const [open, setOpenState] = useState<string | null>(params.get('faktura'))
  const setOpen = (v: string | null) => {
    setOpenState(v)
    if (params.has('faktura')) setParams({}, { replace: true })
  }

  const data = q.data
  // Stare linki z e-maili (?akceptacja) — strona „Do akceptacji”.
  if (params.has('akceptacja')) return <Navigate to="/akceptacja" replace />
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
              onClick={() => setExporting(true)}
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
                  onSuccess: (r) => notifications.show({ color: 'green', message: syncMessage(t, r) }),
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
        <Tabs value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="list">{t('invoices.tabs.list')}</Tabs.Tab>
            <Tabs.Tab value="projects">{t('invoices.tabs.projects')}</Tabs.Tab>
            <Tabs.Tab value="bank">{t('invoices.tabs.bank')}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="list" pt="sm">
            <ListTab items={data.items} onOpen={setOpen} />
          </Tabs.Panel>
          <Tabs.Panel value="projects" pt="sm">
            <ProjectsTab items={data.items} />
          </Tabs.Panel>
          <Tabs.Panel value="bank" pt="sm">
            <BankTab />
          </Tabs.Panel>
        </Tabs>
      )}
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
      <ExportModal opened={exporting} onClose={() => setExporting(false)} />
    </Stack>
  )
}
