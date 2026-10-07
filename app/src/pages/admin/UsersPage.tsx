import { ActionIcon, Badge, Button, Checkbox, Group, Menu, Modal, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconDots, IconUserPlus } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ROLES, type Role, type UserCreatedResponse, type UserDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
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
  sendInvite: boolean
}

const emptyForm: FormState = { email: '', name: '', role: 'EnvcheckInternal', subcontractorId: '', isActive: true, sendInvite: true }

export function UsersPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<UserDto[]>('/admin/users') })
  const [form, setForm] = useState<FormState | null>(null)

  const save = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? api<UserDto>(`/admin/users/${f.id}`, {
            method: 'PATCH',
            json: { name: f.name, role: f.role, subcontractorId: f.subcontractorId || null, isActive: f.isActive, version: f.version },
          })
        : api<UserCreatedResponse>('/admin/users', {
            method: 'POST',
            json: { email: f.email, name: f.name, role: f.role, subcontractorId: f.subcontractorId || null, sendInvite: f.sendInvite },
          }),
    onSuccess: (r, f) => {
      if (f.id) notifications.show({ color: 'green', message: t('app.saved') })
      else {
        const created = r as UserCreatedResponse
        const msg = {
          sent: t('users.inviteSent'),
          exists: t('users.inviteExists'),
          skipped: t('users.inviteSkipped'),
          failed: t('users.inviteFailed', { error: created.inviteError ?? '' }),
        }[created.inviteStatus]
        notifications.show({ color: created.inviteStatus === 'failed' ? 'yellow' : 'green', message: msg, autoClose: created.inviteStatus === 'failed' ? false : 6000 })
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

  const toForm = (u: UserDto): FormState => ({
    id: u.id,
    version: u.version,
    email: u.email,
    name: u.name,
    role: u.role,
    subcontractorId: u.subcontractorId ?? '',
    isActive: u.isActive,
    sendInvite: false,
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
                <Table.Td>
                  {!u.isActive ? (
                    <Badge color="gray">{t('users.inactive')}</Badge>
                  ) : u.identityLinked ? (
                    <Badge color="green">{t('users.active')}</Badge>
                  ) : (
                    <Badge color="yellow">{t('users.pending')}</Badge>
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
              {!form.id && (
                <Checkbox label={t('users.sendInvite')} description={t('users.sendInviteHint')} checked={form.sendInvite} onChange={(e) => setForm({ ...form, sendInvite: e.currentTarget.checked })} />
              )}
              {form.id && <Switch label={t('users.active')} checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })} />}
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
    </Stack>
  )
}
