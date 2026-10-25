import { Alert, Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconArrowRight } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { useAuth, useMe } from '../auth/AuthProvider'
import { NoResponseBadge } from '../features/crm/stage'
import { useOpportunities } from '../features/crm/api'
import { daysUntil, formatDate, todayWarsaw } from '../lib/format'
import { SALES_NAV, projectHomePath } from '../nav'

/** Przypomnienia CRM: moje (lub bez opiekuna) oferty bez odpowiedzi i zaległe „dalsze działania”. */
function CrmReminders() {
  const { t } = useTranslation()
  const me = useMe()
  const q = useOpportunities()
  const today = todayWarsaw()
  const items = (q.data ?? []).filter(
    (o) =>
      (o.ownerId === me.user.id || !o.ownerId) &&
      !['won', 'lost', 'on_hold'].includes(o.stage) &&
      (o.noResponse || (o.nextStepDate !== null && o.nextStepDate <= today)),
  )
  if (!items.length) return null
  return (
    <Card withBorder data-testid="crm-reminders">
      <Text fw={600} mb="xs">
        {t('home.reminders', { count: items.length })}
      </Text>
      <Stack gap={4}>
        {items.slice(0, 10).map((o) => (
          <Group key={o.id} gap="xs" wrap="nowrap">
            <Anchor component={Link} to={`/crm?szansa=${o.id}`} size="sm" fw={600} style={{ flexShrink: 0 }}>
              {o.code}
            </Anchor>
            <Text size="sm" truncate>
              {o.name}
              {o.companyName ? ` · ${o.companyName}` : ''}
            </Text>
            {o.noResponse ? (
              <NoResponseBadge />
            ) : (
              <Badge size="xs" color="red" variant="outline" style={{ flexShrink: 0 }}>
                {formatDate(o.nextStepDate)}
              </Badge>
            )}
          </Group>
        ))}
      </Stack>
      {items.length > 10 && (
        <Anchor component={Link} to="/crm" size="sm" mt="xs">
          {t('home.remindersMore', { count: items.length - 10 })}
        </Anchor>
      )}
    </Card>
  )
}

/** Pulpit Envcheck Hub: projekty użytkownika i (dla pracowników Envcheck) sprzedaż. */
export function HomePage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const sales = SALES_NAV.filter((n) => can(n.module, 'view'))

  // Użytkownik zewnętrzny z jednym projektem trafia od razu do jego dashboardu (jak przed Envcheck Hub).
  if (!sales.length && me.projects.length === 1) return <Navigate to={projectHomePath(me.projects[0]!.code, can)} replace />

  return (
    <Stack>
      <Title order={2}>{t('home.title')}</Title>
      <Title order={4}>{t('nav.projects')}</Title>
      {me.projects.length === 0 ? (
        <Alert variant="light">{t('home.noProjects')}</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
          {me.projects.map((p) => {
            const days = daysUntil(p.contractEndDate)
            return (
              <Card key={p.id} withBorder data-testid={`project-${p.code}`}>
                <Group justify="space-between" wrap="nowrap" mb="xs">
                  <Badge variant="light">{p.code}</Badge>
                  <Badge variant="outline" color={days < 0 ? 'red' : 'navy'}>
                    {days >= 0 ? t('app.daysToDeadline', { count: days }) : t('app.deadlinePassed', { count: -days })}
                  </Badge>
                </Group>
                <Text fw={600}>{p.name}</Text>
                <Text size="sm" c="dimmed">
                  {p.client}
                </Text>
                <Text size="sm" mt="xs">
                  {t('app.contractDeadline', { date: formatDate(p.contractEndDate) })}
                </Text>
                <Button component={Link} to={projectHomePath(p.code, can)} variant="light" mt="md" rightSection={<IconArrowRight size={16} />}>
                  {t('home.openProject')}
                </Button>
              </Card>
            )
          })}
        </SimpleGrid>
      )}
      {sales.length > 0 && (
        <>
          <Title order={4} mt="md">
            {t('nav.sales')}
          </Title>
          {can('crm', 'view') && <CrmReminders />}
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            {sales.map((n) => (
              <Card key={n.module} withBorder component={Link} to={n.path}>
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600}>{t(`nav.${n.module}`)}</Text>
                  {!n.ready && (
                    <Badge color="gray" variant="light" style={{ flexShrink: 0 }}>
                      {n.stage}
                    </Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed" mt={4}>
                  {t(`home.salesHint.${n.module}`)}
                </Text>
              </Card>
            ))}
          </SimpleGrid>
        </>
      )}
    </Stack>
  )
}
