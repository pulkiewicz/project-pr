import type { TimesheetEntriesResponse, TimesheetMeResponse, TimesheetSaveResponse, hours } from '#shared'

/** Błąd z gotowym do pokazania komunikatem po polsku (jak w workload-calendar). */
export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Klient `/api/public/czas/*` — bez sesji Identity; pracownika identyfikuje wyłącznie jego ID. */
async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/public/czas${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'omit',
    })
  } catch {
    throw new PublicApiError('Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.', 0)
  }
  const data = (await res.json().catch(() => null)) as (T & { detail?: string }) | null
  if (!res.ok) throw new PublicApiError(data?.detail ?? 'Wystąpił nieoczekiwany błąd.', res.status)
  return data as T
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString()

export const getMe = (id: string) => request<TimesheetMeResponse>(`/me?${q({ id })}`)
export const getEntries = (id: string, from: string, to: string) => request<TimesheetEntriesResponse>(`/entries?${q({ id, from, to })}`)
export const saveEntries = (id: string, entries: Record<string, hours.TimesheetEntry | null>) =>
  request<TimesheetSaveResponse>('/entries', { method: 'PUT', body: { id, entries } })
