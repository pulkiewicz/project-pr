import { Alert, Badge, Box, Card, Group, Loader, Progress, ScrollArea, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconDiamond } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { DashboardResponse } from '#shared'
import { useDashboard } from '../features/hrf/api'
import { STATUS_COLOR, StatusBadge } from '../features/hrf/StatusBadge'
import { formatDate } from '../lib/format'

const COLOR = { green: 'green', yellow: 'yellow.7', red: 'red', gray: 'gray' } as const

function Tile({ title, children, span }: { title: string; children: React.ReactNode; span?: number }) {
  return (
    <Card withBorder style={span ? { gridColumn: `span ${span}` } : undefined}>
      <Text size="sm" c="dimmed" mb="xs">
        {title}
      </Text>
      {children}
    </Card>
  )
}

function Countdown({ c }: { c: DashboardResponse['countdown'] }) {
  const { t } = useTranslation()
  return (
    <Stack gap={4}>
      <Group align="baseline" gap="xs">
        <Text fz={40} fw={700} c={COLOR[c.color]} data-testid="tile-countdown">
          {c.calendarDays}
        </Text>
        <Text>{t('dashboard.calendarDays')}</Text>
      </Group>
      <Text size="sm">
        {c.workingDays} {t('dashboard.workingDays')}
      </Text>
      <Text size="sm">{t('app.contractDeadline', { date: formatDate(c.contractEndDate) })}</Text>
      {c.forecastEnd && (
        <Text size="sm" c={COLOR[c.color]}>
          {t('dashboard.forecastEnd', { date: formatDate(c.forecastEnd) })} · {t('dashboard.buffer', { count: c.bufferDays ?? 0 })}
        </Text>
      )}
    </Stack>
  )
}

function MiniGantt({ g }: { g: DashboardResponse['miniGantt'] }) {
  const span = (new Date(g.to).getTime() - new Date(g.from).getTime()) / 86_400_000 + 1
  const pos = (d: string) => Math.min(100, Math.max(0, ((new Date(d).getTime() - new Date(g.from).getTime()) / 86_400_000 / span) * 100))
  const today = pos(new Date().toISOString().slice(0, 10))
  return (
    <ScrollArea h={260} type="auto">
      <Stack gap={3} pos="relative">
        <Box pos="absolute" top={0} bottom={0} left={`calc(35% + ${today * 0.65}%)`} w={2} bg="green.6" style={{ zIndex: 1 }} />
        {g.tasks.map((x) => {
          const l = pos(x.start)
          const w = Math.max(1, pos(x.end) - l + 100 / span)
          return (
            <Group key={x.id} gap={0} wrap="nowrap">
              <Text size="xs" w="35%" truncate pr={6}>
                {x.code} {x.name}
              </Text>
              <Box w="65%" h={12} pos="relative" bg="gray.1">
                <Tooltip label={`${x.code} · ${formatDate(x.start)} – ${formatDate(x.end)} · ${x.percent}%`}>
                  <Box
                    pos="absolute"
                    left={`${l}%`}
                    w={`${w}%`}
                    h={12}
                    bg={`${STATUS_COLOR[x.status]}.4`}
                    style={{ borderRadius: 2, outline: x.critical ? '2px solid var(--mantine-color-red-6)' : undefined }}
                  />
                </Tooltip>
              </Box>
            </Group>
          )
        })}
      </Stack>
    </ScrollArea>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const q = useDashboard()
  if (q.isLoading) return <Loader />
  if (!q.data) return null
  const d = q.data

  return (
    <Stack>
      <Title order={2}>{t('dashboard.title')}</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <Tile title={t('dashboard.countdown')}>
          <Countdown c={d.countdown} />
        </Tile>

        <Tile title={t('dashboard.progress')}>
          {d.progress ? (
            <Stack gap="xs">
              <Text size="sm">
                {t('dashboard.actual')}: <b>{d.progress.actualPercent}%</b> · {t('dashboard.planned')}: <b>{d.progress.plannedPercent}%</b>
              </Text>
              <Progress.Root size="xl">
                <Progress.Section value={d.progress.actualPercent} color="navy" />
              </Progress.Root>
              <Progress.Root size="xs">
                <Progress.Section value={d.progress.plannedPercent} color="gray" />
              </Progress.Root>
              <Text size="sm" c={d.progress.deviationDays !== null && d.progress.deviationDays < 0 ? 'red' : 'green'}>
                {d.progress.deviationDays === null ? t('dashboard.deviationNone') : t('dashboard.deviation', { count: d.progress.deviationDays })}
              </Text>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              {t('hrf.dayZeroMissing')}
            </Text>
          )}
        </Tile>

        <Tile title={t('dashboard.milestones')}>
          {d.milestones.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('dashboard.noMilestones')}
            </Text>
          ) : (
            <Stack gap={6}>
              {d.milestones.map((m) => (
                <Group key={m.id} gap="xs" wrap="nowrap">
                  {m.isAcceptancePoint && <IconDiamond size={14} color="var(--mantine-color-violet-6)" />}
                  <Badge variant="outline" size="sm" miw={86}>
                    {formatDate(m.date)}
                  </Badge>
                  <Text size="sm" lineClamp={1}>
                    {m.code} {m.name}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </Tile>

        <Tile title={t('dashboard.stages')}>
          <Stack gap={8}>
            {d.stages.map((s) => (
              <Stack key={s.id} gap={2}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                    {s.code}. {s.name}
                  </Text>
                  <span style={{ flexShrink: 0 }}>
                    <StatusBadge status={s.status} />
                  </span>
                </Group>
                <Progress value={s.percent} color={STATUS_COLOR[s.status]} size="sm" />
              </Stack>
            ))}
          </Stack>
        </Tile>

        <Tile title={t('dashboard.alerts')}>
          {d.alerts.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('dashboard.noAlerts')}
            </Text>
          ) : (
            <ScrollArea h={260} type="auto">
              <Stack gap={6}>
                {d.alerts.map((a, i) => (
                  <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                    <IconAlertTriangle size={16} color={`var(--mantine-color-${a.severity === 'red' ? 'red' : 'yellow'}-6)`} style={{ flexShrink: 0 }} />
                    <Text size="sm">{a.message}</Text>
                  </Group>
                ))}
              </Stack>
            </ScrollArea>
          )}
        </Tile>

        <Tile title={t('dashboard.myTasks')}>
          {d.myTasks.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('dashboard.noMyTasks')}
            </Text>
          ) : (
            <Stack gap={6}>
              {d.myTasks.map((m) => (
                <Group key={m.id} justify="space-between" wrap="nowrap">
                  <Text size="sm" lineClamp={1}>
                    {m.code} {m.name}
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      {formatDate(m.plannedEnd)}
                    </Text>
                    <StatusBadge status={m.status} />
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Tile>
      </SimpleGrid>
      <Card withBorder>
        <Text size="sm" c="dimmed" mb="xs">
          {t('dashboard.miniGantt')} ({formatDate(d.miniGantt.from)} – {formatDate(d.miniGantt.to)})
        </Text>
        {d.dayZeroSet ? <MiniGantt g={d.miniGantt} /> : <Alert color="yellow">{t('hrf.dayZeroMissing')}</Alert>}
      </Card>
    </Stack>
  )
}
