import { DIRECT_UPLOAD_MAX_BYTES, type QuoteInputDto } from '#shared'
import { api } from './api'

export type Progress = (loaded: number, total: number) => void

/** Porcja sesji resumable Google: 8 MiB (wielokrotność 256 KiB). */
const CHUNK_BYTES = 8 * 1024 * 1024

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
 * Materiał wyceny do folderu szansy na Drive: do 4 MB przez serwer, większe bezpośrednio do Google
 * (sesja resumable utworzona przez backend; wznowienie od ostatniego potwierdzonego bajtu).
 */
export async function uploadQuoteInput(quoteId: string, file: File, onProgress: Progress): Promise<QuoteInputDto[]> {
  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
    const form = new FormData()
    form.append('file', file)
    onProgress(0, file.size)
    const list = await api<QuoteInputDto[]>(`/quotes/${quoteId}/inputs/file`, { method: 'POST', body: form })
    onProgress(file.size, file.size)
    return list
  }
  const mimeType = file.type || guessMime(file.name)
  const session = await api<{ inputId: string; uploadUrl: string }>(`/quotes/${quoteId}/inputs/upload-session`, { method: 'POST', json: { name: file.name, size: file.size, mimeType } })
  let start = 0
  let driveFileId: string | null = null
  let retries = 0
  while (!driveFileId) {
    const end = Math.min(start + CHUNK_BYTES, file.size)
    try {
      const r = await putChunk(session.uploadUrl, file.slice(start, end), start, file.size, onProgress)
      if (r.status === 200 || r.status === 201) driveFileId = (JSON.parse(r.body) as { id: string }).id
      else if (r.status === 308) {
        start = r.range ? Number(r.range.split('-')[1]) + 1 : end
        retries = 0
      } else throw new Error(`upload ${r.status}`)
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
  return api<QuoteInputDto[]>(`/quotes/${quoteId}/inputs/${session.inputId}/complete`, { method: 'POST', json: { driveFileId } })
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
  dwg: 'application/acad',
  dxf: 'application/dxf',
  zip: 'application/zip',
}
export const guessMime = (name: string) => MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
