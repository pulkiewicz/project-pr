import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, Paper, Stack, Switch, Text, TextInput } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconCopy, IconPencil, IconTrash, IconUserPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { hours as H, type TimesheetEmployeeDto } from '#shared'
import { errorMessage } from '../../../lib/errors'
import { useTimesheetEmployeeMutations, useTimesheetEmployees } from '../api'

/** Link do ekranu pracownika w PMO (to samo ID co w starej aplikacji). */
export const employeeLink = (id: string) => `${window.location.origin}/godziny?id=${H.formatId(id)}`

/** Gotowa wiadomość do wklejenia pracownikowi (treść jak w workload-calendar, z nowym linkiem). */
export function invitationText(e: Pick<TimesheetEmployeeDto, 'id' | 'name'>) {
  const firstName = e.name.trim().split(/\s+/)[0]
  return `Cześć ${firstName}! Swoje godziny pracy wpisujesz tutaj: ${employeeLink(e.id)} Twoje ID: ${H.formatId(e.id)}`
}

const ok = (message: string) => notifications.show({ color: 'green', message })
const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    ok(message)
  } catch {
    // Brak uprawnień do schowka — pokazujemy treść do skopiowania ręcznie.
    modals.open({ title: 'Skopiuj ręcznie', children: <TextInput value={text} readOnly onFocus={(e) => e.currentTarget.select()} /> })
  }
}

/** Pracownicy ewidencji: dodawanie (ID generuje system), nazwa, aktywność, usuwanie, wiadomość z linkiem. */
export function EmployeesTab({ canEdit }: { canEdit: boolean }) {
  const q = useTimesheetEmployees()
  const { create, update, remove } = useTimesheetEmployeeMutations()
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const sorted = [...(q.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  const busy = (id: string) => (update.isPending && update.variables?.id === id) || (remove.isPending && remove.variables === id)

  const add = () => {
    const name = newName.trim()
    if (!name) return
    create.mutate(name, {
      onSuccess: ({ employee }) => {
        setNewName('')
        ok(`Dodano: ${employee.name} (${H.formatId(employee.id)})`)
      },
      onError: fail,
    })
  }

  const toggleActive = (e: TimesheetEmployeeDto) =>
    update.mutate(
      { id: e.id, patch: { active: !e.active } },
      { onSuccess: () => ok(e.active ? `${e.name} nie może już się zalogować. Godziny zostają w raportach.` : `${e.name} może znowu wpisywać godziny.`), onError: fail },
    )

  const confirmDelete = (e: TimesheetEmployeeDto) =>
    modals.openConfirmModal({
      title: 'Usunąć pracownika?',
      children: (
        <Text size="sm">
          Usuniesz <strong>{e.name}</strong> wraz ze <strong>wszystkimi wpisami godzin</strong>. Tej operacji nie da się cofnąć. Jeśli chodzi tylko o to, żeby pracownik nie mógł się już
          logować — użyj przełącznika „aktywny”.
        </Text>
      ),
      labels: { confirm: 'Usuń bezpowrotnie', cancel: 'Anuluj' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(e.id, { onSuccess: (r) => ok(`Usunięto ${e.name} (wpisów: ${r.deletedEntries}).`), onError: fail }),
    })

  const copyAll = () => void copy(sorted.filter((e) => e.active).map(invitationText).join('\n\n'), 'Skopiowano wiadomości dla wszystkich aktywnych pracowników.')

  return (
    <div>
      {canEdit && (
        <Card withBorder mb="lg">
          <Text fw={600} mb="sm">
            Dodaj pracownika
          </Text>
          <form
            onSubmit={(ev) => {
              ev.preventDefault()
              add()
            }}
          >
            <Group align="flex-start" wrap="wrap">
              <TextInput label="Imię i nazwisko" maxLength={120} style={{ flex: 1, minWidth: 220 }} value={newName} disabled={create.isPending} onChange={(ev) => setNewName(ev.currentTarget.value)} />
              <Button type="submit" mt={24} leftSection={<IconUserPlus size={16} />} loading={create.isPending} disabled={!newName.trim()}>
                Dodaj
              </Button>
            </Group>
          </form>
          <Text size="xs" c="dimmed" mt="xs">
            Identyfikator generuje system — potem skopiuj gotową wiadomość z linkiem dla pracownika.
          </Text>
        </Card>
      )}

      {q.error && (
        <Alert color="red" mb="md">
          {errorMessage(q.error)}
        </Alert>
      )}
      {q.data && !sorted.length && <Alert color="blue">Nie ma jeszcze żadnych pracowników.</Alert>}

      {sorted.length > 0 && (
        <>
          <Group justify="flex-end" mb="xs">
            <Button variant="light" size="xs" leftSection={<IconCopy size={14} />} onClick={copyAll}>
              Skopiuj wiadomości dla wszystkich aktywnych
            </Button>
          </Group>
          <Paper withBorder>
            <Stack gap={0}>
              {sorted.map((e, i) => (
                <Group key={e.id} justify="space-between" wrap="wrap" px="md" py="sm" style={{ borderTop: i ? '1px solid var(--mantine-color-gray-2)' : undefined, opacity: e.active ? 1 : 0.6 }}>
                  <div>
                    <Group gap={8}>
                      <Text fw={500}>{e.name}</Text>
                      {!e.active && (
                        <Badge size="xs" color="orange" variant="light">
                          nieaktywny
                        </Badge>
                      )}
                    </Group>
                    <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {H.formatId(e.id)}
                    </Text>
                  </div>
                  <Group gap={4} wrap="wrap" justify="flex-end">
                    <ActionIcon variant="subtle" title="Skopiuj wiadomość z linkiem" aria-label="Skopiuj wiadomość z linkiem" onClick={() => void copy(invitationText(e), 'Skopiowano wiadomość z linkiem.')}>
                      <IconCopy size={18} />
                    </ActionIcon>
                    {canEdit && (
                      <>
                        <ActionIcon variant="subtle" color="gray" title="Zmień nazwę" aria-label="Zmień nazwę" disabled={busy(e.id)} onClick={() => setRename({ id: e.id, name: e.name })}>
                          <IconPencil size={18} />
                        </ActionIcon>
                        <Switch mx={4} checked={e.active} disabled={busy(e.id)} label={e.active ? 'aktywny' : 'nieaktywny'} aria-label={`Aktywny: ${e.name}`} onChange={() => toggleActive(e)} />
                        <ActionIcon variant="subtle" color="red" title="Usuń pracownika" aria-label="Usuń pracownika" disabled={busy(e.id)} onClick={() => confirmDelete(e)}>
                          <IconTrash size={18} />
                        </ActionIcon>
                      </>
                    )}
                  </Group>
                </Group>
              ))}
            </Stack>
          </Paper>
        </>
      )}

      <Modal opened={!!rename} onClose={() => setRename(null)} title="Zmień nazwę pracownika">
        {rename && (
          <form
            onSubmit={(ev) => {
              ev.preventDefault()
              const name = rename.name.trim()
              if (!name) return
              update.mutate({ id: rename.id, patch: { name } }, { onSuccess: () => ok('Zmieniono nazwę.'), onError: fail })
              setRename(null)
            }}
          >
            <TextInput label="Imię i nazwisko" maxLength={120} autoFocus value={rename.name} onChange={(ev) => setRename({ ...rename, name: ev.currentTarget.value })} />
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setRename(null)}>
                Anuluj
              </Button>
              <Button type="submit" disabled={!rename.name.trim()}>
                Zapisz
              </Button>
            </Group>
          </form>
        )}
      </Modal>
    </div>
  )
}
