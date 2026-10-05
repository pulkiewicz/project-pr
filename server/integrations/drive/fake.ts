import { FOLDER_MIME, type DriveChange, type DriveClient, type DriveItem } from './types.ts'

/** Atrapa Shared Drive w pamięci (testy i lokalny dev bez Google). */
export class FakeDrive implements DriveClient {
  items = new Map<string, DriveItem & { data?: Uint8Array }>()
  sessions = new Map<string, { parentId: string; name: string; mimeType: string; size: number }>()
  log: DriveChange[] = []
  private seq = 0

  constructor(public readonly driveId = 'drive-1') {
    this.items.set(driveId, this.item(driveId, 'Shared', FOLDER_MIME, []))
  }

  private item(id: string, name: string, mimeType: string, parents: string[], data?: Uint8Array): DriveItem & { data?: Uint8Array } {
    return { id, name, mimeType, parents, size: data ? data.length : null, md5: null, version: '1', modifiedTime: new Date().toISOString(), trashed: false, webViewLink: `https://docs.google.com/x/${id}`, thumbnailLink: null, data }
  }

  private add(name: string, mimeType: string, parentId: string, data?: Uint8Array) {
    const id = `f${++this.seq}`
    const it = this.item(id, name, mimeType, [parentId], data)
    this.items.set(id, it)
    this.log.push({ fileId: id, removed: false, file: it })
    return it
  }

  /** Symulacja pliku dodanego przez człowieka bezpośrednio na Drive. */
  externalAdd(parentId: string, name: string, mimeType = 'application/pdf', data = new Uint8Array([37, 80, 68, 70])) {
    return this.add(name, mimeType, parentId, data)
  }

  /** Symulacja zakończonego uploadu z przeglądarki. */
  finishUpload(sessionUrl: string, data: Uint8Array) {
    const s = this.sessions.get(sessionUrl)!
    return this.add(s.name, s.mimeType, s.parentId, data)
  }

  async getDrive(driveId: string) {
    if (driveId !== this.driveId) throw Object.assign(new Error('not found'), { status: 404 })
    return { id: driveId, name: 'Shared' }
  }
  async listChildren(_d: string, parentId: string) {
    return [...this.items.values()].filter((i) => i.parents.includes(parentId) && !i.trashed)
  }
  async getFile(id: string) {
    const it = this.items.get(id)
    if (!it) throw Object.assign(new Error('not found'), { status: 404 })
    return it
  }
  async createFolder(parentId: string, name: string) {
    return this.add(name, FOLDER_MIME, parentId)
  }
  async createUploadSession(p: { parentId: string; name: string; mimeType: string; size: number }) {
    const url = `https://upload.fake/session/${++this.seq}`
    this.sessions.set(url, p)
    return url
  }
  async uploadSmall(p: { parentId: string; name: string; mimeType: string; data: Uint8Array }) {
    return this.add(p.name, p.mimeType, p.parentId, p.data)
  }
  async download(id: string, range?: string) {
    const data = this.items.get(id)?.data ?? new Uint8Array()
    if (!range) return new Response(new Uint8Array(data), { status: 200, headers: { 'content-length': String(data.length) } })
    const [a, b] = range.replace('bytes=', '').split('-').map(Number)
    const end = Math.min(b ?? data.length - 1, data.length - 1)
    return new Response(new Uint8Array(data.slice(a, end + 1)), { status: 206, headers: { 'content-range': `bytes ${a}-${end}/${data.length}`, 'content-length': String(end - a! + 1) } })
  }
  async exportFile() {
    return new Response(new Uint8Array([37, 80, 68, 70, 45]), { status: 200, headers: { 'content-type': 'application/pdf' } })
  }
  async fetchThumbnail() {
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
  }
  async copy(id: string, parentId: string, name: string) {
    const src = await this.getFile(id)
    return this.add(name, src.mimeType, parentId, src.data)
  }
  async update(id: string, p: { name?: string; addParent?: string; removeParent?: string; trashed?: boolean }) {
    const it = await this.getFile(id)
    if (p.name) it.name = p.name
    if (p.addParent) it.parents = [...it.parents.filter((x) => x !== p.removeParent), p.addParent]
    if (p.trashed !== undefined) it.trashed = p.trashed
    this.log.push({ fileId: id, removed: false, file: it })
    return it
  }
  async revisions() {
    return [{ id: '1', modifiedTime: new Date().toISOString(), size: null, author: 'Test' }]
  }
  async startPageToken() {
    return String(this.log.length)
  }
  async changes(_d: string, pageToken: string) {
    const from = Number(pageToken)
    return { changes: this.log.slice(from), nextPageToken: null, newStartPageToken: String(this.log.length) }
  }
}
