import { ActionIcon, Badge, Button, Card, Group, Loader, NumberInput, SegmentedControl, Select, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { IconCheck, IconMessage, IconPlus, IconQuote, IconTrash } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChecklistItemDto, ChecklistStatus, QuoteDto, SpecValue } from '#shared'
import { AiJobButton } from './AiPanels'
import { useChecklist, useChecklistMutation } from './api'

const STATUS_COLOR: Record<ChecklistStatus, string> = { pending: 'gray', confirmed: 'green', missing: 'orange', na: 'gray' }
type Filter = 'all' | 'pending' | 'missing' | 'confirmed'

/** Edytor wartości wg typu parametru; `onChange(null)` = wyczyszczone. */
function ValueEditor({ item, value, disabled, onChange }: { item: ChecklistItemDto; value: SpecValue | null; disabled: boolean; onChange: (v: SpecValue | null) => void }) {
  const { t } = useTranslation()
  const n = (v: string | number) => (v === '' ? null : Number(v))
  switch (item.type) {
    case 'number':
      return <NumberInput size="xs" disabled={disabled} decimalSeparator="," suffix={item.unit ? ` ${item.unit}` : undefined} value={value && 'n' in value ? value.n : ''} onChange={(v) => onChange(n(v) == null ? null : { n: n(v)! })} />
    case 'range': {
      const r = value && 'min' in value ? value : { min: null, max: null }
      return (
        <Group gap={4} wrap="nowrap">
          <NumberInput size="xs" w={90} disabled={disabled} decimalSeparator="," placeholder={t('checklist.min')} value={r.min ?? ''} onChange={(v) => onChange({ min: n(v), max: r.max })} />
          <Text size="xs">…</Text>
          <NumberInput size="xs" w={90} disabled={disabled} decimalSeparator="," placeholder={t('checklist.max')} value={r.max ?? ''} onChange={(v) => onChange({ min: r.min, max: n(v) })} />
          {item.unit && <Text size="xs" c="dimmed">{item.unit}</Text>}
        </Group>
      )
    }
    case 'dims': {
      const d = value && 'w' in value ? value : { w: 0, h: 0, d: 0 }
      const field = (k: 'w' | 'h' | 'd') => <NumberInput size="xs" w={78} min={0} disabled={disabled} placeholder={t(`checklist.${k}`)} value={d[k] || ''} onChange={(v) => onChange({ ...d, [k]: Number(v) || 0 })} />
      return (
        <Group gap={4} wrap="nowrap">
          {field('w')}
          <Text size="xs">×</Text>
          {field('h')}
          <Text size="xs">×</Text>
          {field('d')}
          <Text size="xs" c="dimmed">
            mm
          </Text>
        </Group>
      )
    }
    case 'choice':
      return <Select size="xs" clearable disabled={disabled} data={item.options ?? []} value={value && 'v' in value ? value.v : null} onChange={(v) => onChange(v ? { v } : null)} />
    case 'bool':
      return (
        <SegmentedControl
          size="xs"
          disabled={disabled}
          data={[
            { value: 'yes', label: t('checklist.yes') },
            { value: 'no', label: t('checklist.no') },
          ]}
          value={value && 'b' in value ? (value.b ? 'yes' : 'no') : ''}
          onChange={(v) => onChange({ b: v === 'yes' })}
        />
      )
    default:
      return <Textarea size="xs" autosize minRows={1} disabled={disabled} value={value && 't' in value ? value.t : ''} onChange={(e) => onChange(e.currentTarget.value ? { t: e.currentTarget.value } : null)} />
  }
}

function Row({ q, item }: { q: QuoteDto; item: ChecklistItemDto }) {
  const { t } = useTranslation()
  const m = useChecklistMutation(q.id)
  const [value, setValue] = useState<SpecValue | null>(item.value)
  const [note, setNote] = useState(item.note ?? '')
  const [showNote, setShowNote] = useState(!!item.note)
  useEffect(() => {
    setValue(item.value)
    setNote(item.note ?? '')
  }, [item.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(value) !== JSON.stringify(item.value) || note !== (item.note ?? '')
  const save = (status?: ChecklistStatus) => m.mutate({ method: 'PUT', key: item.key, json: { value, note: note || null, ...(status ? { status } : {}) } })
  const editable = q.canEdit
  return (
    <Table.Tr data-testid={`checklist-${item.key}`}>
      <Table.Td w="30%" style={{ borderLeft: `3px solid var(--mantine-color-${STATUS_COLOR[item.status]}-${item.status === 'pending' ? 3 : 6})` }}>
        <Group gap={4} wrap="nowrap">
          <Text size="sm">{item.label}</Text>
          {item.sourceRef && (
            <Tooltip label={item.sourceRef} multiline w={360}>
              <IconQuote size={14} color="var(--mantine-color-grape-6)" aria-label={t('ai.sourceRef')} style={{ flexShrink: 0 }} />
            </Tooltip>
          )}
        </Group>
        {item.note && item.note.startsWith('AI') && (
          <Text size="xs" c="grape">
            {item.note}
          </Text>
        )}
        {item.help && (
          <Text size="xs" c="dimmed">
            {item.help}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Stack gap={4}>
          <ValueEditor item={item} value={value} disabled={!editable} onChange={setValue} />
          {showNote && <TextInput size="xs" placeholder={t('checklist.note')} disabled={!editable} value={note} onChange={(e) => setNote(e.currentTarget.value)} />}
        </Stack>
      </Table.Td>
      <Table.Td w={editable ? 230 : 140}>
        <Group gap={4} wrap="nowrap" justify="flex-end">
          {item.status !== 'pending' && (
            <Badge size="sm" variant="light" color={STATUS_COLOR[item.status]} style={{ flexShrink: 0 }}>
              {t(`checklist.status.${item.status}`)}
            </Badge>
          )}
          {editable && (
            <>
              <Tooltip label={t('checklist.ok')}>
                <ActionIcon size="sm" color="green" variant={item.status === 'confirmed' && !dirty ? 'filled' : 'light'} loading={m.isPending} onClick={() => save('confirmed')} aria-label={t('checklist.ok')}>
                  <IconCheck size={14} />
                </ActionIcon>
              </Tooltip>
              <Button size="compact-xs" variant={item.status === 'missing' ? 'filled' : 'light'} color="orange" onClick={() => save('missing')}>
                {t('checklist.missing')}
              </Button>
              <Button size="compact-xs" variant={item.status === 'na' ? 'filled' : 'light'} color="gray" onClick={() => save('na')}>
                {t('checklist.na')}
              </Button>
              <Tooltip label={t('checklist.note')}>
                <ActionIcon size="sm" variant="subtle" onClick={() => setShowNote((s) => !s)} aria-label={t('checklist.note')}>
                  <IconMessage size={14} />
                </ActionIcon>
              </Tooltip>
              {dirty && item.status !== 'confirmed' && (
                <Button size="compact-xs" variant="default" onClick={() => save()}>
                  {t('app.save')}
                </Button>
              )}
              {item.custom && (
                <ActionIcon size="sm" variant="subtle" color="red" onClick={() => m.mutate({ method: 'DELETE', key: item.key })} aria-label={t('app.delete')}>
                  <IconTrash size={14} />
                </ActionIcon>
              )}
            </>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  )
}

/** Krok 3: checklista specyfikacyjna — parametry z SIWZ mapowane na standardową listę, każdy potwierdzany. */
export function ChecklistPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const query = useChecklist(q.id)
  const m = useChecklistMutation(q.id)
  const [filter, setFilter] = useState<Filter>('all')
  const [custom, setCustom] = useState('')
  const groups = useMemo(() => {
    const items = (query.data?.items ?? []).filter((i) => filter === 'all' || i.status === filter)
    const map = new Map<string, ChecklistItemDto[]>()
    for (const i of items) map.set(i.group, [...(map.get(i.group) ?? []), i])
    return [...map]
  }, [query.data, filter])
  if (query.isLoading) return <Loader />
  const c = query.data!
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Badge variant="light">{t('checklist.specVersion', { version: c.specVersion })}</Badge>
          <Text size="sm">{t('checklist.progress', { confirmed: c.progress.confirmed, total: c.progress.total })}</Text>
          {c.progress.missing > 0 && (
            <Badge color="orange" variant="light">
              {t('checklist.status.missing')}: {c.progress.missing}
            </Badge>
          )}
        </Group>
        <SegmentedControl size="xs" data={(['all', 'pending', 'missing', 'confirmed'] as const).map((f) => ({ value: f, label: t(`checklist.filter.${f}`) }))} value={filter} onChange={(v) => setFilter(v as Filter)} />
      </Group>
      <AiJobButton q={q} kind="extract_checklist" label={t('ai.extract')} />
      <Text size="sm" c="dimmed">
        {t('checklist.hint')}
      </Text>
      {groups.map(([group, items]) => (
        <Card key={group} withBorder padding="xs">
          <Text fw={600} mb={4}>
            {group}
          </Text>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing={4}>
              <Table.Tbody>
                {items.map((i) => (
                  <Row key={i.key} q={q} item={i} />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      ))}
      {q.canEdit && (
        <Group align="flex-end">
          <TextInput label={t('checklist.addCustom')} placeholder={t('checklist.customLabel')} value={custom} onChange={(e) => setCustom(e.currentTarget.value)} style={{ flex: 1 }} />
          <Button
            leftSection={<IconPlus size={16} />}
            disabled={!custom.trim()}
            loading={m.isPending}
            onClick={() => m.mutate({ method: 'POST', json: { label: custom.trim() } }, { onSuccess: () => setCustom('') })}
          >
            {t('checklist.addCustom')}
          </Button>
        </Group>
      )}
    </Stack>
  )
}
