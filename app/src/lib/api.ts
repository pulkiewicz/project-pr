import { refreshSession } from '@netlify/identity'
import type { ProblemDetails } from '#shared'
import { devToken } from '../auth/devAuth'

/** Wywoływane przy wygaśnięciu sesji (401) — AuthProvider odświeża stan (logowanie / 2FA). */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.code ?? problem.title)
  }
  get status() {
    return this.problem.status
  }
  get code() {
    return this.problem.code
  }
}

function readCookie(name: string): string | null {
  const m = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(document.cookie)
  return m ? decodeURIComponent(m[1]!) : null
}

/** JWT Identity do nagłówka Authorization (cookie nf_jwt utrzymywane przez @netlify/identity). */
export async function identityToken(): Promise<string | null> {
  const dev = devToken()
  if (dev) return dev
  try {
    await refreshSession()
  } catch {
    // brak sesji — obsłuży 401
  }
  return readCookie('nf_jwt')
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await identityToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body, credentials: 'same-origin' })
  if (!res.ok) {
    const problem = res.headers.get('content-type')?.includes('json')
      ? ((await res.json()) as ProblemDetails)
      : { type: 'about:blank', title: res.statusText, status: res.status, code: 'http_error' }
    if (res.status === 401 && path !== '/me') onUnauthorized?.()
    throw new ApiError(problem)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? await res.json() : await res.blob()) as T
}

/** Pobranie pliku z autoryzacją w nagłówku (nigdy token w URL). */
export async function downloadFile(path: string, filename: string) {
  const blob = await api<Blob>(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
