import { Accordion, ActionIcon, Alert, Button, Progress, SimpleGrid, Table } from '@mantine/core'
import { IconCalendarEvent, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { hours as H } from '#shared'
import { getEntries } from './publicApi'

interface Props {
  employeeId: string
  /** Miesiąc, na którym ma się otworzyć panel (YYYY-MM). */
  initialMonth: string
  /** Znacznik zmieniany przez rodzica po zapisie, żeby odświeżyć dane. */
  refreshKey: number
  onOpenWeek: (monday: string) => void
}

const describeEntry = (entry: H.StoredTimesheetEntry | undefined) => {
  if (!entry) return ''
  const parts: string[] = []
  if (entry.mode === 'range' && entry.start && entry.end) {
    parts.push(`${entry.start}–${entry.end}`)
    if (entry.breakMin) parts.push(`przerwa ${entry.breakMin} min`)
  }
  if (entry.note) parts.push(entry.note)
  return parts.join(' · ')
}

/** Podsumowanie miesiąca — odwzorowanie `MonthSummary.vue` z workload-calendar. */
export function MonthSummary({ employeeId, initialMonth, refreshKey, onOpenWeek }: Props) {
  const [month, setMonth] = useState(initialMonth)
  const [entries, setEntries] = useState<Record<string, H.StoredTimesheetEntry>>({})
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const dates = useMemo(() => H.monthDates(month), [month])
  useEffect(() => {
    let alive = true
    setLoading(true)
    setErrorMessage('')
    getEntries(employeeId, dates[0]!, dates.at(-1)!)
      .then((d) => alive && setEntries(d.entries ?? {}))
      .catch((e: Error) => {
        if (!alive) return
        setErrorMessage(e.message)
        setEntries({})
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [employeeId, dates, refreshKey])

  const total = H.sumHours(entries)
  const workedDays = H.countWorkedDays(entries)
  const average = workedDays ? H.roundHours(total / workedDays) : 0

  /** Dni miesiąca pogrupowane w tygodnie (poniedziałek–niedziela). */
  const weeks = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const date of dates) {
      const monday = H.startOfWeek(date)
      groups.set(monday, [...(groups.get(monday) ?? []), date])
    }
    return [...groups].map(([monday, days]) => {
      const weekEntries = days.map((d) => entries[d]).filter(Boolean)
      return { monday, number: H.isoWeekNumber(monday), days, total: H.sumHours(weekEntries), workedDays: H.countWorkedDays(weekEntries) }
    })
  }, [dates, entries])

  return (
    <div>
      <div className="wc-week-nav">
        <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Poprzedni miesiąc" onClick={() => setMonth(H.addMonths(month, -1))}>
          <IconChevronLeft />
        </ActionIcon>
        <h2 className="wc-title wc-week-nav__label" style={{ fontSize: '1.25rem', margin: 0 }}>
          {H.formatMonth(month)}
        </h2>
        <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Następny miesiąc" onClick={() => setMonth(H.addMonths(month, 1))}>
          <IconChevronRight />
        </ActionIcon>
      </div>

      {errorMessage && (
        <Alert color="red" mb="md">
          {errorMessage}
        </Alert>
      )}
      {loading && <Progress value={100} animated size="xs" mb="md" />}

      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" mb="xs">
        <div className="wc-card wc-stat wc-stat--wide">
          <div className="wc-label">Suma godzin</div>
          <div className="wc-stat__value wc-nums">{H.formatHours(total)} h</div>
        </div>
        <div className="wc-card wc-stat">
          <div className="wc-label">Dni z godzinami</div>
          <div className="wc-stat__value wc-nums">{workedDays}</div>
        </div>
        <div className="wc-card wc-stat">
          <div className="wc-label">Średnia na dzień</div>
          <div className="wc-stat__value wc-nums">{H.formatHours(average)} h</div>
        </div>
      </SimpleGrid>

      <Accordion multiple variant="separated" mt="md" className="wc-weeks">
        {weeks.map((week) => (
          <Accordion.Item key={week.monday} value={week.monday}>
            <Accordion.Control>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <span style={{ fontWeight: 500 }}>Tydzień {week.number}</span>
                <span className="wc-muted wc-hide-xs" style={{ fontSize: '0.875rem' }}>
                  {H.formatDayMonth(week.days[0]!)} – {H.formatDayMonth(week.days.at(-1)!)}
                </span>
                <span className="wc-nums" style={{ fontWeight: 700, marginLeft: 'auto', marginRight: 8 }}>
                  {H.formatHours(week.total)} h
                </span>
              </div>
            </Accordion.Control>
            <Accordion.Panel>
              <Table className="wc-nums wc-month-table" verticalSpacing={6} horizontalSpacing={8}>
                <Table.Tbody>
                  {week.days.map((date) => (
                    <Table.Tr key={date} style={H.isWeekend(date) ? { background: 'var(--wc-surface-sunken)' } : undefined}>
                      <Table.Td className="wc-muted" w={44}>
                        {H.DAY_SHORT[H.dayOfWeek(date)]}
                      </Table.Td>
                      <Table.Td>
                        <span className="wc-hide-xs">{H.DAY_NAMES[H.dayOfWeek(date)]}, </span>
                        {H.formatDayMonth(date)}
                      </Table.Td>
                      <Table.Td className="wc-muted" style={{ fontSize: '0.875rem' }}>
                        {describeEntry(entries[date])}
                      </Table.Td>
                      <Table.Td ta="right" fw={500} w={80}>
                        {entries[date] ? `${H.formatHours(entries[date].hours)} h` : '—'}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
                <span className="wc-muted" style={{ fontSize: '0.875rem' }}>
                  Dni z godzinami: {week.workedDays}
                </span>
                <Button size="xs" variant="light" leftSection={<IconCalendarEvent size={16} />} onClick={() => onOpenWeek(week.monday)}>
                  Otwórz ten tydzień
                </Button>
              </div>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </div>
  )
}
