import { AppShell, Badge, Box, Burger, Divider, Group, Image, Indicator, Menu, NavLink, ScrollArea, Text, TextInput, Tooltip, UnstyledButton, ActionIcon, Popover } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconBell,
  IconBuildingFactory2,
  IconCalendarWeek,
  IconTimeline,
  IconChecklist,
  IconClipboardCheck,
  IconFileText,
  IconFolder,
  IconGauge,
  IconHistory,
  IconLock,
  IconLogout,
  IconMail,
  IconReportAnalytics,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconShoppingCart,
  IconTransfer,
  IconTruck,
  IconAlertTriangle,
  IconUsers,
  IconUsersGroup,
  IconReplace,
  IconCoin,
  IconKey,
} from '@tabler/icons-react'
import type { ModuleKey } from '#shared'
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth, useMe } from '../auth/AuthProvider'
import { daysUntil, formatDate } from '../lib/format'
import { NAV, isInternal } from '../nav'
import { BuildInfo } from './BuildInfo'

const ICONS: Partial<Record<ModuleKey, typeof IconGauge>> = {
  dashboard: IconGauge,
  hrf: IconTimeline,
  weeklyPlan: IconCalendarWeek,
  purchases: IconShoppingCart,
  avizations: IconTruck,
  subcontractors: IconBuildingFactory2,
  acceptances: IconClipboardCheck,
  acceptanceDocs: IconChecklist,
  changes: IconReplace,
  risks: IconAlertTriangle,
  letters: IconMail,
  meetings: IconUsersGroup,
  documents: IconFolder,
  weeklyReport: IconReportAnalytics,
  weeklyReportInternal: IconReportAnalytics,
  penalties: IconCoin,
  arsanitFlows: IconTransfer,
  guarantees: IconShieldCheck,
  auditLog: IconHistory,
}

function Countdown() {
  const { t } = useTranslation()
  const project = useMe().projects[0]
  if (!project) return null
  const days = daysUntil(project.contractEndDate)
  // Kolor neutralny — ocena zagrożenia (prognoza vs termin) jest na kaflu Dashboardu.
  const color = days < 0 ? 'red' : 'navy'
  return (
    <Tooltip label={t('app.contractDeadline', { date: formatDate(project.contractEndDate) })}>
      <span style={{ flexShrink: 0 }}>
        <Badge size="lg" variant="light" color={color} data-testid="countdown" visibleFrom="sm" styles={{ label: { overflow: 'visible' } }}>
          {days >= 0 ? t('app.daysToDeadline', { count: days }) : t('app.deadlinePassed', { count: -days })}
        </Badge>
        <Badge size="md" variant="light" color={color} hiddenFrom="sm">
          {t('app.daysShort', { count: days })}
        </Badge>
      </span>
    </Tooltip>
  )
}

export function AppLayout() {
  const { t } = useTranslation()
  const { can, logout } = useAuth()
  const me = useMe()
  const location = useLocation()
  const [opened, { toggle, close }] = useDisclosure()
  const project = me.projects[0]

  // W menu tylko moduły już wdrożone (kolejne etapy pojawią się wraz z implementacją).
  const visible = NAV.filter((n) => n.ready && can(n.module, 'view'))
  const shared = visible.filter((n) => !isInternal(n.module))
  const internal = visible.filter((n) => isInternal(n.module) && n.module !== 'auditLog')
  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))

  const link = (n: (typeof NAV)[number]) => {
    const Icon = ICONS[n.module] ?? IconFileText
    return (
      <NavLink
        key={n.module}
        component={RouterLink}
        to={n.path}
        label={t(`nav.${n.module}`)}
        leftSection={<Icon size={18} stroke={1.6} />}
        rightSection={isInternal(n.module) ? <IconLock size={14} /> : undefined}
        active={isActive(n.path)}
        onClick={close}
      />
    )
  }

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Image src="/brand/envcheck-mark.svg" w={34} h={34} alt="Envcheck" />
            <Text fw={600} truncate visibleFrom="md" maw={420}>
              {project?.name ?? t('app.name')}
            </Text>
          </Group>
          <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Countdown />
            <TextInput
              placeholder={t('app.search')}
              leftSection={<IconSearch size={16} />}
              visibleFrom="xl"
              w={220}
              disabled
              aria-label={t('app.search')}
            />
            <Popover position="bottom-end" withArrow>
              <Popover.Target>
                <Indicator disabled offset={4}>
                  <ActionIcon variant="subtle" size="lg" aria-label={t('app.notifications')}>
                    <IconBell size={20} />
                  </ActionIcon>
                </Indicator>
              </Popover.Target>
              <Popover.Dropdown>
                <Text size="sm" c="dimmed">
                  {t('app.noNotifications')}
                </Text>
              </Popover.Dropdown>
            </Popover>
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <UnstyledButton aria-label={t('app.profile')}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500} visibleFrom="sm" truncate maw={200}>
                      {me.user.name}
                    </Text>
                    <Badge variant="outline" size="sm" style={{ flexShrink: 0 }} styles={{ label: { overflow: 'visible' } }}>
                      {t(`roles.${me.user.role}`)}
                    </Badge>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me.user.email}</Menu.Label>
                <Box hiddenFrom="lg" px="sm" pb={4}>
                  <BuildInfo />
                </Box>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => void logout()}>
                  {t('app.logout')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Box visibleFrom="lg">
              <BuildInfo />
            </Box>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {shared.map(link)}
          {internal.length > 0 && (
            <>
              <Divider my="xs" label={<Group gap={4}><IconLock size={12} />{t('app.internalSection')}</Group>} labelPosition="left" />
              {internal.map(link)}
            </>
          )}
          {can('admin', 'view') && (
            <>
              <Divider my="xs" label={t('nav.admin')} labelPosition="left" />
              <NavLink component={RouterLink} to="/admin/users" label={t('nav.adminUsers')} leftSection={<IconUsers size={18} />} active={isActive('/admin/users')} onClick={close} />
              <NavLink component={RouterLink} to="/admin/permissions" label={t('nav.adminPermissions')} leftSection={<IconKey size={18} />} active={isActive('/admin/permissions')} onClick={close} />
              <NavLink component={RouterLink} to="/admin/repozytorium" label={t('nav.adminDocuments')} leftSection={<IconFolder size={18} />} active={isActive('/admin/repozytorium')} onClick={close} />
              <NavLink component={RouterLink} to="/admin/settings" label={t('nav.adminSettings')} leftSection={<IconSettings size={18} />} active={isActive('/admin/settings')} onClick={close} />
            </>
          )}
          {can('auditLog', 'view') && (
            <NavLink component={RouterLink} to="/admin/audit" label={t('nav.auditLog')} leftSection={<IconHistory size={18} />} active={isActive('/admin/audit')} onClick={close} />
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}
