import { Alert, Badge, Button, Checkbox, Divider, Drawer, Group, Loader, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconEye, IconPlus, IconUserPlus } from '@tabler/icons-react'
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from 'mantine-react-table'
import { MRT_Localization_PL } from 'mantine-react-table/locales/pl/index.esm.mjs'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CONTRACT_TYPES, deadlineStatus, isValidPesel, worstDeadline, type EmployeeDto, type EmployeeInput, type QualificationInput } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { todayWarsaw } from '../../lib/format'
import { fetchPesel, useDelete, useEmployees, useSaveEmployee, useUserOptions } from './api'
import { Deadline, RowsEditor, fromDate, toDate } from './common'
import { ImportFromAvizationsModal } from './ImportFromAvizationsModal'

const fullName = (e: Pick<EmployeeDto, 'firstName' | 'lastName'>) => `${e.lastName} ${e.firstName}`

/** Najbliższy termin uprawnień (najwcześniejsza data ważności). */
const nextQualification = (e: EmployeeDto) =>
  e.qualifications.map((q) => q.validUntil).filter((d): d is string => !!d).sort()[0] ?? null

function employeeStatus(e: EmployeeDto, today: string) {
  return worstDeadline([e.contractEnd, e.medicalExamValidUntil, e.bhpTrainingValidUntil, ...e.qualifications.map((q) => q.validUntil)].map((d) => deadlineStatus(d, today)))
}

export function EmployeesPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useEmployees()
  const [open, setOpen] = useState<EmployeeDto | 'new' | null>(null)
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [importing, setImporting] = useState(false)
  const today = todayWarsaw()

  const items = useMemo(
    () => (q.data ?? []).filter((e) => (showInactive || e.isActive) && (!onlyAttention || ['soon', 'expired'].includes(employeeStatus(e, today)))),
    [q.data, showInactive, onlyAttention, today],
  )

  const columns = useMemo<MRT_ColumnDef<EmployeeDto>[]>(
    () => [
      {
        id: 'name',
        accessorFn: fullName,
        header: t('employees.col.name'),
        size: 200,
        Cell: ({ row }) => (
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600}>{fullName(row.original)}</Text>
            {!row.original.isActive && <Badge size="xs" color="gray" variant="light">{t('deadline.inactive')}</Badge>}
          </Group>
        ),
      },
      { accessorKey: 'position', header: t('employees.position'), size: 160, grow: true, Cell: ({ cell }) => cell.getValue<string | null>() ?? '—' },
      { accessorKey: 'phone', header: t('employees.phone'), size: 130, Cell: ({ cell }) => cell.getValue<string | null>() ?? '—' },
      {
        id: 'contract',
        accessorFn: (e) => e.contractEnd,
        header: t('employees.col.contract'),
        size: 200,
        Cell: ({ row }) => {
          const e = row.original
          if (!e.contractType) return <Text size="sm" c="dimmed">—</Text>
          return (
            <Group gap={4} wrap="nowrap">
              <Text size="sm">{t(`employees.contractType.${e.contractType}`)}</Text>
              {e.contractEnd ? <Deadline date={e.contractEnd} /> : <Text size="xs" c="dimmed">({t('employees.indefinite')})</Text>}
            </Group>
          )
        },
      },
      { accessorKey: 'medicalExamValidUntil', header: t('employees.col.medical'), size: 115, Cell: ({ cell }) => <Deadline date={cell.getValue<string | null>()} /> },
      { accessorKey: 'bhpTrainingValidUntil', header: t('employees.col.bhp'), size: 110, Cell: ({ cell }) => <Deadline date={cell.getValue<string | null>()} /> },
      {
        id: 'qualifications',
        accessorFn: nextQualification,
        header: t('employees.col.qualifications'),
        size: 150,
        Cell: ({ row }) =>
          row.original.qualifications.length ? (
            <Group gap={6} wrap="nowrap">
              <Badge variant="light" size="sm">{row.original.qualifications.length}</Badge>
              <Deadline date={nextQualification(row.original)} empty="" />
            </Group>
          ) : (
            <Text size="sm" c="dimmed">—</Text>
          ),
      },
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
    renderEmptyRowsFallback: () => <Text c="dimmed" p="md">{t('employees.empty')}</Text>,
    getRowId: (r) => r.id,
  })

  if (q.isLoading) return <Loader />

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>{t('employees.title')}</Title>
        {can('employees', 'create') && (
          <Group gap="xs">
            <Button variant="light" leftSection={<IconUserPlus size={16} />} onClick={() => setImporting(true)}>
              {t('employees.import.button')}
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen('new')}>
              {t('employees.add')}
            </Button>
          </Group>
        )}
      </Group>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      <Group gap="lg">
        <Switch label={t('deadline.onlyAttention')} checked={onlyAttention} onChange={(e) => setOnlyAttention(e.currentTarget.checked)} />
        <Switch label={t('deadline.showInactive')} checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
      </Group>
      <MantineReactTable table={table} />
      <ImportFromAvizationsModal opened={importing} onClose={() => setImporting(false)} />
      <EmployeeDrawer opened={!!open} item={open === 'new' ? null : open} onClose={() => setOpen(null)} />
    </Stack>
  )
}

type Form = Omit<EmployeeInput, 'pesel'>
const BLANK: Form = { firstName: '', lastName: '', isActive: true, qualifications: [] }
type TextKey = 'firstName' | 'lastName' | 'position' | 'email' | 'phone' | 'address' | 'emergencyContactName' | 'emergencyContactPhone'
type DateKey = 'birthDate' | 'contractStart' | 'contractEnd' | 'medicalExamValidUntil' | 'bhpTrainingValidUntil'

function EmployeeDrawer({ item, opened, onClose }: { item: EmployeeDto | null; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const userOptions = useUserOptions()
  const save = useSaveEmployee()
  const remove = useDelete('employees')
  const [f, setF] = useState<Form>(BLANK)
  /** PESEL wpisany lub odsłonięty; wysyłany tylko, gdy różni się od zapisanego. */
  const [pesel, setPesel] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return
    setPesel('')
    setRevealed(null)
    if (item) {
      const { id: _i, peselMasked: _p, userName: _u, version: _v, ...rest } = item
      setF(rest)
    } else setF(BLANK)
  }, [opened, item])

  const editable = item ? can('employees', 'edit') : can('employees', 'create')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }))
  const text = (k: TextKey, label: string, required = false) => (
    <TextInput label={label} required={required} disabled={!editable} value={f[k] ?? ''} onChange={(e) => set(k, (e.currentTarget.value || (required ? '' : null)) as never)} />
  )
  const dateField = (k: DateKey, label: string) => (
    <DateInput label={label} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(f[k])} onChange={(d) => set(k, fromDate(d))} />
  )
  const peselChanged = pesel.trim() !== '' && pesel.trim() !== revealed
  const peselError = peselChanged && !isValidPesel(pesel.trim()) ? t('validation.pesel') : undefined

  const reveal = () =>
    fetchPesel(item!.id)
      .then((r) => {
        setRevealed(r.pesel)
        setPesel(r.pesel ?? '')
      })
      .catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))

  const submit = () =>
    save.mutate(
      { id: item?.id, version: item?.version, data: { ...f, ...(peselChanged ? { pesel: pesel.trim() } : {}) } },
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
      children: t('management.deleteConfirm', { name: fullName(item!) }),
      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(item!.id, { onSuccess: onClose, onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) }),
    })

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="xl" title={item ? t('employees.edit', { name: fullName(item) }) : t('employees.add')}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {text('firstName', t('employees.firstName'), true)}
          {text('lastName', t('employees.lastName'), true)}
          {text('position', t('employees.position'))}
          {text('email', t('employees.email'))}
          {text('phone', t('employees.phone'))}
        </SimpleGrid>

        <Divider label={t('employees.personal')} labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput
            label={t('employees.pesel')}
            description={t('employees.peselHint')}
            placeholder={item?.peselMasked ?? ''}
            disabled={!editable}
            value={pesel}
            error={peselError}
            maxLength={11}
            onChange={(e) => setPesel(e.currentTarget.value.replace(/\D/g, ''))}
            rightSectionWidth={item?.peselMasked && revealed === null ? 80 : undefined}
            rightSection={
              item?.peselMasked && revealed === null ? (
                <Button size="compact-xs" variant="subtle" leftSection={<IconEye size={12} />} onClick={reveal}>
                  {t('employees.peselShow')}
                </Button>
              ) : undefined
            }
          />
          {dateField('birthDate', t('employees.birthDate'))}
        </SimpleGrid>
        <Textarea label={t('employees.address')} autosize minRows={1} disabled={!editable} value={f.address ?? ''} onChange={(e) => set('address', e.currentTarget.value || null)} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {text('emergencyContactName', t('employees.emergencyContactName'))}
          {text('emergencyContactPhone', t('employees.emergencyContactPhone'))}
        </SimpleGrid>

        <Divider label={t('employees.contract')} labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label={t('employees.contractTypeLabel')}
            clearable
            disabled={!editable}
            data={CONTRACT_TYPES.map((c) => ({ value: c, label: t(`employees.contractType.${c}`) }))}
            value={f.contractType ?? null}
            onChange={(v) => set('contractType', v as Form['contractType'])}
          />
          {dateField('contractStart', t('employees.contractStart'))}
          {dateField('contractEnd', t('employees.contractEnd'))}
        </SimpleGrid>

        <Divider label={t('employees.validity')} labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {dateField('medicalExamValidUntil', t('employees.medicalExamValidUntil'))}
          {dateField('bhpTrainingValidUntil', t('employees.bhpTrainingValidUntil'))}
        </SimpleGrid>
        <Text size="sm" fw={500}>{t('employees.qualifications')}</Text>
        <RowsEditor<QualificationInput>
          rows={f.qualifications ?? []}
          onChange={(rows) => set('qualifications', rows)}
          disabled={!editable}
          empty={t('employees.noQualifications')}
          blank={() => ({ name: '' })}
          fields={[
            { key: 'name', label: t('employees.qualificationName'), kind: 'text', required: true, w: 220 },
            { key: 'number', label: t('employees.qualificationNumber'), kind: 'text', w: 130 },
            { key: 'validUntil', label: t('fleet.validUntil'), kind: 'date', w: 120 },
            { key: 'documentUrl', label: t('fleet.documentUrl'), kind: 'url', w: 200 },
          ]}
        />

        <Divider />
        <Select
          label={t('employees.user')}
          description={t('employees.userHint')}
          searchable
          clearable
          disabled={!editable}
          data={userOptions.data?.map((u) => ({ value: u.id, label: u.name })) ?? []}
          value={f.userId ?? null}
          onChange={(v) => set('userId', v)}
        />
        <Checkbox label={t('employees.isActive')} disabled={!editable} checked={f.isActive ?? true} onChange={(e) => set('isActive', e.currentTarget.checked)} />
        <Textarea label={t('employees.notes')} autosize minRows={2} disabled={!editable} value={f.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value || null)} />
        <Group justify="space-between">
          <div>
            {item && can('employees', 'delete') && (
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
              <Button
                onClick={submit}
                loading={save.isPending}
                disabled={!f.firstName.trim() || !f.lastName.trim() || !!peselError || (f.qualifications ?? []).some((q) => !q.name.trim())}
              >
                {t('app.save')}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Drawer>
  )
}
