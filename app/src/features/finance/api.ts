import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { FinancePlanResponse } from '#shared'
import { api } from '../../lib/api'

/** Plan finansowy miesiąca; poprzedni miesiąc zostaje na ekranie, dopóki nie dojdzie nowy (przełączanie strzałkami). */
export const useFinancePlan = (month: string) =>
  useQuery({ queryKey: ['invoices', 'finance-plan', month], queryFn: () => api<FinancePlanResponse>(`/finance/plan?month=${month}`), placeholderData: keepPreviousData })
