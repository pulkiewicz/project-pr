import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { LineInput, LinePatch, QuoteCreateInput, QuoteDto, QuoteKind, QuoteListItemDto, QuotePatch, QuoteSettings } from '#shared'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'

export const useQuotes = (kind: QuoteKind = 'quote', opportunityId?: string) =>
  useQuery({
    queryKey: ['quotes', kind, opportunityId ?? 'all'],
    queryFn: () => api<QuoteListItemDto[]>(`/quotes?kind=${kind}${opportunityId ? `&opportunityId=${opportunityId}` : ''}`),
  })

export const useQuote = (id: string | undefined) => useQuery({ queryKey: ['quote', id], queryFn: () => api<QuoteDto>(`/quotes/${id}`), enabled: !!id })

export const useQuoteSettings = () => useQuery({ queryKey: ['quotes', 'settings'], queryFn: () => api<QuoteSettings>('/quotes/settings'), staleTime: 60_000 })

export function useSaveQuoteSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: QuoteSettings) => api<QuoteSettings>('/quotes/settings', { method: 'PUT', json: v }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['quote'] }).then(() => qc.invalidateQueries({ queryKey: ['quotes'] })),
  })
}

export function useCreateQuote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: QuoteCreateInput) => api<QuoteDto>('/quotes', { method: 'POST', json: v }),
    onSuccess: (q) => {
      qc.setQueryData(['quote', q.id], q)
      void qc.invalidateQueries({ queryKey: ['quotes'] })
    },
  })
}

/**
 * Wszystkie zmiany wyceny zwracają całą wycenę — odpowiedź zastępuje cache, błąd pokazuje powiadomienie.
 * `path` względem `/quotes/{id}`.
 */
export function useQuoteMutation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { method: 'POST' | 'PATCH' | 'DELETE'; path?: string; json?: unknown }) => api<QuoteDto>(`/quotes/${id}${v.path ?? ''}`, { method: v.method, json: v.json }),
    onSuccess: (q) => {
      qc.setQueryData(['quote', id], q)
      void qc.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (e) => {
      notifications.show({ color: 'red', message: errorMessage(e) })
      void qc.invalidateQueries({ queryKey: ['quote', id] })
    },
  })
}

export const quoteOps = {
  patch: (v: QuotePatch) => ({ method: 'PATCH' as const, json: v }),
  status: (status: 'draft' | 'approved' | 'sent', version: number) => ({ method: 'POST' as const, path: '/status', json: { status, version } }),
  addDevice: (json: { name: string; quantity?: number; isOption?: boolean; included?: boolean; withDefaultSections?: boolean }) => ({ method: 'POST' as const, path: '/devices', json }),
  patchDevice: (deviceId: string, json: Record<string, unknown>) => ({ method: 'PATCH' as const, path: `/devices/${deviceId}`, json }),
  deleteDevice: (deviceId: string) => ({ method: 'DELETE' as const, path: `/devices/${deviceId}` }),
  addSection: (deviceId: string, name: string) => ({ method: 'POST' as const, path: `/devices/${deviceId}/sections`, json: { name } }),
  patchSection: (sectionId: string, json: { name?: string; sortOrder?: number }) => ({ method: 'PATCH' as const, path: `/sections/${sectionId}`, json }),
  deleteSection: (sectionId: string) => ({ method: 'DELETE' as const, path: `/sections/${sectionId}` }),
  addLine: (sectionId: string, json: LineInput) => ({ method: 'POST' as const, path: `/sections/${sectionId}/lines`, json }),
  patchLine: (lineId: string, json: LinePatch) => ({ method: 'PATCH' as const, path: `/lines/${lineId}`, json }),
  deleteLine: (lineId: string) => ({ method: 'DELETE' as const, path: `/lines/${lineId}` }),
}

export function useQuoteAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; path: '/revision' | '/save-as-profile'; json?: unknown }) => api<QuoteDto>(`/quotes/${v.id}${v.path}`, { method: 'POST', json: v.json }),
    onSuccess: (q) => {
      qc.setQueryData(['quote', q.id], q)
      void qc.invalidateQueries({ queryKey: ['quotes'] })
    },
  })
}

export function useDeleteQuote() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => api(`/quotes/${id}`, { method: 'DELETE' }), onSettled: () => void qc.invalidateQueries({ queryKey: ['quotes'] }) })
}
