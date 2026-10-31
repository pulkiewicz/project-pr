import { ActionIcon, Button, Group, Paper, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconExternalLink, IconPlus, IconTrash } from '@tabler/icons-react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { daysBetween, deadlineStatus, type DeadlineStatus } from '#shared'
import { formatDate, todayWarsaw } from '../../lib/format'

export const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`) : null)
export const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)

const COLORS: Record<DeadlineStatus, string | undefined> = { none: 'dimmed', ok: undefined, soon: 'orange.7', expired: 'red.7' }

/** Data ważności z kolorem: czerwona po terminie, pomarańczowa w ciągu 30 dni. */
export function Deadline({ date, empty = '—' }: { date: string | null | undefined; empty?: string }) {
  const { t } = useTranslation()
  if (!date) return <Text size="sm" c="dimmed">{empty}</Text>
  const today = todayWarsaw()
  const status = deadlineStatus(date, today)
  const days = daysBetween(today, date)
  const hint = days === 0 ? t('deadline.today') : status === 'expired' ? t('deadline.expired', { count: -days }) : t(`deadline.${status}`, { count: days })
  return (
    <Tooltip label={hint}>
      <Text size="sm" c={COLORS[status]} fw={status === 'expired' || status === 'soon' ? 600 : undefined} span>
        {formatDate(date)}
      </Text>
    </Tooltip>
  )
}

export interface RowField<T> {
  key: keyof T & string
  label: string
  kind: 'text' | 'date' | 'select' | 'url'
  data?: { value: string; label: string }[]
  required?: boolean
  w?: number
}

/** Edytor listy wpisów (polisy, przeglądy, uprawnienia): każdy wpis to wiersz pól z przyciskiem usunięcia. */
export function RowsEditor<T extends Record<string, unknown>>({
  rows,
  onChange,
  fields,
  blank,
  empty,
  disabled,
}: {
  rows: T[]
  onChange: (rows: T[]) => void
  fields: RowField<T>[]
  blank: () => T
  empty: string
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const set = (i: number, key: keyof T, value: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)))
  return (
    <Stack gap="xs">
      {!rows.length && <Text size="sm" c="dimmed">{empty}</Text>}
      {rows.map((r, i) => (
        <Paper key={i} withBorder p="xs">
          <Group gap="xs" align="flex-end" wrap="wrap">
            {fields.map((f) => {
              const v = r[f.key] as string | null | undefined
              const common = { key: f.key, label: f.label, size: 'xs' as const, w: f.w ?? 140, disabled, required: f.required }
              if (f.kind === 'date') return <DateInput {...common} valueFormat="DD.MM.YYYY" clearable={!f.required} value={toDate(v)} onChange={(d) => set(i, f.key, fromDate(d))} />
              if (f.kind === 'select') return <Select {...common} allowDeselect={false} data={f.data ?? []} value={v ?? null} onChange={(s) => s && set(i, f.key, s)} />
              return (
                <TextInput
                  {...common}
                  value={v ?? ''}
                  onChange={(e) => set(i, f.key, e.currentTarget.value || null)}
                  rightSection={
                    f.kind === 'url' && v ? (
                      <ActionIcon size="sm" variant="subtle" component="a" href={v} target="_blank" rel="noreferrer" aria-label={t('deadline.openLink')}>
                        <IconExternalLink size={14} />
                      </ActionIcon>
                    ) : undefined
                  }
                />
              )
            })}
            {!disabled && (
              <ActionIcon variant="subtle" color="red" mb={4} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t('deadline.remove')}>
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </Group>
        </Paper>
      ))}
      {!disabled && (
        <Group>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => onChange([...rows, blank()])}>
            {t('deadline.add')}
          </Button>
        </Group>
      )}
    </Stack>
  )
}
