import { ActionIcon, Alert, Badge, Button, Checkbox, FileInput, Group, Modal, Select, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconEye, IconFileImport, IconPlus } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ID_DOC_TYPES, VEHICLE_TYPES, type IdDocType, type PeopleImportRow, type PersonDto, type PersonInput, type VehicleDto, type VehicleInput, type VehicleType } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useAvizationMutations, usePersons, useVehicles } from './api'

function PersonModal({ person, opened, onClose }: { person: PersonDto | null; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const m = useAvizationMutations()
  const [f, setF] = useState<Partial<PersonInput>>({})
  useEffect(() => {
    if (opened) setF(person ? { firstName: person.firstName, lastName: person.lastName, idDocType: person.idDocType, company: person.company, phone: person.phone, roleOnSite: person.roleOnSite, notes: person.notes } : { idDocType: 'id_card', company: 'Envcheck' })
  }, [opened, person])
  const editable = !person || person.canEdit
  const save = () =>
    m.savePerson.mutate(
      { id: person?.id, version: person?.version, data: { ...f, idDocNumber: f.idDocNumber || undefined } },
      { onSuccess: () => (notifications.show({ color: 'green', message: t('app.saved') }), onClose()), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
    )
  const field = (k: keyof PersonInput, label: string, required = false) => (
    <TextInput label={label} required={required} disabled={!editable} value={(f[k] as string | null | undefined) ?? ''} onChange={(e) => setF({ ...f, [k]: e.currentTarget.value || null })} />
  )
  return (
    <Modal opened={opened} onClose={onClose} title={person ? t('avizations.person.edit') : t('avizations.person.add')}>
      <Stack>
        <Group grow>
          {field('firstName', t('avizations.person.firstName'), true)}
          {field('lastName', t('avizations.person.lastName'), true)}
        </Group>
        <Group grow>
          <Select label={t('avizations.person.docType')} allowDeselect={false} disabled={!editable} data={ID_DOC_TYPES.map((d) => ({ value: d, label: t(`avizations.docTypes.${d}`) }))} value={f.idDocType ?? 'id_card'} onChange={(v) => v && setF({ ...f, idDocType: v as IdDocType })} />
          <TextInput
            label={t('avizations.person.docNumber')}
            required={!person}
            disabled={!editable}
            placeholder={person ? `${person.idDocNumberMasked} (${t('avizations.person.docKeep')})` : ''}
            value={f.idDocNumber ?? ''}
            onChange={(e) => setF({ ...f, idDocNumber: e.currentTarget.value })}
            autoComplete="off"
          />
        </Group>
        {field('company', t('avizations.person.company'), true)}
        <Group grow>
          {field('phone', t('avizations.person.phone'))}
          {field('roleOnSite', t('avizations.person.role'))}
        </Group>
        {field('notes', t('avizations.person.notes'))}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t('app.cancel')}</Button>
          {editable && <Button onClick={save} loading={m.savePerson.isPending}>{t('app.save')}</Button>}
        </Group>
      </Stack>
    </Modal>
  )
}

function ImportModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const m = useAvizationMutations()
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<(PeopleImportRow & { swapped?: boolean })[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => (setFile(null), setRows(null), setError(null), onClose())
  const toImport = rows?.filter((r) => !r.duplicate && r.idDocNumber) ?? []
  return (
    <Modal opened={opened} onClose={close} title={t('avizations.import.title')} size="70rem">
      <Stack>
        <Text size="sm">{t('avizations.import.hint')}</Text>
        {error && <Alert color="red">{error}</Alert>}
        <Group align="flex-end">
          <FileInput style={{ flex: 1 }} accept=".xlsx" value={file} onChange={setFile} label="XLSX" />
          <Button
            disabled={!file}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                setRows((await m.importPreview(file!)).rows)
              } catch (e) {
                setError(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('hrf.wizard.preview')}
          </Button>
        </Group>
        {rows && (
          <Table.ScrollContainer minWidth={800}>
            <Table striped fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('avizations.person.firstName')}</Table.Th>
                  <Table.Th>{t('avizations.person.lastName')}</Table.Th>
                  <Table.Th>{t('avizations.person.docNumber')}</Table.Th>
                  <Table.Th>{t('avizations.person.docType')}</Table.Th>
                  <Table.Th>{t('avizations.vehicles')}</Table.Th>
                  <Table.Th>{t('avizations.person.company')}</Table.Th>
                  <Table.Th>{t('avizations.import.swap')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r, i) => (
                  <Table.Tr key={r.row} opacity={r.duplicate ? 0.5 : 1}>
                    <Table.Td>{r.firstName}</Table.Td>
                    <Table.Td>{r.lastName}</Table.Td>
                    <Table.Td>{r.idDocNumber}</Table.Td>
                    <Table.Td>{t(`avizations.docTypes.${r.idDocType}`)}</Table.Td>
                    <Table.Td>{r.vehicle ? `${r.vehicle.makeModel ?? ''} ${r.vehicle.registrationNumber}` : '—'}</Table.Td>
                    <Table.Td>
                      {r.company}
                      {r.duplicate && <Badge ml="xs" size="xs" color="gray">{t('avizations.import.duplicate')}</Badge>}
                      {r.warnings.map((w) => <Text key={w} size="xs" c="orange">{w}</Text>)}
                    </Table.Td>
                    <Table.Td>
                      <Checkbox
                        checked={!!r.swapped}
                        disabled={r.duplicate}
                        onChange={() => setRows(rows.map((x, j) => (j === i ? { ...x, firstName: x.lastName, lastName: x.firstName, swapped: !x.swapped } : x)))}
                        aria-label={t('avizations.import.swap')}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {rows && (
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>{t('app.cancel')}</Button>
            <Button
              disabled={!toImport.length}
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await m.importCommit(toImport.map(({ firstName, lastName, idDocType, idDocNumber, company, vehicle }) => ({ firstName, lastName, idDocType, idDocNumber, company: company || 'Envcheck', vehicle })))
                  notifications.show({ color: 'green', message: t('avizations.import.done', { persons: r.personsCreated, vehicles: r.vehiclesCreated, skipped: r.skipped }) })
                  close()
                } catch (e) {
                  setError(errorMessage(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('avizations.import.commit')} ({toImport.length})
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  )
}

export function PersonsTab() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = usePersons()
  const m = useAvizationMutations()
  const [edit, setEdit] = useState<PersonDto | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const list = (q.data ?? []).filter((p) => `${p.firstName} ${p.lastName} ${p.company}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <Stack>
      <Group justify="space-between">
        <TextInput placeholder={t('app.filter')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={260} />
        {can('avizations', 'create') && (
          <Group gap="xs">
            <Button size="xs" variant="light" leftSection={<IconFileImport size={14} />} onClick={() => setImporting(true)}>{t('avizations.import.button')}</Button>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEdit('new')}>{t('avizations.person.add')}</Button>
          </Group>
        )}
      </Group>
      <Table.ScrollContainer minWidth={700}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('avizations.person.lastName')}</Table.Th>
              <Table.Th>{t('avizations.person.firstName')}</Table.Th>
              <Table.Th>{t('avizations.person.docNumber')}</Table.Th>
              <Table.Th>{t('avizations.person.company')}</Table.Th>
              <Table.Th>{t('avizations.person.role')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((p) => (
              <Table.Tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setEdit(p)}>
                <Table.Td>{p.lastName}</Table.Td>
                <Table.Td>{p.firstName}</Table.Td>
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" ff="monospace">{revealed[p.id] ?? p.idDocNumberMasked}</Text>
                    <Text size="xs" c="dimmed">{t(`avizations.docTypes.${p.idDocType}`)}</Text>
                    {can('avizations', 'export') && !revealed[p.id] && (
                      <Tooltip label={t('avizations.person.reveal')}>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          aria-label={t('avizations.person.reveal')}
                          onClick={() =>
                            m.revealDoc(p.id).then(
                              (r) => (setRevealed({ ...revealed, [p.id]: r.idDocNumber }), notifications.show({ message: t('avizations.person.revealed') })),
                              (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                            )
                          }
                        >
                          <IconEye size={14} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{p.company}</Table.Td>
                <Table.Td>{p.roleOnSite ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <PersonModal opened={!!edit} person={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
      <ImportModal opened={importing} onClose={() => setImporting(false)} />
    </Stack>
  )
}

function VehicleModal({ vehicle, opened, onClose }: { vehicle: VehicleDto | null; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const m = useAvizationMutations()
  const persons = usePersons()
  const [f, setF] = useState<Partial<VehicleInput>>({})
  useEffect(() => {
    if (opened) setF(vehicle ? { registrationNumber: vehicle.registrationNumber, makeModel: vehicle.makeModel, vehicleType: vehicle.vehicleType, company: vehicle.company, defaultDriverId: vehicle.defaultDriverId } : { vehicleType: 'car', company: 'Envcheck' })
  }, [opened, vehicle])
  const editable = !vehicle || vehicle.canEdit
  const save = () =>
    m.saveVehicle.mutate(
      { id: vehicle?.id, version: vehicle?.version, data: vehicle && f.registrationNumber === vehicle.registrationNumber ? { ...f, registrationNumber: undefined } : f },
      { onSuccess: () => (notifications.show({ color: 'green', message: t('app.saved') }), onClose()), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
    )
  return (
    <Modal opened={opened} onClose={onClose} title={vehicle ? t('avizations.vehicle.edit') : t('avizations.vehicle.add')}>
      <Stack>
        <Group grow>
          <TextInput label={t('avizations.vehicle.registration')} required disabled={!editable} value={f.registrationNumber ?? ''} onChange={(e) => setF({ ...f, registrationNumber: e.currentTarget.value })} />
          <TextInput label={t('avizations.vehicle.makeModel')} disabled={!editable} value={f.makeModel ?? ''} onChange={(e) => setF({ ...f, makeModel: e.currentTarget.value || null })} />
        </Group>
        <Group grow>
          <Select label={t('avizations.vehicle.type')} allowDeselect={false} disabled={!editable} data={VEHICLE_TYPES.map((v) => ({ value: v, label: t(`avizations.vehicleTypes.${v}`) }))} value={f.vehicleType ?? 'car'} onChange={(v) => v && setF({ ...f, vehicleType: v as VehicleType })} />
          <TextInput label={t('avizations.vehicle.company')} required disabled={!editable} value={f.company ?? ''} onChange={(e) => setF({ ...f, company: e.currentTarget.value })} />
        </Group>
        <Select label={t('avizations.vehicle.defaultDriver')} clearable searchable disabled={!editable} data={persons.data?.map((p) => ({ value: p.id, label: `${p.lastName} ${p.firstName}` })) ?? []} value={f.defaultDriverId ?? null} onChange={(v) => setF({ ...f, defaultDriverId: v })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t('app.cancel')}</Button>
          {editable && <Button onClick={save} loading={m.saveVehicle.isPending}>{t('app.save')}</Button>}
        </Group>
      </Stack>
    </Modal>
  )
}

export function VehiclesTab() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useVehicles()
  const persons = usePersons()
  const [edit, setEdit] = useState<VehicleDto | 'new' | null>(null)
  const name = (id: string | null) => {
    const p = persons.data?.find((x) => x.id === id)
    return p ? `${p.firstName} ${p.lastName}` : '—'
  }
  return (
    <Stack>
      {can('avizations', 'create') && (
        <Group justify="flex-end">
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEdit('new')}>{t('avizations.vehicle.add')}</Button>
        </Group>
      )}
      <Table.ScrollContainer minWidth={600}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('avizations.vehicle.registration')}</Table.Th>
              <Table.Th>{t('avizations.vehicle.makeModel')}</Table.Th>
              <Table.Th>{t('avizations.vehicle.type')}</Table.Th>
              <Table.Th>{t('avizations.vehicle.company')}</Table.Th>
              <Table.Th>{t('avizations.vehicle.defaultDriver')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {q.data?.map((v) => (
              <Table.Tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setEdit(v)}>
                <Table.Td ff="monospace">{v.registrationNumber}</Table.Td>
                <Table.Td>{v.makeModel ?? '—'}</Table.Td>
                <Table.Td>{t(`avizations.vehicleTypes.${v.vehicleType}`)}</Table.Td>
                <Table.Td>{v.company}</Table.Td>
                <Table.Td>{name(v.defaultDriverId)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <VehicleModal opened={!!edit} vehicle={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
    </Stack>
  )
}
