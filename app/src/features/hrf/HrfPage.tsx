import { Alert, Button, Group, Menu, MultiSelect, SegmentedControl, Select, Stack, Switch, Tabs, Text, TextInput, Title } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconCalendarEvent, IconDownload, IconFileImport, IconSnowflake } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BASE_PARTIES, HRF_STATUSES, type HrfTaskDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { exportPath, useBaseline, useBaselines, useCreateBaseline, useHrfTasks, useProjectId } from './api'
import { DayZeroModal } from './DayZeroModal'
import { GanttChart, type GanttView } from './GanttChart'
import { ImportWizard } from './ImportWizard'
import { TaskDrawer } from './TaskDrawer'
import { TaskTable } from './TaskTable'

interface Filters {
  parties: string[]
  statuses: string[]
  stage: string | null
  range: [Date | null, Date | null]
  onlyCritical: boolean
}

const noFilters: Filters = { parties: [], statuses: [], stage: null, range: [null, null], onlyCritical: false }

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
  const { can } = useAuth()
  const pid = useProjectId()
  const query = useHrfTasks()
  const baselines = useBaselines()
  const createBaseline = useCreateBaseline()
  const [tab, setTab] = useState<string | null>('list')
  const [view, setView] = useState<GanttView>('Week')
  const [filters, setFilters] = useState<Filters>(noFilters)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [baselineId, setBaselineId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [dayZeroOpen, setDayZeroOpen] = useState(false)
  const baseline = useBaseline(baselineId)

  const data = query.data
  const filtered = useMemo(() => (data ? applyFilters(data.tasks, filters) : []), [data, filters])
  const baselineMap = useMemo(() => (baseline.data ? new Map(baseline.data.tasks.map((b) => [b.taskId, b])) : undefined), [baseline.data])
  const stageOptions = useMemo(() => data?.tasks.filter((x) => !x.parentId).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` })) ?? [], [data])
  const showInternal = !!data?.tasks.some((x) => 'contractValue' in x)
  const approve = can('hrf', 'approve')

  const exportFile = (kind: 'xlsx' | 'pdf') =>
    downloadFile(exportPath(pid, kind), kind === 'xlsx' ? 'HRF.xlsx' : 'HRF-Gantt.pdf').catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))

  const freeze = () => {
    let name = `Plan bazowy ${format(new Date(), 'dd.MM.yyyy')}`
    modals.openConfirmModal({
      title: t('hrf.baselineCreate'),
      children: <TextInput label={t('hrf.baselineName')} defaultValue={name} onChange={(e) => (name = e.currentTarget.value)} />,
      labels: { confirm: t('app.save'), cancel: t('app.cancel') },
      onConfirm: () =>
        createBaseline.mutate(name, {
          onSuccess: (b) => {
            setBaselineId(b.id)
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

      <Group gap="sm" align="flex-end" wrap="wrap">
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
          {data && <TaskTable tasks={filtered} showInternal={showInternal} onOpen={setOpenTask} />}
        </Tabs.Panel>
        <Tabs.Panel value="gantt" pt="sm">
          <Group mb="sm" gap="sm">
            <SegmentedControl value={view} onChange={(v) => setView(v as GanttView)} data={(['Day', 'Week', 'Month'] as const).map((v) => ({ value: v, label: t(`hrf.view.${v}`) }))} />
            <Select
              w={260}
              placeholder={t('hrf.baselineNone')}
              aria-label={t('hrf.baseline')}
              clearable
              data={baselines.data?.map((b) => ({ value: b.id, label: b.name })) ?? []}
              value={baselineId}
              onChange={setBaselineId}
            />
            <Text size="xs" c="dimmed">
              — {t('hrf.todayLine')} · <span style={{ color: 'var(--mantine-color-red-6)' }}>- - {t('hrf.deadlineLine')}</span>
            </Text>
          </Group>
          {data && (
            <GanttChart
              tasks={filtered}
              dependencies={data.dependencies}
              view={view}
              contractEndDate={data.contractEndDate}
              deadlineLabel={t('hrf.deadlineLine')}
              baseline={baselineMap}
              onTaskClick={setOpenTask}
            />
          )}
        </Tabs.Panel>
      </Tabs>

      <TaskDrawer task={data?.tasks.find((x) => x.id === openTask) ?? null} tasks={data?.tasks ?? []} dependencies={data?.dependencies ?? []} onClose={() => setOpenTask(null)} />
      {approve && <ImportWizard opened={importOpen} onClose={() => setImportOpen(false)} />}
      {approve && <DayZeroModal opened={dayZeroOpen} onClose={() => setDayZeroOpen(false)} />}
    </Stack>
  )
}
