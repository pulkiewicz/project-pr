import { Alert, Badge, Button, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Table, Tabs, Text, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconPlus } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { AVIZATION_STATUSES, type AvizationDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, todayWarsaw } from '../../lib/format'
import { useProjectId } from '../hrf/api'
import { dayExportUrl, useAvizations, useOnSite } from './api'
import { AvizationDrawer, type AvizationPreset } from './AvizationDrawer'
import { AVIZ_COLOR } from './colors'
import { PersonsTab, VehiclesTab } from './People'

function ListTab({ onOpen }: { onOpen: (a: AvizationDto) => void }) {
  const { t } = useTranslation()
  const q = useAvizations()
  const mobile = useMediaQuery('(max-width: 48em)')
  const [status, setStatus] = useState<string>('active')
  if (q.isLoading) return <Loader />
  const list = (q.data ?? []).filter((a) => (status === 'active' ? ['draft', 'sent', 'accepted'].includes(a.status) : status === 'all' || a.status === status))
  return (
    <Stack>
      <SegmentedControl
        size="xs"
        value={status}
        onChange={setStatus}
        data={[{ value: 'active', label: t('avizations.filterActive') }, { value: 'all', label: t('avizations.filterAll') }, ...AVIZATION_STATUSES.map((s) => ({ value: s, label: t(`avizations.status.${s}`) }))]}
        style={{ alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}
      />
      {list.length === 0 && <Text c="dimmed" size="sm">{t('avizations.noAvizations')}</Text>}
      {mobile ? (
        <Stack gap="xs">
          {list.map((a) => (
            <Card key={a.id} withBorder padding="sm" onClick={() => onOpen(a)} style={{ cursor: 'pointer' }}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600} size="sm">{a.number}</Text>
                <Badge color={AVIZ_COLOR[a.status]}>{t(`avizations.status.${a.status}`)}</Badge>
              </Group>
              <Text size="sm">{formatDate(a.dateFrom)}{a.dateTo !== a.dateFrom ? ` – ${formatDate(a.dateTo)}` : ''} · {a.purpose}</Text>
              <Text size="xs" c="dimmed">{t('avizations.personsShort', { count: a.persons.length })} · {t('avizations.vehiclesShort', { count: a.vehicles.length })}{a.entryPointName ? ` · ${a.entryPointName}` : ''}</Text>
            </Card>
          ))}
        </Stack>
      ) : (
        <Table.ScrollContainer minWidth={800}>
          <Table highlightOnHover striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('avizations.number')}</Table.Th>
                <Table.Th>{t('avizations.dates')}</Table.Th>
                <Table.Th>{t('avizations.purpose')}</Table.Th>
                <Table.Th>{t('avizations.persons')}</Table.Th>
                <Table.Th>{t('avizations.vehicles')}</Table.Th>
                <Table.Th>{t('avizations.entryPoint')}</Table.Th>
                <Table.Th>{t('hrf.statusLabel')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((a) => (
                <Table.Tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(a)}>
                  <Table.Td fw={500}>{a.number}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(a.dateFrom)}{a.dateTo !== a.dateFrom ? ` – ${formatDate(a.dateTo)}` : ''}</Table.Td>
                  <Table.Td>{a.purpose}</Table.Td>
                  <Table.Td>{a.persons.length}</Table.Td>
                  <Table.Td>{a.vehicles.length}</Table.Td>
                  <Table.Td>{a.entryPointName ?? '—'}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Badge color={AVIZ_COLOR[a.status]}>{t(`avizations.status.${a.status}`)}</Badge>
                      {a.warnings.length > 0 && <Badge color="yellow" variant="light">!</Badge>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  )
}

function TodayTab() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const pid = useProjectId()
  const [date, setDate] = useState<Date>(new Date(`${todayWarsaw()}T00:00:00`))
  const iso = format(date, 'yyyy-MM-dd')
  const q = useOnSite(iso)
  const dl = (kind: 'pdf' | 'xlsx') => downloadFile(dayExportUrl(pid, iso, kind), `awizacje-${iso}.${kind}`).catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))
  return (
    <Stack>
      <Group align="flex-end" wrap="wrap">
        <DateInput label={t('avizations.onSiteDate')} valueFormat="DD.MM.YYYY" value={date} onChange={(v) => v && setDate(new Date(v as unknown as string))} w={180} />
        {can('avizations', 'export') && (
          <>
            <Button size="xs" variant="light" onClick={() => dl('pdf')}>{t('avizations.exportDay')} PDF</Button>
            <Button size="xs" variant="light" onClick={() => dl('xlsx')}>{t('avizations.exportDay')} XLSX</Button>
          </>
        )}
      </Group>
      {q.isLoading ? (
        <Loader />
      ) : !q.data || q.data.avizations.length === 0 ? (
        <Alert color="gray">{t('avizations.nobodyOnSite')}</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Card withBorder>
            <Text fw={600} mb="xs">{t('avizations.onSitePersons')} ({q.data.persons.length})</Text>
            <Stack gap={4}>
              {q.data.persons.map((p) => (
                <Group key={`${p.id}${p.avizationNumber}`} justify="space-between" wrap="nowrap">
                  <Text size="sm">{p.name}</Text>
                  <Text size="xs" c="dimmed">{p.company} · {p.avizationNumber}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
          <Card withBorder>
            <Text fw={600} mb="xs">{t('avizations.onSiteVehicles')} ({q.data.vehicles.length})</Text>
            <Stack gap={4}>
              {q.data.vehicles.map((v) => (
                <Group key={`${v.id}${v.avizationNumber}`} justify="space-between" wrap="nowrap">
                  <Text size="sm" ff="monospace">{v.registrationNumber}</Text>
                  <Text size="xs" c="dimmed">{[v.makeModel, v.driverName].filter(Boolean).join(' · ')} · {v.avizationNumber}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
        </SimpleGrid>
      )}
    </Stack>
  )
}

export function AvizationsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<string | null>('list')
  const [open, setOpen] = useState<AvizationDto | 'new' | null>(null)
  const [preset, setPreset] = useState<AvizationPreset | null>(null)
  const list = useAvizations()

  // Szkic z planu tygodniowego: /awizacje?from=…&to=…&purpose=…&hrfTask=…&weeklyItem=…
  useEffect(() => {
    if (params.get('from')) {
      setPreset({ dateFrom: params.get('from')!, dateTo: params.get('to') ?? undefined, purpose: params.get('purpose') ?? '', hrfTaskId: params.get('hrfTask'), weeklyItemId: params.get('weeklyItem') })
      setOpen('new')
      setParams({}, { replace: true })
    }
  }, [params, setParams])

  const current = open && open !== 'new' ? (list.data?.find((a) => a.id === open.id) ?? open) : null
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>{t('avizations.title')}</Title>
        {can('avizations', 'create') && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => (setPreset(null), setOpen('new'))}>{t('avizations.add')}</Button>
        )}
      </Group>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="list">{t('avizations.tabs.list')}</Tabs.Tab>
          <Tabs.Tab value="today">{t('avizations.tabs.today')}</Tabs.Tab>
          <Tabs.Tab value="persons">{t('avizations.tabs.persons')}</Tabs.Tab>
          <Tabs.Tab value="vehicles">{t('avizations.tabs.vehicles')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="list" pt="sm"><ListTab onOpen={setOpen} /></Tabs.Panel>
        <Tabs.Panel value="today" pt="sm"><TodayTab /></Tabs.Panel>
        <Tabs.Panel value="persons" pt="sm"><PersonsTab /></Tabs.Panel>
        <Tabs.Panel value="vehicles" pt="sm"><VehiclesTab /></Tabs.Panel>
      </Tabs>
      <AvizationDrawer opened={!!open} avization={current} preset={open === 'new' ? preset : null} onClose={() => setOpen(null)} />
    </Stack>
  )
}
