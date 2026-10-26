import { ActionIcon, Alert, Anchor, Button, Divider, Drawer, Group, Loader, Modal, NumberInput, Select, Stack, Table, Text, TextInput, Textarea, Timeline } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconExternalLink, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { INVOICE_EDITABLE, shareAmount, type InvoiceDetailDto } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { useInvoice, useInvoiceAttachments, useInvoiceTransition, useSaveAllocation, type InvoiceAction } from './api'
import { InvoiceDetails } from './InvoiceDetails'
import { InvoiceStatusBadge, formatMoney } from './status'

interface Row {
  projectId: string | null
  share: number | string
  description: string
}

const toRows = (d: InvoiceDetailDto): Row[] => d.allocations.map((a) => ({ projectId: a.projectId, share: a.share, description: a.description ?? '' }))
const rowKey = (r: Row) => [r.projectId, num(r.share), r.description.trim()]
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v.replace(',', '.')) || 0)
const round2 = (v: number) => Math.round(v * 100) / 100

/** Komentarz do decyzji: przy odrzuceniu obowiązkowy. */
function CommentModal({ action, onClose, onConfirm, loading }: { action: InvoiceAction | null; onClose: () => void; onConfirm: (comment: string) => void; loading: boolean }) {
  const { t } = useTranslation()
  const [comment, setComment] = useState('')
  useEffect(() => setComment(''), [action])
  const required = action === 'reject'
  const label = action === 'reject' ? t('invoices.reject') : action === 'approve' ? t('invoices.approve') : action === 'submit' ? t('invoices.submit') : t('invoices.reopen')
  return (
    <Modal opened={!!action} onClose={onClose} title={label}>
      <Stack>
        <Textarea autosize minRows={3} label={required ? t('invoices.rejectReason') : t('invoices.comment')} required={required} value={comment} onChange={(e) => setComment(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button color={action === 'reject' ? 'red' : undefined} loading={loading} disabled={required && !comment.trim()} onClick={() => onConfirm(comment.trim())}>
            {label}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export function InvoiceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const q = useInvoice(id)
  const save = useSaveAllocation()
  const move = useInvoiceTransition()
  const [rows, setRows] = useState<Row[]>([])
  const [note, setNote] = useState('')
  const [action, setAction] = useState<InvoiceAction | null>(null)
  const [showFiles, setShowFiles] = useState(false)
  const files = useInvoiceAttachments(id, showFiles)
  const d = q.data

  useEffect(() => {
    if (d) {
      setRows(toRows(d))
      setNote(d.note ?? '')
    }
  }, [d])
  useEffect(() => setShowFiles(false), [id])

  const editable = !!d && INVOICE_EDITABLE.includes(d.status) && can('invoices', 'edit')
  const projectOptions = useMemo(() => me.projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })), [me.projects])
  const total = round2(rows.reduce((s, r) => s + num(r.share), 0))
  const rest = round2(100 - total)
  const dirty = !!d && (JSON.stringify(rows.map(rowKey)) !== JSON.stringify(toRows(d).map(rowKey)) || note !== (d.note ?? ''))
  const invalid = total > 100 || rows.some((r) => !r.projectId || num(r.share) <= 0) || new Set(rows.map((r) => r.projectId)).size !== rows.length
  const allocatedCents = d?.netPrice == null ? 0 : rows.reduce((s, r) => s + shareAmount(d.netPrice!, num(r.share)), 0)

  const onError = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

  const saveAllocation = () =>
    d &&
    save.mutate(
      { id: d.id, data: { allocations: rows.map((r) => ({ projectId: r.projectId!, share: num(r.share), description: r.description.trim() || null })), note: note.trim() || null, version: d.version } },
      { onSuccess: () => notifications.show({ color: 'green', message: t('app.saved') }), onError },
    )

  const runAction = (comment: string) =>
    d && move.mutate({ id: d.id, action: action!, version: d.version, comment }, { onSuccess: () => setAction(null), onError })

  const splitEven = () => {
    const n = rows.length
    if (!n) return
    const base = Math.floor(10000 / n) / 100
    setRows(rows.map((r, i) => ({ ...r, share: i === 0 ? round2(100 - base * (n - 1)) : base })))
  }

  const ownSubmission = d?.status === 'pending' && d.submittedBy === me.user.id

  return (
    <Drawer opened={!!id} onClose={onClose} position="right" size="xl" title={d ? [d.number ?? d.description ?? t('invoices.fileNoData'), d.sellerName].filter(Boolean).join(' · ') : ''}>
      {q.isLoading || !d ? (
        <Loader />
      ) : (
        <Stack>
          {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
          <Group justify="space-between">
            <InvoiceStatusBadge status={d.status} />
            <Anchor size="sm" onClick={() => setShowFiles(true)}>
              {t('invoices.attachments')}
            </Anchor>
          </Group>
          {showFiles && (
            <Stack gap={2}>
              {files.isLoading && <Loader size="xs" />}
              {files.error && <Text size="sm" c="red">{errorMessage(files.error)}</Text>}
              {files.data?.length === 0 && <Text size="sm" c="dimmed">{t('invoices.noAttachments')}</Text>}
              {files.data?.map((f) => (
                <Anchor key={f.url} href={f.url} target="_blank" rel="noreferrer" size="sm">
                  <IconExternalLink size={12} /> {f.fileName}
                </Anchor>
              ))}
            </Stack>
          )}

          <InvoiceDetails key={d.version} d={d} editable={editable} />

          <Divider label={t('invoices.allocation')} labelPosition="left" />
          <Table fz="sm" verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('invoices.project')}</Table.Th>
                <Table.Th w={110}>{t('invoices.share')}</Table.Th>
                <Table.Th w={130} ta="right">
                  {t('invoices.amount')}
                </Table.Th>
                <Table.Th w={36} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Select
                      size="xs"
                      searchable
                      disabled={!editable}
                      data={projectOptions.filter((o) => o.value === r.projectId || !rows.some((x) => x.projectId === o.value))}
                      value={r.projectId}
                      onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, projectId: v } : x)))}
                      aria-label={t('invoices.project')}
                    />
                    {editable ? (
                      <TextInput
                        mt={4}
                        size="xs"
                        placeholder={t('invoices.allocationDescriptionHint')}
                        aria-label={t('invoices.allocationDescription')}
                        maxLength={500}
                        value={r.description}
                        onChange={(e) => {
                          const description = e.currentTarget.value
                          setRows(rows.map((x, j) => (j === i ? { ...x, description } : x)))
                        }}
                      />
                    ) : (
                      r.description && (
                        <Text size="xs" c="dimmed" mt={2}>
                          {r.description}
                        </Text>
                      )
                    )}
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" disabled={!editable} min={0.01} max={100} decimalScale={2} decimalSeparator="," suffix=" %" value={r.share} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, share: v } : x)))} aria-label={t('invoices.share')} />
                  </Table.Td>
                  <Table.Td ta="right">{d.netPrice == null ? '—' : formatMoney(shareAmount(d.netPrice, num(r.share)), d.currency)}</Table.Td>
                  <Table.Td>
                    {editable && (
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t('app.delete')}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td>
                  <Text size="sm" c="dimmed" title={t('invoices.generalHint')}>
                    {t('invoices.general')}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={rest < 0 ? 'red' : 'dimmed'}>
                    {rest.toLocaleString('pl-PL')} %
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" c="dimmed">
                    {d.netPrice == null ? '—' : formatMoney(d.netPrice - allocatedCents, d.currency)}
                  </Text>
                </Table.Td>
                <Table.Td />
              </Table.Tr>
            </Table.Tbody>
          </Table>
          {editable && (
            <>
              <Group gap="xs">
                <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} disabled={rows.length >= projectOptions.length} onClick={() => setRows([...rows, { projectId: null, share: rows.length ? 0 : 100, description: '' }])}>
                  {t('invoices.addProject')}
                </Button>
                {rows.length > 1 && (
                  <Button size="xs" variant="subtle" onClick={splitEven}>
                    {t('invoices.splitEven')}
                  </Button>
                )}
              </Group>
              <Textarea autosize minRows={2} label={t('invoices.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={2000} />
              <Group justify="flex-end">
                <Button variant="light" disabled={!dirty || invalid} loading={save.isPending} onClick={saveAllocation}>
                  {t('invoices.save')}
                </Button>
                <Button disabled={dirty || invalid || d.netPrice == null} onClick={() => setAction('submit')}>
                  {t('invoices.submit')}
                </Button>
              </Group>
              {dirty && (
                <Text size="xs" c="dimmed" ta="right">
                  {t('invoices.unsaved')}
                </Text>
              )}
            </>
          )}
          {!editable && d.note && (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {d.note}
            </Text>
          )}

          {d.submittedByName && d.submittedAt && (
            <Text size="xs" c="dimmed">
              {t('invoices.submittedBy', { name: d.submittedByName, at: formatDateTime(d.submittedAt) })}
              {d.decidedByName && d.decidedAt ? ` · ${t('invoices.decidedBy', { name: d.decidedByName, at: formatDateTime(d.decidedAt) })}` : ''}
            </Text>
          )}

          {d.status === 'pending' && (
            <Group justify="flex-end">
              {ownSubmission ? (
                <>
                  <Text size="sm" c="dimmed" mr="auto">
                    {t('invoices.selfApproval')}
                  </Text>
                  {can('invoices', 'edit') && (
                    <Button variant="default" onClick={() => setAction('reopen')}>
                      {t('invoices.withdraw')}
                    </Button>
                  )}
                </>
              ) : (
                can('invoices', 'approve') && (
                  <>
                    <Button color="red" variant="light" leftSection={<IconX size={16} />} onClick={() => setAction('reject')}>
                      {t('invoices.reject')}
                    </Button>
                    <Button color="green" leftSection={<IconCheck size={16} />} onClick={() => setAction('approve')}>
                      {t('invoices.approve')}
                    </Button>
                  </>
                )
              )}
            </Group>
          )}
          {d.status === 'approved' && can('invoices', 'edit') && (
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setAction('reopen')}>
                {t('invoices.reopen')}
              </Button>
            </Group>
          )}

          <Divider label={t('invoices.history')} labelPosition="left" />
          <Timeline bulletSize={14} lineWidth={2}>
            {d.events.map((e) => (
              <Timeline.Item key={e.id} color={e.kind === 'rejected' || e.kind === 'changed_in_infakt' ? 'red' : e.kind === 'approved' ? 'green' : undefined} title={<Text size="sm" fw={500}>{t(`invoices.event.${e.kind}`)}</Text>}>
                {e.comment && (
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {e.comment}
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  {formatDateTime(e.createdAt)}
                  {e.userName ? ` · ${e.userName}` : ''}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Stack>
      )}
      <CommentModal action={action} onClose={() => setAction(null)} onConfirm={runAction} loading={move.isPending} />
    </Drawer>
  )
}
