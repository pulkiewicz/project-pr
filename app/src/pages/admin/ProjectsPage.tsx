import { Alert, Badge, Button, Group, Loader, Modal, NumberInput, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROJECT_CODE_RE, type ProjectAdminDto, type ProjectInput } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatPLNWhole } from '../../lib/format'

interface FormState {
  id?: string
  version?: number
  code: string
  name: string
  client: string
  contractNo: string
  procurementNo: string
  contractValue: number | string
  contractEndDate: string | null
}

const EMPTY: FormState = { code: '', name: '', client: '', contractNo: '', procurementNo: '', contractValue: '', contractEndDate: null }
const toForm = (p: ProjectAdminDto): FormState => ({ ...p, contractValue: p.contractValue ?? '', contractNo: p.contractNo === '-' ? '' : p.contractNo, procurementNo: p.procurementNo === '-' ? '' : p.procurementNo })

/** Projekty (Admin): zakładanie bez szansy w CRM (np. wewnętrzne), edycja danych, archiwizacja. */
export function ProjectsPage() {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'projects'], queryFn: () => api<ProjectAdminDto[]>('/admin/projects') })
  const [form, setForm] = useState<FormState | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  // Treść okna zostaje do końca animacji zamykania (bez pustego okna po zapisie).
  const last = useRef<FormState | null>(null)
  if (form) last.current = form
  const shown = form ?? last.current

  // Projekty są też w menu i listach wyboru (z /me) — po zmianie odśwież oba.
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'projects'] })
    void refresh()
  }
  const onError = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const data: ProjectInput = {
        code: f.code.trim(),
        name: f.name.trim(),
        client: f.client.trim(),
        contractNo: f.contractNo.trim() || '-',
        procurementNo: f.procurementNo.trim() || '-',
        contractValue: f.contractValue === '' ? null : Number(f.contractValue),
        contractEndDate: f.contractEndDate!,
      }
      if (!f.id) return api<ProjectAdminDto>('/admin/projects', { method: 'POST', json: data })
      const { code: _code, ...patch } = data
      return api<ProjectAdminDto>(`/admin/projects/${f.id}`, { method: 'PATCH', json: { ...patch, version: f.version } })
    },
    onSuccess: () => {
      setForm(null)
      notifications.show({ color: 'green', message: t('app.saved') })
      done()
    },
    onError,
  })

  const archive = useMutation({
    mutationFn: (v: { id: string; archive: boolean }) => api<ProjectAdminDto>(`/admin/projects/${v.id}/${v.archive ? 'archive' : 'restore'}`, { method: 'POST' }),
    onSuccess: done,
    onError,
  })

  const confirmArchive = (p: ProjectAdminDto) =>
    modals.openConfirmModal({
      title: t('projectsAdmin.archiveTitle', { code: p.code }),
      children: <Text size="sm">{t('projectsAdmin.archiveHint')}</Text>,
      labels: { confirm: t('projectsAdmin.archive'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => archive.mutate({ id: p.id, archive: true }),
    })

  const rows = (q.data ?? []).filter((p) => showArchived || !p.archived)
  const codeOk = !form || !!form.id || PROJECT_CODE_RE.test(form.code.trim())
  const valid = !!form && codeOk && !!form.name.trim() && !!form.client.trim() && !!form.contractEndDate

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('projectsAdmin.title')}</Title>
        <Group>
          <Switch label={t('projectsAdmin.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
          <Button leftSection={<IconPlus size={16} />} onClick={() => setForm(EMPTY)}>
            {t('projectsAdmin.add')}
          </Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        {t('projectsAdmin.hint')}
      </Text>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      {q.isLoading ? (
        <Loader />
      ) : (
        <Table withTableBorder striped fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('projectsAdmin.code')}</Table.Th>
              <Table.Th>{t('projectsAdmin.name')}</Table.Th>
              <Table.Th>{t('projectsAdmin.client')}</Table.Th>
              <Table.Th>{t('projectsAdmin.contractNo')}</Table.Th>
              <Table.Th ta="right">{t('projectsAdmin.value')}</Table.Th>
              <Table.Th>{t('projectsAdmin.endDate')}</Table.Th>
              <Table.Th>{t('projectsAdmin.source')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((p) => (
              <Table.Tr key={p.id} c={p.archived ? 'dimmed' : undefined}>
                <Table.Td fw={600}>
                  {p.code}
                  {p.archived && (
                    <Badge ml={6} size="xs" color="gray" variant="light">
                      {t('projectsAdmin.archived')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>{p.client}</Table.Td>
                <Table.Td>{p.contractNo}</Table.Td>
                <Table.Td ta="right">{p.contractValue != null ? formatPLNWhole(p.contractValue) : ''}</Table.Td>
                <Table.Td>{formatDate(p.contractEndDate)}</Table.Td>
                <Table.Td>{p.opportunityCode ? t('projectsAdmin.fromCrm', { code: p.opportunityCode }) : t('projectsAdmin.manual')}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    {!p.archived && (
                      <Button size="xs" variant="subtle" onClick={() => setForm(toForm(p))}>
                        {t('app.edit')}
                      </Button>
                    )}
                    {p.archived ? (
                      <Button size="xs" variant="subtle" onClick={() => archive.mutate({ id: p.id, archive: false })}>
                        {t('projectsAdmin.restore')}
                      </Button>
                    ) : (
                      <Button size="xs" variant="subtle" color="red" onClick={() => confirmArchive(p)}>
                        {t('projectsAdmin.archive')}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={!!form} onClose={() => setForm(null)} title={shown?.id ? t('projectsAdmin.edit', { code: shown.code }) : t('projectsAdmin.add')} size="lg">
        {shown && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput
                label={t('projectsAdmin.code')}
                description={shown.id ? t('projectsAdmin.codeFixed') : t('projectsAdmin.codeHint')}
                required
                disabled={!!shown.id}
                value={shown.code}
                onChange={(e) => setForm({ ...shown, code: e.currentTarget.value.toUpperCase() })}
                error={!codeOk && shown.code ? t('validation.projectCode') : undefined}
                maxLength={30}
              />
              <TextInput label={t('projectsAdmin.client')} required value={shown.client} onChange={(e) => setForm({ ...shown, client: e.currentTarget.value })} maxLength={300} />
            </SimpleGrid>
            <TextInput label={t('projectsAdmin.name')} required value={shown.name} onChange={(e) => setForm({ ...shown, name: e.currentTarget.value })} maxLength={300} />
            <SimpleGrid cols={2}>
              <TextInput label={t('projectsAdmin.contractNo')} value={shown.contractNo} onChange={(e) => setForm({ ...shown, contractNo: e.currentTarget.value })} maxLength={100} />
              <TextInput label={t('projectsAdmin.procurementNo')} value={shown.procurementNo} onChange={(e) => setForm({ ...shown, procurementNo: e.currentTarget.value })} maxLength={100} />
              <NumberInput label={t('projectsAdmin.value')} min={0} thousandSeparator=" " decimalSeparator="," suffix=" zł" value={shown.contractValue} onChange={(v) => setForm({ ...shown, contractValue: v })} />
              <DateInput
                label={t('projectsAdmin.endDate')}
                required
                valueFormat="DD.MM.YYYY"
                value={shown.contractEndDate ? new Date(`${shown.contractEndDate}T00:00:00`) : null}
                onChange={(d) => setForm({ ...shown, contractEndDate: d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null })}
              />
            </SimpleGrid>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setForm(null)}>
                {t('app.cancel')}
              </Button>
              <Button disabled={!valid} loading={save.isPending} onClick={() => form && save.mutate(form)}>
                {t('app.save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
