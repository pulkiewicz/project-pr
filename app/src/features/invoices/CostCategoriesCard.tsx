import { ActionIcon, Badge, Button, Card, Group, Stack, Switch, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../../lib/errors'
import { useAdminCostCategories, useCostCategoryMutations } from './api'

/** Ustawienia (Admin): słownik kategorii kosztów faktur — dodawanie, zmiana nazwy, wyłączanie, usuwanie nieużywanych. */
export function CostCategoriesCard() {
  const { t } = useTranslation()
  const q = useAdminCostCategories()
  const { create, update, remove } = useCostCategoryMutations()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const onError = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })
  if (!q.data) return null

  const add = () => {
    const v = name.trim()
    if (!v) return
    create.mutate(v, { onSuccess: () => setName(''), onError })
  }
  const saveName = () => {
    if (!editing) return
    const v = editing.name.trim()
    if (v) update.mutate({ id: editing.id, patch: { name: v } }, { onSuccess: () => setEditing(null), onError })
  }

  return (
    <Card withBorder maw={520}>
      <Stack>
        <div>
          <Text fw={600}>{t('invoices.categories.title')}</Text>
          <Text size="xs" c="dimmed">
            {t('invoices.categories.hint')}
          </Text>
        </div>
        <Stack gap={4}>
          {q.data.map((k) => (
            <Group key={k.id} justify="space-between" wrap="nowrap" gap="xs">
              {editing?.id === k.id ? (
                <TextInput
                  size="xs"
                  style={{ flex: 1 }}
                  maxLength={100}
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <Group gap={6} style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
                  <Text size="sm" c={k.active ? undefined : 'dimmed'} truncate>
                    {k.name}
                  </Text>
                  {k.invoiceCount > 0 && (
                    <Badge size="xs" variant="light" color="gray">
                      {t('invoices.categories.count', { count: k.invoiceCount })}
                    </Badge>
                  )}
                  {k.transactionCount > 0 && (
                    <Badge size="xs" variant="light" color="gray">
                      {t('invoices.categories.txCount', { count: k.transactionCount })}
                    </Badge>
                  )}
                </Group>
              )}
              <Group gap={4} wrap="nowrap">
                {editing?.id === k.id ? (
                  <>
                    <ActionIcon size="sm" variant="subtle" onClick={saveName} aria-label={t('app.save')}>
                      <IconCheck size={16} />
                    </ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setEditing(null)} aria-label={t('app.cancel')}>
                      <IconX size={16} />
                    </ActionIcon>
                  </>
                ) : (
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setEditing({ id: k.id, name: k.name })} aria-label={t('invoices.categories.rename')}>
                    <IconPencil size={16} />
                  </ActionIcon>
                )}
                <Switch
                  size="xs"
                  checked={k.active}
                  aria-label={t('invoices.categories.active')}
                  title={t('invoices.categories.active')}
                  onChange={(e) => update.mutate({ id: k.id, patch: { active: e.currentTarget.checked } }, { onError })}
                />
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  disabled={k.invoiceCount + k.transactionCount > 0}
                  title={k.invoiceCount + k.transactionCount > 0 ? t('invoices.categories.inUse') : t('app.delete')}
                  aria-label={t('app.delete')}
                  onClick={() => remove.mutate(k.id, { onError })}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </Group>
          ))}
        </Stack>
        <Group wrap="nowrap" gap="xs">
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            placeholder={t('invoices.categories.newPlaceholder')}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button size="xs" leftSection={<IconPlus size={14} />} loading={create.isPending} disabled={!name.trim()} onClick={add}>
            {t('invoices.categories.add')}
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}
