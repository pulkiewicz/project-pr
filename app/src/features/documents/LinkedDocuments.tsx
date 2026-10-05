import { Anchor, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconLink, IconUpload } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileDto, LinkTarget } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useDocsMutations, useDriveStatus, useFiles, useFolders } from './api'
import { useUploader, UploadList } from './DocumentsPage'
import { FileDrawer } from './FileDrawer'

/** Sekcja „Dokumenty” w szczegółach rekordu (HRF, zakupy, awizacje, plan tygodniowy). */
export function LinkedDocuments({ targetType, targetId, defaultFolderPath }: { targetType: LinkTarget; targetId: string; defaultFolderPath?: string }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const status = useDriveStatus()
  const enabled = can('documents', 'view') && !!status.data?.configured
  const files = useFiles({ targetType, targetId }, enabled)
  const folders = useFolders(enabled)
  const m = useDocsMutations()
  const { uploads, start } = useUploader({ targetType, targetId })
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<FileDto | null>(null)
  const [picker, setPicker] = useState(false)
  const [search, setSearch] = useState('')
  const found = useFiles({ q: search }, picker && search.length >= 2)
  const writable = folders.data?.filter((f) => f.level === 'write' || f.level === 'manage') ?? []
  const [folderId, setFolderId] = useState<string | null>(null)
  const target = folderId ?? writable.find((f) => f.path === defaultFolderPath)?.id ?? null
  if (!enabled) return null

  return (
    <Stack gap={6}>
      {files.data?.length === 0 && <Text size="sm" c="dimmed">{t('documents.noLinked')}</Text>}
      {files.data?.map((f) => (
        <Anchor key={f.id} size="sm" onClick={() => setOpen(f)}>{f.name}</Anchor>
      ))}
      <UploadList uploads={uploads} />
      {writable.length > 0 && (
        <Group gap="xs" align="flex-end">
          <Select size="xs" w={260} searchable placeholder={t('documents.pickFolder')} data={writable.map((f) => ({ value: f.id, label: f.path }))} value={target} onChange={setFolderId} aria-label={t('documents.pickFolder')} />
          <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} disabled={!target} onClick={() => input.current?.click()}>{t('documents.upload')}</Button>
          <Button size="xs" variant="subtle" leftSection={<IconLink size={14} />} onClick={() => setPicker(true)}>{t('documents.link')}</Button>
          <input ref={input} type="file" multiple hidden onChange={(e) => (target && e.currentTarget.files && start([...e.currentTarget.files], target), (e.currentTarget.value = ''))} />
        </Group>
      )}
      <Modal opened={picker} onClose={() => setPicker(false)} title={t('documents.link')}>
        <Stack>
          <TextInput placeholder={t('documents.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} data-autofocus />
          {found.data?.filter((f) => f.canWrite).map((f) => (
            <Group key={f.id} justify="space-between" wrap="nowrap">
              <Text size="sm" truncate>{f.name}<Text span size="xs" c="dimmed"> · {f.folderPath}</Text></Text>
              <Button size="xs" variant="light" onClick={() => m.link.mutate({ id: f.id, targetType, targetId }, { onSuccess: () => setPicker(false), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}>
                {t('documents.link')}
              </Button>
            </Group>
          ))}
        </Stack>
      </Modal>
      <FileDrawer file={files.data?.find((f) => f.id === open?.id) ?? open} folders={folders.data ?? []} onClose={() => setOpen(null)} />
    </Stack>
  )
}
