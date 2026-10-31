import { Alert, Button, Checkbox, Group, Loader, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../../lib/errors'
import { useAvizationCandidates, useImportFromAvizations } from './api'

/** Dodanie pracowników z listy awizacyjnej (osoby z firmy Envcheck, których jeszcze nie ma na liście). */
export function ImportFromAvizationsModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const q = useAvizationCandidates(opened)
  const save = useImportFromAvizations()
  const [selected, setSelected] = useState<string[]>([])
  const list = q.data ?? []

  // Domyślnie wszystkie zaznaczone.
  useEffect(() => {
    if (opened && q.data) setSelected(q.data.map((p) => p.personId))
  }, [opened, q.data])

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const submit = () =>
    save.mutate(selected, {
      onSuccess: (r) => {
        notifications.show({ color: 'green', message: t('employees.import.done', { count: r.created }) })
        onClose()
      },
      onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
    })

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={t('employees.import.title')}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t('employees.import.hint')}
        </Text>
        {q.isLoading && <Loader />}
        {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
        {q.data && !list.length && <Alert color="green">{t('employees.import.empty')}</Alert>}
        {list.length > 0 && (
          <ScrollArea.Autosize mah="55vh">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox
                      aria-label={t('employees.import.all')}
                      checked={selected.length === list.length}
                      indeterminate={selected.length > 0 && selected.length < list.length}
                      onChange={() => setSelected(selected.length === list.length ? [] : list.map((p) => p.personId))}
                    />
                  </Table.Th>
                  <Table.Th>{t('employees.col.name')}</Table.Th>
                  <Table.Th>{t('employees.position')}</Table.Th>
                  <Table.Th>{t('employees.phone')}</Table.Th>
                  <Table.Th>{t('employees.import.projects')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.map((p) => (
                  <Table.Tr key={p.personId} onClick={() => toggle(p.personId)} style={{ cursor: 'pointer' }}>
                    <Table.Td>
                      <Checkbox aria-label={`${p.lastName} ${p.firstName}`} checked={selected.includes(p.personId)} onChange={() => toggle(p.personId)} onClick={(e) => e.stopPropagation()} />
                    </Table.Td>
                    <Table.Td>
                      {p.lastName} {p.firstName}
                    </Table.Td>
                    <Table.Td>{p.position ?? '—'}</Table.Td>
                    <Table.Td>{p.phone ?? '—'}</Table.Td>
                    <Table.Td>{p.projects.join(', ')}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          {list.length > 0 && (
            <Button onClick={submit} loading={save.isPending} disabled={!selected.length}>
              {t('employees.import.submit', { count: selected.length })}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  )
}
