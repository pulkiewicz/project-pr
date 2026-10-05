import { Anchor, Badge, Button, Divider, Drawer, Group, Image, Loader, Menu, Progress, Select, Stack, TagsInput, Text, TextInput } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconBrandGoogleDrive, IconDownload, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DOC_STATUSES, DOWNLOAD_CHUNK_BYTES, GOOGLE_NATIVE_MIME, type DocStatus, type FileDto, type FolderDto } from '#shared'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { fetchFileBlob, saveFile } from '../../lib/transfer'
import { useProjectId } from '../hrf/api'
import { contentPath, thumbnailPath, useDocsMutations } from './api'
import { PdfViewer } from './PdfViewer'

export const formatSize = (n: number | null) => (n === null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

function Preview({ file }: { file: FileDto }) {
  const { t } = useTranslation()
  const pid = useProjectId()
  const [state, setState] = useState<{ kind: 'pdf'; data: ArrayBuffer } | { kind: 'img'; url: string; thumb?: boolean } | { kind: 'none' } | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let url: string | null = null
    setState(null)
    void (async () => {
      try {
        if (file.googleNative || file.mimeType === 'application/pdf') {
          const { blob } = await fetchFileBlob(contentPath(pid, file.id, file.googleNative ? '?format=pdf&preview=1' : '?preview=1'), (l, tot) => setProgress(tot ? (l / tot) * 100 : 0))
          setState({ kind: 'pdf', data: await blob.arrayBuffer() })
        } else if (file.mimeType.startsWith('image/')) {
          // Obrazy do 4 MB w całości; większe — miniatura z Drive pobrana przez backend.
          const big = (file.size ?? 0) > DOWNLOAD_CHUNK_BYTES
          const { blob } = await fetchFileBlob(big ? thumbnailPath(pid, file.id) : contentPath(pid, file.id, '?preview=1'))
          url = URL.createObjectURL(blob)
          setState({ kind: 'img', url, thumb: big })
        } else setState({ kind: 'none' })
      } catch (e) {
        notifications.show({ color: 'red', message: errorMessage(e) })
        setState({ kind: 'none' })
      }
    })()
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.id, file.googleNative, file.mimeType, file.size, pid])
  if (!state) return <Stack gap={4}><Loader size="sm" />{progress > 0 && <Progress value={progress} size="xs" />}</Stack>
  if (state.kind === 'pdf') return <PdfViewer data={state.data} />
  if (state.kind === 'img') return <Stack gap={4}><Image src={state.url} alt={file.name} radius="sm" />{state.thumb && <Text size="xs" c="dimmed">{t('documents.previewTooLarge')}</Text>}</Stack>
  return <Text size="sm" c="dimmed">{t('documents.noPreview')}</Text>
}

export function FileDrawer({ file, folders, onClose }: { file: FileDto | null; folders: FolderDto[]; onClose: () => void }) {
  const { t } = useTranslation()
  const pid = useProjectId()
  const m = useDocsMutations()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<DocStatus>('draft')
  const [tags, setTags] = useState<string[]>([])
  const [dl, setDl] = useState<number | null>(null)
  const [revs, setRevs] = useState<{ id: string; modifiedTime: string; author: string | null }[] | null>(null)
  useEffect(() => {
    if (!file) return
    setName(file.name)
    setCategory(file.category ?? '')
    setStatus(file.status)
    setTags(file.tags)
    setRevs(null)
  }, [file])
  if (!file) return <Drawer opened={false} onClose={onClose} />

  const download = (q = '', filename = file.name) =>
    saveFile(contentPath(pid, file.id, q), filename, (l, tot) => setDl(tot ? (l / tot) * 100 : null))
      .catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))
      .finally(() => setDl(null))
  const exports = file.googleNative ? Object.keys(GOOGLE_NATIVE_MIME[file.mimeType as keyof typeof GOOGLE_NATIVE_MIME].exports) : []
  const save = () =>
    m.patch.mutate(
      { id: file.id, data: { name: name !== file.name ? name : undefined, category: category || null, status, tags } },
      { onSuccess: () => (notifications.show({ color: 'green', message: t('app.saved') }), onClose()), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
    )
  const writable = folders.filter((f) => f.level === 'write' || f.level === 'manage')

  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title={file.name}>
      <Stack gap="sm">
        <Group gap="xs">
          <Badge variant="light">{t(`documents.status.${file.status}`)}</Badge>
          <Text size="xs" c="dimmed">{file.folderPath} · {formatSize(file.size)} · {formatDateTime(file.modifiedAt)}{file.uploadedByName ? ` · ${file.uploadedByName}` : ''}</Text>
        </Group>
        <Group gap="xs">
          {file.googleNative ? (
            <Menu>
              <Menu.Target><Button size="xs" leftSection={<IconDownload size={14} />}>{t('documents.download')}</Button></Menu.Target>
              <Menu.Dropdown>{exports.map((fmt) => <Menu.Item key={fmt} onClick={() => download(`?format=${fmt}`, `${file.name}.${fmt}`)}>{t('documents.downloadAs', { fmt: fmt.toUpperCase() })}</Menu.Item>)}</Menu.Dropdown>
            </Menu>
          ) : (
            <Button size="xs" leftSection={<IconDownload size={14} />} onClick={() => download()}>{t('documents.download')}</Button>
          )}
          {file.webViewLink && (
            <Button size="xs" variant="light" component="a" href={file.webViewLink} target="_blank" rel="noopener noreferrer" leftSection={<IconBrandGoogleDrive size={14} />}>
              {t('documents.openInDocs')}
            </Button>
          )}
          {file.canWrite && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() =>
                modals.openConfirmModal({
                  title: t('documents.trash'),
                  children: <Text size="sm">{t('documents.trashConfirm', { name: file.name })}</Text>,
                  labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
                  confirmProps: { color: 'red' },
                  onConfirm: () => m.trash.mutate(file.id, { onSuccess: onClose, onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) }),
                })
              }
            >
              {t('documents.trash')}
            </Button>
          )}
        </Group>
        {dl !== null && <Progress value={dl} size="sm" />}

        {file.canWrite && (
          <>
            <Divider />
            <TextInput label={t('documents.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Group grow>
              <TextInput label={t('documents.category')} value={category} onChange={(e) => setCategory(e.currentTarget.value)} />
              <Select label={t('documents.statusLabel')} allowDeselect={false} data={DOC_STATUSES.map((s) => ({ value: s, label: t(`documents.status.${s}`) }))} value={status} onChange={(v) => v && setStatus(v as DocStatus)} />
            </Group>
            <TagsInput label={t('documents.tags')} value={tags} onChange={setTags} />
            <Group justify="space-between">
              <Select
                size="xs"
                w={320}
                placeholder={t('documents.move')}
                searchable
                data={writable.filter((f) => f.id !== file.folderId).map((f) => ({ value: f.id, label: f.path }))}
                onChange={(v) => v && m.patch.mutate({ id: file.id, data: { folderId: v } }, { onSuccess: onClose, onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}
              />
              <Button size="xs" onClick={save} loading={m.patch.isPending}>{t('app.save')}</Button>
            </Group>
          </>
        )}

        <Divider label={t('documents.links')} labelPosition="left" />
        {file.links.length === 0 ? <Text size="sm" c="dimmed">—</Text> : file.links.map((l) => (
          <Group key={`${l.targetType}${l.targetId}`} justify="space-between">
            <Text size="sm">{t(`documents.linkTargets.${l.targetType}`)}: {l.label ?? l.targetId}</Text>
            {file.canWrite && <Anchor size="xs" onClick={() => m.unlink.mutate({ id: file.id, targetType: l.targetType, targetId: l.targetId })}>{t('documents.unlink')}</Anchor>}
          </Group>
        ))}

        {!file.googleNative && (
          <>
            <Divider label={t('documents.versions')} labelPosition="left" />
            {revs === null ? (
              <Anchor size="sm" onClick={() => m.revisions(file.id).then(setRevs, (e) => notifications.show({ color: 'red', message: errorMessage(e) }))}>{t('documents.versions')}…</Anchor>
            ) : (
              revs.map((r) => <Text key={r.id} size="xs">{formatDateTime(r.modifiedTime)}{r.author ? ` · ${r.author}` : ''}</Text>)
            )}
          </>
        )}

        <Divider label={t('documents.preview')} labelPosition="left" />
        <Preview file={file} />
      </Stack>
    </Drawer>
  )
}
