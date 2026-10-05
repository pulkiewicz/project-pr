import { ActionIcon, Alert, Badge, Button, Divider, Drawer, Group, MultiSelect, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvizationDto, AvizationTransition } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { ApiError } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { useHrfTasks, useProjectId } from '../hrf/api'
import { exportUrl, useAvizationMutations, useEntryPoints, usePersons, useVehicles } from './api'
import { AVIZ_COLOR } from './colors'
import { LinkedDocuments } from '../documents/LinkedDocuments'

export interface AvizationPreset {
  dateFrom?: string
  dateTo?: string
  purpose?: string
  hrfTaskId?: string | null
  weeklyItemId?: string | null
}

interface Props {
  opened: boolean
  avization: AvizationDto | null
  preset?: AvizationPreset | null
  onClose: () => void
}

const toDate = (d: string | undefined) => (d ? new Date(`${d}T00:00:00`) : null)
const iso = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : '')

export function AvizationDrawer({ opened, avization: a, preset, onClose }: Props) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const pid = useProjectId()
  const persons = usePersons()
  const vehicles = useVehicles()
  const entry = useEntryPoints()
  const hrf = useHrfTasks()
  const m = useAvizationMutations()
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null])
  const [purpose, setPurpose] = useState('')
  const [entryPointId, setEntry] = useState<string | null>(null)
  const [hrfTaskId, setHrf] = useState<string | null>(null)
  const [personIds, setPersons] = useState<string[]>([])
  const [vs, setVs] = useState<{ vehicleId: string; driverPersonId: string | null }[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return
    setError(null)
    if (a) {
      setRange([toDate(a.dateFrom), toDate(a.dateTo)])
      setPurpose(a.purpose)
      setEntry(a.entryPointId)
      setHrf(a.hrfTaskId)
      setPersons(a.persons.map((p) => p.id))
      setVs(a.vehicles.map((v) => ({ vehicleId: v.vehicleId, driverPersonId: v.driverPersonId })))
    } else {
      setRange([toDate(preset?.dateFrom), toDate(preset?.dateTo ?? preset?.dateFrom)])
      setPurpose(preset?.purpose ?? '')
      setEntry(null)
      setHrf(preset?.hrfTaskId ?? null)
      setPersons([])
      setVs([])
    }
  }, [opened, a, preset])

  const editable = !a || (a.canEdit && a.status === 'draft')
  const personOptions = persons.data?.map((p) => ({ value: p.id, label: `${p.lastName} ${p.firstName} — ${p.company}` })) ?? []
  const parents = new Set(hrf.data?.tasks.map((x) => x.parentId))
  const err = (e: unknown) => {
    const overlaps = e instanceof ApiError ? (e.problem.overlaps as string[] | undefined) : undefined
    setError(overlaps ? `${errorMessage(e)}: ${overlaps.join(', ')}` : errorMessage(e))
  }

  const save = () => {
    if (!range[0]) return setError(t('validation.dateRange'))
    m.save.mutate(
      {
        id: a?.id,
        version: a?.version,
        data: { dateFrom: iso(range[0]), dateTo: iso(range[1] ?? range[0]), purpose, entryPointId, hrfTaskId, personIds, vehicles: vs.filter((v) => v.vehicleId), ...(a ? {} : { weeklyItemId: preset?.weeklyItemId ?? null }) },
      },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('app.saved') })
          onClose()
        },
        onError: err,
      },
    )
  }

  type Tr = AvizationTransition extends infer T ? (T extends { version: number } ? Omit<T, 'version'> : never) : never
  const act = (tr: Tr) =>
    a &&
    m.transition.mutate(
      { id: a.id, t: { ...tr, version: a.version } as AvizationTransition },
      { onSuccess: () => (notifications.show({ color: 'green', message: t('app.saved') }), onClose()), onError: err },
    )

  const askText = (title: string, action: 'reject' | 'accept_external') => {
    let value = ''
    modals.openConfirmModal({
      title,
      children: <Textarea autosize minRows={2} data-autofocus onChange={(e) => (value = e.currentTarget.value)} />,
      labels: { confirm: t('app.save'), cancel: t('app.cancel') },
      onConfirm: () => act(action === 'reject' ? { action, reason: value } : { action, externalRef: value }),
    })
  }

  const dl = (kind: 'pdf' | 'xlsx') => a && downloadFile(exportUrl(pid, a.id, kind), `${a.number.replace(/\//g, '-')}.${kind}`).catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="xl" title={a ? `${t('avizations.edit')} ${a.number}` : t('avizations.add')}>
      <Stack gap="sm">
        {a && (
          <Group gap="xs">
            <Badge color={AVIZ_COLOR[a.status]}>{t(`avizations.status.${a.status}`)}</Badge>
            {a.requestedByName && <Text size="xs" c="dimmed">{t('avizations.requestedBy')}: {a.requestedByName}</Text>}
            {a.decidedAt && <Text size="xs" c="dimmed">{t('avizations.decidedBy')}: {a.decidedByName} · {formatDateTime(a.decidedAt)}</Text>}
          </Group>
        )}
        {a?.rejectionReason && <Alert color="red">{t('avizations.rejectionReason')}: {a.rejectionReason}</Alert>}
        {a?.externalRef && <Alert color="blue">{t('avizations.externalRef')}: {a.externalRef}</Alert>}
        {a?.warnings.map((w) => <Alert key={w.code} color="yellow">{w.message}</Alert>)}
        {error && <Alert color="red">{error}</Alert>}

        <DatePickerInput type="range" allowSingleDateInRange label={t('avizations.dates')} valueFormat="DD.MM.YYYY" disabled={!editable} value={range} onChange={(v) => setRange(v as [Date | null, Date | null])} />
        <TextInput label={t('avizations.purpose')} required disabled={!editable} value={purpose} onChange={(e) => setPurpose(e.currentTarget.value)} />
        <Group grow>
          <Select label={t('avizations.entryPoint')} clearable disabled={!editable} data={entry.data?.filter((e) => e.isActive).map((e) => ({ value: e.id, label: e.name })) ?? []} value={entryPointId} onChange={setEntry} />
          {can('hrf', 'view') && (
            <Select label={t('avizations.hrfTask')} clearable searchable disabled={!editable} data={hrf.data?.tasks.filter((x) => !parents.has(x.id)).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` })) ?? []} value={hrfTaskId} onChange={setHrf} />
          )}
        </Group>
        <MultiSelect label={t('avizations.persons')} searchable disabled={!editable} data={personOptions} value={personIds} onChange={setPersons} />
        <Divider label={t('avizations.vehicles')} labelPosition="left" />
        {vs.map((v, i) => (
          <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
            <Select
              style={{ flex: 1 }}
              searchable
              disabled={!editable}
              data={vehicles.data?.map((x) => ({ value: x.id, label: `${x.registrationNumber}${x.makeModel ? ` · ${x.makeModel}` : ''}` })) ?? []}
              value={v.vehicleId || null}
              onChange={(id) => {
                const veh = vehicles.data?.find((x) => x.id === id)
                const driver = veh?.defaultDriverId && personIds.includes(veh.defaultDriverId) ? veh.defaultDriverId : v.driverPersonId
                setVs(vs.map((x, j) => (j === i ? { vehicleId: id ?? '', driverPersonId: driver } : x)))
              }}
              aria-label={t('avizations.vehicles')}
            />
            <Select
              w={220}
              clearable
              disabled={!editable}
              placeholder={t('avizations.driver')}
              data={personOptions.filter((p) => personIds.includes(p.value))}
              value={v.driverPersonId}
              onChange={(d) => setVs(vs.map((x, j) => (j === i ? { ...x, driverPersonId: d } : x)))}
              aria-label={t('avizations.driver')}
            />
            {editable && (
              <ActionIcon color="red" variant="subtle" onClick={() => setVs(vs.filter((_, j) => j !== i))} aria-label="usuń">
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </Group>
        ))}
        {editable && (
          <Button variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setVs([...vs, { vehicleId: '', driverPersonId: null }])} style={{ alignSelf: 'flex-start' }}>
            {t('avizations.vehicle.add')}
          </Button>
        )}
        <Text size="xs" c="dimmed">{t('avizations.personalData')}</Text>

        <Group justify="space-between" mt="sm" wrap="wrap">
          <Group gap="xs">
            {a && can('avizations', 'export') && (
              <>
                <Button size="xs" variant="light" onClick={() => dl('pdf')}>{t('avizations.exportPdf')}</Button>
                <Button size="xs" variant="light" onClick={() => dl('xlsx')}>{t('avizations.exportXlsx')}</Button>
              </>
            )}
          </Group>
          <Group gap="xs">
            {editable && <Button onClick={save} loading={m.save.isPending}>{t('avizations.saveDraft')}</Button>}
            {a?.status === 'draft' && a.canEdit && <Button color="navy" variant="outline" onClick={() => act({ action: 'send' })}>{t('avizations.actions.send')}</Button>}
            {a?.status === 'sent' && a.canEdit && <Button variant="default" onClick={() => act({ action: 'withdraw' })}>{t('avizations.actions.withdraw')}</Button>}
            {a?.canDecide && <Button color="green" onClick={() => act({ action: 'accept' })}>{t('avizations.actions.accept')}</Button>}
            {a?.canDecide && <Button color="red" variant="light" onClick={() => askText(t('avizations.rejectPrompt'), 'reject')}>{t('avizations.actions.reject')}</Button>}
            {a && ['draft', 'sent'].includes(a.status) && can('admin', 'edit') && (
              <Button variant="light" onClick={() => askText(t('avizations.externalPrompt'), 'accept_external')}>{t('avizations.actions.accept_external')}</Button>
            )}
            {a && ['draft', 'sent', 'accepted'].includes(a.status) && (a.canEdit || can('avizations', 'delete')) && (
              <Button color="gray" variant="subtle" onClick={() => act({ action: 'cancel' })}>{t('avizations.actions.cancel')}</Button>
            )}
          </Group>
        </Group>
        {a && (
          <>
            <Divider label={t('documents.linkedDocs')} labelPosition="left" />
            <LinkedDocuments targetType="avization" targetId={a.id} defaultFolderPath="/10_BHP_i_awizacje" />
          </>
        )}
      </Stack>
    </Drawer>
  )
}
