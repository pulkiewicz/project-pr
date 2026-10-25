import {
  Alert,
  Anchor,
  Autocomplete,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Timeline,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendarEvent, IconExternalLink, IconMail, IconNote, IconPhone, IconSwitchHorizontal, IconUsers } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  MANUAL_ACTIVITY_KINDS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  type ActivityDto,
  type OpportunityInput,
  type OpportunityStage,
  type OpportunityType,
  type ProjectFromOpportunityInput,
} from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { projectPath } from '../../lib/project'
import { useAddActivity, useCompanies, useCompany, useCreateProject, useOpportunity, useOwners, useSaveOpportunity } from './api'
import { NoResponseBadge, StageBadge, useStageChange } from './stage'

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)

const ACTIVITY_ICON = { note: IconNote, call: IconPhone, email: IconMail, meeting: IconUsers, stage_change: IconSwitchHorizontal } as const

const EMPTY: OpportunityInput = { name: '' }

function Activity({ a }: { a: ActivityDto }) {
  const { t } = useTranslation()
  const Icon = ACTIVITY_ICON[a.kind]
  const meta = a.meta as { from?: OpportunityStage; to?: OpportunityStage } | null
  return (
    <Timeline.Item bullet={<Icon size={12} />} title={<Text size="sm" fw={500}>{t(`crm.activity.${a.kind}`)}</Text>}>
      {a.kind === 'stage_change' && meta?.from && meta.to && (
        <Text size="sm">{t('crm.stageChange', { from: t(`crm.stage.${meta.from}`), to: t(`crm.stage.${meta.to}`) })}</Text>
      )}
      {a.body && (
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {a.body}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {formatDateTime(a.occurredAt)}
        {a.userName ? ` · ${a.userName}` : ''}
      </Text>
    </Timeline.Item>
  )
}

function CreateProjectModal({ opened, onClose, opportunityId, code, defaults }: { opened: boolean; onClose: () => void; opportunityId: string; code: string; defaults: ProjectFromOpportunityInput }) {
  const { t } = useTranslation()
  const create = useCreateProject()
  const [f, setF] = useState<ProjectFromOpportunityInput>(defaults)
  useEffect(() => {
    if (opened) setF(defaults)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])
  const valid = f.name.trim() && f.client.trim() && f.contractNo.trim() && f.contractEndDate
  return (
    <Modal opened={opened} onClose={onClose} title={t('crm.createProject')} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          {t('crm.createProjectHint', { code })}
        </Text>
        <TextInput label={t('crm.name')} required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <TextInput label={t('crm.client')} required value={f.client} onChange={(e) => setF({ ...f, client: e.currentTarget.value })} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={t('crm.contractNo')} required value={f.contractNo} onChange={(e) => setF({ ...f, contractNo: e.currentTarget.value })} />
          <TextInput label={t('crm.procurementNo')} value={f.procurementNo ?? ''} onChange={(e) => setF({ ...f, procurementNo: e.currentTarget.value })} />
          <NumberInput label={t('crm.contractValue')} min={0} thousandSeparator=" " decimalSeparator="," value={f.contractValue ?? ''} onChange={(v) => setF({ ...f, contractValue: v === '' ? null : Number(v) })} />
          <DateInput label={t('crm.contractEndDate')} required valueFormat="DD.MM.YYYY" value={toDate(f.contractEndDate || null)} onChange={(v) => setF({ ...f, contractEndDate: fromDate(v) ?? '' })} />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            disabled={!valid}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { id: opportunityId, data: f },
                {
                  onSuccess: (r) => {
                    notifications.show({ color: 'green', message: t('crm.projectCreated', { code: r.code }) })
                    onClose()
                  },
                  onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                },
              )
            }
          >
            {t('crm.createProject')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Karta szansy: `id` = edycja istniejącej, `null` przy `opened` = nowa. */
export function OpportunityDrawer({ id, opened, onClose, onCreated }: { id: string | null; opened: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const detail = useOpportunity(opened ? id : null)
  const companies = useCompanies()
  const owners = useOwners()
  const save = useSaveOpportunity()
  const addActivity = useAddActivity()
  const [changeStage, lossModal] = useStageChange()
  const [f, setF] = useState<OpportunityInput>(EMPTY)
  const [activity, setActivity] = useState<{ kind: (typeof MANUAL_ACTIVITY_KINDS)[number]; body: string }>({ kind: 'note', body: '' })
  const [projectOpen, setProjectOpen] = useState(false)
  const company = useCompany(f.companyId ?? null)
  const o = id ? detail.data : undefined

  useEffect(() => {
    if (!opened) return
    if (!id) setF(EMPTY)
    else if (o) {
      const { name, companyId, contactId, ownerId, type, source, value, submissionDeadline, decisionDate, nextStep, nextStepDate, link, notes } = o
      setF({ name, companyId, contactId, ownerId, type, source, value, submissionDeadline, decisionDate, nextStep, nextStepDate, link, notes })
    }
    setActivity({ kind: 'note', body: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, id, o?.version])

  const editable = id ? can('crm', 'edit') : can('crm', 'create')
  const set = <K extends keyof OpportunityInput>(k: K, v: OpportunityInput[K]) => setF((prev) => ({ ...prev, [k]: v }))
  const dateField = (k: 'submissionDeadline' | 'decisionDate' | 'nextStepDate', label: string) => (
    <DateInput label={label} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(f[k])} onChange={(v) => set(k, fromDate(v))} />
  )

  const submit = () =>
    save.mutate(
      { id: id ?? undefined, version: o?.version, data: f },
      {
        onSuccess: (r) => {
          notifications.show({ color: 'green', message: id ? t('app.saved') : `${r.code} · ${t('app.saved')}` })
          if (!id) onCreated?.(r.id)
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )

  const sourceSuggestions = t('crm.sourceSuggestions', { returnObjects: true }) as string[]

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      title={
        o ? (
          <Group gap="xs" wrap="nowrap">
            <Text fw={700}>{o.code}</Text>
            <StageBadge stage={o.stage} />
            {o.noResponse && <NoResponseBadge />}
          </Group>
        ) : (
          t('crm.addOpportunity')
        )
      }
    >
      {id && !o ? (
        <Loader />
      ) : (
        <Stack gap="sm">
          {o && (
            <Group align="flex-end" wrap="wrap">
              <Select
                label={t('crm.stageLabel')}
                w={200}
                allowDeselect={false}
                disabled={!can('crm', 'edit')}
                data={OPPORTUNITY_STAGES.map((s) => ({ value: s, label: t(`crm.stage.${s}`) }))}
                value={o.stage}
                onChange={(v) => v && changeStage(o, v as OpportunityStage)}
                data-testid="opportunity-stage"
              />
              {o.projectCode ? (
                <Button component={Link} to={projectPath(o.projectCode)} variant="light" leftSection={<IconExternalLink size={16} />}>
                  {t('crm.openProject')} {o.projectCode}
                </Button>
              ) : (
                o.stage === 'won' &&
                can('crm', 'approve') && (
                  <Button variant="light" color="green" onClick={() => setProjectOpen(true)}>
                    {t('crm.createProject')}
                  </Button>
                )
              )}
            </Group>
          )}
          {o?.stage === 'lost' && o.lossReason && (
            <Alert color="red" variant="light" title={t('crm.lossReason')}>
              {o.lossReason}
            </Alert>
          )}
          {!o && (
            <Text size="sm" c="dimmed">
              {t('crm.codeAuto')}
            </Text>
          )}
          <TextInput label={t('crm.name')} required disabled={!editable} value={f.name} onChange={(e) => set('name', e.currentTarget.value)} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label={t('crm.company')}
              searchable
              selectFirstOptionOnChange
              clearable
              disabled={!editable}
              data={companies.data?.map((c) => ({ value: c.id, label: c.name })) ?? []}
              value={f.companyId ?? null}
              onChange={(v) => setF((prev) => ({ ...prev, companyId: v, contactId: null }))}
            />
            <Select
              label={t('crm.contact')}
              clearable
              disabled={!editable || !f.companyId}
              data={company.data?.contacts.map((c) => ({ value: c.id, label: c.position ? `${c.name} (${c.position})` : c.name })) ?? []}
              value={f.contactId ?? null}
              onChange={(v) => set('contactId', v)}
            />
            <Select label={t('crm.owner')} clearable disabled={!editable} data={owners.data?.map((u) => ({ value: u.id, label: u.name })) ?? []} value={f.ownerId ?? null} onChange={(v) => set('ownerId', v)} />
            <Select
              label={t('crm.typeLabel')}
              clearable
              disabled={!editable}
              data={OPPORTUNITY_TYPES.map((x) => ({ value: x, label: t(`crm.type.${x}`) }))}
              value={f.type ?? null}
              onChange={(v) => set('type', v as OpportunityType | null)}
            />
            <Autocomplete label={t('crm.source')} disabled={!editable} data={sourceSuggestions} value={f.source ?? ''} onChange={(v) => set('source', v || null)} />
            <NumberInput label={t('crm.value')} min={0} thousandSeparator=" " decimalSeparator="," disabled={!editable} value={f.value ?? ''} onChange={(v) => set('value', v === '' ? null : Number(v))} />
            {dateField('submissionDeadline', t('crm.submissionDeadline'))}
            {dateField('decisionDate', t('crm.decisionDate'))}
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Textarea label={t('crm.nextStep')} autosize minRows={1} disabled={!editable} value={f.nextStep ?? ''} onChange={(e) => set('nextStep', e.currentTarget.value || null)} />
            {dateField('nextStepDate', t('crm.nextStepDate'))}
          </SimpleGrid>
          <TextInput
            label={t('crm.link')}
            disabled={!editable}
            value={f.link ?? ''}
            onChange={(e) => set('link', e.currentTarget.value || null)}
            rightSection={
              f.link ? (
                <Anchor href={f.link} target="_blank" rel="noopener noreferrer" aria-label={t('crm.link')}>
                  <IconExternalLink size={16} />
                </Anchor>
              ) : undefined
            }
          />
          <Textarea label={t('crm.notes')} autosize minRows={2} disabled={!editable} value={f.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value || null)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('app.close')}
            </Button>
            {editable && (
              <Button onClick={submit} loading={save.isPending} disabled={!f.name.trim()}>
                {t('app.save')}
              </Button>
            )}
          </Group>

          {o && (
            <>
              <Divider label={t('crm.activities')} labelPosition="left" />
              {can('crm', 'edit') && (
                <Stack gap={6}>
                  <SegmentedControl
                    size="xs"
                    data={MANUAL_ACTIVITY_KINDS.map((k) => ({ value: k, label: t(`crm.activity.${k}`) }))}
                    value={activity.kind}
                    onChange={(v) => setActivity({ ...activity, kind: v as typeof activity.kind })}
                  />
                  <Textarea placeholder={t('crm.activityBody')} autosize minRows={2} value={activity.body} onChange={(e) => setActivity({ ...activity, body: e.currentTarget.value })} />
                  <Group justify="flex-end">
                    <Button
                      size="xs"
                      leftSection={<IconCalendarEvent size={14} />}
                      disabled={!activity.body.trim()}
                      loading={addActivity.isPending}
                      onClick={() =>
                        addActivity.mutate(
                          { id: o.id, data: { kind: activity.kind, body: activity.body } },
                          { onSuccess: () => setActivity({ kind: activity.kind, body: '' }), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
                        )
                      }
                    >
                      {t('crm.addActivity')}
                    </Button>
                  </Group>
                </Stack>
              )}
              <Timeline bulletSize={22} lineWidth={2}>
                {o.activities.map((a) => (
                  <Activity key={a.id} a={a} />
                ))}
              </Timeline>
              <CreateProjectModal
                opened={projectOpen}
                onClose={() => setProjectOpen(false)}
                opportunityId={o.id}
                code={o.code}
                defaults={{ name: o.name, client: o.companyName ?? '', contractNo: '', procurementNo: '-', contractValue: o.value, contractEndDate: '' }}
              />
            </>
          )}
        </Stack>
      )}
      {lossModal}
    </Drawer>
  )
}
