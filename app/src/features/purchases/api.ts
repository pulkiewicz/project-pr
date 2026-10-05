import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PurchaseItemDto, PurchaseItemInput, PurchasesResponse } from '#shared'
import { api } from '../../lib/api'
import { useProjectId } from '../hrf/api'

export function usePurchases() {
  const pid = useProjectId()
  return useQuery({ queryKey: ['purchases', pid], queryFn: () => api<PurchasesResponse>(`/projects/${pid}/purchases`) })
}

export function useSavePurchase() {
  const pid = useProjectId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id?: string; version?: number; data: Partial<PurchaseItemInput> }) =>
      v.id
        ? api<PurchaseItemDto>(`/projects/${pid}/purchases/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } })
        : api<PurchaseItemDto>(`/projects/${pid}/purchases`, { method: 'POST', json: v.data }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['purchases', pid] })
      void qc.invalidateQueries({ queryKey: ['dashboard', pid] })
    },
  })
}
