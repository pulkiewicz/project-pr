import { ActionIcon, Avatar, Button, Group, Loader, Paper, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconMessage, IconSend, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { useCostCommentMutation, useCostComments } from './api'

const initials = (name: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

/** Historia komentarzy pozycji kosztorysu (od najstarszego) z autorem i datą oraz pole nowego komentarza. */
export function CostComments({ itemId }: { itemId: string }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useCostComments(itemId)
  const m = useCostCommentMutation(itemId)
  const [body, setBody] = useState('')
  const onError = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

  const send = () => {
    if (!body.trim()) return
    m.mutate({ body: body.trim() }, { onSuccess: () => setBody(''), onError })
  }

  return (
    <Stack gap="xs">
      {q.isLoading ? (
        <Loader size="sm" />
      ) : !q.data?.length ? (
        <Text size="xs" c="dimmed">
          {t('costEstimate.comments.empty')}
        </Text>
      ) : (
        q.data.map((c) => (
          <Paper key={c.id} withBorder p="xs" radius="sm">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Avatar size="sm" radius="xl" color="navy">
                  {initials(c.authorName)}
                </Avatar>
                <Stack gap={0}>
                  <Text size="xs">
                    <Text span fw={600} inherit>
                      {c.authorName ?? t('costEstimate.comments.unknown')}
                    </Text>{' '}
                    <Text span c="dimmed" inherit>
                      · {formatDateTime(c.createdAt)}
                    </Text>
                  </Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {c.body}
                  </Text>
                </Stack>
              </Group>
              {c.canDelete && (
                <Tooltip label={t('costEstimate.comments.delete')}>
                  <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => m.mutate({ deleteId: c.id }, { onError })} aria-label="delete">
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Paper>
        ))
      )}
      {can('costEstimate', 'create') && (
        <Stack gap={4}>
          <Textarea
            placeholder={t('costEstimate.comments.placeholder')}
            autosize
            minRows={2}
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            }}
            leftSection={<IconMessage size={14} />}
          />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {t('costEstimate.comments.hint')}
            </Text>
            <Button size="xs" leftSection={<IconSend size={14} />} onClick={send} loading={m.isPending} disabled={!body.trim()}>
              {t('costEstimate.comments.add')}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  )
}
