import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BaselineDto,
  BaselineTasksDto,
  DashboardResponse,
  DayZeroPreview,
  HrfInternalAssigneeOption,
  HrfInternalTaskCreate,
  HrfInternalTaskDto,
  HrfInternalTaskPatch,
  HrfTaskDto,
  HrfTaskPatch,
  HrfTasksResponse,
  ImportInspectResponse,
  ImportMapping,
  ImportPreviewResponse,
  ImportProfileDto,
} from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { api } from '../../lib/api'

export function useProjectId(): string {
  const project = useMe().projects[0]
  if (!project) throw new Error('No project')
  return project.id
}

const base = (pid: string) => `/projects/${pid}/hrf`

export function useHrfTasks() {
  const pid = useProjectId()
  return useQuery({ queryKey: ['hrf', pid, 'tasks'], queryFn: () => api<HrfTasksResponse>(`${base(pid)}/tasks`) })
}

export function useProject() {
  const pid = useProjectId()
  return useQuery({
    queryKey: ['project', pid],
    queryFn: () => api<{ id: string; name: string; dayZeroDate: string | null; contractEndDate: string; version: number }>(`/projects/${pid}`),
  })
}

export function useDashboard() {
  const pid = useProjectId()
  return useQuery({ queryKey: ['dashboard', pid], queryFn: () => api<DashboardResponse>(`/projects/${pid}/dashboard`) })
}

function useInvalidateHrf() {
  const qc = useQueryClient()
  const pid = useProjectId()
  return () => {
    void qc.invalidateQueries({ queryKey: ['hrf', pid] })
    void qc.invalidateQueries({ queryKey: ['dashboard', pid] })
    void qc.invalidateQueries({ queryKey: ['project', pid] })
  }
}

export function usePatchTask() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: HrfTaskPatch }) => api<HrfTaskDto>(`${base(pid)}/tasks/${id}`, { method: 'PATCH', json: patch }),
    onSettled: invalidate,
  })
}

export function useSetDependencies() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: ({ id, predecessors }: { id: string; predecessors: { predecessorId: string; type: 'FS' | 'SS' | 'FF'; lagDays: number }[] }) =>
      api(`${base(pid)}/tasks/${id}/dependencies`, { method: 'PUT', json: { predecessors } }),
    onSettled: invalidate,
  })
}

export function useBaselines() {
  const pid = useProjectId()
  return useQuery({ queryKey: ['hrf', pid, 'baselines'], queryFn: () => api<BaselineDto[]>(`${base(pid)}/baselines`) })
}

export function useBaseline(id: string | null) {
  const pid = useProjectId()
  return useQuery({
    queryKey: ['hrf', pid, 'baseline', id],
    queryFn: () => api<BaselineTasksDto>(`${base(pid)}/baselines/${id}`),
    enabled: !!id,
  })
}

export function useCreateBaseline() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: (v: { name: string; isCurrent: boolean }) => api<BaselineDto>(`${base(pid)}/baselines`, { method: 'POST', json: v }),
    onSettled: invalidate,
  })
}

export function useUpdateBaseline() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; isCurrent?: boolean } }) =>
      api<BaselineDto>(`${base(pid)}/baselines/${id}`, { method: 'PATCH', json: patch }),
    onSettled: invalidate,
  })
}

/** Korekta dat zadania w zamrożonym planie bazowym (tylko Admin). */
export function useSetBaselineTask() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: ({ baselineId, taskId, start, end }: { baselineId: string; taskId: string; start: string | null; end: string | null }) =>
      api(`${base(pid)}/baselines/${baselineId}/tasks/${taskId}`, { method: 'PUT', json: { start, end } }),
    onSettled: invalidate,
  })
}

export function useDeleteBaseline() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: (id: string) => api(`${base(pid)}/baselines/${id}`, { method: 'DELETE' }),
    onSettled: invalidate,
  })
}

export function useDayZero() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return {
    preview: (date: string) => api<DayZeroPreview>(`${base(pid)}/day-zero/preview?date=${date}`),
    apply: useMutation({
      mutationFn: (v: { date: string; projectVersion: number }) => api<{ tasksChanged: number }>(`${base(pid)}/day-zero`, { method: 'PUT', json: v }),
      onSettled: invalidate,
    }),
  }
}

export function useImportApi() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  const send = <T,>(step: string, file: File, mapping?: ImportMapping) => {
    const form = new FormData()
    form.set('file', file)
    if (mapping) form.set('mapping', JSON.stringify(mapping))
    return api<T>(`${base(pid)}/import/${step}`, { method: 'POST', body: form })
  }
  return {
    inspect: (file: File, mapping?: ImportMapping) => send<ImportInspectResponse>('inspect', file, mapping),
    preview: (file: File, mapping: ImportMapping) => send<ImportPreviewResponse>('preview', file, mapping),
    commit: async (file: File, mapping: ImportMapping) => {
      const r = await send<{ created: number; updated: number }>('commit', file, mapping)
      invalidate()
      return r
    },
    profiles: () => api<ImportProfileDto[]>(`${base(pid)}/import/profiles`),
    saveProfile: (name: string, mapping: ImportMapping) => api<ImportProfileDto>(`${base(pid)}/import/profiles`, { method: 'POST', json: { name, mapping } }),
  }
}

export const exportPath = (pid: string, kind: 'xlsx' | 'pdf') => `${base(pid)}/export.${kind}`

// --- Zadania wewnętrzne (moduł hrfInternal) ---

export function useInternalTasks() {
  const pid = useProjectId()
  const { can } = useAuth()
  return useQuery({
    queryKey: ['hrf', pid, 'internal'],
    queryFn: () => api<HrfInternalTaskDto[]>(`${base(pid)}/internal-tasks`),
    enabled: can('hrfInternal', 'view'),
  })
}

export function useInternalAssignees(enabled: boolean) {
  const pid = useProjectId()
  return useQuery({
    queryKey: ['hrf', pid, 'internal', 'assignees'],
    queryFn: () => api<HrfInternalAssigneeOption[]>(`${base(pid)}/internal-tasks/assignees`),
    enabled,
    staleTime: 60_000,
  })
}

export function useSaveInternalTask() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: (v: { id: string; patch: HrfInternalTaskPatch } | { create: HrfInternalTaskCreate }) =>
      'create' in v
        ? api<HrfInternalTaskDto>(`${base(pid)}/internal-tasks`, { method: 'POST', json: v.create })
        : api<HrfInternalTaskDto>(`${base(pid)}/internal-tasks/${v.id}`, { method: 'PATCH', json: v.patch }),
    onSettled: invalidate,
  })
}

export function useDeleteInternalTask() {
  const pid = useProjectId()
  const invalidate = useInvalidateHrf()
  return useMutation({
    mutationFn: (id: string) => api(`${base(pid)}/internal-tasks/${id}`, { method: 'DELETE' }),
    onSettled: invalidate,
  })
}
