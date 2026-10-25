import { Alert, Button, Checkbox, Group, Menu, MultiSelect, SegmentedControl, Select, Stack, Switch, Tabs, Text, TextInput, Title } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconCalendarEvent, IconDownload, IconFileImport, IconSnowflake, IconStack2, IconSubtask } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BASE_PARTIES, HRF_STATUSES, type HrfTaskDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime } from '../../lib/format'
import { exportPath, useBaseline, useBaselines, useCreateBaseline, useHrfTasks, useInternalTasks, useProjectId } from './api'
import { BaselinesModal } from './BaselinesModal'
import { BaselineTaskModal, type BaselineTaskTarget } from './BaselineTaskModal'
import { DayZeroModal } from './DayZeroModal'
import { GanttChart, type GanttView } from './GanttChart'
import { ImportWizard } from './ImportWizard'
import { InternalTaskModal, type InternalTaskTarget } from './InternalTaskModal'
import { TaskDrawer } from './TaskDrawer'
import { TaskTable } from './TaskTable'

interface Filters {
  parties: string[]
  statuses: string[]
  stage: string | null
  range: [Date | null, Date | null]
  onlyCritical: boolean
  /** Zadania wewnętrzne: wszystkie / tylko przypisane do mnie / ukryte. */
  internal: 'all' | 'mine' | 'none'
}

/** Wariant „bieżący” w listach wyboru planu. */
const CURRENT = 'current'

type DateMap = Map<string, { start: string | null; end: string | null }>

const noFilters: Filters = { parties: [], statuses: [], stage: null, range: [null, null], onlyCritical: false, internal: 'all' }

/** Filtr zachowujący hierarchię: zostają pasujące zadania i ich Etapy nadrzędne. */
function applyFilters(tasks: HrfTaskDto[], f: Filters): HrfTaskDto[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const parents = new Set(tasks.map((t) => t.parentId))
  const rootOf = (t: HrfTaskDto): HrfTaskDto => (t.parentId && byId.get(t.parentId) ? rootOf(byId.get(t.parentId)!) : t)
  const [from, to] = f.range.map((d) => (d ? format(d, 'yyyy-MM-dd') : null))
  const matches = (t: HrfTaskDto) =>
    (!f.parties.length || f.parties.includes(t.party)) &&
    (!f.statuses.length || f.statuses.includes(t.status)) &&
    (!f.stage || rootOf(t).id === f.stage) &&
    (!f.onlyCritical || t.isCriticalPath) &&
    (!from || (t.plannedEnd ?? '') >= from) &&
    (!to || (t.plannedStart ?? '9999') <= to)
  const keep = new Set<string>()
  for (const t of tasks) {
    if (parents.has(t.id) && !f.stage) continue
    if (matches(t)) {
      let cur: HrfTaskDto | undefined = t
      while (cur) {
        keep.add(cur.id)
        cur = cur.parentId ? byId.get(cur.parentId) : undefined
      }
    }
  }
  return tasks.filter((t) => keep.has(t.id))
}

export function HrfPage() {
  const { t } = useTranslation()
  const { can, state } = useAuth()
  const pid = useProjectId()
  const query = useHrfTasks()
  const internalQuery = useInternalTasks()
  const [internalTarget, setInternalTarget] = useState<InternalTaskTarget | null>(null)
  const myId = state.status === 'ready' ? state.me.user.id : null
  const baselines = useBaselines()
  const createBaseline = useCreateBaseline()
  const [tab, setTab] = useState<string | null>('list')
  const [view, setView] = useState<GanttView>('Week')
  const [filters, setFilters] = useState<Filters>(noFilters)
  const [openTask, setOpenTask] = useState<string | null>(null)
  /** Wyświetlany wariant: bieżący harmonogram albo zamrożony plan bazowy. */
  const [variantId, setVariantId] = useState<string>(CURRENT)
  /** Porównanie na Gantcie; `undefined` = domyślnie obowiązujący plan bazowy. */
  const [compareChoice, setCompareChoice] = useState<string | null | undefined>(undefined)
  const [importOpen, setImportOpen] = useState(false)
  const [dayZeroOpen, setDayZeroOpen] = useState(false)
  const [baselinesOpen, setBaselinesOpen] = useState(false)
  const [baselineTask, setBaselineTask] = useState<BaselineTaskTarget | null>(null)
  const isAdmin = state.status === 'ready' && state.me.user.role === 'Admin'

  const baselineList = baselines.data
  const currentBaseline = baselineList?.find((b) => b.isCurrent)
  // Usunięty plan nie może pozostać wybrany.
  const variant = variantId === CURRENT ? null : (baselineList?.find((b) => b.id === variantId) ?? null)
  const effectiveVariantId = variant?.id ?? CURRENT
  const compareCandidate = compareChoice === undefined ? (currentBaseline?.id ?? null) : compareChoice
  const compareId =
    compareCandidate && compareCandidate !== effectiveVariantId && (compareCandidate === CURRENT || baselineList?.some((b) => b.id === compareCandidate))
      ? compareCandidate
      : null
  const variantData = useBaseline(variant?.id ?? null)
  const compareData = useBaseline(compareId && compareId !== CURRENT ? compareId : null)

  const data = query.data
  const variantMap = useMemo<DateMap | undefined>(() => (variantData.data ? new Map(variantData.data.tasks.map((b) => [b.taskId, b])) : undefined), [variantData.data])
  /** Zadania z datami planowanymi wybranego wariantu (status i postęp zawsze bieżące). */
  const tasks = useMemo(() => {
    if (!data) return []
    if (!variant) return data.tasks
    if (!variantMap) return []
    return data.tasks.map((x) => {
      const b = variantMap.get(x.id)
      return { ...x, plannedStart: b?.start ?? null, plannedEnd: b?.end ?? null }
    })
  }, [data, variant, variantMap])
  const filtered = useMemo(() => applyFilters(tasks, filters), [tasks, filters])
  const internalVisible = useMemo(() => {
    if (filters.internal === 'none') return []
    const all = internalQuery.data ?? []
    return filters.internal === 'mine' ? all.filter((i) => i.assignees.some((a) => a.id === myId)) : all
  }, [internalQuery.data, filters.internal, myId])
  const openRow = (id: string) => {
    const internal = internalQuery.data?.find((i) => i.id === id)
    if (internal) return setInternalTarget({ task: internal })
    const task = data?.tasks.find((x) => x.id === id)
    // W widoku planu bazowego Admin koryguje daty tego planu; pozostali widzą szczegóły zadania.
    if (variant && isAdmin && task) {
      const b = variantMap?.get(id)
      setBaselineTask({ baseline: variant, task, start: b?.start ?? null, end: b?.end ?? null })
    } else setOpenTask(id)
  }
  const baselineMap = useMemo<DateMap | undefined>(() => {
    if (compareId === CURRENT) return data ? new Map(data.tasks.map((x) => [x.id, { start: x.plannedStart, end: x.plannedEnd }])) : undefined
    return compareData.data ? new Map(compareData.data.tasks.map((b) => [b.taskId, b])) : undefined
  }, [compareId, compareData.data, data])
  const baselineOption = (b: { id: string; name: string; isCurrent: boolean }) => ({ value: b.id, label: b.isCurrent ? `${b.name} (${t('hrf.baselineCurrent')})` : b.name })
  const variantOptions = [{ value: CURRENT, label: t('hrf.variantCurrent') }, ...(baselineList?.map(baselineOption) ?? [])]
  const compareOptions = variantOptions.filter((o) => o.value !== effectiveVariantId)
  const stageOptions = useMemo(() => data?.tasks.filter((x) => !x.parentId).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` })) ?? [], [data])
  const showInternal = !!data?.tasks.some((x) => 'contractValue' in x)
  const approve = can('hrf', 'approve')

  const exportFile = (kind: 'xlsx' | 'pdf') =>
    downloadFile(exportPath(pid, kind), kind === 'xlsx' ? 'HRF.xlsx' : 'HRF-Gantt.pdf').catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))

  const freeze = () => {
    let name = `Plan bazowy ${format(new Date(), 'dd.MM.yyyy')}`
    let isCurrent = true
    modals.openConfirmModal({
      title: t('hrf.baselineCreate'),
      children: (
        <Stack gap="sm">
          <TextInput label={t('hrf.baselineName')} defaultValue={name} onChange={(e) => (name = e.currentTarget.value)} />
          <Checkbox label={t('hrf.baselineMakeCurrent')} defaultChecked={isCurrent} onChange={(e) => (isCurrent = e.currentTarget.checked)} />
        </Stack>
      ),
      labels: { confirm: t('app.save'), cancel: t('app.cancel') },
      onConfirm: () =>
        createBaseline.mutate({ name, isCurrent }, {
          onSuccess: () => {
            setCompareChoice(undefined)
            notifications.show({ color: 'green', message: t('app.saved') })
          },
          onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
        }),
    })
  }

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>{t('hrf.title')}</Title>
        <Group gap="xs">
          {approve && (
            <>
              <Button variant="light" leftSection={<IconCalendarEvent size={16} />} onClick={() => setDayZeroOpen(true)}>
                {t('hrf.dayZero')}
              </Button>
              <Button variant="light" leftSection={<IconFileImport size={16} />} onClick={() => setImportOpen(true)}>
                {t('hrf.import')}
              </Button>
              <Button variant="light" leftSection={<IconSnowflake size={16} />} disabled={!data?.dayZeroDate} onClick={freeze}>
                {t('hrf.baselineCreate')}
              </Button>
            </>
          )}
          <Button variant="light" leftSection={<IconStack2 size={16} />} onClick={() => setBaselinesOpen(true)}>
            {t('hrf.baselineManage')}
          </Button>
          {can('hrfInternal', 'create') && (
            <Button variant="light" color="blue" leftSection={<IconSubtask size={16} />} disabled={!data?.tasks.length} onClick={() => setInternalTarget({ parentTaskId: openTask })}>
              {t('hrf.internal.add')}
            </Button>
          )}
          {can('hrf', 'export') && (
            <Menu>
              <Menu.Target>
                <Button variant="light" leftSection={<IconDownload size={16} />}>
                  {t('hrf.export')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => exportFile('xlsx')}>{t('hrf.exportXlsx')}</Menu.Item>
                <Menu.Item disabled={!data?.dayZeroDate} onClick={() => exportFile('pdf')}>
                  {t('hrf.exportPdf')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      {data && !data.dayZeroDate && <Alert color="yellow">{t('hrf.dayZeroMissing')}</Alert>}
      {data && data.tasks.length > 0 && !data.criticalPathComputed && (
        <Alert color="gray" variant="light">
          {t('hrf.cpmEmpty')}
        </Alert>
      )}
      {data && data.tasks.length === 0 && <Alert>{t('hrf.noTasks')}</Alert>}

      {variant && (
        <Alert color="indigo" variant="light">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm">
              {t('hrf.variantViewing', { name: variant.name, date: formatDateTime(variant.createdAt), dayZero: formatDate(variant.dayZeroDate) })}
              {isAdmin && ` ${t('hrf.variantEditHint')}`}
            </Text>
            <Button size="xs" variant="white" onClick={() => setVariantId(CURRENT)}>
              {t('hrf.variantBack')}
            </Button>
          </Group>
        </Alert>
      )}

      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          w={260}
          label={t('hrf.variant')}
          allowDeselect={false}
          data={variantOptions}
          value={effectiveVariantId}
          onChange={(v) => v && setVariantId(v)}
        />
        <MultiSelect w={200} label={t('hrf.filters.party')} data={BASE_PARTIES.map((p) => ({ value: p, label: t(`parties.${p}`) }))} value={filters.parties} onChange={(v) => setFilters({ ...filters, parties: v })} clearable />
        <MultiSelect w={220} label={t('hrf.filters.status')} data={HRF_STATUSES.map((s) => ({ value: s, label: t(`hrf.status.${s}`) }))} value={filters.statuses} onChange={(v) => setFilters({ ...filters, statuses: v })} clearable />
        <Select w={240} label={t('hrf.filters.stage')} data={stageOptions} value={filters.stage} onChange={(v) => setFilters({ ...filters, stage: v })} clearable />
        <DatePickerInput
          type="range"
          w={240}
          label={`${t('hrf.filters.from')} – ${t('hrf.filters.to')}`}
          valueFormat="DD.MM.YYYY"
          clearable
          value={filters.range}
          onChange={(v) => setFilters({ ...filters, range: v as [Date | null, Date | null] })}
        />
        {can('hrfInternal', 'view') && (
          <Select
            w={210}
            label={t('hrf.internal.title')}
            allowDeselect={false}
            data={(['all', 'mine', 'none'] as const).map((v) => ({ value: v, label: t(`hrf.internal.filter.${v}`) }))}
            value={filters.internal}
            onChange={(v) => v && setFilters({ ...filters, internal: v as Filters['internal'] })}
          />
        )}
        <Switch label={t('hrf.filters.onlyCritical')} checked={filters.onlyCritical} onChange={(e) => setFilters({ ...filters, onlyCritical: e.currentTarget.checked })} />
        <Button variant="subtle" onClick={() => setFilters(noFilters)}>
          {t('app.clear')}
        </Button>
      </Group>

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="list">{t('hrf.tabs.list')}</Tabs.Tab>
          <Tabs.Tab value="gantt">{t('hrf.tabs.gantt')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="list" pt="sm">
          {data && <TaskTable tasks={filtered} internalTasks={internalVisible} showInternal={showInternal} onOpen={openRow} />}
        </Tabs.Panel>
        <Tabs.Panel value="gantt" pt="sm">
          <Group mb="sm" gap="sm">
            <SegmentedControl value={view} onChange={(v) => setView(v as GanttView)} data={(['Day', 'Week', 'Month'] as const).map((v) => ({ value: v, label: t(`hrf.view.${v}`) }))} />
            <Select
              w={280}
              placeholder={`${t('hrf.baselineCompare')}: ${t('hrf.baselineNone')}`}
              aria-label={t('hrf.baselineCompare')}
              clearable
              data={compareOptions}
              value={compareId}
              onChange={setCompareChoice}
            />
            <Text size="xs" c="dimmed">
              — {t('hrf.todayLine')} · <span style={{ color: 'var(--mantine-color-red-6)' }}>- - {t('hrf.deadlineLine')}</span>
            </Text>
          </Group>
          {data && (
            <GanttChart
              tasks={filtered}
              dependencies={data.dependencies}
              internalTasks={internalVisible}
              view={view}
              contractEndDate={data.contractEndDate}
              deadlineLabel={t('hrf.deadlineLine')}
              baseline={baselineMap}
              onTaskClick={openRow}
            />
          )}
        </Tabs.Panel>
      </Tabs>

      <TaskDrawer
        task={data?.tasks.find((x) => x.id === openTask) ?? null}
        tasks={data?.tasks ?? []}
        dependencies={data?.dependencies ?? []}
        internalTasks={internalQuery.data}
        onOpenInternal={(task) => setInternalTarget({ task })}
        onAddInternal={(parentTaskId) => setInternalTarget({ parentTaskId })}
        onClose={() => setOpenTask(null)}
      />
      <InternalTaskModal target={internalTarget} formalTasks={data?.tasks ?? []} onClose={() => setInternalTarget(null)} />
      {approve && <ImportWizard opened={importOpen} onClose={() => setImportOpen(false)} />}
      <BaselineTaskModal
        target={baselineTask}
        onClose={() => setBaselineTask(null)}
        onOpenDetails={(id) => {
          setBaselineTask(null)
          setOpenTask(id)
        }}
      />
      <BaselinesModal
        opened={baselinesOpen}
        onClose={() => setBaselinesOpen(false)}
        onShow={(id) => {
          setVariantId(id)
          setBaselinesOpen(false)
        }}
      />
      {approve && <DayZeroModal opened={dayZeroOpen} onClose={() => setDayZeroOpen(false)} />}
    </Stack>
  )
}
