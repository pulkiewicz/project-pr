import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PersonOption, WeekMatrixResponse, WeekViewResponse, WeeklyItemDto, WeeklyItemInput } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { api } from '../../lib/api'
import { useProjectId } from '../hrf/api'

export function useWeek(isoWeek: string) {
  const pid = useProjectId()
  return useQuery({ queryKey: ['weekly', pid, isoWeek], queryFn: () => api<WeekViewResponse>(`/projects/${pid}/weekly/${isoWeek}`) })
}

export function useMatrix(from: string, weeks = 8) {
  const pid = useProjectId()
  return useQuery({ queryKey: ['weekly', pid, 'matrix', from, weeks], queryFn: () => api<WeekMatrixResponse>(`/projects/${pid}/weekly-matrix?from=${from}&weeks=${weeks}`) })
}

export function usePeople() {
  const pid = useProjectId()
  const { can } = useAuth()
  return useQuery({ queryKey: ['people', pid], queryFn: () => api<PersonOption[]>(`/projects/${pid}/people`), enabled: can('weeklyPlan', 'create'), staleTime: 300_000 })
}

function useInvalidate() {
  const qc = useQueryClient()
  const pid = useProjectId()
  return () => {
    void qc.invalidateQueries({ queryKey: ['weekly', pid] })
    void qc.invalidateQueries({ queryKey: ['dashboard', pid] })
  }
}

export function useSaveItem() {
  const pid = useProjectId()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id?: string; version?: number; data: Partial<WeeklyItemInput> }) =>
      v.id
        ? api<WeeklyItemDto>(`/projects/${pid}/weekly-items/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } })
        : api<WeeklyItemDto>(`/projects/${pid}/weekly-items`, { method: 'POST', json: v.data }),
    onSettled: invalidate,
  })
}

export function useDeleteItem() {
  const pid = useProjectId()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api(`/projects/${pid}/weekly-items/${id}`, { method: 'DELETE' }), onSettled: invalidate })
}

export function useCloseWeek() {
  const pid = useProjectId()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { isoWeek: string; carryItemIds: string[] }) =>
      api<{ carried: number; nextWeek: string }>(`/projects/${pid}/weekly/${v.isoWeek}/close`, { method: 'POST', json: { carryItemIds: v.carryItemIds } }),
    onSettled: invalidate,
  })
}
