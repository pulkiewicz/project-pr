import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BankCostDto, BankImportPreview, BankImportResult, BankStatementDetailDto, BankStatementDto, BankTransactionDto, BankTxPatch } from '#shared'
import { api } from '../../lib/api'

export const useBankStatements = () => useQuery({ queryKey: ['bank', 'statements'], queryFn: () => api<BankStatementDto[]>('/bank/statements') })

export const useBankStatement = (id: string | null) =>
  useQuery({ queryKey: ['bank', 'statement', id ?? ''], queryFn: () => api<BankStatementDetailDto>(`/bank/statements/${id}`), enabled: !!id })

const upload = <T,>(path: string, file: File) => {
  const form = new FormData()
  form.set('file', file)
  return api<T>(path, { method: 'POST', body: form })
}

export const previewBankStatement = (file: File) => upload<BankImportPreview>('/bank/import/preview', file)

export function useImportBankStatement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => upload<BankImportResult>('/bank/import', file),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
}

export function useDeleteBankStatement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/bank/statements/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
}

export const useBankCosts = () => useQuery({ queryKey: ['bank', 'costs'], queryFn: () => api<BankCostDto[]>('/bank/costs') })

/** Rozliczenie operacji: wiersz w wyciągu podmieniany od razu, koszty per projekt i słownik kategorii odświeżane w tle. */
export function useUpdateBankTx() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BankTxPatch }) => api<BankTransactionDto>(`/bank/transactions/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: (tx) => {
      qc.setQueryData<BankStatementDetailDto>(['bank', 'statement', tx.statementId], (old) => old && { ...old, transactions: old.transactions.map((t) => (t.id === tx.id ? tx : t)) })
      void qc.invalidateQueries({ queryKey: ['bank', 'costs'] })
      void qc.invalidateQueries({ queryKey: ['invoices', 'categories'] })
    },
  })
}
