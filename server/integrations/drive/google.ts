import { SignJWT, importPKCS8 } from 'jose'
import { FOLDER_MIME, type DriveChange, type DriveClient, type DriveItem, type DriveRevision } from './types.ts'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FIELDS = 'id,name,mimeType,parents,size,md5Checksum,version,modifiedTime,trashed,webViewLink,thumbnailLink'
const ALL = 'supportsAllDrives=true'

export class DriveApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

interface RawFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  size?: string
  md5Checksum?: string
  version?: string
  modifiedTime?: string
  trashed?: boolean
  webViewLink?: string
  thumbnailLink?: string
}

const toItem = (f: RawFile): DriveItem => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  parents: f.parents ?? [],
  size: f.size ? Number(f.size) : null,
  md5: f.md5Checksum ?? null,
  version: f.version ?? null,
  modifiedTime: f.modifiedTime ?? null,
  trashed: !!f.trashed,
  webViewLink: f.webViewLink ?? null,
  thumbnailLink: f.thumbnailLink ?? null,
})

/**
 * Klient REST Drive v3 z uwierzytelnieniem kontem serwisowym (JWT bearer, RS256).
 * Bez domain-wide delegation — konto serwisowe jest członkiem Shared Drive (Content Manager).
 */
export class GoogleDriveClient implements DriveClient {
  private token: { value: string; until: number } | null = null

  constructor(private readonly email: string, private readonly privateKeyPem: string) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value
    const key = await importPKCS8(this.privateKeyPem, 'RS256')
    const now = Math.floor(Date.now() / 1000)
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/drive' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key)
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    })
    if (!res.ok) throw new DriveApiError(res.status, `Google token: ${await res.text()}`)
    const body = (await res.json()) as { access_token: string; expires_in: number }
    this.token = { value: body.access_token, until: Date.now() + body.expires_in * 1000 }
    return body.access_token
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${await this.accessToken()}`)
    const res = await fetch(url, { ...init, headers })
    if (!res.ok && res.status !== 206 && res.status !== 308) {
      throw new DriveApiError(res.status, `Drive ${init.method ?? 'GET'} ${url.split('?')[0]}: ${res.status} ${await res.text().catch(() => '')}`)
    }
    return res
  }

  private async json<T>(url: string, init?: RequestInit) {
    return (await (await this.call(url, init)).json()) as T
  }

  async getDrive(driveId: string) {
    return this.json<{ id: string; name: string }>(`${API}/drives/${driveId}`)
  }

  async listChildren(driveId: string, parentId: string) {
    const out: DriveItem[] = []
    let pageToken: string | undefined
    do {
      const q = new URLSearchParams({
        q: `'${parentId}' in parents and trashed = false`,
        corpora: 'drive',
        driveId,
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        pageSize: '1000',
        fields: `nextPageToken,files(${FIELDS})`,
        ...(pageToken ? { pageToken } : {}),
      })
      const r = await this.json<{ files: RawFile[]; nextPageToken?: string }>(`${API}/files?${q}`)
      out.push(...r.files.map(toItem))
      pageToken = r.nextPageToken
    } while (pageToken)
    return out
  }

  async getFile(fileId: string) {
    return toItem(await this.json<RawFile>(`${API}/files/${fileId}?${ALL}&fields=${FIELDS}`))
  }

  async createFolder(parentId: string, name: string) {
    return toItem(
      await this.json<RawFile>(`${API}/files?${ALL}&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      }),
    )
  }

  async createUploadSession(p: { parentId: string; name: string; mimeType: string; size: number; origin: string }) {
    const res = await this.call(`${UPLOAD}/files?uploadType=resumable&${ALL}&fields=${FIELDS}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': p.mimeType,
        'X-Upload-Content-Length': String(p.size),
        // Origin wymagany, by Google zwracał nagłówki CORS dla uploadu z przeglądarki.
        Origin: p.origin,
      },
      body: JSON.stringify({ name: p.name, parents: [p.parentId], mimeType: p.mimeType }),
    })
    const location = res.headers.get('location')
    if (!location) throw new DriveApiError(502, 'Drive: brak adresu sesji uploadu')
    return location
  }

  async uploadSmall(p: { parentId: string; name: string; mimeType: string; data: Uint8Array }) {
    const boundary = `pmo${crypto.randomUUID()}`
    const meta = JSON.stringify({ name: p.name, parents: [p.parentId], mimeType: p.mimeType })
    const enc = new TextEncoder()
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${p.mimeType}\r\n\r\n`)
    const tail = enc.encode(`\r\n--${boundary}--`)
    const body = new Uint8Array(head.length + p.data.length + tail.length)
    body.set(head, 0)
    body.set(p.data, head.length)
    body.set(tail, head.length + p.data.length)
    return toItem(
      await this.json<RawFile>(`${UPLOAD}/files?uploadType=multipart&${ALL}&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      }),
    )
  }

  download(fileId: string, range?: string) {
    return this.call(`${API}/files/${fileId}?alt=media&${ALL}`, { headers: range ? { Range: range } : {} })
  }

  exportFile(fileId: string, mimeType: string) {
    return this.call(`${API}/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`)
  }

  fetchThumbnail(url: string) {
    return this.call(url)
  }

  async copy(fileId: string, parentId: string, name: string) {
    return toItem(
      await this.json<RawFile>(`${API}/files/${fileId}/copy?${ALL}&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, parents: [parentId] }),
      }),
    )
  }

  async update(fileId: string, p: { name?: string; addParent?: string; removeParent?: string; trashed?: boolean }) {
    const q = new URLSearchParams({ supportsAllDrives: 'true', fields: FIELDS })
    if (p.addParent) q.set('addParents', p.addParent)
    if (p.removeParent) q.set('removeParents', p.removeParent)
    const body: Record<string, unknown> = {}
    if (p.name) body.name = p.name
    if (p.trashed !== undefined) body.trashed = p.trashed
    return toItem(await this.json<RawFile>(`${API}/files/${fileId}?${q}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  }

  async revisions(fileId: string): Promise<DriveRevision[]> {
    const r = await this.json<{ revisions?: { id: string; modifiedTime: string; size?: string; lastModifyingUser?: { displayName?: string } }[] }>(
      `${API}/files/${fileId}/revisions?fields=revisions(id,modifiedTime,size,lastModifyingUser/displayName)`,
    )
    return (r.revisions ?? []).map((x) => ({ id: x.id, modifiedTime: x.modifiedTime, size: x.size ? Number(x.size) : null, author: x.lastModifyingUser?.displayName ?? null }))
  }

  async startPageToken(driveId: string) {
    return (await this.json<{ startPageToken: string }>(`${API}/changes/startPageToken?driveId=${driveId}&${ALL}`)).startPageToken
  }

  async changes(driveId: string, pageToken: string) {
    const q = new URLSearchParams({
      pageToken,
      driveId,
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      includeRemoved: 'true',
      pageSize: '500',
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))`,
    })
    const r = await this.json<{ changes: { fileId: string; removed: boolean; file?: RawFile }[]; nextPageToken?: string; newStartPageToken?: string }>(`${API}/changes?${q}`)
    return {
      changes: r.changes.map((c): DriveChange => ({ fileId: c.fileId, removed: c.removed, file: c.file ? toItem(c.file) : null })),
      nextPageToken: r.nextPageToken ?? null,
      newStartPageToken: r.newStartPageToken ?? null,
    }
  }
}
