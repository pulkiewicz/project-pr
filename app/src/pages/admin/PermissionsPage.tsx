import { Button, Checkbox, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACTIONS, MODULE_KEYS, ROLES, type PermissionEntry } from '#shared'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'

const key = (e: Pick<PermissionEntry, 'role' | 'module' | 'action'>) => `${e.role}|${e.module}|${e.action}`

export function PermissionsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'permissions'], queryFn: () => api<PermissionEntry[]>('/admin/permissions') })
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map())

  const current = useMemo(() => new Map(query.data?.map((e) => [key(e), e.allowed])), [query.data])
  const value = (k: string) => draft.get(k) ?? current.get(k) ?? false

  const save = useMutation({
    mutationFn: () =>
      api<{ changed: number }>('/admin/permissions', {
        method: 'PUT',
        json: {
          entries: [...draft].map(([k, allowed]) => {
            const [role, module, action] = k.split('|')
            return { role, module, action, allowed }
          }),
        },
      }),
    onSuccess: (r) => {
      notifications.show({ color: 'green', message: t('permissions.changed', { count: r.changed }) })
      setDraft(new Map())
      void qc.invalidateQueries({ queryKey: ['admin', 'permissions'] })
    },
    onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
  })

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('permissions.title')}</Title>
        <Group>
          <Button variant="default" disabled={!draft.size} onClick={() => setDraft(new Map())}>
            {t('app.cancel')}
          </Button>
          <Button disabled={!draft.size} loading={save.isPending} onClick={() => save.mutate()}>
            {t('app.save')} {draft.size ? `(${draft.size})` : ''}
          </Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        {t('permissions.hint')}
      </Text>
      <Table.ScrollContainer minWidth={1100}>
        <Table withTableBorder withColumnBorders stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th rowSpan={2}>{t('permissions.module')}</Table.Th>
              {ROLES.map((r) => (
                <Table.Th key={r} colSpan={ACTIONS.length} ta="center">
                  {t(`roles.${r}`)}
                </Table.Th>
              ))}
            </Table.Tr>
            <Table.Tr>
              {ROLES.flatMap((r) =>
                ACTIONS.map((a) => (
                  <Table.Th key={`${r}${a}`} ta="center" p={2}>
                    <Tooltip label={t(`actions.${a}`)}>
                      <Text size="xs">{t(`actions.${a}`).slice(0, 1)}</Text>
                    </Tooltip>
                  </Table.Th>
                )),
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {MODULE_KEYS.map((m) => (
              <Table.Tr key={m}>
                <Table.Td>
                  <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                    {t(`nav.${m}`)}
                  </Text>
                </Table.Td>
                {ROLES.flatMap((r) =>
                  ACTIONS.map((a) => {
                    const k = key({ role: r, module: m, action: a })
                    const changed = draft.has(k)
                    return (
                      <Table.Td key={k} ta="center" p={2} bg={changed ? 'yellow.1' : undefined}>
                        <Checkbox
                          size="xs"
                          aria-label={`${r} ${m} ${a}`}
                          checked={value(k)}
                          onChange={(e) => {
                            const next = new Map(draft)
                            const v = e.currentTarget.checked
                            if (current.get(k) === v) next.delete(k)
                            else next.set(k, v)
                            setDraft(next)
                          }}
                          styles={{ body: { justifyContent: 'center' } }}
                        />
                      </Table.Td>
                    )
                  }),
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  )
}
