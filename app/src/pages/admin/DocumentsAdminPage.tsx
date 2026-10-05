import { Alert, Badge, Button, Card, Group, Modal, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACL_LEVELS, type AclLevel, type AclMatrixRow } from '#shared'
import { useAcl, useDocsMutations, useDriveStatus } from '../../features/documents/api'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'

const ROLE_SUBJECTS = ['role:EnvcheckInternal', 'role:Arsanit', 'role:Client', 'role:Subcontractor']
/** Klucz bez dwukropka (i18next traktuje „:” jako separator przestrzeni nazw). */
const subjectKey = (s: string) => `documents.subjects.${s.replace(/^role:/, '')}`

function AclEditor({ row, onClose }: { row: AclMatrixRow; onClose: () => void }) {
  const { t } = useTranslation()
  const m = useDocsMutations()
  const [inherit, setInherit] = useState(!row.explicit)
  const [entries, setEntries] = useState<Record<string, AclLevel>>({})
  const [newSub, setNewSub] = useState('')
  useEffect(() => setEntries(Object.fromEntries(row.entries.map((e) => [e.subject, e.level]))), [row])
  const subjects = [...new Set([...ROLE_SUBJECTS, ...Object.keys(entries)])]
  const save = () =>
    m.saveAcl.mutate(
      { folderId: row.folderId, entries: inherit ? null : Object.entries(entries).map(([subject, level]) => ({ subject, level })) },
      { onSuccess: () => (notifications.show({ color: 'green', message: t('app.saved') }), onClose()), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
    )
  return (
    <Modal opened onClose={onClose} title={t('documents.admin.editAcl', { path: row.path })}>
      <Stack>
        <Switch label={t('documents.admin.inheritToggle')} checked={inherit} onChange={(e) => setInherit(e.currentTarget.checked)} />
        {!inherit && (
          <>
            {subjects.map((s) => (
              <Group key={s} justify="space-between">
                <Text size="sm">{s.startsWith('role:') ? t(subjectKey(s)) : s.replace('party:', '')}</Text>
                <Select size="xs" w={150} allowDeselect={false} data={ACL_LEVELS.map((l) => ({ value: l, label: t(`documents.acl.${l}`) }))} value={entries[s] ?? 'none'} onChange={(v) => setEntries({ ...entries, [s]: v as AclLevel })} />
              </Group>
            ))}
            <Group align="flex-end">
              <TextInput size="xs" style={{ flex: 1 }} label={t('documents.admin.addSubcontractor')} placeholder="00000000-0000-0000-0000-000000000000" value={newSub} onChange={(e) => setNewSub(e.currentTarget.value.trim())} />
              <Button size="xs" variant="light" disabled={!/^[0-9a-f-]{36}$/i.test(newSub)} onClick={() => (setEntries({ ...entries, [`party:Subcontractor:${newSub}`]: 'write' }), setNewSub(''))}>+</Button>
            </Group>
          </>
        )}
        <Group justify="flex-end">
          <Button onClick={save} loading={m.saveAcl.isPending}>{t('app.save')}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export function DocumentsAdminPage() {
  const { t } = useTranslation()
  const status = useDriveStatus()
  const acl = useAcl()
  const m = useDocsMutations()
  const [driveId, setDriveId] = useState('')
  const [domain, setDomain] = useState('')
  const [editing, setEditing] = useState<AclMatrixRow | null>(null)
  useEffect(() => {
    if (status.data) {
      setDriveId(status.data.sharedDriveId ?? '')
      setDomain(status.data.googleDomain ?? '')
    }
  }, [status.data])
  const err = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e), autoClose: 10000 })
  const s = status.data
  const levelText = (row: AclMatrixRow, subject: string) => {
    if (!row.explicit) return <Text size="xs" c="dimmed">{t('documents.admin.inherit')}</Text>
    const e = row.entries.find((x) => x.subject === subject)
    return <Badge size="xs" variant="light" color={!e ? 'gray' : e.level === 'write' || e.level === 'manage' ? 'green' : 'navy'}>{t(`documents.acl.${e?.level ?? 'none'}`)}</Badge>
  }

  return (
    <Stack>
      <Title order={2}>{t('documents.admin.title')}</Title>
      <Card withBorder maw={760}>
        <Stack>
          <Group gap="xs">
            <Text size="sm">{t('documents.admin.credentials')}:</Text>
            {s?.credentials ? <Badge color="green">{t('documents.admin.credentialsOk')}</Badge> : <Badge color="red">{t('documents.admin.credentialsMissing')}</Badge>}
          </Group>
          {s?.configured && (
            <Text size="sm">
              {t('documents.admin.stats', { folders: s.folders, files: s.files })} · {t('documents.admin.lastSync')}: {formatDateTime(s.lastSyncAt)}
            </Text>
          )}
          <TextInput label={t('documents.admin.sharedDriveId')} value={driveId} onChange={(e) => setDriveId(e.currentTarget.value.trim())} />
          <TextInput label={t('documents.admin.googleDomain')} placeholder="envcheck.pl" value={domain} onChange={(e) => setDomain(e.currentTarget.value.trim())} />
          <Group>
            <Button
              disabled={!driveId || !s?.credentials}
              loading={m.saveSettings.isPending}
              onClick={() => m.saveSettings.mutate({ sharedDriveId: driveId, googleDomain: domain || null }, { onSuccess: (r) => notifications.show({ color: 'green', message: t('documents.admin.connected', { name: r.driveName }) }), onError: err })}
            >
              {t('documents.admin.save')}
            </Button>
            <Button
              variant="light"
              disabled={!s?.sharedDriveId}
              loading={m.initialize.isPending}
              onClick={() => m.initialize.mutate(undefined, { onSuccess: (r) => notifications.show({ color: 'green', message: t('documents.admin.initialized', r) }), onError: err })}
            >
              {t('documents.admin.initialize')}
            </Button>
            <Button variant="subtle" disabled={!s?.configured} loading={m.sync.isPending} onClick={() => m.sync.mutate(undefined, { onSuccess: (r) => notifications.show({ color: 'green', message: t('documents.admin.synced', { count: r.applied }) }), onError: err })}>
              {t('documents.admin.sync')}
            </Button>
          </Group>
        </Stack>
      </Card>

      {s?.configured && acl.data && (
        <Card withBorder>
          <Text fw={600} mb="xs">{t('documents.admin.acl')}</Text>
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('documents.folders')}</Table.Th>
                  {ROLE_SUBJECTS.map((r) => <Table.Th key={r}>{t(subjectKey(r))}</Table.Th>)}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {acl.data.map((row) => (
                  <Table.Tr key={row.folderId} style={{ cursor: 'pointer' }} onClick={() => setEditing(row)}>
                    <Table.Td><Text size="xs" fw={row.explicit ? 600 : 400}>{row.path}</Text></Table.Td>
                    {ROLE_SUBJECTS.map((r) => <Table.Td key={r}>{levelText(row, r)}</Table.Td>)}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {!s?.credentials && <Alert color="yellow">{t('documents.admin.credentialsMissing')}</Alert>}
      {editing && <AclEditor row={editing} onClose={() => setEditing(null)} />}
    </Stack>
  )
}
