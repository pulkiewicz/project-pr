import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CostCategoryDto,
  InvoiceAllocationInput,
  InvoiceBulkAllocationInput,
  InvoiceBulkResult,
  InvoiceBulkSubmitInput,
  InvoiceDetailDto,
  InvoiceDetailsInput,
  InvoiceListResponse,
  InvoiceSettings,
  InvoiceSyncResult,
  InvoiceUserOption,
} from '#shared'
import { api } from '../../lib/api'

export const useInvoices = () => useQuery({ queryKey: ['invoices', 'list'], queryFn: () => api<InvoiceListResponse>('/invoices') })

export const useInvoice = (id: string | null) =>
  useQuery({ queryKey: ['invoices', 'one', id ?? ''], queryFn: () => api<InvoiceDetailDto>(`/invoices/${id}`), enabled: !!id })

export const useInvoiceAttachments = (id: string | null, enabled: boolean) =>
  useQuery({ queryKey: ['invoices', 'attachments', id ?? ''], queryFn: () => api<{ fileName: string; url: string }[]>(`/invoices/${id}/attachments`), enabled: !!id && enabled, staleTime: 300_000 })

/** Licznik faktur czekających na moją akceptację (menu, baner na liście); odświeżany co 2 minuty. */
export const useAwaitingApproval = (enabled: boolean) =>
  useQuery({ queryKey: ['invoices', 'awaiting'], queryFn: () => api<{ count: number }>('/invoices/awaiting-approval'), enabled, refetchInterval: 120_000, staleTime: 60_000 })

/** Plik faktury do podglądu (pobierany przez serwer z inFakt). */
export const fetchAttachment = (id: string, index: number) => api<Blob>(`/invoices/${id}/attachments/${index}/file`)

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

export function useBulkAllocation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: InvoiceBulkAllocationInput) => api<InvoiceBulkResult>('/invoices/bulk-allocation', { method: 'POST', json: data }),
    onSettled: invalidate,
  })
}

export function useBulkSubmit() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: InvoiceBulkSubmitInput) => api<InvoiceBulkResult>('/invoices/bulk-submit', { method: 'POST', json: data }),
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
  useQuery({ queryKey: ['admin', 'settings', 'invoices'], queryFn: () => api<{ settings: InvoiceSettings; users: InvoiceUserOption[]; configured: boolean; mailConfigured: boolean }>('/admin/settings/invoices') })

export function useSaveInvoiceSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: InvoiceSettings) => api<InvoiceSettings>('/admin/settings/invoices', { method: 'PUT', json: s }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin', 'settings', 'invoices'] }),
  })
}

// ---------------- Kategorie kosztów ----------------

export const useCostCategories = (enabled = true) =>
  useQuery({ queryKey: ['invoices', 'categories'], queryFn: () => api<CostCategoryDto[]>('/invoices/categories'), staleTime: 60_000, enabled })

export function useSetInvoiceCategory() {
  const invalidate = useInvalidate()
  const setDetail = useSetDetail()
  return useMutation({
    mutationFn: (v: { id: string; costCategoryId: string | null }) => api<InvoiceDetailDto>(`/invoices/${v.id}/category`, { method: 'PATCH', json: { costCategoryId: v.costCategoryId } }),
    onSuccess: setDetail,
    onSettled: invalidate,
  })
}

export function useBulkCategory() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (data: { ids: string[]; costCategoryId: string | null }) => api<InvoiceBulkResult>('/invoices/bulk-category', { method: 'POST', json: data }),
    onSettled: invalidate,
  })
}

/** Ustawienia (Admin): słownik kategorii. */
export const useAdminCostCategories = () =>
  useQuery({ queryKey: ['admin', 'settings', 'cost-categories'], queryFn: () => api<CostCategoryDto[]>('/admin/settings/cost-categories') })

export function useCostCategoryMutations() {
  const qc = useQueryClient()
  const onSettled = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'settings', 'cost-categories'] })
    void qc.invalidateQueries({ queryKey: ['invoices'] })
  }
  return {
    create: useMutation({ mutationFn: (name: string) => api<CostCategoryDto[]>('/admin/settings/cost-categories', { method: 'POST', json: { name } }), onSettled }),
    update: useMutation({
      mutationFn: (v: { id: string; patch: { name?: string; active?: boolean } }) => api<CostCategoryDto[]>(`/admin/settings/cost-categories/${v.id}`, { method: 'PATCH', json: v.patch }),
      onSettled,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<CostCategoryDto[]>(`/admin/settings/cost-categories/${id}`, { method: 'DELETE' }), onSettled }),
  }
}
