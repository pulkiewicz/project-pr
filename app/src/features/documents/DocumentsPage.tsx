import { Alert, Box, Button, Card, Group, Loader, Modal, NavLink, Progress, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconFileText, IconFolder, IconFolderPlus, IconLock, IconSearch, IconTemplate, IconUpload } from '@tabler/icons-react'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_UPLOAD_BYTES, type FileDto, type FolderDto, type LinkTarget } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { uploadToDrive } from '../../lib/transfer'
import { useProjectId } from '../hrf/api'
import { useDocsMutations, useDriveStatus, useFiles, useFolders, useTemplates } from './api'
import { FileDrawer, formatSize } from './FileDrawer'

interface Upload {
  key: string
  name: string
  progress: number
  error?: string
}

export function useUploader(link?: { targetType: LinkTarget; targetId: string }) {
  const { t } = useTranslation()
  const pid = useProjectId()
  const m = useDocsMutations()
  const [uploads, setUploads] = useState<Upload[]>([])
  const start = (files: File[], folderId: string) => {
    for (const file of files) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploads((u) => [...u, { key, name: file.name, progress: 0, error: '> 200 MB' }])
        continue
      }
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }])
      uploadToDrive(pid, file, folderId, (l, tot) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: tot ? (l / tot) * 100 : 0 } : x))), link)
        .then(() => {
          setUploads((u) => u.filter((x) => x.key !== key))
          notifications.show({ color: 'green', message: t('documents.uploaded', { name: file.name }) })
          m.invalidate()
        })
        .catch((e) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: errorMessage(e) } : x))))
    }
  }
  return { uploads, start, clear: () => setUploads((u) => u.filter((x) => !x.error)) }
}

export function UploadList({ uploads }: { uploads: Upload[] }) {
  return (
    <Stack gap={4}>
      {uploads.map((u) => (
        <Stack key={u.key} gap={2}>
          <Text size="xs" c={u.error ? 'red' : undefined}>{u.name}{u.error ? ` — ${u.error}` : ''}</Text>
          {!u.error && <Progress value={u.progress} size="sm" animated />}
        </Stack>
      ))}
    </Stack>
  )
}

function FolderTree({ folders, selected, onSelect }: { folders: FolderDto[]; selected: string | null; onSelect: (id: string) => void }) {
  const children = useMemo(() => {
    const map = new Map<string | null, FolderDto[]>()
    for (const f of folders) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f])
    return map
  }, [folders])
  const ids = new Set(folders.map((f) => f.id))
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((f) => (
      <NavLink
        key={f.id}
        label={f.parentId === null ? '/' : f.name}
        leftSection={f.level === 'none' ? <IconLock size={14} /> : <IconFolder size={14} />}
        active={selected === f.id}
        disabled={f.level === 'none' && !(children.get(f.id) ?? []).length}
        onClick={() => f.level !== 'none' && onSelect(f.id)}
        defaultOpened={depth < 1}
        childrenOffset={12}
        py={3}
      >
        {(children.get(f.id) ?? []).length ? render(f.id, depth + 1) : undefined}
      </NavLink>
    ))
  const roots = folders.filter((f) => !f.parentId || !ids.has(f.parentId))
  return <>{roots.map((r) => render(r.parentId, 0))}</>
}

function TemplateModal({ opened, folderId, folders, onClose }: { opened: boolean; folderId: string | null; folders: FolderDto[]; onClose: (created?: FileDto) => void }) {
  const { t } = useTranslation()
  const templates = useTemplates(opened)
  const m = useDocsMutations()
  const [tpl, setTpl] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(folderId)
  const [name, setName] = useState('')
  const writable = folders.filter((f) => f.level === 'write' || f.level === 'manage')
  return (
    <Modal opened={opened} onClose={() => onClose()} title={t('documents.fromTemplate')}>
      <Stack>
        {templates.data?.length === 0 && <Alert color="gray">{t('documents.noTemplates')}</Alert>}
        <Select label={t('documents.template')} data={templates.data?.map((x) => ({ value: x.id, label: x.name })) ?? []} value={tpl} onChange={(v) => (setTpl(v), !name && setName(templates.data?.find((x) => x.id === v)?.name ?? ''))} />
        <Select label={t('documents.pickFolder')} searchable data={writable.map((f) => ({ value: f.id, label: f.path }))} value={target} onChange={setTarget} />
        <TextInput label={t('documents.templateName')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button
            disabled={!tpl || !target || !name.trim()}
            loading={m.fromTemplate.isPending}
            onClick={() => m.fromTemplate.mutate({ templateId: tpl!, folderId: target!, name: name.trim() }, { onSuccess: (f) => onClose(f), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}
          >
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export function DocumentsPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const status = useDriveStatus()
  const folders = useFolders(!!status.data?.configured)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [debounced] = useDebouncedValue(q, 300)
  const current = folders.data?.find((f) => f.id === folderId) ?? null
  const files = useFiles(debounced ? { q: debounced } : { folderId }, !!status.data?.configured && (!!folderId || !!debounced))
  const m = useDocsMutations()
  const { uploads, start } = useUploader()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<FileDto | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [drag, setDrag] = useState(false)
  const canWrite = current && (current.level === 'write' || current.level === 'manage')
  const desktop = useMediaQuery('(min-width: 62em)')

  if (status.isLoading) return <Loader />
  if (!status.data?.configured) {
    return (
      <Stack>
        <Title order={2}>{t('documents.title')}</Title>
        <Alert color="yellow">{t('documents.notConfigured')} {can('admin', 'edit') && t('documents.notConfiguredAdmin')}</Alert>
      </Stack>
    )
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (canWrite && folderId && e.dataTransfer.files.length) start([...e.dataTransfer.files], folderId)
  }
  const openFile = files.data?.find((f) => f.id === open?.id) ?? open

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>{t('documents.title')}</Title>
        <TextInput leftSection={<IconSearch size={16} />} placeholder={t('documents.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={{ base: '100%', sm: 360 }} />
      </Group>
      {desktop ? (
        <Group align="flex-start" wrap="nowrap" gap="md">
          <Card withBorder p="xs" w={320} miw={240} style={{ flexShrink: 0 }}>
            <ScrollArea h="calc(100vh - 230px)">{folders.data && <FolderTree folders={folders.data} selected={folderId} onSelect={(id) => (setFolderId(id), setQ(''))} />}</ScrollArea>
          </Card>
          {filesPanel()}
        </Group>
      ) : (
        <Box>
          <Select label={t('documents.folders')} searchable data={folders.data?.filter((f) => f.level !== 'none').map((f) => ({ value: f.id, label: f.path })) ?? []} value={folderId} onChange={(v) => (setFolderId(v), setQ(''))} mb="sm" />
          {filesPanel()}
        </Box>
      )}
      <FileDrawer file={openFile} folders={folders.data ?? []} onClose={() => setOpen(null)} />
      <Modal opened={newFolder !== null} onClose={() => setNewFolder(null)} title={t('documents.newFolder')}>
        <Stack>
          <TextInput label={t('documents.folderName')} value={newFolder ?? ''} onChange={(e) => setNewFolder(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button
              disabled={!newFolder?.trim()}
              loading={m.createFolder.isPending}
              onClick={() => m.createFolder.mutate({ parentId: folderId!, name: newFolder!.trim() }, { onSuccess: () => setNewFolder(null), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}
            >
              {t('app.save')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <TemplateModal opened={tplOpen} folderId={folderId} folders={folders.data ?? []} onClose={(f) => (setTplOpen(false), f && setOpen(f))} />
    </Stack>
  )

  function filesPanel() {
    return (
      <Card
        withBorder
        style={{ flex: 1, minWidth: 0, outline: drag ? '2px dashed var(--mantine-color-navy-6)' : undefined }}
        onDragOver={(e) => (e.preventDefault(), canWrite && setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap">
            <Text fw={600} size="sm">{debounced ? `„${debounced}”` : (current?.path ?? t('documents.pickFolder'))}{current && !canWrite ? ` (${t('documents.readOnly')})` : ''}</Text>
            {canWrite && !debounced && (
              <Group gap="xs">
                <Button size="xs" leftSection={<IconUpload size={14} />} onClick={() => input.current?.click()}>{t('documents.upload')}</Button>
                <Button size="xs" variant="light" leftSection={<IconFolderPlus size={14} />} onClick={() => setNewFolder('')}>{t('documents.newFolder')}</Button>
                <Button size="xs" variant="light" leftSection={<IconTemplate size={14} />} onClick={() => setTplOpen(true)}>{t('documents.fromTemplate')}</Button>
                <input ref={input} type="file" multiple hidden onChange={(e) => (folderId && e.currentTarget.files && start([...e.currentTarget.files], folderId), (e.currentTarget.value = ''))} />
              </Group>
            )}
          </Group>
          {canWrite && !debounced && <Text size="xs" c="dimmed">{t('documents.dropHere')}</Text>}
          <UploadList uploads={uploads} />
          {files.isLoading && <Loader size="sm" />}
          {files.data && files.data.length === 0 && <Text size="sm" c="dimmed">{t('documents.noFiles')}</Text>}
          {files.data && files.data.length > 0 && (
            <Table.ScrollContainer minWidth={600}>
              <Table highlightOnHover verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('documents.name')}</Table.Th>
                    {debounced && <Table.Th>{t('documents.folders')}</Table.Th>}
                    <Table.Th>{t('documents.statusLabel')}</Table.Th>
                    <Table.Th>{t('documents.size')}</Table.Th>
                    <Table.Th>{t('documents.modified')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {files.data.map((f) => (
                    <Table.Tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(f)}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <IconFileText size={16} color="var(--mantine-color-navy-6)" />
                          <Text size="sm">{f.name}</Text>
                          {f.category && <Text size="xs" c="dimmed">· {f.category}</Text>}
                        </Group>
                      </Table.Td>
                      {debounced && <Table.Td><Text size="xs">{f.folderPath}</Text></Table.Td>}
                      <Table.Td><Text size="xs">{t(`documents.status.${f.status}`)}</Text></Table.Td>
                      <Table.Td><Text size="xs">{formatSize(f.size)}</Text></Table.Td>
                      <Table.Td><Text size="xs">{formatDateTime(f.modifiedAt)}</Text></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Card>
    )
  }
}
