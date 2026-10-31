import { ActionIcon, Alert, Button, Group, Progress, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronLeft, IconChevronRight, IconFileSpreadsheet } from '@tabler/icons-react'
import { useState } from 'react'
import { hours as H, type TimesheetReportResponse } from '#shared'
import { errorMessage } from '../../../lib/errors'
import { useTimesheetReport } from '../api'
import './panel.css'

type Entry = H.StoredTimesheetEntry

/** Opis komórki pokazywany jako podpowiedź: godziny, przerwa, uwagi. */
function cellTitle(entry: Entry | undefined) {
  if (!entry) return ''
  const parts: string[] = []
  if (entry.mode === 'range' && entry.start && entry.end) parts.push(`${entry.start}–${entry.end}`)
  if (entry.breakMin) parts.push(`przerwa ${entry.breakMin} min`)
  parts.push(`${H.formatHours(entry.hours)} h`)
  if (entry.note) parts.push(`uwagi: ${entry.note}`)
  return parts.join(' · ')
}

const localToday = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** Zestawienie miesięczne: pracownicy × dni (dawna zakładka „Zestawienie miesięczne” workload-calendar). */
export function ReportTab({ currentMonth }: { currentMonth: string }) {
  const [month, setMonth] = useState(currentMonth)
  const q = useTimesheetReport(month)
  const [exporting, setExporting] = useState('') // id pracownika albo 'all'
  const report = q.data
  const days = report?.days ?? []
  const employees = report?.employees ?? []
  const today = localToday()
  const dayTotal = (date: string) => H.roundHours(employees.reduce((s, e) => s + (Number(e.days?.[date]?.hours) || 0), 0))
  const grandTotal = H.roundHours(employees.reduce((s, e) => s + (Number(e.total) || 0), 0))

  const run = async (key: string, fn: (x: typeof import('../excel')) => Promise<void>) => {
    setExporting(key)
    try {
      await fn(await import('../excel'))
    } catch (e) {
      notifications.show({ color: 'red', message: `Nie udało się wygenerować pliku: ${(e as Error).message}` })
    } finally {
      setExporting('')
    }
  }
  const exportEmployee = (e: TimesheetReportResponse['employees'][number]) => run(e.id, (x) => x.exportEmployeeWorkbook(e, month))
  const exportAll = () => run('all', (x) => x.exportSummaryWorkbook(employees, month))

  return (
    <div>
      <Group mb="md" gap="xs" wrap="wrap">
        <ActionIcon variant="subtle" color="gray" aria-label="Poprzedni miesiąc" onClick={() => setMonth(H.addMonths(month, -1))}>
          <IconChevronLeft />
        </ActionIcon>
        <Title order={4}>{H.formatMonth(month)}</Title>
        <ActionIcon variant="subtle" color="gray" aria-label="Następny miesiąc" onClick={() => setMonth(H.addMonths(month, 1))}>
          <IconChevronRight />
        </ActionIcon>
        <Button ml="auto" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting === 'all'} disabled={q.isLoading || !employees.length} onClick={() => void exportAll()}>
          Pobierz zestawienie (Excel)
        </Button>
      </Group>

      {q.error && (
        <Alert color="red" mb="md">
          {errorMessage(q.error)}
        </Alert>
      )}
      {q.isFetching && <Progress value={100} animated size="xs" mb="sm" />}
      {report && !employees.length && !q.isFetching && <Alert color="blue">W tym miesiącu nie ma żadnych pracowników ani godzin.</Alert>}

      {employees.length > 0 && (
        <>
          <div className="ts-table-wrap">
            <table className="ts-table">
              <caption className="ts-sr-only">Zestawienie godzin za {H.formatMonth(month)}</caption>
              <thead>
                <tr>
                  <th scope="col" className="ts-col-name">
                    Pracownik
                  </th>
                  {days.map((d) => (
                    <th key={d} scope="col" className={`${H.isWeekend(d) ? 'ts-weekend' : ''} ${d === today ? 'ts-today' : ''}`}>
                      <div>{Number(d.slice(8, 10))}</div>
                      <div className="ts-dow">{H.DAY_SHORT[H.dayOfWeek(d)]}</div>
                    </th>
                  ))}
                  <th scope="col" className="ts-col-total">
                    Suma
                  </th>
                  <th scope="col">Excel</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <th scope="row" className="ts-col-name">
                      <div className="ts-name">{e.name}</div>
                      <div className="ts-sub">
                        {H.formatId(e.id)}
                        {!e.active && <span className="ts-inactive"> · nieaktywny</span>}
                      </div>
                    </th>
                    {days.map((d) => {
                      const entry = e.days[d]
                      return (
                        <td key={d} className={`${H.isWeekend(d) ? 'ts-weekend' : ''} ${entry ? 'ts-has-hours' : 'ts-zero'}`} title={cellTitle(entry)}>
                          {entry ? H.formatHours(entry.hours) : '·'}
                        </td>
                      )
                    })}
                    <td className="ts-col-total">{H.formatHours(e.total)}</td>
                    <td>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        loading={exporting === e.id}
                        aria-label={`Pobierz Excel dla ${e.name}`}
                        title={`Pobierz Excel dla ${e.name}`}
                        onClick={() => void exportEmployee(e)}
                      >
                        <IconFileSpreadsheet size={16} />
                      </ActionIcon>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="ts-col-name">
                    Razem
                  </th>
                  {days.map((d) => (
                    <td key={d} className={`${H.isWeekend(d) ? 'ts-weekend' : ''} ${dayTotal(d) ? '' : 'ts-zero'}`}>
                      {dayTotal(d) ? H.formatHours(dayTotal(d)) : '·'}
                    </td>
                  ))}
                  <td className="ts-col-total">{H.formatHours(grandTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <Text size="xs" c="dimmed" mt="xs">
            Najedź na komórkę, aby zobaczyć godziny od–do, przerwę i uwagi. Nieaktywni pracownicy są pokazywani tylko wtedy, gdy mają godziny w tym miesiącu.
          </Text>
        </>
      )}
    </div>
  )
}
