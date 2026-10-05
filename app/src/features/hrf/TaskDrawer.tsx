import { ActionIcon, Alert, Button, Checkbox, Divider, Drawer, Group, NumberInput, Select, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BASE_PARTIES, DEPENDENCY_TYPES, HRF_STATUSES, type DependencyType, type HrfDependencyDto, type HrfStatus, type HrfTaskDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { usePatchTask, useSetDependencies } from './api'
import { StatusBadge } from './StatusBadge'
import { LinkedDocuments } from '../documents/LinkedDocuments'

interface Props {
  task: HrfTaskDto | null
  tasks: HrfTaskDto[]
  dependencies: HrfDependencyDto[]
  onClose: () => void
}

const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)

type Form = Pick<HrfTaskDto, 'actualStart' | 'actualEnd' | 'forecastEnd' | 'percentComplete' | 'status' | 'notes' | 'name' | 'party' | 'startOffsetDays' | 'durationDays' | 'isMilestone' | 'isAcceptancePoint' | 'postAcceptanceAllowed'> & { contractValue: string | null }

export function TaskDrawer({ task, tasks, dependencies, onClose }: Props) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const patch = usePatchTask()
  const setDeps = useSetDependencies()
  const [form, setForm] = useState<Form | null>(null)
  const [preds, setPreds] = useState<{ predecessorId: string; type: DependencyType; lagDays: number }[]>([])
  const isStage = !!task && tasks.some((x) => x.parentId === task.id)
  const structure = can('hrf', 'approve')
  const internalEdit = can('penalties', 'edit')

  useEffect(() => {
    if (!task) return setForm(null)
    setForm({
      actualStart: task.actualStart,
      actualEnd: task.actualEnd,
      forecastEnd: task.forecastEnd,
      percentComplete: task.percentComplete,
      status: task.status,
      notes: task.notes,
      name: task.name,
      party: task.party,
      startOffsetDays: task.startOffsetDays,
      durationDays: task.durationDays,
      isMilestone: task.isMilestone,
      isAcceptancePoint: task.isAcceptancePoint,
      postAcceptanceAllowed: task.postAcceptanceAllowed,
      contractValue: task.contractValue ?? null,
    })
    setPreds(dependencies.filter((d) => d.taskId === task.id).map(({ predecessorId, type, lagDays }) => ({ predecessorId, type, lagDays })))
  }, [task, dependencies])

  const leafOptions = useMemo(() => {
    const parents = new Set(tasks.map((x) => x.parentId))
    return tasks.filter((x) => !parents.has(x.id) && x.id !== task?.id).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))
  }, [tasks, task])

  if (!task || !form) return <Drawer opened={false} onClose={onClose} />

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v })
  const editable = task.canEdit

  const submit = () => {
    const changes: Record<string, unknown> = {}
    const progressKeys = ['actualStart', 'actualEnd', 'forecastEnd', 'percentComplete', 'status', 'notes'] as const
    const structKeys = ['name', 'party', 'startOffsetDays', 'durationDays', 'isMilestone', 'isAcceptancePoint', 'postAcceptanceAllowed'] as const
    for (const k of progressKeys) if (form[k] !== task[k]) changes[k] = form[k]
    if (structure) for (const k of structKeys) if (form[k] !== task[k]) changes[k] = form[k]
    if (internalEdit && 'contractValue' in task && form.contractValue !== (task.contractValue ?? null)) changes.contractValue = form.contractValue || null
    if (!Object.keys(changes).length) return onClose()
    patch.mutate(
      { id: task.id, patch: { version: task.version, ...changes } as never },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('app.saved') })
          onClose()
        },
        onError: (e) => {
          notifications.show({ color: e instanceof ApiError && e.status === 409 ? 'yellow' : 'red', message: errorMessage(e) })
        },
      },
    )
  }

  const saveDeps = () =>
    setDeps.mutate(
      { id: task.id, predecessors: preds.filter((p) => p.predecessorId) },
      {
        onSuccess: () => notifications.show({ color: 'green', message: t('app.saved') }),
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )

  return (
    <Drawer opened onClose={onClose} position="right" size="lg" title={`${task.code} — ${t('hrf.details')}`}>
      <Stack gap="sm">
        <Text fw={600}>{task.name}</Text>
        <Group gap="xs">
          <StatusBadge status={task.status} />
          {task.isCriticalPath && <Text size="xs" c="red">{t('hrf.critical')}</Text>}
          {task.totalFloatDays !== null && <Text size="xs" c="dimmed">{t('hrf.float')}: {task.totalFloatDays}</Text>}
        </Group>
        <Text size="sm">
          {t('hrf.plannedStart')}: {formatDate(task.plannedStart)} · {t('hrf.plannedEnd')}: {formatDate(task.plannedEnd)} · {t('hrf.party')}: {t(`parties.${task.party}`)}
        </Text>

        {!isStage && (
          <>
            <Divider label={t('hrf.statusLabel')} labelPosition="left" />
            <Group grow>
              <DateInput label={t('hrf.actualStart')} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(form.actualStart)} onChange={(v) => set('actualStart', fromDate(v))} />
              <DateInput label={t('hrf.actualEnd')} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(form.actualEnd)} onChange={(v) => set('actualEnd', fromDate(v))} />
            </Group>
            <Group grow>
              <DateInput label={t('hrf.forecastEnd')} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(form.forecastEnd)} onChange={(v) => set('forecastEnd', fromDate(v))} />
              <NumberInput label={t('hrf.percent')} min={0} max={100} suffix=" %" disabled={!editable} value={form.percentComplete} onChange={(v) => set('percentComplete', Number(v) || 0)} />
            </Group>
            <Select
              label={t('hrf.statusLabel')}
              disabled={!editable}
              allowDeselect={false}
              data={HRF_STATUSES.map((s) => ({ value: s, label: t(`hrf.status.${s}`) }))}
              value={form.status}
              onChange={(v) => v && set('status', v as HrfStatus)}
            />
          </>
        )}
        <Textarea label={t('hrf.notes')} autosize minRows={2} disabled={!editable} value={form.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value || null)} />

        {structure && (
          <>
            <Divider label={t('hrf.structure')} labelPosition="left" />
            <TextInput label={t('hrf.name')} value={form.name} onChange={(e) => set('name', e.currentTarget.value)} />
            <Group grow>
              <Select label={t('hrf.party')} allowDeselect={false} data={BASE_PARTIES.map((p) => ({ value: p, label: t(`parties.${p}`) }))} value={form.party} onChange={(v) => v && set('party', v)} />
              <NumberInput label={t('hrf.offset')} min={0} value={form.startOffsetDays} onChange={(v) => set('startOffsetDays', Number(v) || 0)} />
              <NumberInput label={t('hrf.duration')} min={1} value={form.durationDays} onChange={(v) => set('durationDays', Number(v) || 1)} />
            </Group>
            <Group>
              <Checkbox label={t('hrf.milestone')} checked={form.isMilestone} onChange={(e) => set('isMilestone', e.currentTarget.checked)} />
              <Checkbox label={t('hrf.acceptance')} checked={form.isAcceptancePoint} onChange={(e) => set('isAcceptancePoint', e.currentTarget.checked)} />
              <Checkbox label={t('hrf.postAcceptance')} checked={form.postAcceptanceAllowed} onChange={(e) => set('postAcceptanceAllowed', e.currentTarget.checked)} />
            </Group>
          </>
        )}
        {'contractValue' in task && (
          <TextInput
            label={t('hrf.contractValue')}
            disabled={!internalEdit}
            placeholder="0.00"
            value={form.contractValue ?? ''}
            onChange={(e) => set('contractValue', e.currentTarget.value.replace(/\s/g, '').replace(',', '.') || null)}
          />
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          {(editable || structure) && (
            <Button onClick={submit} loading={patch.isPending}>
              {t('app.save')}
            </Button>
          )}
        </Group>

        <Divider label={t('documents.linkedDocs')} labelPosition="left" />
        <LinkedDocuments targetType="hrf_task" targetId={task.id} />

        {!isStage && (
          <>
            <Divider label={t('hrf.dependencies')} labelPosition="left" />
            {preds.length === 0 && <Text size="sm" c="dimmed">—</Text>}
            {preds.map((p, i) => (
              <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
                <Select
                  style={{ flex: 1 }}
                  searchable
                  disabled={!structure}
                  data={leafOptions}
                  value={p.predecessorId || null}
                  onChange={(v) => setPreds(preds.map((x, j) => (j === i ? { ...x, predecessorId: v ?? '' } : x)))}
                  aria-label={t('hrf.dependencies')}
                />
                <Select w={80} disabled={!structure} data={[...DEPENDENCY_TYPES]} value={p.type} allowDeselect={false} onChange={(v) => setPreds(preds.map((x, j) => (j === i ? { ...x, type: v as DependencyType } : x)))} aria-label={t('hrf.type')} />
                <NumberInput w={90} disabled={!structure} value={p.lagDays} onChange={(v) => setPreds(preds.map((x, j) => (j === i ? { ...x, lagDays: Number(v) || 0 } : x)))} aria-label={t('hrf.lag')} />
                {structure && (
                  <ActionIcon variant="subtle" color="red" onClick={() => setPreds(preds.filter((_, j) => j !== i))} aria-label="usuń">
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            ))}
            {structure && (
              <Group justify="space-between">
                <Button variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setPreds([...preds, { predecessorId: '', type: 'FS', lagDays: 0 }])}>
                  {t('hrf.addDependency')}
                </Button>
                <Button variant="light" onClick={saveDeps} loading={setDeps.isPending}>
                  {t('app.save')}
                </Button>
              </Group>
            )}
            {setDeps.error && <Alert color="red">{errorMessage(setDeps.error)}</Alert>}
          </>
        )}
      </Stack>
    </Drawer>
  )
}
