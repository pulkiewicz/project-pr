import { Badge, Card, Group, Text, UnstyledButton } from '@mantine/core'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import type { ContractType, StaffIssue, StaffIssueSeverity } from '#shared'
import { formatDate } from '../../lib/format'

export const SEVERITY_RANK: Record<StaffIssueSeverity, number> = { red: 0, orange: 1, yellow: 2, gray: 3 }
export const SEVERITY_COLOR: Record<StaffIssueSeverity, string> = { red: 'red', orange: 'orange', yellow: 'yellow', gray: 'gray' }

export function worstIssue(issues: StaffIssue[]): StaffIssue | null {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0] ?? null
}

/** Opis problemu z umową / płatnościami (Koszty pracownicze, Pracownicy). */
export function useIssueText() {
  const { t } = useTranslation()
  return (i: StaffIssue, today: string) =>
    t(`staffCosts.issue.${i.code}`, {
      date: i.date ? formatDate(i.date) : '',
      month: i.month ? dayjs(`${i.month}-01`).locale('pl').format('MMMM YYYY') : '',
      days: i.date ? dayjs(i.date).diff(dayjs(today), 'day') : 0,
    })
}

export interface IssuePerson {
  employeeId: string
  name: string
  contractType: ContractType | null
  issues: StaffIssue[]
}

/** Karta „Umowy i płatności do sprawdzenia”: problemy wszystkich osób, od najpilniejszych; klik — karta pracownika. */
export function StaffIssuesCard({ people, today, onOpen }: { people: IssuePerson[]; today: string; onOpen?: (employeeId: string) => void }) {
  const { t } = useTranslation()
  const issueText = useIssueText()
  const list = people.flatMap((p) => p.issues.map((issue) => ({ p, issue }))).sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity])
  if (!list.length) return null
  return (
    <Card withBorder padding="sm">
      <Text size="sm" fw={600} mb="xs">
        {t('staffCosts.issuesTitle')}
      </Text>
      {list.map(({ p, issue }, i) => (
        <UnstyledButton key={i} display="block" w="100%" py={3} onClick={onOpen ? () => onOpen(p.employeeId) : undefined} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" color={SEVERITY_COLOR[issue.severity]} variant={issue.severity === 'red' ? 'filled' : 'light'} w={14} p={0} circle>
              {' '}
            </Badge>
            <Text size="sm" fw={500} miw={180}>
              {p.name}{' '}
              <Text span size="xs" c="dimmed">
                {p.contractType ? t(`employees.contractShort.${p.contractType}`) : ''}
              </Text>
            </Text>
            <Text size="sm">{issueText(issue, today)}</Text>
          </Group>
        </UnstyledButton>
      ))}
    </Card>
  )
}
