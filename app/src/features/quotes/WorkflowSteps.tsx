import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Menu,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { DateInput, TimeInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { IconAlertTriangle, IconCheck, IconDots, IconPlus, IconQuote, IconTrash } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { QUOTE_STEPS, type QuoteDto, type QuoteInfo, type QuoteStep, type RequiredDocDto, type RequiredDocStatus } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { daysUntil, formatDate, formatPLN } from '../../lib/format'
import { useCompanies, useOpportunities, useOpportunity } from '../crm/api'
import { AiJobButton, FolderLink } from './AiPanels'
import { quoteOps, useQuoteMutation, useRequiredDocMutation, useRequiredDocs } from './api'

// ---------------- Stan kroków ----------------

export type StepState = 'done' | 'progress' | 'todo' | 'warn'
export interface StepInfo {
  step: QuoteStep
  n: number
  state: StepState
  caption: string
}

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)

/** „30.11.2026 10:00” */
export const deadlineLabel = (date: string | null | undefined, time: string | null | undefined) => (date ? `${formatDate(date)}${time ? ` ${time}` : ''}` : null)

/** Stan kroków wyliczany z danych wyceny — kroki można odwiedzać w dowolnej kolejności. */
export function stepInfos(q: QuoteDto, t: (k: string, o?: Record<string, unknown>) => string): StepInfo[] {
  const w = q.workflow ?? { inputs: 0, docs: { total: 0, ready: 0, todo: 0 }, questions: { total: 0, open: 0 }, calcs: 0 }
  const lines = q.devices.flatMap((d) => d.sections.flatMap((s) => s.lines))
  const approvedLines = lines.filter((l) => l.approved).length
  const cl = q.checklistProgress
  const sub = q.info.submissionDeadline
  const qd = q.info.questionsDeadline
  const states: Record<QuoteStep, Omit<StepInfo, 'step' | 'n'>> = {
    identification: q.opportunityId ? { state: 'done', caption: [q.opportunityCode, q.companyName].filter(Boolean).join(' · ') } : { state: 'todo', caption: t('workflow.cap.noOpportunity') },
    inputs:
      w.inputs || q.driveFolderId
        ? { state: 'done', caption: [q.driveFolderId ? t('workflow.cap.folder') : null, w.inputs ? t('workflow.cap.inputs', { count: w.inputs }) : null].filter(Boolean).join(' · ') }
        : { state: 'todo', caption: t('workflow.cap.noInputs') },
    formal: {
      state: sub && daysUntil(sub) < 0 && q.status === 'draft' ? 'warn' : sub && w.docs.total > 0 && w.docs.todo === 0 ? 'done' : sub || w.docs.total ? 'progress' : 'todo',
      caption: [sub ? t('workflow.cap.submission', { date: formatDate(sub) }) : t('workflow.cap.noDeadline'), w.docs.total ? t('workflow.cap.docs', { ready: w.docs.ready, total: w.docs.total }) : null].filter(Boolean).join(' · '),
    },
    checklist: {
      state: cl && cl.total > 0 && cl.confirmed === cl.total ? 'done' : cl && cl.confirmed > 0 ? 'progress' : 'todo',
      caption: cl ? t('workflow.cap.confirmed', { confirmed: cl.confirmed, total: cl.total }) : '',
    },
    questions: {
      state: w.questions.open > 0 && qd && daysUntil(qd) < 0 && q.status === 'draft' ? 'warn' : w.questions.open > 0 ? 'progress' : w.questions.total > 0 ? 'done' : 'todo',
      caption: w.questions.total ? t('workflow.cap.questions', { open: w.questions.open, total: w.questions.total }) : qd ? t('workflow.cap.questionsUntil', { date: formatDate(qd) }) : t('workflow.cap.noQuestions'),
    },
    calc: w.calcs ? { state: 'done', caption: t('workflow.cap.calcs', { count: w.calcs }) } : { state: 'todo', caption: t('workflow.cap.noCalcs') },
    pricing: {
      state: lines.length > 0 && approvedLines === lines.length ? 'done' : lines.length ? 'progress' : 'todo',
      caption: q.summary ? `${formatPLN(q.summary.net)} ${t('quotes.net').toLowerCase()}` : lines.length ? t('quotes.approvedCount', { done: approvedLines, all: lines.length }) : t('workflow.cap.noLines'),
    },
    summary: { state: q.status === 'draft' ? 'todo' : 'done', caption: t(`quotes.status.${q.status}`) },
  }
  return QUOTE_STEPS.map((step, i) => ({ step, n: i + 1, ...states[step] }))
}

const STATE_COLOR: Record<StepState, string> = { done: 'green', progress: 'blue', todo: 'gray', warn: 'orange' }

/** Pasek kroków: każdy krok klikalny (swobodne przechodzenie), kolor = stan danych kroku. */
export function StepNav({ steps, active, onSelect }: { steps: StepInfo[]; active: QuoteStep; onSelect: (s: QuoteStep) => void }) {
  const { t } = useTranslation()
  return (
    <SimpleGrid cols={{ base: 2, xs: 4, xl: 8 }} spacing={6} data-testid="quote-steps">
      {steps.map((s) => {
        const current = s.step === active
        const color = STATE_COLOR[s.state]
        return (
          <UnstyledButton
            key={s.step}
            onClick={() => onSelect(s.step)}
            aria-current={current ? 'step' : undefined}
            data-testid={`step-${s.step}`}
            p={8}
            style={{
              borderRadius: 'var(--mantine-radius-md)',
              border: `1px solid ${current ? 'var(--mantine-color-navy-6)' : 'var(--mantine-color-gray-3)'}`,
              background: current ? 'var(--mantine-color-navy-0)' : 'var(--mantine-color-body)',
              boxShadow: current ? '0 0 0 1px var(--mantine-color-navy-6)' : undefined,
            }}
          >
            <Group gap={8} wrap="nowrap" align="flex-start">
              <ThemeIcon size={24} radius="xl" color={color} variant={s.state === 'todo' ? 'light' : 'filled'} style={{ flexShrink: 0 }}>
                {s.state === 'done' ? <IconCheck size={14} /> : s.state === 'warn' ? <IconAlertTriangle size={14} /> : <Text size="xs" fw={700}>{s.n}</Text>}
              </ThemeIcon>
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="sm" fw={current ? 700 : 500} lh={1.3}>
                  {t(`workflow.step.${s.step}`)}
                </Text>
                <Text size="xs" c={s.state === 'warn' ? 'orange' : 'dimmed'} lineClamp={1} title={s.caption}>
                  {s.caption || ' '}
                </Text>
              </Stack>
            </Group>
          </UnstyledButton>
        )
      })}
    </SimpleGrid>
  )
}

// ---------------- Krok 1: identyfikacja ----------------

export function IdentificationStep({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const companies = useCompanies()
  const opps = useOpportunities()
  const mutation = useQuoteMutation(q.id)
  const [companyId, setCompanyId] = useState<string | null>(q.companyId)
  const [oppId, setOppId] = useState<string | null>(q.opportunityId)
  useEffect(() => {
    setCompanyId(q.companyId)
    setOppId(q.opportunityId)
  }, [q.opportunityId, q.companyId])
  const opp = useOpportunity(oppId)
  const oppData = useMemo(
    () =>
      (opps.data ?? [])
        .filter((o) => (!companyId || o.companyId === companyId) && (!['lost', 'on_hold'].includes(o.stage) || o.id === oppId))
        .map((o) => ({ value: o.id, label: `${o.code} · ${o.name}${o.companyName && !companyId ? ` (${o.companyName})` : ''}` })),
    [opps.data, companyId, oppId],
  )
  const companyData = (companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))
  const changed = oppId !== q.opportunityId
  const o = opp.data
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      <Card withBorder>
        <Title order={5} mb="sm">
          {t('workflow.identification.title')}
        </Title>
        <Stack gap="sm">
          <SelectField
            label={t('workflow.identification.client')}
            placeholder={t('workflow.identification.anyClient')}
            data={companyData}
            value={companyId}
            disabled={!q.canEdit}
            clearable
            onChange={(v) => {
              setCompanyId(v)
              const cur = opps.data?.find((x) => x.id === oppId)
              if (v && cur && cur.companyId !== v) setOppId(null)
            }}
          />
          <SelectField
            label={t('workflow.identification.deal')}
            placeholder={t('quotes.chooseOpportunity')}
            data={oppData}
            value={oppId}
            disabled={!q.canEdit}
            onChange={(v) => {
              setOppId(v)
              const sel = opps.data?.find((x) => x.id === v)
              if (sel?.companyId) setCompanyId(sel.companyId)
            }}
          />
          {changed && q.canEdit && (
            <Alert variant="light" color="yellow">
              {t('workflow.identification.changeHint')}
            </Alert>
          )}
          {q.canEdit && (
            <Group justify="flex-end">
              <Button disabled={!changed || !oppId} loading={mutation.isPending} onClick={() => oppId && mutation.mutate(quoteOps.patch({ opportunityId: oppId, version: q.version }))}>
                {t('app.save')}
              </Button>
            </Group>
          )}
          {q.basedOnLabel && (
            <Text size="sm" c="dimmed">
              {t('quotes.basedOn')}: {q.basedOnLabel}
            </Text>
          )}
        </Stack>
      </Card>
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={5}>{t('workflow.identification.dealDetails')}</Title>
          {o && (
            <Anchor component={Link} to={`/crm?szansa=${o.id}`} size="sm">
              {t('quotes.openOpportunity')}
            </Anchor>
          )}
        </Group>
        {!oppId ? (
          <Text size="sm" c="dimmed">
            {t('workflow.cap.noOpportunity')}
          </Text>
        ) : opp.isLoading || !o ? (
          <Loader size="sm" />
        ) : (
          <Table>
            <Table.Tbody>
              <InfoRow label={t('crm.code')} value={`${o.code} · ${o.name}`} />
              <InfoRow label={t('crm.client')} value={o.companyName} />
              <InfoRow label={t('crm.contact')} value={o.contactName} />
              <InfoRow label={t('crm.stageLabel')} value={<Badge variant="light">{t(`crm.stage.${o.stage}`)}</Badge>} />
              <InfoRow label={t('crm.owner')} value={o.ownerName} />
              <InfoRow label={t('crm.value')} value={o.value != null ? formatPLN(o.value) : null} />
              <InfoRow label={t('crm.submissionDeadline')} value={o.submissionDeadline ? formatDate(o.submissionDeadline) : null} />
              <InfoRow
                label={t('crm.link')}
                value={
                  o.link ? (
                    <Anchor href={o.link} target="_blank" rel="noopener noreferrer" size="sm">
                      {o.link}
                    </Anchor>
                  ) : null
                }
              />
            </Table.Tbody>
          </Table>
        )}
        {o && (
          <Group mt="sm">
            <FolderLink folderId={o.driveFolderId} />
          </Group>
        )}
      </Card>
    </SimpleGrid>
  )
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Table.Tr>
      <Table.Td w="40%">
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Table.Td>
      <Table.Td>{value ?? <Text c="dimmed">—</Text>}</Table.Td>
    </Table.Tr>
  )
}

// Select z wyszukiwaniem — wspólne ustawienia dla kroku 1.
function SelectField(props: { label: string; placeholder: string; data: { value: string; label: string }[]; value: string | null; disabled: boolean; clearable?: boolean; onChange: (v: string | null) => void }) {
  return <Select searchable selectFirstOptionOnChange nothingFoundMessage="—" {...props} />
}

// ---------------- Krok 3: parametry formalne ----------------

function DeadlineBadge({ date }: { date: string | null | undefined }) {
  const { t } = useTranslation()
  if (!date) return null
  const d = daysUntil(date)
  return (
    <Badge variant="light" color={d < 0 ? 'red' : d <= 3 ? 'orange' : 'gray'}>
      {d < 0 ? t('workflow.formal.overdue', { count: -d }) : d === 0 ? t('workflow.formal.today') : t('workflow.formal.inDays', { count: d })}
    </Badge>
  )
}

const DOC_COLOR: Record<RequiredDocStatus, string> = { todo: 'orange', ready: 'green', na: 'gray' }

function RequiredDocs({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const docs = useRequiredDocs(q.id)
  const m = useRequiredDocMutation(q.id)
  const [draft, setDraft] = useState({ name: '', note: '' })
  const list = docs.data ?? []
  const active = list.filter((d) => d.status !== 'na')
  const ready = active.filter((d) => d.status === 'ready').length
  const edit = (d: RequiredDocDto) => {
    let name = d.name
    let note = d.note ?? ''
    modals.openConfirmModal({
      title: t('workflow.formal.editDoc'),
      children: (
        <Stack>
          <TextInput label={t('workflow.formal.docName')} defaultValue={name} onChange={(e) => (name = e.currentTarget.value)} data-autofocus />
          <Textarea label={t('workflow.formal.docNote')} autosize minRows={2} defaultValue={note} onChange={(e) => (note = e.currentTarget.value)} />
        </Stack>
      ),
      labels: { confirm: t('app.save'), cancel: t('app.cancel') },
      onConfirm: () => name.trim() && m.mutate({ method: 'PATCH', docId: d.id, json: { name: name.trim(), note: note.trim() || null } }),
    })
  }
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Group gap="xs">
          <Title order={5}>{t('workflow.formal.docs')}</Title>
          {active.length > 0 && (
            <Badge variant="light" color={ready === active.length ? 'green' : 'orange'}>
              {t('workflow.cap.docs', { ready, total: active.length })}
            </Badge>
          )}
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {t('workflow.formal.docsHint')}
      </Text>
      {docs.isLoading ? (
        <Loader size="sm" />
      ) : !list.length ? (
        <Alert variant="light" mb="sm">
          {t('workflow.formal.noDocs')}
        </Alert>
      ) : (
        <Table verticalSpacing={6} mb="sm">
          <Table.Tbody>
            {list.map((d) => (
              <Table.Tr key={d.id} data-testid="required-doc" style={{ opacity: d.status === 'na' ? 0.55 : 1 }}>
                <Table.Td w={36}>
                  <Checkbox
                    color="green"
                    aria-label={t('workflow.formal.docStatus.ready')}
                    disabled={!q.canEdit || d.status === 'na'}
                    checked={d.status === 'ready'}
                    onChange={(e) => m.mutate({ method: 'PATCH', docId: d.id, json: { status: e.currentTarget.checked ? 'ready' : 'todo' } })}
                  />
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" td={d.status === 'na' ? 'line-through' : undefined}>
                      {d.name}
                    </Text>
                    {d.source === 'ai' && (
                      <Badge size="xs" color="grape" variant="light">
                        AI
                      </Badge>
                    )}
                    {d.sourceRef && (
                      <Tooltip label={d.sourceRef} multiline w={360}>
                        <IconQuote size={14} color="var(--mantine-color-grape-6)" aria-label={t('ai.sourceRef')} style={{ flexShrink: 0 }} />
                      </Tooltip>
                    )}
                  </Group>
                  {d.note && (
                    <Text size="xs" c="dimmed">
                      {d.note}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td w={170} ta="right">
                  <Badge size="sm" variant="light" color={DOC_COLOR[d.status]} styles={{ root: { maxWidth: 'none' }, label: { overflow: 'visible' } }}>
                    {t(`workflow.formal.docStatus.${d.status}`)}
                  </Badge>
                </Table.Td>
                <Table.Td w={40}>
                  {q.canEdit && (
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" size="sm" aria-label={t('workflow.formal.docName')}>
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => edit(d)}>{t('workflow.formal.editDoc')}</Menu.Item>
                        <Menu.Item onClick={() => m.mutate({ method: 'PATCH', docId: d.id, json: { status: d.status === 'na' ? 'todo' : 'na' } })}>
                          {d.status === 'na' ? t('workflow.formal.restore') : t('workflow.formal.docStatus.na')}
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => m.mutate({ method: 'DELETE', docId: d.id })}>
                          {t('app.delete')}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {q.canEdit && (
        <Group align="flex-end" wrap="wrap">
          <TextInput label={t('workflow.formal.addDoc')} placeholder={t('workflow.formal.docNamePlaceholder')} style={{ flex: 2, minWidth: 200 }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
          <TextInput placeholder={t('workflow.formal.docNote')} style={{ flex: 2, minWidth: 160 }} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.currentTarget.value })} />
          <Button
            leftSection={<IconPlus size={16} />}
            disabled={!draft.name.trim()}
            loading={m.isPending}
            onClick={() => m.mutate({ method: 'POST', json: { name: draft.name.trim(), note: draft.note.trim() || null } }, { onSuccess: () => setDraft({ name: '', note: '' }) })}
          >
            {t('workflow.formal.add')}
          </Button>
        </Group>
      )}
    </Card>
  )
}

/** Porównanie bez względu na kolejność kluczy (jsonb ją zmienia) i różnicę brak/null. */
function sameInfo(a: QuoteInfo, b: QuoteInfo) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof QuoteInfo)[])
  return [...keys].every((k) => (a[k] ?? null) === (b[k] ?? null))
}

export function FormalStep({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const opp = useOpportunity(q.opportunityId)
  const [info, setInfo] = useState<QuoteInfo>(q.info)
  // Synchronizacja tylko przy zmianie samych danych formalnych — np. dodanie dokumentu podbija wersję wyceny,
  // ale nie może kasować niezapisanych zmian w formularzu.
  const serverInfo = JSON.stringify(q.info)
  useEffect(() => setInfo(q.info), [serverInfo]) // eslint-disable-line react-hooks/exhaustive-deps
  const editable = q.canEdit
  const changed = !sameInfo(info, q.info)
  const set = <K extends keyof QuoteInfo>(k: K, v: QuoteInfo[K]) => setInfo((p) => ({ ...p, [k]: v }))
  const text = (k: 'deliveryTerm' | 'deliveryPlace' | 'participationConditions' | 'evaluationCriteria', label: string) => (
    <Textarea label={label} autosize minRows={1} disabled={!editable} value={info[k] ?? ''} onChange={(e) => set(k, e.currentTarget.value || null)} />
  )
  const crmDeadline = opp.data?.submissionDeadline
  const deadline = (dateKey: 'submissionDeadline' | 'questionsDeadline', timeKey: 'submissionTime' | 'questionsTime', label: string) => (
    <Stack gap={4}>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <DateInput label={label} valueFormat="DD.MM.YYYY" clearable disabled={!editable} style={{ flex: 1 }} value={toDate(info[dateKey])} onChange={(v) => set(dateKey, fromDate(v))} data-testid={`formal-${dateKey}`} />
        <TimeInput w={110} aria-label={t('workflow.formal.time')} disabled={!editable || !info[dateKey]} value={info[timeKey] ?? ''} onChange={(e) => set(timeKey, e.currentTarget.value || null)} />
      </Group>
      <DeadlineBadge date={q.info[dateKey]} />
    </Stack>
  )
  const save = () => mutation.mutate(quoteOps.patch({ info, version: q.version }))
  return (
    <Stack>
      <AiJobButton q={q} kind="extract_formal" label={t('workflow.formal.extract')} />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Card withBorder>
          <Title order={5} mb="sm">
            {t('workflow.formal.deadlines')}
          </Title>
          <Stack>
            {deadline('submissionDeadline', 'submissionTime', t('workflow.formal.submission'))}
            {crmDeadline && crmDeadline !== info.submissionDeadline && (
              <Text size="xs" c="dimmed">
                {t('workflow.formal.crmDeadline', { date: formatDate(crmDeadline) })}{' '}
                {editable && (
                  <Anchor size="xs" component="button" onClick={() => set('submissionDeadline', crmDeadline)}>
                    {t('workflow.formal.useCrm')}
                  </Anchor>
                )}
              </Text>
            )}
            {deadline('questionsDeadline', 'questionsTime', t('workflow.formal.questions'))}
          </Stack>
        </Card>
        <Card withBorder>
          <Title order={5} mb="sm">
            {t('workflow.formal.conditions')}
          </Title>
          <Stack gap="sm">
            <NumberInput label={t('quotes.budget')} min={0} thousandSeparator=" " decimalSeparator="," disabled={!editable} value={info.budget ?? ''} onChange={(v) => set('budget', v === '' ? null : Number(v))} />
            {text('deliveryTerm', t('quotes.deliveryTerm'))}
            {text('deliveryPlace', t('quotes.deliveryPlace'))}
          </Stack>
        </Card>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {text('participationConditions', t('quotes.participationConditions'))}
        {text('evaluationCriteria', t('quotes.evaluationCriteria'))}
      </SimpleGrid>
      {editable && (
        <Group justify="flex-end">
          <Button disabled={!changed} loading={mutation.isPending} onClick={save} data-testid="formal-save">
            {t('app.save')}
          </Button>
        </Group>
      )}
      <RequiredDocs q={q} />
    </Stack>
  )
}

/** Baner terminu pytań nad krokiem „Pytania do zamawiającego”. */
export function QuestionsDeadline({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const label = deadlineLabel(q.info.questionsDeadline, q.info.questionsTime)
  if (!label) return <Text size="sm" c="dimmed">{t('workflow.questions.noDeadline')}</Text>
  const d = daysUntil(q.info.questionsDeadline!)
  return (
    <Alert variant="light" color={d < 0 ? 'red' : d <= 3 ? 'orange' : 'blue'} title={t('workflow.questions.deadline', { date: label })}>
      {d < 0 ? t('workflow.questions.closed') : t('workflow.questions.open')}
    </Alert>
  )
}

// ---------------- Krok 8: podsumowanie ----------------

export function SummaryStep({ q, steps, onSelect, actions }: { q: QuoteDto; steps: StepInfo[]; onSelect: (s: QuoteStep) => void; actions: ReactNode }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const mutation = useQuoteMutation(q.id)
  const [notes, setNotes] = useState(q.notes)
  useEffect(() => setNotes(q.notes), [q.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = steps.filter((s) => s.step !== 'summary' && s.state !== 'done')
  const s = q.summary
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Card withBorder>
          <Title order={5} mb="sm">
            {t('workflow.summary.steps')}
          </Title>
          <Stack gap={6}>
            {steps
              .filter((x) => x.step !== 'summary')
              .map((x) => (
                <Group key={x.step} justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ThemeIcon size={20} radius="xl" color={STATE_COLOR[x.state]} variant={x.state === 'todo' ? 'light' : 'filled'}>
                      {x.state === 'done' ? <IconCheck size={12} /> : x.state === 'warn' ? <IconAlertTriangle size={12} /> : <Text size="10px" fw={700}>{x.n}</Text>}
                    </ThemeIcon>
                    <Text size="sm" fw={500}>
                      {t(`workflow.step.${x.step}`)}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {x.caption}
                    </Text>
                  </Group>
                  <Anchor size="xs" component="button" onClick={() => onSelect(x.step)} style={{ flexShrink: 0 }}>
                    {t('workflow.summary.go')}
                  </Anchor>
                </Group>
              ))}
          </Stack>
          {open.length > 0 && q.status === 'draft' && (
            <Alert variant="light" color="yellow" mt="sm">
              {t('workflow.summary.openSteps', { count: open.length })}
            </Alert>
          )}
        </Card>
        <Card withBorder>
          <Title order={5} mb="sm">
            {t('workflow.summary.key')}
          </Title>
          <Table>
            <Table.Tbody>
              <InfoRow label={t('crm.client')} value={q.companyName} />
              <InfoRow label={t('quotes.opportunity')} value={q.opportunityName ? `${q.opportunityCode} · ${q.opportunityName}` : null} />
              <InfoRow label={t('workflow.formal.submission')} value={deadlineLabel(q.info.submissionDeadline, q.info.submissionTime)} />
              <InfoRow label={t('workflow.formal.questions')} value={deadlineLabel(q.info.questionsDeadline, q.info.questionsTime)} />
              <InfoRow label={t('quotes.budget')} value={q.info.budget != null ? formatPLN(q.info.budget) : null} />
              {q.costSummary && <InfoRow label={t('quotes.cost')} value={formatPLN(q.costSummary.cost)} />}
              {s && <InfoRow label={t('quotes.netTotal')} value={<b>{formatPLN(s.net)}</b>} />}
              {s && <InfoRow label={t('quotes.grossTotal')} value={formatPLN(s.gross)} />}
              {s && q.info.budget != null && <InfoRow label={t('quotes.budgetDiff')} value={<Text c={q.info.budget - s.gross < 0 ? 'red' : 'green'}>{formatPLN(q.info.budget - s.gross)}</Text>} />}
              <InfoRow label={t('quotes.statusLabel')} value={<Badge variant="light">{t(`quotes.status.${q.status}`)}</Badge>} />
            </Table.Tbody>
          </Table>
          <Group mt="md" gap="xs">
            {actions}
          </Group>
        </Card>
      </SimpleGrid>
      <Card withBorder>
        <Textarea label={t('quotes.notes')} autosize minRows={3} disabled={!q.canEdit} value={notes ?? ''} onChange={(e) => setNotes(e.currentTarget.value || null)} />
        {q.canEdit && can('quotes', 'edit') && (
          <Group justify="flex-end" mt="sm">
            <Button disabled={(notes ?? null) === (q.notes ?? null)} loading={mutation.isPending} onClick={() => mutation.mutate(quoteOps.patch({ notes, version: q.version }))}>
              {t('app.save')}
            </Button>
          </Group>
        )}
      </Card>
    </Stack>
  )
}
