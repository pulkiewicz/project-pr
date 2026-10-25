import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ActivityInput,
  CompanyDetailDto,
  CompanyDto,
  CompanyInput,
  ContactDto,
  ContactInput,
  CrmOwnerOption,
  NipLookupResult,
  OpportunityDetailDto,
  OpportunityDto,
  OpportunityInput,
  OpportunityStage,
  ProjectFromOpportunityInput,
} from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { api } from '../../lib/api'

const keys = {
  opportunities: ['crm', 'opportunities'] as const,
  opportunity: (id: string) => ['crm', 'opportunity', id] as const,
  companies: ['crm', 'companies'] as const,
  company: (id: string) => ['crm', 'company', id] as const,
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['crm'] })
}

export const useOpportunities = () => useQuery({ queryKey: keys.opportunities, queryFn: () => api<OpportunityDto[]>('/crm/opportunities') })

export const useOpportunity = (id: string | null) =>
  useQuery({ queryKey: keys.opportunity(id ?? ''), queryFn: () => api<OpportunityDetailDto>(`/crm/opportunities/${id}`), enabled: !!id })

export const useCompanies = () => useQuery({ queryKey: keys.companies, queryFn: () => api<CompanyDto[]>('/crm/companies') })

export const useCompany = (id: string | null) =>
  useQuery({ queryKey: keys.company(id ?? ''), queryFn: () => api<CompanyDetailDto>(`/crm/companies/${id}`), enabled: !!id })

export const useOwners = () => useQuery({ queryKey: ['crm', 'owners'], queryFn: () => api<CrmOwnerOption[]>('/crm/owners'), staleTime: 300_000 })

export function useSaveOpportunity() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id?: string; version?: number; data: Partial<OpportunityInput> }) =>
      v.id
        ? api<OpportunityDetailDto>(`/crm/opportunities/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } })
        : api<OpportunityDetailDto>('/crm/opportunities', { method: 'POST', json: v.data }),
    onSettled: invalidate,
  })
}

export function useChangeStage() {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id: string; version: number; stage: OpportunityStage; lossReason?: string }) =>
      api<OpportunityDetailDto>(`/crm/opportunities/${v.id}/stage`, { method: 'POST', json: { stage: v.stage, lossReason: v.lossReason, version: v.version } }),
    // Kanban: karta przeskakuje od razu, a lista wraca do stanu serwera po odpowiedzi.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.opportunities })
      const prev = qc.getQueryData<OpportunityDto[]>(keys.opportunities)
      qc.setQueryData<OpportunityDto[]>(keys.opportunities, (old) => old?.map((o) => (o.id === v.id ? { ...o, stage: v.stage } : o)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.opportunities, ctx.prev),
    onSettled: invalidate,
  })
}

export function useAddActivity() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id: string; data: ActivityInput }) => api<OpportunityDetailDto>(`/crm/opportunities/${v.id}/activities`, { method: 'POST', json: v.data }),
    onSettled: invalidate,
  })
}

export function useDeleteOpportunity() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api(`/crm/opportunities/${id}`, { method: 'DELETE' }), onSettled: invalidate })
}

export function useCreateProject() {
  const invalidate = useInvalidate()
  const { refresh } = useAuth()
  return useMutation({
    mutationFn: (v: { id: string; data: ProjectFromOpportunityInput }) =>
      api<{ projectId: string; code: string; opportunity: OpportunityDetailDto }>(`/crm/opportunities/${v.id}/project`, { method: 'POST', json: v.data }),
    // Nowy projekt musi pojawić się w /me (menu, adresy /projekty/{kod}).
    onSuccess: () => void refresh(),
    onSettled: invalidate,
  })
}

export function useSaveCompany() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id?: string; version?: number; data: Partial<CompanyInput> }) =>
      v.id ? api<CompanyDto>(`/crm/companies/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } }) : api<CompanyDto>('/crm/companies', { method: 'POST', json: v.data }),
    onSettled: invalidate,
  })
}

export function useDeleteCompany() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api(`/crm/companies/${id}`, { method: 'DELETE' }), onSettled: invalidate })
}

export function useSaveContact() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { companyId: string; id?: string; version?: number; data: Partial<ContactInput> }) =>
      v.id
        ? api<ContactDto>(`/crm/contacts/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } })
        : api<ContactDto>(`/crm/companies/${v.companyId}/contacts`, { method: 'POST', json: v.data }),
    onSettled: invalidate,
  })
}

export function useDeleteContact() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api(`/crm/contacts/${id}`, { method: 'DELETE' }), onSettled: invalidate })
}

export const lookupNip = (nip: string) => api<NipLookupResult & { existingCompanyId: string | null }>(`/crm/nip/${encodeURIComponent(nip)}`)
