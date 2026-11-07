import { AI_READABLE_MIME, driveFolderUrl, type DriveFolderDto, type DriveFolderFileDto } from '#shared'
import { FOLDER_MIME, type DriveClient } from '../../integrations/drive/types.ts'

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
export const driveFileUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`

/** Limity przeglądania folderu wyceny (ochrona przed przypadkowo podpiętym dużym drzewem). */
const MAX_DEPTH = 3
const MAX_FILES = 200

/**
 * Pliki folderu Drive wyceny wraz z podfolderami. Najpierw `getFile` — zapytanie o zawartość
 * folderu bez dostępu zwraca w Google pustą listę, a nie błąd.
 */
export async function listDriveFolder(drive: DriveClient | null | undefined, folderId: string | null): Promise<DriveFolderDto> {
  const base = { folderId, url: folderId ? driveFolderUrl(folderId) : null, files: [] as DriveFolderFileDto[], accountEmail: drive?.accountEmail ?? null, truncated: false }
  if (!folderId) return { ...base, error: null }
  if (!drive) return { ...base, error: 'not_configured' }
  try {
    const root = await drive.getFile(folderId)
    if (root.mimeType !== FOLDER_MIME) return { ...base, error: 'not_a_folder' }
  } catch {
    return { ...base, error: 'not_accessible' }
  }
  const files: DriveFolderFileDto[] = []
  let truncated = false
  const walk = async (id: string, path: string, depth: number) => {
    const items = (await drive.listFolder(id)).sort((a, b) => a.name.localeCompare(b.name, 'pl'))
    for (const it of items) {
      if (files.length >= MAX_FILES) {
        truncated = true
        return
      }
      if (it.mimeType === FOLDER_MIME) {
        if (depth < MAX_DEPTH) await walk(it.id, `${path}${it.name}/`, depth + 1)
        else truncated = true
        continue
      }
      files.push({ id: it.id, name: it.name, path, mimeType: it.mimeType, size: it.size, modifiedTime: it.modifiedTime, webViewLink: it.webViewLink, aiReadable: AI_READABLE_MIME.includes(it.mimeType) })
    }
  }
  await walk(folderId, '', 1)
  return { ...base, files, truncated, error: null }
}
