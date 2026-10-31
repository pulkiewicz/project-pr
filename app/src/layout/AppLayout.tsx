import { AppShell, Badge, Box, Burger, Divider, Group, Image, Indicator, Menu, NavLink, ScrollArea, Text, TextInput, Tooltip, UnstyledButton, ActionIcon, Popover } from '@mantine/core'
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks'
import {
  IconAddressBook,
  IconAlertTriangle,
  IconBell,
  IconBooks,
  IconBuildingFactory2,
  IconCalculator,
  IconCalendarWeek,
  IconCar,
  IconChecklist,
  IconClipboardCheck,
  IconCoin,
  IconFileText,
  IconFolder,
  IconGauge,
  IconHistory,
  IconHome,
  IconId,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLock,
  IconLogout,
  IconMail,
  IconReceipt,
  IconReplace,
  IconReportAnalytics,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconShoppingCart,
  IconTimeline,
  IconTransfer,
  IconTruck,
  IconUsers,
  IconUsersGroup,
} from '@tabler/icons-react'
import type { ModuleKey } from '#shared'
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth, useMe } from '../auth/AuthProvider'
import { daysUntil, formatDate } from '../lib/format'
import { projectPath, useCurrentProject } from '../lib/project'
import { FINANCE_NAV, MANAGEMENT_NAV, PROJECT_NAV, SALES_NAV, isInternal, projectHomePath } from '../nav'
import { BuildInfo } from './BuildInfo'
import { ErrorBoundary } from './ErrorBoundary'

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
  weeklyReport: IconReportAnalytics,
  weeklyReportInternal: IconReportAnalytics,
  penalties: IconCoin,
  arsanitFlows: IconTransfer,
  guarantees: IconShieldCheck,
  auditLog: IconHistory,
  crm: IconAddressBook,
  quotes: IconCalculator,
  quoteKnowledge: IconBooks,
  invoices: IconReceipt,
  employees: IconId,
  fleet: IconCar,
}

function Countdown() {
  const { t } = useTranslation()
  const project = useCurrentProject()
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
  const project = useCurrentProject()

  // Moduły projektu: tylko wdrożone (kolejne etapy pojawią się wraz z implementacją).
  // Dashboard projektu = sama pozycja projektu w menu.
  const visible = PROJECT_NAV.filter((n) => n.ready && n.path && can(n.module, 'view'))
  const shared = visible.filter((n) => !isInternal(n.module))
  const internal = visible.filter((n) => isInternal(n.module))
  // Sprzedaż: także moduły zapowiedziane (z etapem), żeby było widać docelową strukturę.
  const sales = SALES_NAV.filter((n) => can(n.module, 'view'))
  const finance = FINANCE_NAV.filter((n) => can(n.module, 'view'))
  const management = MANAGEMENT_NAV.filter((n) => can(n.module, 'view'))
  const norm = (p: string) => p.replace(/\/+$/, '') || '/'
  const isActive = (path: string, exact = false) => (path === '/' || exact ? norm(location.pathname) === norm(path) : location.pathname.startsWith(path))

  const item = (key: string, to: string, label: string, Icon: typeof IconGauge, internalMark = false, opts: { exact?: boolean; indent?: boolean; badge?: string } = {}) => {
    const nav = (
      <NavLink
        key={key}
        component={RouterLink}
        to={to}
        label={collapsed ? undefined : label}
        aria-label={label}
        leftSection={<Icon size={collapsed ? 20 : 18} stroke={1.6} />}
        rightSection={
          collapsed ? undefined : opts.badge ? (
            <Badge size="xs" variant="light" color="gray">
              {opts.badge}
            </Badge>
          ) : internalMark ? (
            <IconLock size={14} />
          ) : undefined
        }
        active={isActive(to, opts.exact)}
        onClick={close}
        styles={
          collapsed
            ? { root: { justifyContent: 'center', paddingInline: 0 }, section: { marginInlineEnd: 0 }, body: { display: 'none' } }
            : opts.indent
              ? { root: { paddingInlineStart: 28 } }
              : undefined
        }
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
  const projectLink = (code: string) => (n: (typeof PROJECT_NAV)[number]) =>
    item(`${code}-${n.module}`, projectPath(code, n.path), t(`nav.${n.module}`), ICONS[n.module] ?? IconFileText, isInternal(n.module), { indent: true })
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
              {project ? `${project.code} · ${project.name}` : t('app.name')}
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
          {item('home', '/', t('home.title'), IconHome)}
          {me.projects.length > 0 && section(t('nav.projects'))}
          {me.projects.map((p) => (
            <Box key={p.id}>
              {item(`project-${p.id}`, projectHomePath(p.code, can), p.code, IconFolder, false, { exact: true })}
              {project?.id === p.id && (
                <>
                  {shared.map(projectLink(p.code))}
                  {internal.length > 0 && (
                    <>
                      {!collapsed && (
                        <Group gap={4} pl={28} mt={6} mb={2}>
                          <IconLock size={12} />
                          <Text size="xs" c="dimmed">
                            {t('app.internalSection')}
                          </Text>
                        </Group>
                      )}
                      {internal.map(projectLink(p.code))}
                    </>
                  )}
                </>
              )}
            </Box>
          ))}
          {sales.length > 0 && (
            <>
              {section(t('nav.sales'))}
              {sales.map((n) => item(n.module, n.path, t(`nav.${n.module}`), ICONS[n.module] ?? IconFileText, false, { badge: n.ready ? undefined : n.stage }))}
            </>
          )}
          {finance.length > 0 && (
            <>
              {section(t('nav.finance'))}
              {finance.map((n) => item(n.module, n.path, t(`nav.${n.module}`), ICONS[n.module] ?? IconFileText))}
            </>
          )}
          {management.length > 0 && (
            <>
              {section(t('nav.management'))}
              {management.map((n) => item(n.module, n.path, t(`nav.${n.module}`), ICONS[n.module] ?? IconFileText))}
            </>
          )}
          {can('admin', 'view') && (
            <>
              {section(t('nav.admin'))}
              {item('admin-users', '/admin/users', t('nav.adminUsers'), IconUsers)}
              {item('admin-projects', '/admin/projects', t('nav.adminProjects'), IconFolder)}
              {item('admin-permissions', '/admin/permissions', t('nav.adminPermissions'), IconKey)}
              {item('admin-settings', '/admin/settings', t('nav.adminSettings'), IconSettings)}
            </>
          )}
          {can('auditLog', 'view') && (
            item('audit', '/admin/audit', t('nav.auditLog'), IconHistory)
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </AppShell.Main>
    </AppShell>
  )
}
