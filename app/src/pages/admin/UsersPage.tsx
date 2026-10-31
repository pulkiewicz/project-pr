import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Menu,
  Modal,
  Radio,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconDots, IconUserPlus } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ROLES, USER_ACCESS_MODES, isStaffRole, type Role, type TempPasswordResponse, type UserAccessMode, type UserCreatedResponse, type UserDto } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { ApiError, api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'

interface FormState {
  id?: string
  version?: number
  email: string
  name: string
  role: Role
  subcontractorId: string
  isActive: boolean
  taskReminders: boolean
  access: UserAccessMode
  initialPassword: string
  projectIds: string[]
}

interface Credentials {
  name: string
  email: string
  password: string
}

const emptyForm: FormState = { email: '', name: '', role: 'EnvcheckInternal', subcontractorId: '', isActive: true, taskReminders: true, access: 'password', initialPassword: '', projectIds: [] }

const ACCESS_LABEL = { password: 'users.accessPassword', invite: 'users.accessInvite', none: 'users.accessNone' } as const
const ACCESS_HINT = { password: 'users.accessPasswordHint', invite: 'users.accessInviteHint', none: 'users.accessNoneHint' } as const

/** Jednorazowy podgląd hasła tymczasowego do przekazania użytkownikowi. */
function CredentialsModal({ credentials, onClose }: { credentials: Credentials | null; onClose: () => void }) {
  const { t } = useTranslation()
  const url = window.location.origin
  const all = credentials ? `${t('users.loginUrl')}: ${url}\n${t('users.email')}: ${credentials.email}\n${t('users.initialPassword')}: ${credentials.password}` : ''
  return (
    <Modal opened={!!credentials} onClose={onClose} title={t('users.credentialsTitle')} closeOnClickOutside={false}>
      {credentials && (
        <Stack>
          <Text size="sm" fw={500}>
            {credentials.name}
          </Text>
          <Alert color="yellow">{t('users.credentialsHint')}</Alert>
          <Text size="sm">
            {t('users.loginUrl')}: <Code>{url}</Code>
          </Text>
          <Text size="sm">
            {t('users.email')}: <Code>{credentials.email}</Code>
          </Text>
          <Group gap="xs">
            <Text size="sm">{t('users.initialPassword')}:</Text>
            <Code fz="md" data-testid="temp-password">
              {credentials.password}
            </Code>
            <CopyButton value={credentials.password}>
              {({ copied, copy }) => (
                <Button size="compact-xs" variant="light" onClick={copy}>
                  {copied ? t('mfa.copied') : t('mfa.copy')}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Group justify="flex-end">
            <CopyButton value={all}>
              {({ copied, copy }) => (
                <Button variant="default" onClick={copy}>
                  {copied ? t('mfa.copied') : t('users.copyAll')}
                </Button>
              )}
            </CopyButton>
            <Button onClick={onClose}>{t('users.done')}</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

export function UsersPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const projectCode = new Map(me.projects.map((p) => [p.id, p.code]))
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<UserDto[]>('/admin/users') })
  const [form, setForm] = useState<FormState | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)

  const save = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api<UserDto>(`/admin/users/${f.id}`, {
            method: 'PATCH',
            json: { name: f.name, role: f.role, subcontractorId: f.subcontractorId || null, isActive: f.isActive, taskReminders: f.taskReminders, projectIds: f.projectIds, version: f.version },
          })
        : api<UserCreatedResponse>('/admin/users', {
            method: 'POST',
            json: {
              email: f.email,
              name: f.name,
              role: f.role,
              subcontractorId: f.subcontractorId || null,
              access: f.access,
              initialPassword: f.access === 'password' && f.initialPassword ? f.initialPassword : undefined,
              projectIds: f.projectIds,
            },
          }),
    onSuccess: (r, f) => {
      if (f.id) notifications.show({ color: 'green', message: t('app.saved') })
      else {
        const created = r as UserCreatedResponse
        const msg = {
          password_set: t('users.passwordSet'),
          sent: t('users.inviteSent'),
          exists: t('users.inviteExists'),
          skipped: t('users.inviteSkipped'),
          failed: t('users.inviteFailed', { error: created.inviteError ?? '' }),
        }[created.inviteStatus]
        notifications.show({ color: created.inviteStatus === 'failed' ? 'yellow' : 'green', message: msg, autoClose: created.inviteStatus === 'failed' ? false : 6000 })
        if (created.initialPassword) setCredentials({ name: created.name, email: created.email, password: created.initialPassword })
      }
      setForm(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && e.problem.current) {
        const cur = e.problem.current as UserDto
        notifications.show({ color: 'yellow', message: t('users.conflict') })
        setForm(toForm(cur))
        void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
        return
      }
      notifications.show({ color: 'red', message: errorMessage(e) })
    },
  })

  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'reset-mfa' | 'resend-invite' }) => api(`/admin/users/${id}/${kind}`, { method: 'POST' }),
    onSuccess: () => {
      notifications.show({ color: 'green', message: t('app.saved') })
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
  })

  const tempPassword = useMutation({
    mutationFn: (u: UserDto) => api<TempPasswordResponse>(`/admin/users/${u.id}/temp-password`, { method: 'POST', json: {} }),
    onSuccess: (r) => {
      setCredentials({ name: r.user.name, email: r.user.email, password: r.password })
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
  })

  const confirmTempPassword = (u: UserDto) =>
    modals.openConfirmModal({
      title: t('users.setTempPassword'),
      children: <Text size="sm">{t('users.setTempPasswordConfirm', { name: u.name })}</Text>,
      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
      onConfirm: () => tempPassword.mutate(u),
    })

  const toForm = (u: UserDto): FormState => ({
    id: u.id,
    version: u.version,
    email: u.email,
    name: u.name,
    role: u.role,
    subcontractorId: u.subcontractorId ?? '',
    isActive: u.isActive,
    taskReminders: u.taskReminders,
    access: 'none',
    initialPassword: '',
    projectIds: u.projectIds,
  })

  const confirmReset = (u: UserDto) =>
    modals.openConfirmModal({
      title: t('users.resetMfa'),
      children: <Text size="sm">{t('users.resetMfaConfirm', { name: u.name })}</Text>,
      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => action.mutate({ id: u.id, kind: 'reset-mfa' }),
    })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('users.title')}</Title>
        {can('admin', 'create') && (
          <Button leftSection={<IconUserPlus size={16} />} onClick={() => setForm(emptyForm)}>
            {t('users.invite')}
          </Button>
        )}
      </Group>
      <Table.ScrollContainer minWidth={800}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('users.name')}</Table.Th>
              <Table.Th>{t('users.email')}</Table.Th>
              <Table.Th>{t('users.role')}</Table.Th>
              <Table.Th>{t('users.party')}</Table.Th>
              <Table.Th>{t('users.projects')}</Table.Th>
              <Table.Th>{t('users.status')}</Table.Th>
              <Table.Th>{t('users.mfa')}</Table.Th>
              <Table.Th>{t('users.lastLogin')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.data?.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>{t(`roles.${u.role}`)}</Table.Td>
                <Table.Td>{u.party}</Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  {isStaffRole(u.role) ? (
                    <Text size="sm" c="dimmed">
                      {t('users.projectsAllShort')}
                    </Text>
                  ) : (
                    u.projectIds.map((id) => projectCode.get(id) ?? '?').join(', ') || '—'
                  )}
                </Table.Td>
                <Table.Td>
                  {!u.isActive ? (
                    <Badge color="gray">{t('users.inactive')}</Badge>
                  ) : u.mustChangePassword ? (
                    <Badge color="yellow">{t('users.tempPasswordBadge')}</Badge>
                  ) : u.identityLinked ? (
                    <Badge color="green">{t('users.active')}</Badge>
                  ) : (
                    <Badge color="yellow">{t('users.pending')}</Badge>
                  )}
                  {u.isActive && !u.taskReminders && (
                    <Badge color="gray" variant="outline" ml={4}>
                      {t('users.noTaskReminders')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{u.totpEnabled ? <Badge color="green">✓</Badge> : <Badge color="gray">—</Badge>}</Table.Td>
                <Table.Td>{formatDateTime(u.lastLoginAt)}</Table.Td>
                <Table.Td>
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="menu">
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setForm(toForm(u))}>{t('users.edit')}</Menu.Item>
                      <Menu.Item disabled={!u.totpEnabled} onClick={() => confirmReset(u)}>
                        {t('users.resetMfa')}
                      </Menu.Item>
                      {can('admin', 'edit') && (
                        <Menu.Item disabled={!u.isActive} onClick={() => confirmTempPassword(u)}>
                          {t('users.setTempPassword')}
                        </Menu.Item>
                      )}
                      <Menu.Item disabled={u.identityLinked} onClick={() => action.mutate({ id: u.id, kind: 'resend-invite' })}>
                        {t('users.resendInvite')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.id ? t('users.edit') : t('users.invite')}>
        {form && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate(form)
            }}
          >
            <Stack>
              <TextInput label={t('users.email')} type="email" required disabled={!!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} />
              <TextInput label={t('users.name')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
              <Select
                label={t('users.role')}
                data={ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
                value={form.role}
                allowDeselect={false}
                onChange={(v) => v && setForm({ ...form, role: v as Role })}
              />
              {form.role === 'Subcontractor' && (
                <TextInput label={t('users.subcontractorId')} required value={form.subcontractorId} onChange={(e) => setForm({ ...form, subcontractorId: e.currentTarget.value })} />
              )}
              {isStaffRole(form.role) ? (
                <Text size="sm" c="dimmed">
                  {t('users.projectsAll')}
                </Text>
              ) : (
                <MultiSelect
                  label={t('users.projects')}
                  description={t('users.projectsHint')}
                  data={me.projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                  value={form.projectIds}
                  onChange={(v) => setForm({ ...form, projectIds: v })}
                  searchable
                  data-testid="user-projects"
                />
              )}
              {!form.id && (
                <Radio.Group label={t('users.access')} value={form.access} onChange={(v) => setForm({ ...form, access: v as UserAccessMode })}>
                  <Stack gap="xs" mt="xs">
                    {USER_ACCESS_MODES.map((m) => (
                      <Radio key={m} value={m} label={t(ACCESS_LABEL[m])} description={t(ACCESS_HINT[m])} />
                    ))}
                  </Stack>
                </Radio.Group>
              )}
              {!form.id && form.access === 'password' && (
                <TextInput
                  label={t('users.initialPassword')}
                  description={t('users.initialPasswordHint')}
                  autoComplete="off"
                  minLength={12}
                  value={form.initialPassword}
                  onChange={(e) => setForm({ ...form, initialPassword: e.currentTarget.value })}
                />
              )}
              {form.id && <Switch label={t('users.active')} checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })} />}
              {form.id && (
                <Switch
                  label={t('users.taskReminders')}
                  description={t('users.taskRemindersHint')}
                  checked={form.taskReminders}
                  onChange={(e) => setForm({ ...form, taskReminders: e.currentTarget.checked })}
                />
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setForm(null)}>
                  {t('app.cancel')}
                </Button>
                <Button type="submit" loading={save.isPending}>
                  {t('app.save')}
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
      <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
    </Stack>
  )
}
