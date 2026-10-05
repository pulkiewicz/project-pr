import { ActionIcon, Button, Card, Group, NumberInput, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AVIZATION_EXPORT_COLUMNS, DEFAULT_EXPORT_TEMPLATE, type AvizationExportColumn, type AvizationSettings } from '#shared'
import { errorMessage } from '../../lib/errors'
import { useAvizationMutations, useAvizationSettings, useEntryPoints } from './api'

/** Ustawienia M5 (Admin): wyprzedzenie zgłoszenia, bramy, szablon listy dla ochrony. */
export function AvizationSettingsCard() {
  const { t } = useTranslation()
  const q = useAvizationSettings()
  const entry = useEntryPoints()
  const m = useAvizationMutations()
  const [s, setS] = useState<AvizationSettings | null>(null)
  const [newEntry, setNewEntry] = useState('')
  useEffect(() => {
    if (q.data) setS(q.data)
  }, [q.data])
  if (!s) return null
  const cols = s.exportTemplate.columns
  const setCols = (columns: typeof cols) => setS({ ...s, exportTemplate: { ...s.exportTemplate, columns } })
  const move = (i: number, d: number) => {
    const next = [...cols]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x!)
    setCols(next)
  }
  return (
    <Card withBorder maw={820}>
      <Stack>
        <Text fw={600}>{t('avizations.settings.title')}</Text>
        <NumberInput w={360} label={t('avizations.settings.minLead')} min={0} max={30} value={s.minLeadWorkingDays} onChange={(v) => setS({ ...s, minLeadWorkingDays: Number(v) || 0 })} />

        <Text fw={500} size="sm">{t('avizations.settings.entryPoints')}</Text>
        <Stack gap={4}>
          {entry.data?.map((e) => (
            <Group key={e.id} justify="space-between" maw={420}>
              <Text size="sm">{e.name}</Text>
              <Switch size="xs" checked={e.isActive} onChange={(ev) => m.updateEntryPoint.mutate({ id: e.id, isActive: ev.currentTarget.checked })} aria-label={e.name} />
            </Group>
          ))}
          <Group maw={420}>
            <TextInput style={{ flex: 1 }} size="xs" value={newEntry} onChange={(e) => setNewEntry(e.currentTarget.value)} placeholder={t('avizations.settings.addEntryPoint')} />
            <Button size="xs" variant="light" disabled={!newEntry.trim()} onClick={() => m.addEntryPoint.mutate(newEntry.trim(), { onSuccess: () => setNewEntry('') })}>
              {t('avizations.settings.addEntryPoint')}
            </Button>
          </Group>
        </Stack>

        <Text fw={500} size="sm">{t('avizations.settings.template')}</Text>
        <Table withTableBorder fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('avizations.settings.column')}</Table.Th>
              <Table.Th>{t('avizations.settings.header')}</Table.Th>
              <Table.Th>{t('avizations.settings.width')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {cols.map((c, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <Select size="xs" allowDeselect={false} data={AVIZATION_EXPORT_COLUMNS.map((k) => ({ value: k, label: t(`avizations.columns.${k}`) }))} value={c.key} onChange={(v) => v && setCols(cols.map((x, j) => (j === i ? { ...x, key: v as AvizationExportColumn } : x)))} />
                </Table.Td>
                <Table.Td>
                  <TextInput size="xs" value={c.header} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, header: e.currentTarget.value } : x)))} />
                </Table.Td>
                <Table.Td w={90}>
                  <NumberInput size="xs" min={4} max={80} value={c.width} onChange={(v) => setCols(cols.map((x, j) => (j === i ? { ...x, width: Number(v) || 10 } : x)))} />
                </Table.Td>
                <Table.Td w={100}>
                  <Group gap={2} wrap="nowrap">
                    <ActionIcon size="sm" variant="subtle" disabled={i === 0} onClick={() => move(i, -1)} aria-label="w górę"><IconArrowUp size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" disabled={i === cols.length - 1} onClick={() => move(i, 1)} aria-label="w dół"><IconArrowDown size={14} /></ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="red" disabled={cols.length === 1} onClick={() => setCols(cols.filter((_, j) => j !== i))} aria-label="usuń"><IconTrash size={14} /></ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group>
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setCols([...cols, { key: 'phone', header: t('avizations.columns.phone'), width: 15 }])}>
            {t('avizations.settings.addColumn')}
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setS({ ...s, exportTemplate: DEFAULT_EXPORT_TEMPLATE })}>
            {DEFAULT_EXPORT_TEMPLATE.name}
          </Button>
        </Group>
        <NumberInput w={360} label={t('avizations.settings.minRows')} min={0} max={100} value={s.exportTemplate.minRows} onChange={(v) => setS({ ...s, exportTemplate: { ...s.exportTemplate, minRows: Number(v) || 0 } })} />
        <Group justify="flex-end">
          <Button
            loading={m.saveSettings.isPending}
            onClick={() => m.saveSettings.mutate(s, { onSuccess: () => notifications.show({ color: 'green', message: t('app.saved') }), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}
          >
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}
