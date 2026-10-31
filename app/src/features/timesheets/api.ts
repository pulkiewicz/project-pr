import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ManagementUserOption,
  TimesheetEmployeeDto,
  TimesheetImportInput,
  TimesheetImportResult,
  TimesheetReportResponse,
  TimesheetSettings,
  TimesheetSummaryResponse,
} from '#shared'
import { api } from '../../lib/api'

export const useTimesheetSettings = () =>
  useQuery({ queryKey: ['admin', 'settings', 'timesheets'], queryFn: () => api<{ settings: TimesheetSettings; users: ManagementUserOption[] }>('/admin/settings/timesheets') })

export function useSaveTimesheetSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: TimesheetSettings) => api<TimesheetSettings>('/admin/settings/timesheets', { method: 'PUT', json: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'settings', 'timesheets'] }),
  })
}

export function useImportTimesheets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: TimesheetImportInput) => api<TimesheetImportResult>('/admin/timesheets/import', { method: 'POST', json: file }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets'] }),
  })
}

// ---------------- Panel (Zarząd → Czas pracy) ----------------

export const useTimesheetEmployees = () =>
  useQuery({ queryKey: ['timesheets', 'employees'], queryFn: () => api<{ employees: TimesheetEmployeeDto[] }>('/timesheets/employees').then((r) => r.employees) })

export const useTimesheetReport = (month: string) =>
  useQuery({ queryKey: ['timesheets', 'report', month], queryFn: () => api<TimesheetReportResponse>(`/timesheets/report?month=${month}`) })

export const useTimesheetSummary = (from: string, to: string) =>
  useQuery({ queryKey: ['timesheets', 'summary', from, to], queryFn: () => api<TimesheetSummaryResponse>(`/timesheets/summary?from=${from}&to=${to}`) })

export function useTimesheetEmployeeMutations() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['timesheets'] })
  return {
    create: useMutation({ mutationFn: (name: string) => api<{ employee: TimesheetEmployeeDto }>('/timesheets/employees', { method: 'POST', json: { name } }), onSuccess }),
    update: useMutation({
      mutationFn: (v: { id: string; patch: { name?: string; active?: boolean } }) => api<{ employee: TimesheetEmployeeDto }>(`/timesheets/employees/${v.id}`, { method: 'PATCH', json: v.patch }),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<{ ok: true; deletedEntries: number }>(`/timesheets/employees/${id}`, { method: 'DELETE' }), onSuccess }),
  }
}
