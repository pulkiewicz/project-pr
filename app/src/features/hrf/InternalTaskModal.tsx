import { ActionIcon, Alert, Button, Group, Modal, MultiSelect, NumberInput, Select, Stack, TextInput, Textarea, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconExternalLink } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HrfInternalTaskDto, HrfTaskDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { useDeleteInternalTask, useInternalAssignees, useSaveInternalTask } from './api'

/** `task` = edycja istniejącego; `parentTaskId` = nowe zadanie pod wskazanym zadaniem formalnym. */
export type InternalTaskTarget = { task: HrfInternalTaskDto } | { parentTaskId: string | null }

interface Props {
  target: InternalTaskTarget | null
  formalTasks: HrfTaskDto[]
  onClose: () => void
}

interface Form {
  parentTaskId: string | null
  name: string
  assigneeIds: string[]
  startDate: string | null
  endDate: string | null
  percentComplete: number
  notes: string
  link: string
}

const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)
const isHttpUrl = (v: string) => /^https?:\/\/\S+$/i.test(v.trim())

function initialForm(target: InternalTaskTarget): Form {
  if ('task' in target) {
    const t = target.task
    return {
      parentTaskId: t.parentTaskId,
      name: t.name,
      assigneeIds: t.assignees.map((a) => a.id),
      startDate: t.startDate,
      endDate: t.endDate,
      percentComplete: t.percentComplete,
      notes: t.notes ?? '',
      link: t.link ?? '',
    }
  }
  return { parentTaskId: target.parentTaskId, name: '', assigneeIds: [], startDate: null, endDate: null, percentComplete: 0, notes: '', link: '' }
}

export function InternalTaskModal({ target, formalTasks, onClose }: Props) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const save = useSaveInternalTask()
  const remove = useDeleteInternalTask()
  const assignees = useInternalAssignees(!!target)
  const [form, setForm] = useState<Form | null>(null)
  const existing = target && 'task' in target ? target.task : null
  const editable = existing ? can('hrfInternal', 'edit') : can('hrfInternal', 'create')

  useEffect(() => setForm(target ? initialForm(target) : null), [target])

  const parentOptions = useMemo(() => formalTasks.map((x) => ({ value: x.id, label: `${x.code} ${x.name}` })), [formalTasks])
  const assigneeOptions = useMemo(() => {
    const opts = (assignees.data ?? []).map((a) => ({ value: a.id, label: a.name }))
    // Osoba przypisana wcześniej, która straciła dostęp, nadal widoczna (do usunięcia z listy).
    for (const a of existing?.assignees ?? []) if (!opts.some((o) => o.value === a.id)) opts.push({ value: a.id, label: a.name })
    return opts
  }, [assignees.data, existing])

  if (!target || !form) return <Modal opened={false} onClose={onClose} />

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v })
  const datesInvalid = !!form.startDate && !!form.endDate && form.endDate < form.startDate
  const linkInvalid = !!form.link.trim() && !isHttpUrl(form.link)
  const canSubmit = editable && !!form.parentTaskId && !!form.name.trim() && !datesInvalid && !linkInvalid

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const values = {
      parentTaskId: form.parentTaskId!,
      name: form.name.trim(),
      assigneeIds: form.assigneeIds,
      startDate: form.startDate,
      endDate: form.endDate,
      percentComplete: form.percentComplete,
      notes: form.notes.trim() || null,
      link: form.link.trim() || null,
    }
    save.mutate(existing ? { id: existing.id, patch: { ...values, version: existing.version } } : { create: values }, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: t('app.saved') })
        onClose()
      },
      onError: (err) => notifications.show({ color: err instanceof ApiError && err.status === 409 ? 'yellow' : 'red', message: errorMessage(err) }),
    })
  }

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t('hrf.internal.delete'),
      children: t('hrf.internal.deleteConfirm', { name: existing!.name }),
      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        remove.mutate(existing!.id, {
          onSuccess: () => {
            notifications.show({ color: 'green', message: t('hrf.internal.deleted') })
            onClose()
          },
          onError: (err) => notifications.show({ color: 'red', message: errorMessage(err) }),
        }),
    })

  return (
    <Modal opened onClose={onClose} size="lg" title={existing ? t('hrf.internal.edit') : t('hrf.internal.add')}>
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Select
            label={t('hrf.internal.parent')}
            description={t('hrf.internal.parentHint')}
            required
            searchable
            disabled={!editable}
            data={parentOptions}
            value={form.parentTaskId}
            onChange={(v) => set('parentTaskId', v)}
          />
          <TextInput label={t('hrf.internal.name')} required disabled={!editable} value={form.name} onChange={(e) => set('name', e.currentTarget.value)} />
          <MultiSelect
            label={t('hrf.internal.assignees')}
            searchable
            clearable
            disabled={!editable}
            data={assigneeOptions}
            value={form.assigneeIds}
            onChange={(v) => set('assigneeIds', v)}
            nothingFoundMessage={t('hrf.internal.noAssignees')}
          />
          <Group grow align="flex-start">
            <DateInput label={t('hrf.internal.start')} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(form.startDate)} onChange={(v) => set('startDate', fromDate(v))} />
            <DateInput
              label={t('hrf.internal.end')}
              valueFormat="DD.MM.YYYY"
              clearable
              disabled={!editable}
              value={toDate(form.endDate)}
              onChange={(v) => set('endDate', fromDate(v))}
              error={datesInvalid ? t('validation.dateRange') : undefined}
            />
            <NumberInput label={t('hrf.percent')} min={0} max={100} step={5} clampBehavior="strict" suffix=" %" disabled={!editable} value={form.percentComplete} onChange={(v) => set('percentComplete', Math.round(Number(v) || 0))} />
          </Group>
          <Textarea label={t('hrf.internal.notes')} autosize minRows={3} maxRows={10} disabled={!editable} value={form.notes} onChange={(e) => set('notes', e.currentTarget.value)} />
          <TextInput
            label={t('hrf.internal.link')}
            placeholder="https://"
            disabled={!editable}
            value={form.link}
            onChange={(e) => set('link', e.currentTarget.value)}
            error={linkInvalid ? t('validation.httpUrl') : undefined}
            rightSection={
              form.link && !linkInvalid ? (
                <Tooltip label={t('hrf.internal.openLink')}>
                  <ActionIcon variant="subtle" component="a" href={form.link.trim()} target="_blank" rel="noopener noreferrer" aria-label={t('hrf.internal.openLink')}>
                    <IconExternalLink size={16} />
                  </ActionIcon>
                </Tooltip>
              ) : null
            }
          />
          {!editable && <Alert color="gray">{t('hrf.internal.readOnly')}</Alert>}
          <Group justify="space-between">
            <div>
              {existing && can('hrfInternal', 'delete') && (
                <Button variant="subtle" color="red" onClick={confirmDelete} loading={remove.isPending}>
                  {t('hrf.internal.delete')}
                </Button>
              )}
            </div>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                {t('app.cancel')}
              </Button>
              {editable && (
                <Button type="submit" disabled={!canSubmit} loading={save.isPending}>
                  {t('app.save')}
                </Button>
              )}
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
