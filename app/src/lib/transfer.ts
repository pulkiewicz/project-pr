import { UPLOAD_CHUNK_BYTES, type ProblemDetails } from '#shared'
import { ApiError, api, identityToken } from './api'

export type Progress = (loaded: number, total: number) => void

/**
 * Pobranie pliku porcjami (Range, ≤ 4 MB — limit odpowiedzi funkcji) i złożenie w Blob.
 * Token w nagłówku Authorization, nigdy w URL (spec. 7.4).
 */
export async function fetchFileBlob(path: string, onProgress?: Progress): Promise<{ blob: Blob; type: string }> {
  const parts: ArrayBuffer[] = []
  let start = 0
  let total = Infinity
  let type = 'application/octet-stream'
  while (start < total) {
    const token = await identityToken()
    const res = await fetch(`/api${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Range: `bytes=${start}-` }, credentials: 'same-origin' })
    if (!res.ok) {
      const problem = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as ProblemDetails) : { type: 'about:blank', title: res.statusText, status: res.status, code: 'http_error' }
      throw new ApiError(problem)
    }
    type = res.headers.get('content-type') ?? type
    const buf = await res.arrayBuffer()
    parts.push(buf)
    const range = res.headers.get('content-range')
    if (res.status === 206 && range) {
      total = Number(range.split('/')[1])
      start += buf.byteLength
    } else {
      // Całość w jednej odpowiedzi (mały plik lub eksport dokumentu Google).
      total = start + buf.byteLength
      start = total
    }
    onProgress?.(start, total)
    if (buf.byteLength === 0) break
  }
  return { blob: new Blob(parts, { type }), type }
}

export async function saveFile(path: string, filename: string, onProgress?: Progress) {
  const { blob } = await fetchFileBlob(path, onProgress)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function putChunk(url: string, chunk: Blob, start: number, total: number, onProgress: Progress): Promise<{ status: number; body: string; range: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Range', chunk.size ? `bytes ${start}-${start + chunk.size - 1}/${total}` : `bytes */${total}`)
    xhr.upload.onprogress = (e) => onProgress(start + e.loaded, total)
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText, range: xhr.getResponseHeader('Range') })
    xhr.onerror = () => reject(new Error('network'))
    xhr.send(chunk)
  })
}

/**
 * Upload bezpośrednio do Google (sesja resumable utworzona przez backend; spec. 7.3):
 * porcje 8 MiB (wielokrotność 256 KiB), wznowienie po błędzie sieci od ostatniego potwierdzonego bajtu.
 */
export async function uploadToDrive(
  projectId: string,
  file: File,
  folderId: string,
  onProgress: Progress,
  link?: { targetType: string; targetId: string },
): Promise<string> {
  const mimeType = file.type || guessMime(file.name)
  const session = await api<{ pendingUploadId: string; uploadUrl: string }>(`/projects/${projectId}/documents/upload-sessions`, {
    method: 'POST',
    json: { folderId, name: file.name, size: file.size, mimeType, link },
  })
  let start = 0
  let driveFileId: string | null = null
  let retries = 0
  while (!driveFileId) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size)
    try {
      const r = await putChunk(session.uploadUrl, file.slice(start, end), start, file.size, onProgress)
      if (r.status === 200 || r.status === 201) {
        driveFileId = (JSON.parse(r.body) as { id: string }).id
      } else if (r.status === 308) {
        start = r.range ? Number(r.range.split('-')[1]) + 1 : end
        retries = 0
      } else {
        throw new Error(`upload ${r.status}`)
      }
    } catch (e) {
      if (++retries > 5) throw e
      await new Promise((ok) => setTimeout(ok, 1000 * retries))
      // Zapytanie o stan sesji: ile bajtów Google już przyjął.
      const status = await putChunk(session.uploadUrl, new Blob([]), 0, file.size, () => undefined).catch(() => null)
      if (status?.status === 200 || status?.status === 201) driveFileId = (JSON.parse(status.body) as { id: string }).id
      else if (status?.status === 308) start = status.range ? Number(status.range.split('-')[1]) + 1 : 0
    }
  }
  onProgress(file.size, file.size)
  const done = await api<{ id: string }>(`/projects/${projectId}/documents/upload-complete`, { method: 'POST', json: { pendingUploadId: session.pendingUploadId, driveFileId } })
  return done.id
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  dwg: 'application/acad',
  dxf: 'application/dxf',
  msg: 'application/vnd.ms-outlook',
  eml: 'message/rfc822',
}
export const guessMime = (name: string) => MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
