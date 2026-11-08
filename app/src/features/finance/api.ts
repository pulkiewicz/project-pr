import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FinanceFixedCostDto, FinancePlanItemDto, FinancePlanResponse, FixedCostInput, FixedCostPatch, PlanItemInput, PlanItemPatch, PlanYearInput, PlanYearResult } from '#shared'
import { api } from '../../lib/api'

/** Plan finansowy miesiąca; poprzedni miesiąc zostaje na ekranie, dopóki nie dojdzie nowy (przełączanie strzałkami). */
export const useFinancePlan = (month: string) =>
  useQuery({ queryKey: ['invoices', 'finance-plan', month], queryFn: () => api<FinancePlanResponse>(`/finance/plan?month=${month}`), placeholderData: keepPreviousData })

/** Po zapisie odświeżane są wszystkie miesiące (pozycja powtarzana i koszt stały dotyczą wielu miesięcy). */
function useInvalidatePlan() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['invoices', 'finance-plan'] })
}

export function useCreatePlanItem() {
  const invalidate = useInvalidatePlan()
  return useMutation({ mutationFn: (v: PlanItemInput) => api<{ created: number }>('/finance/plan-items', { method: 'POST', json: v }), onSuccess: invalidate })
}
export function useUpdatePlanItem() {
  const invalidate = useInvalidatePlan()
  return useMutation({ mutationFn: (v: { id: string; data: PlanItemPatch }) => api<FinancePlanItemDto>(`/finance/plan-items/${v.id}`, { method: 'PATCH', json: v.data }), onSettled: invalidate })
}
export function useDeletePlanItem() {
  const invalidate = useInvalidatePlan()
  return useMutation({ mutationFn: (id: string) => api(`/finance/plan-items/${id}`, { method: 'DELETE' }), onSettled: invalidate })
}

export function useCreateFixedCost() {
  const invalidate = useInvalidatePlan()
  return useMutation({ mutationFn: (v: FixedCostInput) => api<FinanceFixedCostDto>('/finance/fixed-costs', { method: 'POST', json: v }), onSuccess: invalidate })
}
export function useUpdateFixedCost() {
  const invalidate = useInvalidatePlan()
  return useMutation({ mutationFn: (v: { id: string; data: FixedCostPatch }) => api<FinanceFixedCostDto>(`/finance/fixed-costs/${v.id}`, { method: 'PATCH', json: v.data }), onSettled: invalidate })
}
export function useDeleteFixedCost() {
  const invalidate = useInvalidatePlan()
  return useMutation({ mutationFn: (id: string) => api(`/finance/fixed-costs/${id}`, { method: 'DELETE' }), onSettled: invalidate })
}

export function useSavePlanYear() {
  const invalidate = useInvalidatePlan()
  return useMutation({ mutationFn: (v: PlanYearInput) => api<PlanYearResult>('/finance/plan-year', { method: 'PUT', json: v }), onSuccess: invalidate })
}
