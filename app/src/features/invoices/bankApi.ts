import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BankCostDto, BankReportDto, BankImportPreview, BankImportResult, BankMatchResult, BankRuleDto, BankRuleResult, BankStatementDetailDto, BankStatementDto, BankTransactionDto, BankTxPatch } from '#shared'
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

/** Po wgraniu wyciągu: wyciągi, Rozliczenia i koszty odświeżane; faktury też (import dopasowuje płatności). */
export function useImportBankStatement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => upload<BankImportResult>('/bank/import', file),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['bank'] }), void qc.invalidateQueries({ queryKey: ['invoices'] })),
  })
}

export function useDeleteBankStatement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/bank/statements/${id}`, { method: 'DELETE' }),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['bank'] }), void qc.invalidateQueries({ queryKey: ['invoices'] })),
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
      void qc.invalidateQueries({ queryKey: ['bank', 'report'] })
      void qc.invalidateQueries({ queryKey: ['invoices', 'categories'] })
    },
  })
}

/** Odpowiedź zmiany to aktualny wiersz operacji — podmiana w wyciągu; faktury (zapłata) i koszty odświeżane w tle. */
function useSetTx() {
  const qc = useQueryClient()
  return (tx: BankTransactionDto) => {
    qc.setQueryData<BankStatementDetailDto>(['bank', 'statement', tx.statementId], (old) => old && { ...old, transactions: old.transactions.map((t) => (t.id === tx.id ? tx : t)) })
    void qc.invalidateQueries({ queryKey: ['bank', 'costs'] })
    void qc.invalidateQueries({ queryKey: ['bank', 'report'] })
    void qc.invalidateQueries({ queryKey: ['invoices'] })
  }
}

export function useLinkInvoice() {
  const setTx = useSetTx()
  return useMutation({
    mutationFn: ({ txId, invoiceId }: { txId: string; invoiceId: string }) => api<BankTransactionDto>(`/bank/transactions/${txId}/links`, { method: 'POST', json: { invoiceId } }),
    onSuccess: setTx,
  })
}

export function useUnlinkInvoice() {
  const setTx = useSetTx()
  return useMutation({
    mutationFn: ({ txId, invoiceId }: { txId: string; invoiceId: string }) => api<BankTransactionDto>(`/bank/transactions/${txId}/links/${invoiceId}`, { method: 'DELETE' }),
    onSuccess: setTx,
  })
}

export function useRunMatching() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (statementId?: string) => api<BankMatchResult>('/bank/match', { method: 'POST', json: { statementId } }),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['bank'] }), void qc.invalidateQueries({ queryKey: ['invoices'] })),
  })
}

export const useBankRules = () => useQuery({ queryKey: ['bank', 'rules'], queryFn: () => api<BankRuleDto[]>('/bank/rules') })

export function useCreateBankRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (transactionId: string) => api<BankRuleResult>('/bank/rules', { method: 'POST', json: { transactionId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
}

export function useDeleteBankRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/bank/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank'] }),
  })
}

const reportQuery = (range: { from?: string | null; to?: string | null }) => {
  const q = new URLSearchParams()
  if (range.from) q.set('from', range.from)
  if (range.to) q.set('to', range.to)
  const s = q.toString()
  return s ? `?${s}` : ''
}
export const bankReportPath = (range: { from?: string | null; to?: string | null }, xlsx = false) => `/bank/report${xlsx ? '.xlsx' : ''}${reportQuery(range)}`

export const useBankReport = (range: { from: string | null; to: string | null }) =>
  // Zawsze świeże przy wejściu na stronę — dane zmieniają się przy wgraniu wyciągu, synchronizacji z inFakt i rozliczaniu operacji.
  useQuery({ queryKey: ['bank', 'report', range.from ?? '', range.to ?? ''], queryFn: () => api<BankReportDto>(bankReportPath(range)), staleTime: 0, refetchOnMount: 'always', placeholderData: (prev) => prev })
