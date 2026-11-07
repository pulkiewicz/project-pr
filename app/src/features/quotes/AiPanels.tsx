import { ActionIcon, Alert, Anchor, Badge, Button, Card, Code, CopyButton, FileButton, Group, Loader, Menu, Modal, Progress, Select, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { IconBrandGoogleDrive, IconCheck, IconCopy, IconDots, IconExternalLink, IconFileText, IconPaperclip, IconRefresh, IconSparkles, IconTrash, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseDriveFolderId, type AiJobInput, type AiJobKind, type QuestionAudience, type QuestionDto, type QuoteDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatPLN } from '../../lib/format'
import { uploadQuoteInput } from '../../lib/transfer'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { quoteOps, useQuoteMutation } from './api'
import { driveFolderUrl, useAiJobs, useAiStatus, useDecideSuggestions, useDriveFolder, useDriveStatus, useInputMutation, useInputs, useQuestionMutation, useQuestions, useStartAiJob, useSuggestions } from './ai-api'

/** Przycisk zadania AI ze stanem (trwa / ostatni wynik / błąd); wyłączony, gdy AI niedostępne. */
export function AiJobButton({ q, kind, label, input, disabled }: { q: QuoteDto; kind: AiJobKind; label: string; input?: () => AiJobInput; disabled?: boolean }) {
  const { t } = useTranslation()
  const status = useAiStatus()
  const jobs = useAiJobs(q.id)
  const start = useStartAiJob(q.id)
  const last = jobs.data?.find((j) => j.kind === kind)
  const running = last?.status === 'queued' || last?.status === 'running'
  const unavailable = status.data && !status.data.available
  return (
    <Group gap="xs" wrap="wrap">
      <Tooltip label={t('ai.unavailable')} disabled={!unavailable}>
        <Button
          variant="light"
          color="grape"
          leftSection={<IconSparkles size={16} />}
          loading={running || start.isPending}
          disabled={!q.canEdit || !!unavailable || disabled}
          onClick={() => start.mutate(input ? input() : ({ kind } as AiJobInput))}
        >
          {label}
        </Button>
      </Tooltip>
      {status.data?.fake && (
        <Badge color="gray" variant="outline">
          {t('ai.fake')}
        </Badge>
      )}
      {running && (
        <Text size="xs" c="dimmed">
          {t('ai.running')}
        </Text>
      )}
      {last && !running && (
        <Text size="xs" c={last.status === 'error' ? 'red' : 'dimmed'} maw={520} lineClamp={2}>
          {formatDateTime(last.finishedAt ?? last.createdAt)} · {last.status === 'error' ? last.error : last.summary}
          {last.costUsd != null ? ` · $${last.costUsd.toFixed(3)}` : ''}
        </Text>
      )}
    </Group>
  )
}

/** Krok 2 — folder Google Drive wyceny: link wklejony ręcznie, otwieranie w nowej karcie, lista plików czytanych przez AI. */
function DriveFolderCard({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const folder = useDriveFolder(q.id, q.driveFolderId)
  const status = useDriveStatus()
  const [editing, setEditing] = useState(false)
  const [link, setLink] = useState('')
  const accountEmail = folder.data?.accountEmail ?? status.data?.accountEmail ?? null
  const save = (url: string | null) => mutation.mutate(quoteOps.patch({ driveFolderUrl: url, version: q.version }), { onSuccess: () => setEditing(false) })
  const shareHint = accountEmail && (
    <Group gap={4} wrap="wrap">
      <Text size="sm">{t('driveFolder.shareWith')}</Text>
      <Code>{accountEmail}</Code>
      <CopyButton value={accountEmail}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? t('questions.copied') : t('driveFolder.copyEmail')}>
            <ActionIcon size="sm" variant="subtle" onClick={copy} aria-label={t('driveFolder.copyEmail')}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
      <Text size="sm">{t('driveFolder.shareRole')}</Text>
    </Group>
  )
  const form = (
    <Group align="flex-end" wrap="wrap">
      <TextInput
        label={t('driveFolder.link')}
        placeholder="https://drive.google.com/drive/folders/…"
        style={{ flex: 1, minWidth: 280 }}
        value={link}
        onChange={(e) => setLink(e.currentTarget.value)}
        error={link.trim() && !parseDriveFolderId(link) ? t('driveFolder.invalid') : undefined}
        data-testid="drive-folder-link"
      />
      <Button disabled={!parseDriveFolderId(link)} loading={mutation.isPending} onClick={() => save(link.trim())}>
        {t('driveFolder.attach')}
      </Button>
      {editing && (
        <Button variant="default" onClick={() => setEditing(false)}>
          {t('app.cancel')}
        </Button>
      )}
    </Group>
  )
  const f = folder.data
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Group gap="xs">
          <IconBrandGoogleDrive size={20} />
          <Text fw={600}>{t('driveFolder.title')}</Text>
          {f && !f.error && <Badge variant="light">{t('driveFolder.count', { count: f.files.length })}</Badge>}
        </Group>
        {q.driveFolderId && (
          <Group gap="xs">
            <Button component="a" href={driveFolderUrl(q.driveFolderId)} target="_blank" rel="noopener noreferrer" leftSection={<IconExternalLink size={16} />} data-testid="drive-folder-open">
              {t('driveFolder.open')}
            </Button>
            <Tooltip label={t('driveFolder.refresh')}>
              <ActionIcon variant="light" size="lg" loading={folder.isFetching} onClick={() => void folder.refetch()} aria-label={t('driveFolder.refresh')}>
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            {q.canEdit && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="light" size="lg" aria-label={t('driveFolder.title')}>
                    <IconDots size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    onClick={() => {
                      setLink(driveFolderUrl(q.driveFolderId!))
                      setEditing(true)
                    }}
                  >
                    {t('driveFolder.change')}
                  </Menu.Item>
                  <Menu.Item color="red" onClick={() => save(null)}>
                    {t('driveFolder.detach')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        )}
      </Group>
      {(!q.driveFolderId || editing) && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {t('driveFolder.hint')}
          </Text>
          {shareHint}
          {q.canEdit ? form : !q.driveFolderId && <Text size="sm">{t('driveFolder.none')}</Text>}
        </Stack>
      )}
      {q.driveFolderId && !editing && (
        <>
          {folder.isLoading && <Loader size="sm" />}
          {f?.error === 'not_accessible' && (
            <Alert color="yellow" variant="light" title={t('driveFolder.noAccess')}>
              {shareHint ?? t('driveFolder.noAccessGeneric')}
            </Alert>
          )}
          {f?.error === 'not_a_folder' && <Alert color="yellow" variant="light">{t('driveFolder.notAFolder')}</Alert>}
          {f?.error === 'not_configured' && <Alert color="yellow" variant="light">{t('driveFolder.notConfigured')}</Alert>}
          {f && !f.error && !f.files.length && <Alert variant="light">{t('driveFolder.empty')}</Alert>}
          {f && !f.error && f.files.length > 0 && (
            <Table verticalSpacing={4}>
              <Table.Tbody>
                {f.files.map((x) => (
                  <Table.Tr key={x.id} data-testid="drive-folder-file">
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <IconFileText size={16} style={{ flexShrink: 0 }} />
                        {x.path && (
                          <Text size="sm" c="dimmed">
                            {x.path}
                          </Text>
                        )}
                        {x.webViewLink ? (
                          <Anchor href={x.webViewLink} target="_blank" rel="noopener noreferrer" size="sm">
                            {x.name}
                          </Anchor>
                        ) : (
                          <Text size="sm">{x.name}</Text>
                        )}
                        {!x.aiReadable && (
                          <Tooltip label={t('inputs.notReadableHint')}>
                            <Badge color="gray" variant="outline">
                              {t('inputs.notReadable')}
                            </Badge>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td w={110} ta="right">
                      <Text size="xs" c="dimmed">
                        {x.size != null ? `${Math.max(1, Math.round(x.size / 1024))} KB` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td w={150}>
                      <Text size="xs" c="dimmed">
                        {x.modifiedTime ? formatDateTime(x.modifiedTime) : ''}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {f?.truncated && (
            <Text size="xs" c="dimmed" mt={4}>
              {t('driveFolder.truncated')}
            </Text>
          )}
        </>
      )}
    </Card>
  )
}

/** Krok 2: folder Drive wyceny + wklejone treści (maile) i pliki przesłane z aplikacji. */
export function InputsPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const inputs = useInputs(q.id)
  const drive = useDriveStatus()
  const m = useInputMutation(q.id)
  const [paste, setPaste] = useState<{ name: string; text: string } | null>(null)
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null)

  const upload = async (files: File[]) => {
    for (const file of files) {
      setProgress({ name: file.name, pct: 0 })
      try {
        const list = await uploadQuoteInput(q.id, file, (loaded, total) => setProgress({ name: file.name, pct: Math.round((loaded / Math.max(total, 1)) * 100) }))
        qc.setQueryData(['inputs', q.id], list)
      } catch (e) {
        notifications.show({ color: 'red', message: `${file.name}: ${errorMessage(e)}` })
      }
    }
    setProgress(null)
  }

  return (
    <Stack>
      <DriveFolderCard q={q} />
      <Group justify="space-between" wrap="wrap">
        <Stack gap={0}>
          <Text fw={600}>{t('inputs.title')}</Text>
          <Text size="sm" c="dimmed" maw={640}>
            {t('inputs.hint')}
          </Text>
        </Stack>
        {q.canEdit && (
          <Group gap="xs">
            {drive.data?.configured && (
              <FileButton multiple onChange={(f) => void upload(f)} disabled={!!progress}>
                {(props) => (
                  <Button {...props} variant="light" leftSection={<IconPaperclip size={16} />} disabled={!!progress}>
                    {t('inputs.addFile')}
                  </Button>
                )}
              </FileButton>
            )}
            <Button variant="light" leftSection={<IconFileText size={16} />} onClick={() => setPaste({ name: t('inputs.mailDefault'), text: '' })}>
              {t('inputs.paste')}
            </Button>
          </Group>
        )}
      </Group>
      {progress && (
        <Stack gap={2}>
          <Text size="xs">{progress.name}</Text>
          <Progress value={progress.pct} />
        </Stack>
      )}
      {inputs.isLoading ? (
        <Loader />
      ) : !inputs.data?.length ? (
        <Text size="sm" c="dimmed">
          {t('inputs.empty')}
        </Text>
      ) : (
        <Table>
          <Table.Tbody>
            {inputs.data.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {i.kind === 'text' ? <IconFileText size={16} /> : <IconPaperclip size={16} />}
                    {i.webViewLink ? (
                      <Anchor href={i.webViewLink} target="_blank" rel="noopener noreferrer" size="sm">
                        {i.name}
                      </Anchor>
                    ) : (
                      <Text size="sm">{i.name}</Text>
                    )}
                    {i.status === 'uploading' && <Badge color="yellow" variant="light">{t('inputs.uploading')}</Badge>}
                    {!i.aiReadable && (
                      <Tooltip label={t('inputs.notReadableHint')}>
                        <Badge color="gray" variant="outline">
                          {t('inputs.notReadable')}
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>
                  {i.textPreview && (
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {i.textPreview}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td w={110} ta="right">
                  <Text size="xs" c="dimmed">
                    {i.size != null && i.kind === 'file' ? `${Math.max(1, Math.round(i.size / 1024))} KB` : ''}
                  </Text>
                </Table.Td>
                <Table.Td w={200}>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(i.createdAt)}
                    {i.createdByName ? ` · ${i.createdByName}` : ''}
                  </Text>
                </Table.Td>
                <Table.Td w={40}>
                  {q.canEdit && (
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => m.mutate({ method: 'DELETE', path: `/${i.id}` })} aria-label={t('app.delete')}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={!!paste} onClose={() => setPaste(null)} title={t('inputs.paste')} size="lg">
        {paste && (
          <Stack>
            <TextInput label={t('inputs.name')} value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.currentTarget.value })} />
            <Textarea label={t('inputs.text')} autosize minRows={8} maxRows={20} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.currentTarget.value })} data-autofocus />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPaste(null)}>
                {t('app.cancel')}
              </Button>
              <Button disabled={!paste.name.trim() || !paste.text.trim()} loading={m.isPending} onClick={() => m.mutate({ method: 'POST', path: '/text', json: paste }, { onSuccess: () => setPaste(null) })}>
                {t('app.save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}

/** Krok 5: propozycje AI do akceptacji (nie wchodzą do sumy, dopóki ich nie zaakceptujesz). */
export function SuggestionsPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const s = useSuggestions(q.id)
  const decide = useDecideSuggestions(q.id)
  const [hint, setHint] = useState('')
  const pending = s.data ?? []
  const total = pending.reduce((a, x) => a + (x.cost ?? 0), 0)
  return (
    <Card withBorder bg="grape.0">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" align="flex-end">
          <Textarea
            label={t('ai.proposeHint')}
            placeholder={t('ai.proposeHintPlaceholder')}
            autosize
            minRows={1}
            style={{ flex: 1, minWidth: 260 }}
            disabled={!q.canEdit}
            value={hint}
            onChange={(e) => setHint(e.currentTarget.value)}
          />
          <AiJobButton q={q} kind="propose_lines" label={t('ai.propose')} input={() => ({ kind: 'propose_lines', hint: hint.trim() || null })} disabled={!q.canEditCosts} />
        </Group>
        {pending.length > 0 && (
          <>
            <Group justify="space-between">
              <Text fw={600}>
                {t('ai.suggestions', { count: pending.length })}
                {q.canSeeCosts ? ` · ${formatPLN(total)}` : ''}
              </Text>
              {q.canEdit && (
                <Group gap="xs">
                  <Button size="xs" variant="default" leftSection={<IconX size={14} />} onClick={() => decide.mutate({ ids: 'all', accept: false })}>
                    {t('ai.rejectAll')}
                  </Button>
                  <Button size="xs" color="grape" leftSection={<IconCheck size={14} />} loading={decide.isPending} onClick={() => decide.mutate({ ids: 'all', accept: true })}>
                    {t('ai.acceptAll')}
                  </Button>
                </Group>
              )}
            </Group>
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing={4} fz="sm" bg="white">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('quotes.section')}</Table.Th>
                    <Table.Th>{t('quotes.line')}</Table.Th>
                    {q.canSeeCosts && <Table.Th ta="right">{t('quotes.lineCost')}</Table.Th>}
                    <Table.Th>{t('quotes.justification')}</Table.Th>
                    <Table.Th w={90}>{t('quotes.confidence')}</Table.Th>
                    <Table.Th w={70} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pending.map((x) => (
                    <Table.Tr key={x.id} data-testid="ai-suggestion">
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {q.devices.length > 1 ? `${x.deviceName} · ` : ''}
                          {x.sectionName}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="light" color={x.action === 'add' ? 'green' : 'blue'} mr={4}>
                          {t(`ai.action.${x.action}`)}
                        </Badge>
                        {x.payload.group ? `${x.payload.group} · ` : ''}
                        {x.payload.name}
                        {x.payload.quantity !== 1 ? ` × ${x.payload.quantity}` : ''}
                      </Table.Td>
                      {q.canSeeCosts && (
                        <Table.Td ta="right">
                          <Text size="sm" fw={500}>
                            {x.cost != null ? formatPLN(x.cost) : '—'}
                          </Text>
                          {x.current?.cost != null && (
                            <Text size="xs" c="dimmed" td="line-through">
                              {formatPLN(x.current.cost)}
                            </Text>
                          )}
                        </Table.Td>
                      )}
                      <Table.Td>
                        <Tooltip label={x.payload.justification} multiline w={420}>
                          <Text size="xs" lineClamp={2}>
                            {x.payload.justification}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="outline" color={x.payload.confidence === 'low' ? 'orange' : x.payload.confidence === 'high' ? 'green' : 'gray'}>
                          {t(`quotes.confidenceName.${x.payload.confidence}`)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {q.canEdit && (
                          <Group gap={2} wrap="nowrap">
                            <ActionIcon size="sm" color="green" variant="light" onClick={() => decide.mutate({ ids: [x.id], accept: true })} aria-label={t('ai.accept')}>
                              <IconCheck size={14} />
                            </ActionIcon>
                            <ActionIcon size="sm" color="gray" variant="light" onClick={() => decide.mutate({ ids: [x.id], accept: false })} aria-label={t('ai.reject')}>
                              <IconX size={14} />
                            </ActionIcon>
                          </Group>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </>
        )}
      </Stack>
    </Card>
  )
}

function QuestionRow({ q, item }: { q: QuoteDto; item: QuestionDto }) {
  const { t } = useTranslation()
  const m = useQuestionMutation(q.id)
  const [answer, setAnswer] = useState(item.answer ?? '')
  return (
    <Card withBorder padding="xs" opacity={item.status === 'dismissed' ? 0.5 : 1} data-testid="question">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ flex: 1 }}>
          <Text size="sm" fw={500}>
            {item.text}
          </Text>
          {item.context && (
            <Text size="xs" c="dimmed">
              {item.context}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {item.source === 'ai' ? 'AI · ' : ''}
            {item.assigneeName ? `${t('questions.assignee')}: ${item.assigneeName} · ` : ''}
            {formatDateTime(item.createdAt)}
          </Text>
        </Stack>
        <Group gap={4} wrap="nowrap">
          <Badge size="sm" variant="light" color={item.status === 'answered' ? 'green' : item.status === 'open' ? 'orange' : 'gray'}>
            {t(`questions.status.${item.status}`)}
          </Badge>
          {item.status !== 'dismissed' && q.canEdit && (
            <Tooltip label={t('questions.dismiss')}>
              <ActionIcon size="sm" variant="subtle" onClick={() => m.mutate({ id: item.id, json: { status: 'dismissed' } })} aria-label={t('questions.dismiss')}>
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      {item.audience === 'internal' && item.status !== 'dismissed' && (
        <Group mt={6} align="flex-end" wrap="nowrap">
          <Textarea size="xs" autosize minRows={1} placeholder={t('questions.answer')} style={{ flex: 1 }} value={answer} onChange={(e) => setAnswer(e.currentTarget.value)} />
          <Button size="xs" disabled={!answer.trim() || answer === item.answer} loading={m.isPending} onClick={() => m.mutate({ id: item.id, json: { answer } })}>
            {t('questions.saveAnswer')}
          </Button>
        </Group>
      )}
      {item.answeredByName && (
        <Text size="xs" c="dimmed" mt={2}>
          {t('questions.answeredBy', { name: item.answeredByName, date: formatDateTime(item.answeredAt) })}
        </Text>
      )}
    </Card>
  )
}

/** Krok 6: pytania do Kamila (w aplikacji) i do klienta (do skopiowania do maila). */
export function QuestionsPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const list = useQuestions(q.id)
  const m = useQuestionMutation(q.id)
  const [draft, setDraft] = useState<{ audience: QuestionAudience; text: string }>({ audience: 'internal', text: '' })
  if (list.isLoading) return <Loader />
  const items = list.data ?? []
  const clientText = items
    .filter((x) => x.audience === 'client' && x.status !== 'dismissed')
    .map((x, i) => `${i + 1}. ${x.text}`)
    .join('\n')
  const section = (audience: QuestionAudience) => {
    const rows = items.filter((x) => x.audience === audience)
    return (
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>{t(`questions.audience.${audience}`)}</Text>
          {audience === 'client' && clientText && (
            <CopyButton value={clientText}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={copy}>
                  {copied ? t('questions.copied') : t('questions.copy')}
                </Button>
              )}
            </CopyButton>
          )}
        </Group>
        {!rows.length && (
          <Text size="sm" c="dimmed">
            {t('questions.none')}
          </Text>
        )}
        {rows.map((x) => (
          <QuestionRow key={x.id} q={q} item={x} />
        ))}
      </Stack>
    )
  }
  return (
    <Stack>
      <AiJobButton q={q} kind="questions" label={t('ai.questions')} />
      {section('internal')}
      {section('client')}
      {q.canEdit && can('quotes', 'edit') && (
        <Group align="flex-end">
          <Select
            w={180}
            allowDeselect={false}
            data={(['internal', 'client'] as const).map((a) => ({ value: a, label: t(`questions.audience.${a}`) }))}
            value={draft.audience}
            onChange={(v) => v && setDraft({ ...draft, audience: v as QuestionAudience })}
          />
          <TextInput placeholder={t('questions.add')} style={{ flex: 1 }} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.currentTarget.value })} />
          <Button disabled={!draft.text.trim()} loading={m.isPending} onClick={() => m.mutate({ json: { audience: draft.audience, text: draft.text.trim() } }, { onSuccess: () => setDraft({ ...draft, text: '' }) })}>
            {t('questions.add')}
          </Button>
        </Group>
      )}
    </Stack>
  )
}

export function FolderLink({ folderId, label }: { folderId: string | null; label?: string }) {
  const { t } = useTranslation()
  if (!folderId) return null
  return (
    <Anchor href={driveFolderUrl(folderId)} target="_blank" rel="noopener noreferrer" size="sm">
      <Group gap={4} wrap="nowrap">
        <IconExternalLink size={14} />
        {label ?? t('inputs.folder')}
      </Group>
    </Anchor>
  )
}
