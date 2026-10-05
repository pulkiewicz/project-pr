import { Badge, Group, NumberInput, Select, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDiamond, IconFlame } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HRF_STATUSES, type HrfStatus, type HrfTaskDto } from '#shared'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatPLN } from '../../lib/format'
import { usePatchTask } from './api'
import { StatusBadge } from './StatusBadge'

export type TreeTask = HrfTaskDto & { subRows: TreeTask[] }

export function buildTree(tasks: HrfTaskDto[]): TreeTask[] {
  const nodes = new Map<string, TreeTask>(tasks.map((t) => [t.id, { ...t, subRows: [] }]))
  const roots: TreeTask[] = []
  for (const t of tasks) {
    const n = nodes.get(t.id)!
    const parent = t.parentId ? nodes.get(t.parentId) : undefined
    if (parent) parent.subRows.push(n)
    else roots.push(n)
  }
  return roots
}

interface Props {
  tasks: HrfTaskDto[]
  showInternal: boolean
  onOpen: (id: string) => void
}

export function TaskTable({ tasks, showInternal, onOpen }: Props) {
  const { t } = useTranslation()
  const patch = usePatchTask()
  const data = useMemo(() => buildTree(tasks), [tasks])

  const save = (row: HrfTaskDto, change: Partial<HrfTaskDto>) =>
    patch.mutate(
      { id: row.id, patch: { version: row.version, ...change } as never },
      { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
    )

  const columns = useMemo<MRT_ColumnDef<TreeTask>[]>(
    () => [
      { accessorKey: 'code', header: t('hrf.code'), size: 90 },
      {
        accessorKey: 'name',
        header: t('hrf.name'),
        size: 420,
        grow: true,
        Cell: ({ row }) => (
          <Group gap={6} wrap="nowrap">
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
            <Text size="sm" fw={row.original.parentId ? 400 : 600} lineClamp={2}>
              {row.original.name}
            </Text>
          </Group>
        ),
      },
      { accessorKey: 'party', header: t('hrf.party'), size: 150, Cell: ({ cell }) => t(`parties.${cell.getValue<string>()}`) },
      { accessorKey: 'plannedStart', header: t('hrf.plannedStart'), size: 130, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'plannedEnd', header: t('hrf.plannedEnd'), size: 130, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'actualStart', header: t('hrf.actualStart'), size: 130, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      { accessorKey: 'actualEnd', header: t('hrf.actualEnd'), size: 130, Cell: ({ cell }) => formatDate(cell.getValue<string | null>()) },
      {
        accessorKey: 'percentComplete',
        header: t('hrf.percent'),
        size: 120,
        Cell: ({ row }) =>
          row.original.canEdit && row.original.subRows.length === 0 ? (
            <NumberInput
              size="xs"
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
            `${row.original.percentComplete} %`
          ),
      },
      {
        accessorKey: 'status',
        header: t('hrf.statusLabel'),
        size: 170,
        Cell: ({ row }) =>
          row.original.canEdit && row.original.subRows.length === 0 ? (
            <Select
              size="xs"
              allowDeselect={false}
              value={row.original.status}
              data={HRF_STATUSES.map((s) => ({ value: s, label: t(`hrf.status.${s}`) }))}
              onClick={(e) => e.stopPropagation()}
              onChange={(v) => v && v !== row.original.status && save(row.original, { status: v as HrfStatus })}
              aria-label={t('hrf.statusLabel')}
            />
          ) : (
            <StatusBadge status={row.original.status} />
          ),
      },
      ...(showInternal
        ? [
            {
              accessorKey: 'contractValue',
              header: t('hrf.contractValue'),
              size: 140,
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
    mantineTableContainerProps: { style: { maxHeight: 'calc(100vh - 300px)' } },
    mantineTableBodyRowProps: ({ row }) => ({
      onClick: () => onOpen(row.original.id),
      style: { cursor: 'pointer' },
    }),
    getRowId: (r) => r.id,
  })

  return <MantineReactTable table={table} />
}
