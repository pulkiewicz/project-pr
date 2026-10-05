import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Loader, Menu, Modal, ScrollArea, Select, Stack, Table, Tabs, Text, Title, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronLeft, IconChevronRight, IconDownload, IconLock, IconPlus } from '@tabler/icons-react'
import { useMediaQuery } from '@mantine/hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WEEKLY_OPEN_STATUSES, WEEKLY_STATUSES, addWeeks, isoWeekOf, maskToDays, type WeeklyItemDto, type WeeklyStatus } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, todayWarsaw } from '../../lib/format'
import { useProjectId } from '../hrf/api'
import { StatusBadge } from '../hrf/StatusBadge'
import { useCloseWeek, useMatrix, useSaveItem, useWeek } from './api'
import { ItemModal } from './ItemModal'

const STATUS_COLOR: Record<WeeklyStatus, string> = { plan: 'gray', in_progress: 'navy', done: 'green', moved: 'yellow', cancelled: 'dark' }

function DaysBadges({ mask }: { mask: number }) {
  const { t } = useTranslation()
  const days = t('weekly.days', { returnObjects: true }) as string[]
  const on = new Set(maskToDays(mask))
  return (
    <Group gap={2} wrap="nowrap">
      {days.map((d, i) => (
        <Badge key={d} size="xs" variant={on.has(i) ? 'filled' : 'outline'} color={on.has(i) ? 'navy' : 'gray'} px={4} miw={26} styles={{ label: { overflow: 'visible' } }}>
          {d}
        </Badge>
      ))}
    </Group>
  )
}

function CloseWeekModal({ isoWeek, items, opened, onClose }: { isoWeek: string; items: WeeklyItemDto[]; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const close = useCloseWeek()
  const open = items.filter((i) => WEEKLY_OPEN_STATUSES.includes(i.status) && i.canEdit)
  const [selected, setSelected] = useState<string[]>(open.map((i) => i.id))
  const next = addWeeks(isoWeek, 1)
  return (
    <Modal opened={opened} onClose={onClose} title={`${t('weekly.close')} ${isoWeek}`}>
      <Stack>
        {open.length === 0 ? (
          <Text size="sm">{t('weekly.closeNone')}</Text>
        ) : (
          <>
            <Text size="sm">{t('weekly.closeHint', { week: next })}</Text>
            <Checkbox.Group value={selected} onChange={setSelected}>
              <Stack gap="xs">
                {open.map((i) => (
                  <Checkbox key={i.id} value={i.id} label={`${i.hrfTaskCode ? `[${i.hrfTaskCode}] ` : ''}${i.title}`} />
                ))}
              </Stack>
            </Checkbox.Group>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            disabled={!selected.length}
            loading={close.isPending}
            onClick={() =>
              close.mutate(
                { isoWeek, carryItemIds: selected },
                {
                  onSuccess: (r) => {
                    notifications.show({ color: 'green', message: t('weekly.closed', { count: r.carried, week: r.nextWeek }) })
                    onClose()
                  },
                  onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                },
              )
            }
          >
            {t('weekly.close')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function WeekView({ isoWeek }: { isoWeek: string }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const week = useWeek(isoWeek)
  const save = useSaveItem()
  const [edit, setEdit] = useState<WeeklyItemDto | null>(null)
  const [adding, setAdding] = useState<{ task: { id: string; name: string } | null } | null>(null)
  const [closing, setClosing] = useState(false)
  const mobile = useMediaQuery('(max-width: 48em)')
  if (week.isLoading) return <Loader />
  const d = week.data
  if (!d) return null

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t('weekly.stats', d.stats)}
        </Text>
        <Group gap="xs">
          {can('weeklyPlan', 'create') && (
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAdding({ task: null })}>
              {t('weekly.add')}
            </Button>
          )}
          {can('weeklyPlan', 'edit') && (
            <Button size="xs" variant="light" leftSection={<IconLock size={14} />} onClick={() => setClosing(true)}>
              {t('weekly.close')}
            </Button>
          )}
        </Group>
      </Group>

      <Card withBorder>
        <Text fw={600} size="sm" mb="xs">
          {t('weekly.items')}
        </Text>
        {d.items.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('weekly.noItems')}
          </Text>
        ) : mobile ? (
          <Stack gap="xs">
            {d.items.map((i) => (
              <Card key={i.id} withBorder padding="sm" onClick={() => setEdit(i)} style={{ cursor: 'pointer' }}>
                <Group gap={6} mb={4} wrap="nowrap">
                  {i.hrfTaskCode && <Badge variant="outline" size="xs">{i.hrfTaskCode}</Badge>}
                  <Text size="sm" fw={500}>
                    {i.title}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed" mb={6}>
                  {t(`parties.${i.party}`)}
                  {i.assigneeName ? ` · ${i.assigneeName}` : ''}
                  {i.carriedOverFromWeek ? ` · ${t('weekly.carriedFrom', { week: i.carriedOverFromWeek })}` : ''}
                </Text>
                <Stack gap={6}>
                  <DaysBadges mask={i.plannedDays} />
                  <Badge color={STATUS_COLOR[i.status]} variant="light" style={{ alignSelf: 'flex-start' }}>
                    {t(`weekly.status.${i.status}`)}
                  </Badge>
                </Stack>
              </Card>
            ))}
          </Stack>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table highlightOnHover verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('weekly.itemTitle')}</Table.Th>
                  <Table.Th>{t('hrf.party')}</Table.Th>
                  <Table.Th>{t('weekly.assignee')}</Table.Th>
                  <Table.Th>{t('weekly.plannedDays')}</Table.Th>
                  <Table.Th>{t('hrf.statusLabel')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.items.map((i) => (
                  <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setEdit(i)}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {i.hrfTaskCode && <Badge variant="outline" size="xs">{i.hrfTaskCode}</Badge>}
                        <Text size="sm">{i.title}</Text>
                        {i.carriedOverFromWeek && (
                          <Badge size="xs" color="yellow" variant="light">
                            {t('weekly.carriedFrom', { week: i.carriedOverFromWeek })}
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{t(`parties.${i.party}`)}</Table.Td>
                    <Table.Td>{i.assigneeName ?? '—'}</Table.Td>
                    <Table.Td>
                      <DaysBadges mask={i.plannedDays} />
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      {i.canEdit && i.status !== 'moved' ? (
                        <Select
                          size="xs"
                          w={140}
                          allowDeselect={false}
                          value={i.status}
                          data={WEEKLY_STATUSES.filter((s) => s !== 'moved').map((s) => ({ value: s, label: t(`weekly.status.${s}`) }))}
                          onChange={(v) => v && save.mutate({ id: i.id, version: i.version, data: { status: v as WeeklyStatus } }, { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}
                          aria-label={t('hrf.statusLabel')}
                        />
                      ) : (
                        <Badge color={STATUS_COLOR[i.status]} variant="light">
                          {t(`weekly.status.${i.status}`)}
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      {d.hrfTasks && (
        <Card withBorder>
          <Text fw={600} size="sm" mb="xs">
            {t('weekly.hrfActive')}
          </Text>
          {d.hrfTasks.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('weekly.noHrf')}
            </Text>
          ) : (
            <Stack gap={4}>
              {d.hrfTasks.map((h) => (
                <Group key={h.id} justify="space-between" wrap="nowrap">
                  <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                    <b>{h.code}</b> {h.name}
                  </Text>
                  <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                    <Text size="xs" c="dimmed" visibleFrom="sm">
                      {formatDate(h.plannedStart)} – {formatDate(h.plannedEnd)} · {h.percentComplete}%
                    </Text>
                    <StatusBadge status={h.status as never} />
                    {can('weeklyPlan', 'create') && (
                      <Tooltip label={t('weekly.fromHrf')}>
                        <ActionIcon size="sm" variant="subtle" onClick={() => setAdding({ task: { id: h.id, name: h.name } })} aria-label={t('weekly.fromHrf')}>
                          <IconPlus size={14} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Card>
      )}

      <ItemModal opened={!!edit || !!adding} isoWeek={isoWeek} item={edit} presetTask={adding?.task} onClose={() => (setEdit(null), setAdding(null))} />
      {closing && <CloseWeekModal isoWeek={isoWeek} items={d.items} opened onClose={() => setClosing(false)} />}
    </Stack>
  )
}

function MatrixView({ from }: { from: string }) {
  const { t } = useTranslation()
  const m = useMatrix(from)
  if (m.isLoading) return <Loader />
  if (!m.data) return null
  return (
    <Stack>
      <Text size="xs" c="dimmed">
        {t('weekly.matrixHint')}
      </Text>
      <ScrollArea type="auto">
        <Table withTableBorder withColumnBorders miw={900} fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th miw={280}>&nbsp;</Table.Th>
              {m.data.weeks.map((w) => (
                <Table.Th key={w.isoWeek} ta="center">
                  {w.isoWeek.slice(5)}
                  <Text size="10px" c="dimmed">
                    {formatDate(w.start).slice(0, 5)}
                  </Text>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {m.data.rows.map((r) => (
              <Table.Tr key={r.key}>
                <Table.Td>
                  <Text size="xs" fw={r.kind === 'party' ? 600 : 400} lineClamp={1}>
                    {r.label}
                  </Text>
                </Table.Td>
                {r.cells.map((c, i) => (
                  <Table.Td key={i} ta="center" bg={c.hrfActive ? 'navy.0' : undefined}>
                    {c.hrfActive && <span style={{ color: 'var(--mantine-color-navy-7)' }}>● </span>}
                    {c.items > 0 && (
                      <Badge size="xs" color={c.done === c.items ? 'green' : 'navy'} variant="light">
                        {c.done}/{c.items}
                      </Badge>
                    )}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  )
}

export function WeeklyPlanPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const pid = useProjectId()
  const current = isoWeekOf(todayWarsaw())
  const [isoWeek, setIsoWeek] = useState(current)
  const [tab, setTab] = useState<string | null>('week')
  const week = useWeek(isoWeek)

  const exportXlsx = (weeks: number) =>
    downloadFile(`/projects/${pid}/weekly/${isoWeek}/export.xlsx?weeks=${weeks}`, `plan-${isoWeek}.xlsx`).catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>{t('weekly.title')}</Title>
        {can('weeklyPlan', 'export') && (
          <Menu>
            <Menu.Target>
              <Button variant="light" size="xs" leftSection={<IconDownload size={14} />}>
                {t('hrf.export')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => exportXlsx(1)}>{t('weekly.exportWeek')}</Menu.Item>
              <Menu.Item onClick={() => exportXlsx(8)}>{t('weekly.exportMatrix')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Group gap="xs" wrap="nowrap">
        <ActionIcon variant="default" size="lg" onClick={() => setIsoWeek(addWeeks(isoWeek, -1))} aria-label={t('weekly.prev')}>
          <IconChevronLeft size={18} />
        </ActionIcon>
        <Text fw={600} data-testid="week-label">
          {isoWeek}, {week.data ? `${formatDate(week.data.start).slice(0, 5)}–${formatDate(week.data.end).slice(0, 5)}` : ''}
        </Text>
        <ActionIcon variant="default" size="lg" onClick={() => setIsoWeek(addWeeks(isoWeek, 1))} aria-label={t('weekly.next')}>
          <IconChevronRight size={18} />
        </ActionIcon>
        {isoWeek !== current && (
          <Button variant="subtle" size="xs" onClick={() => setIsoWeek(current)}>
            {t('weekly.today')}
          </Button>
        )}
      </Group>
      {week.error && <Alert color="red">{errorMessage(week.error)}</Alert>}
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="week">{t('weekly.tabs.week')}</Tabs.Tab>
          <Tabs.Tab value="matrix">{t('weekly.tabs.matrix')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="week" pt="sm">
          <WeekView isoWeek={isoWeek} />
        </Tabs.Panel>
        <Tabs.Panel value="matrix" pt="sm">
          <MatrixView from={isoWeek} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
