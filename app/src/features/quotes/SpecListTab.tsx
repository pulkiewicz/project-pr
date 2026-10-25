import { ActionIcon, Alert, Badge, Button, Group, Loader, Select, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SPEC_TYPES, type SpecItemDef, type SpecType } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { useSaveSpecList, useSpecLists } from './api'

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'param'

/** Edycja standardowej listy specyfikacyjnej — zapis tworzy nową wersję (rozpoczęte checklisty zostają przy swojej). */
export function SpecListTab() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const versions = useSpecLists()
  const save = useSaveSpecList()
  const latest = versions.data?.[0]
  const [items, setItems] = useState<SpecItemDef[]>([])
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (latest) setItems(latest.items)
  }, [latest?.version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (versions.isLoading || !latest) return <Loader />
  const editable = can('quoteKnowledge', 'edit')
  const dirty = JSON.stringify(items) !== JSON.stringify(latest.items)
  const upd = (i: number, p: Partial<SpecItemDef>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...items]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x!)
    setItems(next)
  }
  const groups = [...new Set(items.map((i) => i.group))]
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Badge variant="light">v{latest.version}</Badge>
          <Text size="sm" c="dimmed">
            {formatDateTime(latest.createdAt)}
            {latest.createdByName ? ` · ${latest.createdByName}` : ''} · {items.length}
          </Text>
        </Group>
        {editable && (
          <Group gap="xs">
            <Button variant="default" disabled={!dirty} onClick={() => setItems(latest.items)}>
              {t('app.cancel')}
            </Button>
            <Button
              disabled={!dirty}
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { items, notes: notes || null },
                  { onSuccess: (v) => notifications.show({ color: 'green', message: `v${v.version} · ${t('app.saved')}` }), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
                )
              }
            >
              {t('knowledge.specSave')}
            </Button>
          </Group>
        )}
      </Group>
      <Alert variant="light">{t('knowledge.specHint')}</Alert>
      {editable && dirty && <Textarea placeholder={t('quotes.notes')} autosize minRows={1} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />}
      <Table.ScrollContainer minWidth={1100}>
        <Table verticalSpacing={2} striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={150}>{t('knowledge.specGroup')}</Table.Th>
              <Table.Th miw={280}>{t('knowledge.specLabel')}</Table.Th>
              <Table.Th w={110}>{t('knowledge.specType')}</Table.Th>
              <Table.Th w={80}>{t('knowledge.specUnit')}</Table.Th>
              <Table.Th w={200}>{t('knowledge.specOptions')}</Table.Th>
              <Table.Th w={130}>{t('knowledge.specKey')}</Table.Th>
              <Table.Th w={90} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((it, i) => (
              <Table.Tr key={`${it.key}-${i}`}>
                <Table.Td>
                  <Select size="xs" searchable disabled={!editable} data={groups} value={it.group} onChange={(v) => v && upd(i, { group: v })} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" disabled={!editable} value={it.label} onChange={(e) => upd(i, { label: e.currentTarget.value })} />
                </Table.Td>
                <Table.Td>
                  <Select size="xs" allowDeselect={false} disabled={!editable} data={SPEC_TYPES.map((s) => ({ value: s, label: t(`knowledge.specTypeName.${s}`) }))} value={it.type} onChange={(v) => v && upd(i, { type: v as SpecType })} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" disabled={!editable} value={it.unit ?? ''} onChange={(e) => upd(i, { unit: e.currentTarget.value || null })} />
                </Table.Td>
                <Table.Td>
                  {it.type === 'choice' && (
                    <TextInput size="xs" disabled={!editable} value={(it.options ?? []).join('; ')} onChange={(e) => upd(i, { options: e.currentTarget.value.split(';').map((s) => s.trim()).filter(Boolean) })} />
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {it.key}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {editable && (
                    <Group gap={0} wrap="nowrap">
                      <ActionIcon size="sm" variant="subtle" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">
                        <IconArrowUp size={14} />
                      </ActionIcon>
                      <ActionIcon size="sm" variant="subtle" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="down">
                        <IconArrowDown size={14} />
                      </ActionIcon>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t('app.delete')}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {editable && (
        <Button
          variant="light"
          w="fit-content"
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            const label = t('knowledge.specLabel')
            let key = slug(`${label}_${items.length + 1}`)
            while (items.some((x) => x.key === key)) key = `${key}_x`
            setItems([...items, { key, group: items.at(-1)?.group ?? 'Ogólne', label, type: 'text', unit: null, options: null, help: null }])
          }}
        >
          {t('knowledge.specAdd')}
        </Button>
      )}
      <Text size="sm" fw={600} mt="md">
        {t('knowledge.specVersions')}
      </Text>
      {versions.data!.map((v) => (
        <Text key={v.id} size="sm" c="dimmed">
          v{v.version} · {formatDateTime(v.createdAt)}
          {v.createdByName ? ` · ${v.createdByName}` : ''} · {v.items.length}
          {v.notes ? ` · ${v.notes}` : ''}
        </Text>
      ))}
    </Stack>
  )
}
