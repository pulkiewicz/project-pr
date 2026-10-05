export interface DriveItem {
  id: string
  name: string
  mimeType: string
  parents: string[]
  size: number | null
  md5: string | null
  version: string | null
  modifiedTime: string | null
  trashed: boolean
  webViewLink: string | null
  thumbnailLink: string | null
}

export interface DriveChange {
  fileId: string
  removed: boolean
  file: DriveItem | null
}

export interface DriveRevision {
  id: string
  modifiedTime: string
  size: number | null
  author: string | null
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Operacje na Shared Drive używane przez aplikację (konto serwisowe, supportsAllDrives). */
export interface DriveClient {
  getDrive(driveId: string): Promise<{ id: string; name: string }>
  listChildren(driveId: string, parentId: string): Promise<DriveItem[]>
  getFile(fileId: string): Promise<DriveItem>
  createFolder(parentId: string, name: string): Promise<DriveItem>
  /** Sesja resumable z nagłówkiem Origin — przeglądarka wysyła plik bezpośrednio do Google. */
  createUploadSession(p: { parentId: string; name: string; mimeType: string; size: number; origin: string }): Promise<string>
  uploadSmall(p: { parentId: string; name: string; mimeType: string; data: Uint8Array }): Promise<DriveItem>
  /** Pobranie zawartości (opcjonalnie zakresu `bytes=a-b`) — odpowiedź Google przekazywana dalej. */
  download(fileId: string, range?: string): Promise<Response>
  exportFile(fileId: string, mimeType: string): Promise<Response>
  fetchThumbnail(url: string): Promise<Response>
  copy(fileId: string, parentId: string, name: string): Promise<DriveItem>
  update(fileId: string, p: { name?: string; addParent?: string; removeParent?: string; trashed?: boolean }): Promise<DriveItem>
  revisions(fileId: string): Promise<DriveRevision[]>
  startPageToken(driveId: string): Promise<string>
  changes(driveId: string, pageToken: string): Promise<{ changes: DriveChange[]; nextPageToken: string | null; newStartPageToken: string | null }>
}
