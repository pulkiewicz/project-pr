import { ActionIcon, Badge, Group, NumberInput, Select, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDiamond, IconExternalLink, IconFlame, IconSubtask } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useMemo } from 'react'
import './table.css'
import { useTranslation } from 'react-i18next'
import { HRF_STATUSES, type HrfInternalTaskDto, type HrfStatus, type HrfTaskDto } from '#shared'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatPLN } from '../../lib/format'
import { usePatchTask } from './api'
import { StatusBadge } from './StatusBadge'

/** Wiersz drzewa: zadanie formalne albo (z `internal`) zadanie wewnętrzne pod swoim zadaniem formalnym. */
export type TreeTask = HrfTaskDto & { subRows: TreeTask[]; hasFormalChildren: boolean; internal?: HrfInternalTaskDto }

function internalRow(i: HrfInternalTaskDto): TreeTask {
  return {
    id: i.id,
    code: '',
    name: i.name,
    parentId: i.parentTaskId,
    party: '',
    responsibleUserId: null,
    startOffsetDays: 0,
    durationDays: 0,
    plannedStart: i.startDate,
    plannedEnd: i.endDate,
    actualStart: null,
    actualEnd: null,
    forecastEnd: null,
    percentComplete: i.percentComplete,
    status: i.overdue ? 'delayed' : i.percentComplete >= 100 ? 'accepted' : i.percentComplete > 0 ? 'in_progress' : 'not_started',
    isMilestone: false,
    isAcceptancePoint: false,
    postAcceptanceAllowed: false,
    isCriticalPath: false,
    totalFloatDays: null,
    notes: i.notes,
    link: i.link,
    sortOrder: 0,
    version: i.version,
    canEdit: false,
    subRows: [],
    hasFormalChildren: false,
    internal: i,
  }
}

export function buildTree(tasks: HrfTaskDto[], internal: HrfInternalTaskDto[] = []): TreeTask[] {
  const formalParents = new Set(tasks.map((t) => t.parentId))
  const nodes = new Map<string, TreeTask>(tasks.map((t) => [t.id, { ...t, subRows: [], hasFormalChildren: formalParents.has(t.id) }]))
  const roots: TreeTask[] = []
  for (const t of tasks) {
    const n = nodes.get(t.id)!
    const parent = t.parentId ? nodes.get(t.parentId) : undefined
    if (parent) parent.subRows.push(n)
    else roots.push(n)
  }
  // Zadania wewnętrzne na końcu listy dzieci swojego zadania formalnego (tylko gdy to zadanie jest widoczne po filtrach).
  for (const i of internal) nodes.get(i.parentTaskId)?.subRows.push(internalRow(i))
  return roots
}

interface Props {
  tasks: HrfTaskDto[]
  internalTasks?: HrfInternalTaskDto[]
  showInternal: boolean
  onOpen: (id: string) => void
}

export function TaskTable({ tasks, internalTasks = [], showInternal, onOpen }: Props) {
  const { t } = useTranslation()
  const patch = usePatchTask()
  const data = useMemo(() => buildTree(tasks, internalTasks), [tasks, internalTasks])

  const save = (row: HrfTaskDto, change: Partial<HrfTaskDto>) =>
    patch.mutate(
      { id: row.id, patch: { version: row.version, ...change } as never },
      { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
    )

  const columns = useMemo<MRT_ColumnDef<TreeTask>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('hrf.code'),
        size: 70,
        Cell: ({ row }) =>
          row.original.internal ? (
            <Tooltip label={t('hrf.internal.single')}>
              <IconSubtask size={14} color="var(--mantine-color-blue-6)" />
            </Tooltip>
          ) : (
            row.original.code
          ),
      },
      {
        accessorKey: 'name',
        header: t('hrf.name'),
        size: 380,
        minSize: 260,
        grow: true,
        mantineTableBodyCellProps: { style: { whiteSpace: 'normal', fontSize: 12, paddingTop: 4, paddingBottom: 4, verticalAlign: 'top' } },
        Cell: ({ row }) => (
          <Group gap={6} wrap="nowrap" align="flex-start">
            {row.original.isCriticalPath && (
              <Tooltip label={t('hrf.critical')}>
                <IconFlame size={14} color="var(--mantine-color-red-6)" />
              </Tooltip>
            )}
            {row.original.isAcceptancePoint && (
              <Tooltip label={t('hrf.acceptance')}>
                <IconDiamond size={14} color="var(--mantine-color-violet-6)" />
              </Tooltip>
            )}
            <Text
              fz={12}
              lh={1.35}
              fw={row.original.parentId ? 400 : 600}
              c={row.original.internal ? 'blue.7' : undefined}
              style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
            >
              {row.original.name}
            </Text>
          </Group>
        ),
      },
      {
        accessorKey: 'link',
        header: t('hrf.linkColumn'),
        size: 64,
        enableSorting: false,
        Cell: ({ row }) =>
          row.original.link ? (
            <Tooltip label={`${t('hrf.openLinkNewTab')}: ${row.original.link}`} multiline maw={360} style={{ wordBreak: 'break-all' }}>
              <ActionIcon
                size="sm"
                variant="light"
                component="a"
                href={row.original.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={t('hrf.openLinkNewTab')}
              >
                <IconExternalLink size={14} />
              </ActionIcon>
            </Tooltip>
          ) : null,
      },
      {
        accessorKey: 'party',
        header: t('hrf.party'),
        size: 120,
        mantineTableBodyCellProps: { style: { whiteSpace: 'normal', fontSize: 12, paddingTop: 4, paddingBottom: 4, verticalAlign: 'top' } },
        Cell: ({ row }) =>
          row.original.internal ? (
            <Text fz={12} c="blue.7">
              {row.original.internal.assignees.map((a) => a.name).join(', ') || '—'}
            </Text>
          ) : (
            t(`parties.${row.original.party}`)
          ),
      },
      { accessorKey: 'plannedStart', header: t('hrf.plannedStart'), size: 118, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'plannedEnd', header: t('hrf.plannedEnd'), size: 118, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'actualStart', header: t('hrf.actualStart'), size: 118, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'actualEnd', header: t('hrf.actualEnd'), size: 118, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      {
        accessorKey: 'percentComplete',
        header: t('hrf.percent'),
        size: 95,
        Cell: ({ row }) =>
          row.original.canEdit && !row.original.hasFormalChildren ? (
            <NumberInput
              size="xs"
              styles={{ input: { fontSize: 12, height: 26, minHeight: 26 } }}
              min={0}
              max={100}
              suffix=" %"
              defaultValue={row.original.percentComplete}
              aria-label={t('hrf.percent')}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = Number(e.currentTarget.value.replace(/[^\d.,]/g, '').replace(',', '.'))
                if (!Number.isNaN(v) && v !== row.original.percentComplete) save(row.original, { percentComplete: v })
              }}
            />
          ) : (
            <Text fz={12} c={row.original.internal ? 'blue.7' : undefined}>
              {row.original.percentComplete} %
            </Text>
          ),
      },
      {
        accessorKey: 'status',
        header: t('hrf.statusLabel'),
        size: 150,
        Cell: ({ row }) =>
          row.original.canEdit && !row.original.hasFormalChildren ? (
            <Select
              size="xs"
              styles={{ input: { fontSize: 12, height: 26, minHeight: 26 } }}
              allowDeselect={false}
              value={row.original.status}
              data={HRF_STATUSES.map((s) => ({ value: s, label: t(`hrf.status.${s}`) }))}
              onClick={(e) => e.stopPropagation()}
              onChange={(v) => v && v !== row.original.status && save(row.original, { status: v as HrfStatus })}
              aria-label={t('hrf.statusLabel')}
            />
          ) : row.original.internal ? (
            row.original.internal.overdue ? (
              <Badge size="sm" color="red" variant="light">
                {t('hrf.internal.overdue')}
              </Badge>
            ) : (
              <Badge size="sm" color="blue" variant="light">
                {t(row.original.percentComplete >= 100 ? 'hrf.internal.done' : 'hrf.internal.open')}
              </Badge>
            )
          ) : (
            <StatusBadge status={row.original.status} />
          ),
      },
      ...(showInternal
        ? [
            {
              accessorKey: 'contractValue',
              header: t('hrf.contractValue'),
              size: 125,
              Cell: ({ cell }: { cell: { getValue: <T>() => T } }) => {
                const v = cell.getValue<string | null>()
                return v ? <Badge variant="outline">{formatPLN(v)}</Badge> : '—'
              },
            } as MRT_ColumnDef<TreeTask>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, showInternal],
  )

  const table = useMantineReactTable({
    columns,
    data,
    localization: MRT_Localization_PL,
    layoutMode: 'grid',
    enableColumnActions: false,
    enableExpanding: true,
    enableExpandAll: true,
    getSubRows: (r) => r.subRows,
    filterFromLeafRows: true,
    initialState: { expanded: true, density: 'xs', columnPinning: { left: ['mrt-row-expand', 'code'] } },
    enablePagination: false,
    enableRowVirtualization: true,
    enableColumnPinning: true,
    enableStickyHeader: true,
    mantineTableContainerProps: { className: 'pmo-dense-table', style: { maxHeight: 'calc(100vh - 300px)' } },
    mantineTableProps: { style: { fontSize: 12 } },
    mantineTableHeadCellProps: { style: { fontSize: 12 } },
    mantineTableBodyCellProps: { style: { fontSize: 12, paddingTop: 4, paddingBottom: 4, verticalAlign: 'top' } },
    // Wiersze o zmiennej wysokości (zawijana nazwa) — pomiar rzeczywistej wysokości przy wirtualizacji.
    rowVirtualizerOptions: { estimateSize: () => 40, overscan: 10 },
    mantineTableBodyRowProps: ({ row }) => ({
      onClick: () => onOpen(row.original.id),
      className: row.original.internal ? 'pmo-internal-row' : undefined,
      style: { cursor: 'pointer' },
    }),
    getRowId: (r) => r.id,
  })

  return <MantineReactTable table={table} />
}
