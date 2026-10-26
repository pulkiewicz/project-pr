import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InvoiceAllocationInput, InvoiceDetailDto, InvoiceDetailsInput, InvoiceListResponse, InvoiceSettings, InvoiceSyncResult, InvoiceUserOption } from '#shared'
import { api } from '../../lib/api'

export const useInvoices = () => useQuery({ queryKey: ['invoices', 'list'], queryFn: () => api<InvoiceListResponse>('/invoices') })

export const useInvoice = (id: string | null) =>
  useQuery({ queryKey: ['invoices', 'one', id ?? ''], queryFn: () => api<InvoiceDetailDto>(`/invoices/${id}`), enabled: !!id })

export const useInvoiceAttachments = (id: string | null, enabled: boolean) =>
  useQuery({ queryKey: ['invoices', 'attachments', id ?? ''], queryFn: () => api<{ fileName: string; url: string }[]>(`/invoices/${id}/attachments`), enabled: !!id && enabled, staleTime: 300_000 })

function useInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['invoices'] })
}

/** Odpowiedź zmiany to aktualna karta faktury — szuflada i wiersz listy pokazują ją od razu, lista odświeża się w tle. */
function useSetDetail() {
  const qc = useQueryClient()
  return (d: InvoiceDetailDto) => {
    qc.setQueryData(['invoices', 'one', d.id], d)
    const { events: _events, ...item } = d
    qc.setQueryData<InvoiceListResponse>(['invoices', 'list'], (old) => old && { ...old, items: old.items.map((i) => (i.id === d.id ? item : i)) })
  }
}

export function useSyncInvoices() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: () => api<InvoiceSyncResult>('/invoices/sync', { method: 'POST' }), onSettled: invalidate })
}

export function useSaveAllocation() {
  const invalidate = useInvalidate()
  const setDetail = useSetDetail()
  return useMutation({
    mutationFn: (v: { id: string; data: InvoiceAllocationInput }) => api<InvoiceDetailDto>(`/invoices/${v.id}/allocation`, { method: 'PUT', json: v.data }),
    onSuccess: setDetail,
    onSettled: invalidate,
  })
}

export function useSaveDetails() {
  const invalidate = useInvalidate()
  const setDetail = useSetDetail()
  return useMutation({
    mutationFn: (v: { id: string; data: InvoiceDetailsInput }) => api<InvoiceDetailDto>(`/invoices/${v.id}/details`, { method: 'PATCH', json: v.data }),
    onSuccess: setDetail,
    onSettled: invalidate,
  })
}

export type InvoiceAction = 'submit' | 'approve' | 'reject' | 'reopen'

export function useInvoiceTransition() {
  const invalidate = useInvalidate()
  const setDetail = useSetDetail()
  return useMutation({
    mutationFn: (v: { id: string; action: InvoiceAction; version: number; comment?: string | null }) =>
      api<InvoiceDetailDto>(`/invoices/${v.id}/${v.action}`, { method: 'POST', json: { version: v.version, comment: v.comment || null } }),
    onSuccess: setDetail,
    onSettled: invalidate,
  })
}

export const useInvoiceSettings = () =>
  useQuery({ queryKey: ['admin', 'settings', 'invoices'], queryFn: () => api<{ settings: InvoiceSettings; users: InvoiceUserOption[]; configured: boolean }>('/admin/settings/invoices') })

export function useSaveInvoiceSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: InvoiceSettings) => api<InvoiceSettings>('/admin/settings/invoices', { method: 'PUT', json: s }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin', 'settings', 'invoices'] }),
  })
}
