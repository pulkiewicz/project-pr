import { AppShell, Badge, Box, Burger, Divider, Group, Image, Indicator, Menu, NavLink, ScrollArea, Text, TextInput, Tooltip, UnstyledButton, ActionIcon, Popover } from '@mantine/core'
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks'
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
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
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
  // Zwinięte menu (pasek ikon) — tylko na komputerze; stan zapamiętany w przeglądarce.
  const [collapsedPref, setCollapsed] = useLocalStorage({ key: 'pmo_nav_collapsed', defaultValue: false })
  const desktop = useMediaQuery('(min-width: 48em)')
  const collapsed = collapsedPref && !!desktop
  const project = me.projects[0]

  // W menu tylko moduły już wdrożone (kolejne etapy pojawią się wraz z implementacją).
  const visible = NAV.filter((n) => n.ready && can(n.module, 'view'))
  const shared = visible.filter((n) => !isInternal(n.module))
  const internal = visible.filter((n) => isInternal(n.module) && n.module !== 'auditLog')
  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))

  const item = (key: string, to: string, label: string, Icon: typeof IconGauge, internalMark = false) => {
    const nav = (
      <NavLink
        key={key}
        component={RouterLink}
        to={to}
        label={collapsed ? undefined : label}
        aria-label={label}
        leftSection={<Icon size={collapsed ? 20 : 18} stroke={1.6} />}
        rightSection={!collapsed && internalMark ? <IconLock size={14} /> : undefined}
        active={isActive(to)}
        onClick={close}
        styles={collapsed ? { root: { justifyContent: 'center', paddingInline: 0 }, section: { marginInlineEnd: 0 }, body: { display: 'none' } } : undefined}
      />
    )
    return collapsed ? (
      <Tooltip key={key} label={label} position="right" withArrow>
        {nav}
      </Tooltip>
    ) : (
      nav
    )
  }
  const link = (n: (typeof NAV)[number]) => item(n.module, n.path, t(`nav.${n.module}`), ICONS[n.module] ?? IconFileText, isInternal(n.module))
  const section = (label: React.ReactNode) => (collapsed ? <Divider my="xs" /> : <Divider my="xs" label={label} labelPosition="left" />)

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: collapsed ? 64 : 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
      transitionDuration={150}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Tooltip label={t(collapsedPref ? 'app.expandMenu' : 'app.collapseMenu')}>
              <ActionIcon variant="subtle" size="lg" visibleFrom="sm" onClick={() => setCollapsed(!collapsedPref)} aria-label={t(collapsedPref ? 'app.expandMenu' : 'app.collapseMenu')} data-testid="nav-toggle">
                {collapsedPref ? <IconLayoutSidebarLeftExpand size={20} /> : <IconLayoutSidebarLeftCollapse size={20} />}
              </ActionIcon>
            </Tooltip>
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

      <AppShell.Navbar p={collapsed ? 6 : 'xs'}>
        <AppShell.Section grow component={ScrollArea}>
          {shared.map(link)}
          {internal.length > 0 && (
            <>
              {section(<Group gap={4}><IconLock size={12} />{t('app.internalSection')}</Group>)}
              {internal.map(link)}
            </>
          )}
          {can('admin', 'view') && (
            <>
              {section(t('nav.admin'))}
              {item('admin-users', '/admin/users', t('nav.adminUsers'), IconUsers)}
              {item('admin-permissions', '/admin/permissions', t('nav.adminPermissions'), IconKey)}
              {item('admin-docs', '/admin/repozytorium', t('nav.adminDocuments'), IconFolder)}
              {item('admin-settings', '/admin/settings', t('nav.adminSettings'), IconSettings)}
            </>
          )}
          {can('auditLog', 'view') && (
            item('audit', '/admin/audit', t('nav.auditLog'), IconHistory)
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}
