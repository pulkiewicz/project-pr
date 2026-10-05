import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AvizationDto, AvizationInput, AvizationSettings, AvizationTransition, EntryPointDto, OnSiteResponse, PersonDto, PersonInput, VehicleDto, VehicleInput } from '#shared'
import { api } from '../../lib/api'
import { useProjectId } from '../hrf/api'

const keys = (pid: string) => ({ all: ['aviz', pid] as const })

export function useAvizations() {
  const pid = useProjectId()
  return useQuery({ queryKey: [...keys(pid).all, 'list'], queryFn: () => api<AvizationDto[]>(`/projects/${pid}/avizations`) })
}
export function usePersons() {
  const pid = useProjectId()
  return useQuery({ queryKey: [...keys(pid).all, 'persons'], queryFn: () => api<PersonDto[]>(`/projects/${pid}/persons`) })
}
export function useVehicles(enabled = true) {
  const pid = useProjectId()
  return useQuery({ queryKey: [...keys(pid).all, 'vehicles'], queryFn: () => api<VehicleDto[]>(`/projects/${pid}/vehicles`), enabled })
}
export function useEntryPoints() {
  const pid = useProjectId()
  return useQuery({ queryKey: [...keys(pid).all, 'entry'], queryFn: () => api<EntryPointDto[]>(`/projects/${pid}/entry-points`) })
}
export function useOnSite(date: string) {
  const pid = useProjectId()
  return useQuery({ queryKey: [...keys(pid).all, 'onsite', date], queryFn: () => api<OnSiteResponse>(`/projects/${pid}/avizations/on-site?date=${date}`) })
}
export function useAvizationSettings() {
  const pid = useProjectId()
  return useQuery({ queryKey: [...keys(pid).all, 'settings'], queryFn: () => api<AvizationSettings>(`/projects/${pid}/avizations/settings`) })
}

function useInv() {
  const qc = useQueryClient()
  const pid = useProjectId()
  return () => void qc.invalidateQueries({ queryKey: keys(pid).all })
}

export function useAvizationMutations() {
  const pid = useProjectId()
  const inv = useInv()
  const base = `/projects/${pid}`
  return {
    save: useMutation({
      mutationFn: (v: { id?: string; version?: number; data: Partial<AvizationInput> }) =>
        v.id ? api<AvizationDto>(`${base}/avizations/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } }) : api<AvizationDto>(`${base}/avizations`, { method: 'POST', json: v.data }),
      onSettled: inv,
    }),
    transition: useMutation({
      mutationFn: (v: { id: string; t: AvizationTransition }) => api<AvizationDto>(`${base}/avizations/${v.id}/transition`, { method: 'POST', json: v.t }),
      onSettled: inv,
    }),
    savePerson: useMutation({
      mutationFn: (v: { id?: string; version?: number; data: Partial<PersonInput> }) =>
        v.id ? api<PersonDto>(`${base}/persons/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } }) : api<PersonDto>(`${base}/persons`, { method: 'POST', json: v.data }),
      onSettled: inv,
    }),
    saveVehicle: useMutation({
      mutationFn: (v: { id?: string; version?: number; data: Partial<VehicleInput> }) =>
        v.id ? api<VehicleDto>(`${base}/vehicles/${v.id}`, { method: 'PATCH', json: { ...v.data, version: v.version } }) : api<VehicleDto>(`${base}/vehicles`, { method: 'POST', json: v.data }),
      onSettled: inv,
    }),
    revealDoc: (id: string) => api<{ idDocNumber: string }>(`${base}/persons/${id}/document`),
    importPreview: (file: File) => {
      const form = new FormData()
      form.set('file', file)
      return api<{ rows: import('#shared').PeopleImportRow[] }>(`${base}/people/import/preview`, { method: 'POST', body: form })
    },
    importCommit: async (rows: unknown[]) => {
      const r = await api<{ personsCreated: number; vehiclesCreated: number; skipped: number }>(`${base}/people/import/commit`, { method: 'POST', json: { rows } })
      inv()
      return r
    },
    saveSettings: useMutation({ mutationFn: (s: AvizationSettings) => api(`${base}/avizations/settings`, { method: 'PUT', json: s }), onSettled: inv }),
    addEntryPoint: useMutation({ mutationFn: (name: string) => api(`${base}/entry-points`, { method: 'POST', json: { name } }), onSettled: inv }),
    updateEntryPoint: useMutation({ mutationFn: (v: { id: string; isActive: boolean }) => api(`${base}/entry-points/${v.id}`, { method: 'PATCH', json: { isActive: v.isActive } }), onSettled: inv }),
  }
}

export const exportUrl = (pid: string, id: string, kind: 'pdf' | 'xlsx') => `/projects/${pid}/avizations/${id}/export/${kind}`
export const dayExportUrl = (pid: string, date: string, kind: 'pdf' | 'xlsx') => `/projects/${pid}/avizations/day/${date}/export/${kind}`
