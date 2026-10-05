import { Alert, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useMe } from '../auth/AuthProvider'
import { daysUntil, formatDate } from '../lib/format'

export function DashboardPage() {
  const { t } = useTranslation()
  const project = useMe().projects[0]
  if (!project) return null
  const days = daysUntil(project.contractEndDate)
  return (
    <Stack>
      <Title order={2}>{t('dashboard.title')}</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            {t('dashboard.countdown')}
          </Text>
          <Group align="baseline" gap="xs">
            <Text fz={40} fw={700} c={days < 30 ? 'red' : days <= 90 ? 'yellow.7' : 'green'}>
              {days}
            </Text>
            <Text>{t('dashboard.calendarDays')}</Text>
          </Group>
          <Text size="sm">{t('app.contractDeadline', { date: formatDate(project.contractEndDate) })}</Text>
        </Card>
        <Card withBorder>
          <Text size="sm" c="dimmed">
            {t('dashboard.project')}
          </Text>
          <Text fw={600}>{project.name}</Text>
          <Text size="sm">
            {t('dashboard.client')}: {project.client}
          </Text>
          <Text size="sm">
            {t('dashboard.contract')}: {project.contractNo} · {t('dashboard.procurement')}: {project.procurementNo}
          </Text>
          <Text size="sm">
            {t('dashboard.dayZero')}: {project.dayZeroDate ? formatDate(project.dayZeroDate) : t('dashboard.dayZeroUnset')}
          </Text>
        </Card>
      </SimpleGrid>
      <Alert variant="light">{t('dashboard.moreTiles')}</Alert>
    </Stack>
  )
}
