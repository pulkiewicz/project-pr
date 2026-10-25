import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AiJobDto, AiJobInput, AiSettings, AiStatusDto, AiSuggestionDto, DriveStatusDto, QuestionDto, QuoteInputDto } from '#shared'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'

const notifyError = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

export const useInputs = (quoteId: string) => useQuery({ queryKey: ['inputs', quoteId], queryFn: () => api<QuoteInputDto[]>(`/quotes/${quoteId}/inputs`) })

export function useInputMutation(quoteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { method: 'POST' | 'DELETE'; path: string; json?: unknown }) => api<QuoteInputDto[]>(`/quotes/${quoteId}/inputs${v.path}`, { method: v.method, json: v.json }),
    onSuccess: (list) => qc.setQueryData(['inputs', quoteId], list),
    onError: notifyError,
  })
}

/** Zadania AI wyceny; odświeżane co 2 s, dopóki któreś trwa — po zakończeniu odświeża zależne dane. */
export function useAiJobs(quoteId: string) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['ai-jobs', quoteId],
    queryFn: async () => {
      const prev = qc.getQueryData<AiJobDto[]>(['ai-jobs', quoteId])
      const jobs = await api<AiJobDto[]>(`/quotes/${quoteId}/ai/jobs`)
      const finished = jobs.filter((j) => (j.status === 'done' || j.status === 'error') && prev?.some((p) => p.id === j.id && (p.status === 'queued' || p.status === 'running')))
      for (const j of finished) {
        if (j.status === 'error') notifications.show({ color: 'red', title: 'AI', message: j.error ?? '' })
        else notifications.show({ color: 'green', title: 'AI', message: j.summary ?? '' })
        for (const key of [['checklist', quoteId], ['quote', quoteId], ['ai-suggestions', quoteId], ['questions', quoteId], ['ai-status']]) void qc.invalidateQueries({ queryKey: key })
      }
      return jobs
    },
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 2000 : false),
  })
}

export function useStartAiJob(quoteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: AiJobInput) => api<AiJobDto>(`/quotes/${quoteId}/ai/jobs`, { method: 'POST', json: v }),
    onSuccess: (job) => {
      qc.setQueryData<AiJobDto[]>(['ai-jobs', quoteId], (old) => [job, ...(old ?? []).filter((j) => j.id !== job.id)])
      void qc.invalidateQueries({ queryKey: ['ai-jobs', quoteId] })
    },
    onError: notifyError,
  })
}

export const useSuggestions = (quoteId: string) => useQuery({ queryKey: ['ai-suggestions', quoteId], queryFn: () => api<AiSuggestionDto[]>(`/quotes/${quoteId}/ai/suggestions`) })

export function useDecideSuggestions(quoteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ids: string[] | 'all'; accept: boolean }) => api<AiSuggestionDto[]>(`/quotes/${quoteId}/ai/suggestions/decide`, { method: 'POST', json: v }),
    onSuccess: (list) => {
      qc.setQueryData(['ai-suggestions', quoteId], list)
      void qc.invalidateQueries({ queryKey: ['quote', quoteId] })
    },
    onError: notifyError,
  })
}

export const useQuestions = (quoteId: string) => useQuery({ queryKey: ['questions', quoteId], queryFn: () => api<QuestionDto[]>(`/quotes/${quoteId}/questions`) })
export const useMyQuestions = (enabled: boolean) => useQuery({ queryKey: ['questions', 'mine'], queryFn: () => api<QuestionDto[]>('/questions/mine'), enabled })

export function useQuestionMutation(quoteId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id?: string; json: unknown }) =>
      v.id ? api<QuestionDto[]>(`/questions/${v.id}`, { method: 'PATCH', json: v.json }) : api<QuestionDto[]>(`/quotes/${quoteId}/questions`, { method: 'POST', json: v.json }),
    onSuccess: (list) => {
      qc.setQueryData(['questions', quoteId], list)
      void qc.invalidateQueries({ queryKey: ['questions', 'mine'] })
    },
    onError: notifyError,
  })
}

export const useAiStatus = () => useQuery({ queryKey: ['ai-status'], queryFn: () => api<AiStatusDto>('/ai/status'), staleTime: 30_000 })
export const useDriveStatus = () => useQuery({ queryKey: ['drive-status'], queryFn: () => api<DriveStatusDto>('/drive/status'), staleTime: 60_000 })

export function useSaveAiSettings() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (v: AiSettings) => api<AiSettings>('/ai/settings', { method: 'PUT', json: v }), onSettled: () => void qc.invalidateQueries({ queryKey: ['ai-status'] }), onError: notifyError })
}

export function useSaveDriveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sharedDriveId: string) => api<{ driveName: string }>('/drive/settings', { method: 'PUT', json: { sharedDriveId } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['drive-status'] }),
  })
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (opportunityId: string) => api<{ driveFolderId: string }>(`/crm/opportunities/${opportunityId}/folder`, { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['crm'] }),
    onError: notifyError,
  })
}

export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`
