import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ManagementUserOption, TimesheetImportInput, TimesheetImportResult, TimesheetSettings } from '#shared'
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
