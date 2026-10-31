import { Alert, Badge, Button, Checkbox, Divider, Drawer, Group, Loader, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FLEET_KINDS,
  FLEET_OWNERSHIP,
  INSPECTION_KINDS,
  INSURANCE_TYPES,
  deadlineStatus,
  latestValid,
  worstDeadline,
  type FleetVehicleDto,
  type FleetVehicleInput,
  type InspectionInput,
  type InsuranceInput,
  type InspectionKind,
  type InsuranceType,
} from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { todayWarsaw } from '../../lib/format'
import { useDelete, useEmployeeOptions, useSaveVehicle, useVehicles } from './api'
import { Deadline, RowsEditor, fromDate, toDate } from './common'

const lastInsurance = (v: FleetVehicleDto, type: InsuranceType) => latestValid(v.insurances, (i) => i.type === type, (i) => i.validTo)
const lastInspection = (v: FleetVehicleDto, kind: InspectionKind) => latestValid(v.inspections, (i) => i.kind === kind, (i) => i.validUntil ?? null)

/** Najgorszy status spośród aktualnych terminów pojazdu (ostatnia polisa / przegląd danego rodzaju, koniec leasingu). */
function vehicleStatus(v: FleetVehicleDto, today: string) {
  const dates = [
    ...INSURANCE_TYPES.map((t) => lastInsurance(v, t)),
    ...INSPECTION_KINDS.map((k) => lastInspection(v, k)),
    v.financingEndDate,
  ]
  return worstDeadline(dates.map((d) => deadlineStatus(d, today)))
}

export function FleetPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useVehicles()
  const [open, setOpen] = useState<FleetVehicleDto | 'new' | null>(null)
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const today = todayWarsaw()

  const items = useMemo(
    () => (q.data ?? []).filter((v) => (showInactive || v.isActive) && (!onlyAttention || ['soon', 'expired'].includes(vehicleStatus(v, today)))),
    [q.data, showInactive, onlyAttention, today],
  )

  const columns = useMemo<MRT_ColumnDef<FleetVehicleDto>[]>(
    () => [
      {
        accessorKey: 'registrationNumber',
        header: t('fleet.registrationNumber'),
        size: 130,
        Cell: ({ row }) => (
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600}>{row.original.registrationNumber}</Text>
            {!row.original.isActive && <Badge size="xs" color="gray" variant="light">{t('deadline.inactive')}</Badge>}
          </Group>
        ),
      },
      { id: 'vehicle', accessorFn: (v) => [v.make, v.model].filter(Boolean).join(' '), header: t('fleet.col.vehicle'), size: 180, grow: true },
      { accessorKey: 'kind', header: t('fleet.kindLabel'), size: 120, Cell: ({ cell }) => t(`fleet.kind.${cell.getValue<string>()}`) },
      { accessorKey: 'assignedEmployeeName', header: t('fleet.assignedEmployee'), size: 160, Cell: ({ cell }) => cell.getValue<string | null>() ?? '—' },
      { id: 'oc', accessorFn: (v) => lastInsurance(v, 'OC'), header: t('fleet.col.oc'), size: 110, Cell: ({ cell }) => <Deadline date={cell.getValue<string | null>()} /> },
      { id: 'ac', accessorFn: (v) => lastInsurance(v, 'AC'), header: t('fleet.col.ac'), size: 110, Cell: ({ cell }) => <Deadline date={cell.getValue<string | null>()} /> },
      { id: 'technical', accessorFn: (v) => lastInspection(v, 'technical'), header: t('fleet.col.technical'), size: 140, Cell: ({ cell }) => <Deadline date={cell.getValue<string | null>()} /> },
      { id: 'udt', accessorFn: (v) => lastInspection(v, 'udt'), header: t('fleet.col.udt'), size: 110, Cell: ({ cell }) => <Deadline date={cell.getValue<string | null>()} /> },
    ],
    [t],
  )

  const table = useMantineReactTable({
    columns,
    data: items,
    localization: MRT_Localization_PL,
    layoutMode: 'grid',
    enableColumnActions: false,
    initialState: { density: 'xs', showGlobalFilter: true },
    enablePagination: false,
    enableStickyHeader: true,
    mantineTableContainerProps: { style: { maxHeight: 'calc(100vh - 280px)' } },
    mantineTableBodyRowProps: ({ row }) => ({ onClick: () => setOpen(row.original), style: { cursor: 'pointer' } }),
    renderEmptyRowsFallback: () => <Text c="dimmed" p="md">{t('fleet.empty')}</Text>,
    getRowId: (r) => r.id,
  })

  if (q.isLoading) return <Loader />

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>{t('fleet.title')}</Title>
        {can('fleet', 'create') && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen('new')}>
            {t('fleet.add')}
          </Button>
        )}
      </Group>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      <Group gap="lg">
        <Switch label={t('deadline.onlyAttention')} checked={onlyAttention} onChange={(e) => setOnlyAttention(e.currentTarget.checked)} />
        <Switch label={t('deadline.showInactive')} checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
      </Group>
      <MantineReactTable table={table} />
      <VehicleDrawer opened={!!open} item={open === 'new' ? null : open} onClose={() => setOpen(null)} />
    </Stack>
  )
}

const BLANK: FleetVehicleInput = { registrationNumber: '', kind: 'car', ownership: 'owned', isActive: true, insurances: [], inspections: [] }

function VehicleDrawer({ item, opened, onClose }: { item: FleetVehicleDto | null; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const employees = useEmployeeOptions()
  const save = useSaveVehicle()
  const remove = useDelete('fleet')
  const [f, setF] = useState<FleetVehicleInput>(BLANK)

  useEffect(() => {
    if (!opened) return
    if (item) {
      const { id: _i, assignedEmployeeName: _n, version: _v, ...rest } = item
      setF(rest)
    } else setF(BLANK)
  }, [opened, item])

  const editable = item ? can('fleet', 'edit') : can('fleet', 'create')
  const set = <K extends keyof FleetVehicleInput>(k: K, v: FleetVehicleInput[K]) => setF((s) => ({ ...s, [k]: v }))
  const text = (k: 'make' | 'model' | 'vin' | 'financingCompany', label: string) => (
    <TextInput label={label} disabled={!editable} value={f[k] ?? ''} onChange={(e) => set(k, e.currentTarget.value || null)} />
  )

  const submit = () =>
    save.mutate(
      { id: item?.id, version: item?.version, data: f },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('app.saved') })
          onClose()
        },
        onError: (e) => notifications.show({ color: e instanceof ApiError && e.status === 409 ? 'yellow' : 'red', message: errorMessage(e) }),
      },
    )

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t('app.delete'),
      children: t('management.deleteConfirm', { name: item!.registrationNumber }),
      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(item!.id, { onSuccess: onClose, onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) }),
    })

  const insuranceTypes = INSURANCE_TYPES.map((v) => ({ value: v, label: t(`fleet.insuranceType.${v}`) }))
  const inspectionKinds = INSPECTION_KINDS.map((v) => ({ value: v, label: t(`fleet.inspectionKind.${v}`) }))

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="xl" title={item ? t('fleet.edit', { name: item.registrationNumber }) : t('fleet.add')}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label={t('fleet.registrationNumber')} required disabled={!editable} value={f.registrationNumber} onChange={(e) => set('registrationNumber', e.currentTarget.value)} />
          {text('make', t('fleet.make'))}
          {text('model', t('fleet.model'))}
          <Select label={t('fleet.kindLabel')} allowDeselect={false} disabled={!editable} data={FLEET_KINDS.map((k) => ({ value: k, label: t(`fleet.kind.${k}`) }))} value={f.kind} onChange={(v) => v && set('kind', v as FleetVehicleInput['kind'])} />
          {text('vin', t('fleet.vin'))}
          <NumberInput label={t('fleet.productionYear')} disabled={!editable} min={1950} max={2100} thousandSeparator="" value={f.productionYear ?? ''} onChange={(v) => set('productionYear', v === '' ? null : Number(v))} />
          <Select label={t('fleet.ownershipLabel')} allowDeselect={false} disabled={!editable} data={FLEET_OWNERSHIP.map((k) => ({ value: k, label: t(`fleet.ownership.${k}`) }))} value={f.ownership ?? 'owned'} onChange={(v) => v && set('ownership', v as FleetVehicleInput['ownership'])} />
          {f.ownership !== 'owned' && text('financingCompany', t('fleet.financingCompany'))}
          {f.ownership !== 'owned' && (
            <DateInput label={t('fleet.financingEndDate')} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(f.financingEndDate)} onChange={(d) => set('financingEndDate', fromDate(d))} />
          )}
        </SimpleGrid>
        <Select
          label={t('fleet.assignedEmployee')}
          searchable
          clearable
          disabled={!editable}
          data={employees.data?.map((e) => ({ value: e.id, label: e.name })) ?? []}
          value={f.assignedEmployeeId ?? null}
          onChange={(v) => set('assignedEmployeeId', v)}
        />
        <Divider label={t('fleet.insurances')} labelPosition="left" />
        <RowsEditor<InsuranceInput>
          rows={f.insurances ?? []}
          onChange={(rows) => set('insurances', rows)}
          disabled={!editable}
          empty={t('fleet.noInsurances')}
          blank={() => ({ type: 'OC', validTo: '' })}
          fields={[
            { key: 'type', label: t('fleet.type'), kind: 'select', data: insuranceTypes, w: 110 },
            { key: 'insurer', label: t('fleet.insurer'), kind: 'text' },
            { key: 'policyNumber', label: t('fleet.policyNumber'), kind: 'text', w: 130 },
            { key: 'validFrom', label: t('fleet.validFrom'), kind: 'date', w: 120 },
            { key: 'validTo', label: t('fleet.validTo'), kind: 'date', required: true, w: 120 },
            { key: 'policyUrl', label: t('fleet.policyUrl'), kind: 'url', w: 220 },
          ]}
        />
        <Divider label={t('fleet.inspections')} labelPosition="left" />
        <RowsEditor<InspectionInput>
          rows={f.inspections ?? []}
          onChange={(rows) => set('inspections', rows)}
          disabled={!editable}
          empty={t('fleet.noInspections')}
          blank={() => ({ kind: 'technical' })}
          fields={[
            { key: 'kind', label: t('fleet.type'), kind: 'select', data: inspectionKinds, w: 170 },
            { key: 'performedDate', label: t('fleet.performedDate'), kind: 'date', w: 120 },
            { key: 'validUntil', label: t('fleet.validUntil'), kind: 'date', w: 120 },
            { key: 'documentUrl', label: t('fleet.documentUrl'), kind: 'url', w: 220 },
            { key: 'notes', label: t('fleet.notes'), kind: 'text' },
          ]}
        />
        <Divider />
        <Checkbox label={t('fleet.isActive')} disabled={!editable} checked={f.isActive ?? true} onChange={(e) => set('isActive', e.currentTarget.checked)} />
        <Textarea label={t('fleet.notes')} autosize minRows={2} disabled={!editable} value={f.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value || null)} />
        <Group justify="space-between">
          <div>
            {item && can('fleet', 'delete') && (
              <Button variant="subtle" color="red" onClick={confirmDelete}>
                {t('app.delete')}
              </Button>
            )}
          </div>
          <Group>
            <Button variant="default" onClick={onClose}>
              {t('app.cancel')}
            </Button>
            {editable && (
              <Button onClick={submit} loading={save.isPending} disabled={!f.registrationNumber.trim() || (f.insurances ?? []).some((i) => !i.validTo)}>
                {t('app.save')}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Drawer>
  )
}
