import { Alert, Anchor, Badge, Button, Card, FileButton, Group, List, Modal, ScrollArea, Stack, Table, Text, Textarea, Title, TypographyStylesProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconDownload, IconExternalLink, IconPencil, IconUpload } from '@tabler/icons-react'
import { Marked } from 'marked'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COMPETITION_GUIDELINES_MAX, type CompetitionGuidelinesDto, type CompetitionMatch, type CompetitionProduct, type QuoteDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatNumber } from '../../lib/format'
import { AiJobButton } from './AiPanels'

const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

const useGuidelines = () => useQuery({ queryKey: ['competition-guidelines'], queryFn: () => api<CompetitionGuidelinesDto>('/competition-guidelines') })

function useSaveGuidelines() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { markdown: string; fileName: string }) => api<CompetitionGuidelinesDto>('/competition-guidelines', { method: 'PUT', json: v }),
    onSuccess: (g) => qc.setQueryData(['competition-guidelines'], g),
    onError: fail,
  })
}

/** Markdown wytycznych (plik wczytany przez użytkownika): surowy HTML wyświetlany jako tekst, linki tylko http(s)/mailto. */
const md = new Marked({
  gfm: true,
  async: false,
  renderer: {
    html: ({ text }) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noreferrer">${label}</a>` : label
    },
    image: ({ text }) => text,
    // Nagłówki o trzy poziomy niżej — wytyczne są kartą w kroku, nie stroną.
    heading({ tokens, depth }) {
      const level = Math.min(depth + 3, 6)
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>`
    },
  },
})

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Wytyczne analizy konkurencji — jeden plik .md wspólny dla wszystkich wycen: podgląd, wczytanie pliku, edycja, pobranie. */
function GuidelinesCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation()
  const g = useGuidelines()
  const save = useSaveGuidelines()
  const [edit, setEdit] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const html = useMemo(() => (g.data ? (md.parse(g.data.markdown) as string) : ''), [g.data])
  const upload = async (file: File | null) => {
    if (!file) return
    if (!/\.(md|markdown|txt)$/i.test(file.name)) return fail(new Error(t('competition.mdOnly')))
    const text = await file.text()
    if (!text.trim()) return fail(new Error(t('competition.emptyFile')))
    if (text.length > COMPETITION_GUIDELINES_MAX) return fail(new Error(t('competition.tooLong')))
    save.mutate({ markdown: text, fileName: file.name }, { onSuccess: () => notifications.show({ color: 'green', message: t('competition.uploaded', { name: file.name }) }) })
  }
  return (
    <Card withBorder data-testid="competition-guidelines">
      <Group justify="space-between" align="flex-start" wrap="wrap" mb="xs">
        <div>
          <Title order={5}>{t('competition.guidelines')}</Title>
          <Text size="xs" c="dimmed">
            {t('competition.guidelinesShared')}
          </Text>
          {g.data && (
            <Text size="xs" c="dimmed">
              {g.data.fileName}
              {g.data.isDefault ? ` · ${t('competition.default')}` : ` · ${formatDateTime(g.data.updatedAt!)}${g.data.updatedByName ? ` · ${g.data.updatedByName}` : ''}`}
            </Text>
          )}
        </div>
        <Group gap="xs">
          {canEdit && (
            <FileButton onChange={(f) => void upload(f)} accept=".md,.markdown,.txt,text/markdown,text/plain">
              {(props) => (
                <Button {...props} size="xs" variant="light" leftSection={<IconUpload size={14} />} loading={save.isPending} data-testid="guidelines-upload">
                  {t('competition.upload')}
                </Button>
              )}
            </FileButton>
          )}
          {canEdit && g.data && (
            <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setEdit(g.data!.markdown)} data-testid="guidelines-edit">
              {t('app.edit')}
            </Button>
          )}
          {g.data && (
            <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={() => download(g.data!.fileName, g.data!.markdown)}>
              {t('competition.download')}
            </Button>
          )}
        </Group>
      </Group>
      {g.data && (
        <>
          <ScrollArea.Autosize mah={expanded ? undefined : 220}>
            <TypographyStylesProvider fz="sm">
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </TypographyStylesProvider>
          </ScrollArea.Autosize>
          <Anchor component="button" type="button" size="xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('competition.collapse') : t('competition.expand')}
          </Anchor>
        </>
      )}
      <Modal opened={edit != null} onClose={() => setEdit(null)} title={t('competition.editTitle')} size="xl">
        <Stack>
          <Text size="sm" c="dimmed">
            {t('competition.guidelinesShared')}
          </Text>
          <Textarea autosize minRows={14} maxRows={30} value={edit ?? ''} onChange={(e) => setEdit(e.currentTarget.value)} styles={{ input: { fontFamily: 'monospace', fontSize: 13 } }} data-testid="guidelines-text" />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEdit(null)}>
              {t('app.cancel')}
            </Button>
            <Button
              loading={save.isPending}
              disabled={!edit?.trim() || edit === g.data?.markdown || (edit?.length ?? 0) > COMPETITION_GUIDELINES_MAX}
              onClick={() => save.mutate({ markdown: edit!, fileName: g.data?.fileName ?? 'wytyczne-konkurencja.md' }, { onSuccess: () => setEdit(null) })}
              data-testid="guidelines-save"
            >
              {t('app.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  )
}

const MATCH_COLOR: Record<CompetitionMatch, string> = { full: 'green', partial: 'yellow', none: 'gray' }

function priceLabel(p: CompetitionProduct, t: (k: string) => string) {
  if (p.price == null) return '—'
  const kind = p.priceNet === true ? ` ${t('competition.net')}` : p.priceNet === false ? ` ${t('competition.gross')}` : ''
  return `${formatNumber(p.price)} ${p.currency ?? ''}${kind}`.trim()
}

/** Krok 4a (opcjonalny): AI szuka w sieci produktów konkurencji spełniających parametry wyceny, z cenami — wg wspólnych wytycznych. */
export function CompetitionPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [hint, setHint] = useState('')
  const c = q.competition
  return (
    <Stack gap="lg">
      <GuidelinesCard canEdit={can('quotes', 'edit')} />
      <Card withBorder>
        <Title order={5} mb={4}>
          {t('competition.run')}
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          {t('competition.runHint')}
        </Text>
        <Stack gap="sm">
          <Textarea label={t('competition.hint')} placeholder={t('competition.hintPlaceholder')} autosize minRows={2} disabled={!q.canEdit} value={hint} onChange={(e) => setHint(e.currentTarget.value)} />
          <AiJobButton q={q} kind="competition" label={c ? t('competition.rerun') : t('competition.start')} input={() => ({ kind: 'competition', hint: hint.trim() || null })} />
        </Stack>
      </Card>
      {c && (
        <Card withBorder data-testid="competition-result">
          <Group justify="space-between" mb="xs">
            <Title order={5}>{t('competition.result')}</Title>
            <Text size="xs" c="dimmed">
              {formatDateTime(c.generatedAt)}
              {c.guidelinesFile ? ` · ${c.guidelinesFile}` : ''}
            </Text>
          </Group>
          <Text size="sm" mb="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {c.summary}
          </Text>
          {c.products.length === 0 ? (
            <Alert variant="light">{t('competition.none')}</Alert>
          ) : (
            <Table.ScrollContainer minWidth={900}>
              <Table verticalSpacing="xs" striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('competition.product')}</Table.Th>
                    <Table.Th>{t('competition.match')}</Table.Th>
                    <Table.Th>{t('competition.specs')}</Table.Th>
                    <Table.Th ta="right">{t('competition.price')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {c.products.map((p, i) => (
                    <Table.Tr key={i}>
                      <Table.Td maw={220}>
                        <Text size="sm" fw={600}>
                          {p.manufacturer}
                        </Text>
                        {p.url ? (
                          <Anchor href={p.url} target="_blank" rel="noreferrer" size="sm">
                            {p.model} <IconExternalLink size={12} />
                          </Anchor>
                        ) : (
                          <Text size="sm">{p.model}</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={MATCH_COLOR[p.match]}>
                          {t(`competition.matchName.${p.match}`)}
                        </Badge>
                        <Text size="xs" c="dimmed" mt={2}>
                          {t(`quotes.confidenceName.${p.confidence}`)}
                        </Text>
                      </Table.Td>
                      <Table.Td maw={420}>
                        <Text size="sm">{p.specs}</Text>
                        {p.deviations && (
                          <Text size="xs" c="orange">
                            {p.deviations}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" maw={240}>
                        <Text size="sm" fw={600}>
                          {priceLabel(p, t)}
                        </Text>
                        {p.priceNote && (
                          <Text size="xs" c="dimmed">
                            {p.priceNote}
                          </Text>
                        )}
                        {p.priceUrl && (
                          <Anchor href={p.priceUrl} target="_blank" rel="noreferrer" size="xs">
                            {t('competition.priceSource')}
                          </Anchor>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <Text size="xs" c="dimmed" mt="sm" fw={600}>
            {t('competition.criteria')}
          </Text>
          <List size="xs" c="dimmed">
            {c.criteria.map((x, i) => (
              <List.Item key={i}>{x}</List.Item>
            ))}
          </List>
        </Card>
      )}
    </Stack>
  )
}
