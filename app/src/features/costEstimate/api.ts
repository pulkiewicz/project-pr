import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CostEstimateResponse, CostItemInput, CostItemPatch, CostSettingsInput } from '#shared'
import { api } from '../../lib/api'
import { useProjectId } from '../hrf/api'

const key = (pid: string) => ['costEstimate', pid]

export function useCostEstimate() {
  const pid = useProjectId()
  return useQuery({ queryKey: key(pid), queryFn: () => api<CostEstimateResponse>(`/projects/${pid}/cost-estimate`) })
}

/** Każda zmiana zwraca cały kosztorys z przeliczonymi sumami — od razu do cache. */
function useCostMutation<V>(fn: (pid: string, v: V) => Promise<CostEstimateResponse>) {
  const pid = useProjectId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: V) => fn(pid, v),
    onSuccess: (data) => qc.setQueryData(key(pid), data),
    onError: () => void qc.invalidateQueries({ queryKey: key(pid) }),
  })
}

export const useSaveCostItem = () =>
  useCostMutation((pid, v: { id?: string; version?: number; data: CostItemInput | Omit<CostItemPatch, 'version'> }) =>
    v.id
      ? api<CostEstimateResponse>(`/projects/${pid}/cost-estimate/items/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } })
      : api<CostEstimateResponse>(`/projects/${pid}/cost-estimate/items`, { method: 'POST', json: v.data }),
  )

export const useDeleteCostItem = () => useCostMutation((pid, id: string) => api<CostEstimateResponse>(`/projects/${pid}/cost-estimate/items/${id}`, { method: 'DELETE' }))

export const useMoveCostItem = () =>
  useCostMutation((pid, v: { id: string; direction: 'up' | 'down' }) =>
    api<CostEstimateResponse>(`/projects/${pid}/cost-estimate/items/${v.id}/move`, { method: 'POST', json: { direction: v.direction } }),
  )

export const useSaveCostSettings = () =>
  useCostMutation((pid, v: CostSettingsInput) => api<CostEstimateResponse>(`/projects/${pid}/cost-estimate/settings`, { method: 'PUT', json: v }))
