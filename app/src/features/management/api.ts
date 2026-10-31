import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EmployeeDto, EmployeeInput, FleetVehicleDto, FleetVehicleInput, ManagementSettings, ManagementUserOption } from '#shared'
import { api } from '../../lib/api'

export const useVehicles = () => useQuery({ queryKey: ['fleet', 'list'], queryFn: () => api<FleetVehicleDto[]>('/fleet') })
export const useEmployeeOptions = () => useQuery({ queryKey: ['fleet', 'employee-options'], queryFn: () => api<ManagementUserOption[]>('/fleet/employee-options') })

export const useEmployees = () => useQuery({ queryKey: ['employees', 'list'], queryFn: () => api<EmployeeDto[]>('/employees') })
export const useUserOptions = () => useQuery({ queryKey: ['employees', 'user-options'], queryFn: () => api<ManagementUserOption[]>('/employees/user-options') })

/** Zapis / usunięcie odświeża obie listy (pojazd pokazuje nazwisko użytkownika). */
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['fleet'] })
    void qc.invalidateQueries({ queryKey: ['employees'] })
  }
}

export function useSaveVehicle() {
  const onSettled = useInvalidate()
  return useMutation({
    mutationFn: (v: { id?: string; version?: number; data: FleetVehicleInput }) =>
      v.id ? api<FleetVehicleDto>(`/fleet/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } }) : api<FleetVehicleDto>('/fleet', { method: 'POST', json: v.data }),
    onSettled,
  })
}

export function useSaveEmployee() {
  const onSettled = useInvalidate()
  return useMutation({
    mutationFn: (v: { id?: string; version?: number; data: EmployeeInput }) =>
      v.id ? api<EmployeeDto>(`/employees/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } }) : api<EmployeeDto>('/employees', { method: 'POST', json: v.data }),
    onSettled,
  })
}

export function useDelete(kind: 'fleet' | 'employees') {
  const onSettled = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api(`/${kind}/${id}`, { method: 'DELETE' }), onSettled })
}

/** Pełny PESEL — tylko na żądanie (odczyt zapisywany w audit logu). */
export const fetchPesel = (id: string) => api<{ pesel: string | null }>(`/employees/${id}/pesel`)

export const useManagementSettings = () =>
  useQuery({ queryKey: ['admin', 'settings', 'management'], queryFn: () => api<{ settings: ManagementSettings; users: ManagementUserOption[] }>('/admin/settings/management') })

export function useSaveManagementSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: ManagementSettings) => api<ManagementSettings>('/admin/settings/management', { method: 'PUT', json: s }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'settings', 'management'] }),
  })
}
