import { Alert, Button, Card, Group, Progress, SimpleGrid, Table, Text } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useState } from 'react'
import { hours as H } from '#shared'
import { errorMessage } from '../../../lib/errors'
import { useTimesheetSummary } from '../api'
import { HoursChart, buildSeries } from './HoursChart'

const toMonth = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM') : null)
const monthDate = (m: string) => dayjs(`${m}-01`).toDate()

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" tt="uppercase" fw={600} c="dimmed">
        {label}
      </Text>
      <Text fz={24} fw={650} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
    </Card>
  )
}

/** Podsumowanie wszystkich pracowników za okres (dawna zakładka „Podsumowanie” workload-calendar). */
export function SummaryTab({ currentMonth }: { currentMonth: string }) {
  const [from, setFrom] = useState(currentMonth)
  const [to, setTo] = useState(currentMonth)
  const q = useTimesheetSummary(from, to)
  const [exporting, setExporting] = useState(false)
  const data = q.data
  const employees = [...(data?.employees ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  const series = data ? buildSeries(employees, data.buckets) : []
  const colorById = Object.fromEntries(series.map((s) => [s.id, s.color]))
  const showMonthColumns = data?.granularity === 'month'
  const averageAll = data?.workedDays ? Math.round((data.total / data.workedDays) * 100) / 100 : 0

  const setPeriod = (monthsBack: number) => {
    setFrom(H.addMonths(currentMonth, -monthsBack + 1))
    setTo(currentMonth)
  }
  const isPeriod = (monthsBack: number) => to === currentMonth && from === H.addMonths(currentMonth, -monthsBack + 1)
  const changeFrom = (m: string | null) => {
    if (!m) return
    setFrom(m)
    // Odwrócony zakres poprawiamy zamiast pokazywać błąd.
    if (m > to) setTo(m)
  }

  const exportOverview = async () => {
    if (!data) return
    setExporting(true)
    try {
      const { exportOverviewWorkbook } = await import('../excel')
      await exportOverviewWorkbook(data)
    } catch (e) {
      notifications.show({ color: 'red', message: `Nie udało się wygenerować pliku: ${(e as Error).message}` })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <Group mb="md" align="flex-end" wrap="wrap">
        <Group gap={4}>
          <Button size="xs" variant={isPeriod(1) ? 'light' : 'subtle'} onClick={() => setPeriod(1)}>
            Bieżący miesiąc
          </Button>
          <Button size="xs" variant={isPeriod(3) ? 'light' : 'subtle'} onClick={() => setPeriod(3)}>
            Ostatnie 3 miesiące
          </Button>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              setFrom(`${currentMonth.slice(0, 4)}-01`)
              setTo(currentMonth)
            }}
          >
            Ten rok
          </Button>
        </Group>
        <MonthPickerInput label="Od miesiąca" size="xs" w={150} valueFormat="MMMM YYYY" value={monthDate(from)} onChange={(v) => changeFrom(toMonth(v))} />
        <MonthPickerInput label="Do miesiąca" size="xs" w={150} valueFormat="MMMM YYYY" value={monthDate(to)} minDate={monthDate(from)} onChange={(v) => toMonth(v) && setTo(toMonth(v)!)} />
        <Button ml="auto" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting} disabled={q.isLoading || !employees.length} onClick={() => void exportOverview()}>
          Pobierz podsumowanie (Excel)
        </Button>
      </Group>

      {q.error && (
        <Alert color="red" mb="md">
          {errorMessage(q.error)}
        </Alert>
      )}
      {q.isFetching && <Progress value={100} animated size="xs" mb="sm" />}

      {data && employees.length === 0 && !q.isFetching && <Alert color="blue">W tym okresie nie ma żadnych pracowników ani godzin.</Alert>}

      {data && employees.length > 0 && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mb="md">
            <Stat label="Pracowników" value={employees.length} />
            <Stat label="Suma godzin" value={`${H.formatHours(data.total)} h`} />
            <Stat label="Dni pracy" value={data.workedDays} />
            <Stat label="Średnia na dzień" value={`${H.formatHours(averageAll)} h`} />
          </SimpleGrid>

          <Card withBorder mb="md">
            <Group justify="space-between" mb="xs" wrap="wrap">
              <Text fw={600}>Godziny {data.granularity === 'day' ? 'dzień po dniu' : 'miesiąc po miesiącu'}</Text>
              <Text size="xs" c="dimmed">
                Kliknij nazwisko w legendzie, aby ukryć lub pokazać serię.
              </Text>
            </Group>
            <HoursChart buckets={data.buckets} granularity={data.granularity} series={series} />
          </Card>

          <Table.ScrollContainer minWidth={600}>
            <Table withTableBorder striped={false} highlightOnHover style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pracownik</Table.Th>
                  <Table.Th ta="center">Status</Table.Th>
                  {showMonthColumns &&
                    data.months.map((m) => (
                      <Table.Th key={m} ta="center">
                        {H.formatMonth(m)}
                      </Table.Th>
                    ))}
                  <Table.Th ta="center">Dni pracy</Table.Th>
                  <Table.Th ta="center">Suma godzin</Table.Th>
                  <Table.Th ta="center">Średnia / dzień</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {employees.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>
                      <Group gap={8} wrap="nowrap">
                        {colorById[e.id] && <span style={{ width: 10, height: 10, borderRadius: 3, background: colorById[e.id], flex: 'none' }} />}
                        <div>
                          <Text size="sm" fw={500}>
                            {e.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {H.formatId(e.id)}
                          </Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Text size="sm" c={e.active ? 'dimmed' : 'orange.8'}>
                        {e.active ? 'aktywny' : 'nieaktywny'}
                      </Text>
                    </Table.Td>
                    {showMonthColumns &&
                      data.months.map((m) => (
                        <Table.Td key={m} ta="center" c={e.byBucket[m] ? undefined : 'dimmed'}>
                          {e.byBucket[m] ? H.formatHours(e.byBucket[m]) : '·'}
                        </Table.Td>
                      ))}
                    <Table.Td ta="center">{e.workedDays}</Table.Td>
                    <Table.Td ta="center" fw={600}>
                      {H.formatHours(e.total)}
                    </Table.Td>
                    <Table.Td ta="center">{e.workedDays ? H.formatHours(e.average) : '·'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr style={{ fontWeight: 600 }}>
                  <Table.Th>RAZEM</Table.Th>
                  <Table.Td />
                  {showMonthColumns &&
                    data.months.map((m) => (
                      <Table.Td key={m} ta="center">
                        {H.formatHours(employees.reduce((s, e) => s + (e.byBucket[m] || 0), 0))}
                      </Table.Td>
                    ))}
                  <Table.Td ta="center">{data.workedDays}</Table.Td>
                  <Table.Td ta="center">{H.formatHours(data.total)}</Table.Td>
                  <Table.Td ta="center">{H.formatHours(averageAll)}</Table.Td>
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>
          <Text size="xs" c="dimmed" mt="xs">
            Podsumowanie obejmuje {data.months.length === 1 ? H.formatMonth(data.months[0]!) : `okres ${H.formatMonth(from)} – ${H.formatMonth(to)}`}. Osoby nieaktywne pokazujemy tylko
            wtedy, gdy mają w tym okresie godziny.
          </Text>
        </>
      )}
    </div>
  )
}
