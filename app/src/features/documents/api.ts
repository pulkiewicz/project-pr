import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AclMatrixRow, DriveStatus, FileDto, FolderDto, LinkTarget } from '#shared'
import { api } from '../../lib/api'
import { useProjectId } from '../hrf/api'

const base = (pid: string) => `/projects/${pid}/documents`

export function useDriveStatus() {
  const pid = useProjectId()
  return useQuery({ queryKey: ['docs', pid, 'status'], queryFn: () => api<DriveStatus>(`${base(pid)}/status`) })
}
export function useFolders(enabled = true) {
  const pid = useProjectId()
  return useQuery({ queryKey: ['docs', pid, 'folders'], queryFn: () => api<FolderDto[]>(`${base(pid)}/folders`), enabled })
}
export function useFiles(params: { folderId?: string | null; q?: string; targetType?: LinkTarget; targetId?: string }, enabled = true) {
  const pid = useProjectId()
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
  return useQuery({ queryKey: ['docs', pid, 'files', qs.toString()], queryFn: () => api<FileDto[]>(`${base(pid)}/files?${qs}`), enabled })
}
export function useTemplates(enabled: boolean) {
  const pid = useProjectId()
  return useQuery({ queryKey: ['docs', pid, 'templates'], queryFn: () => api<{ id: string; name: string; mimeType: string }[]>(`${base(pid)}/templates`), enabled })
}
export function useAcl() {
  const pid = useProjectId()
  return useQuery({ queryKey: ['docs', pid, 'acl'], queryFn: () => api<AclMatrixRow[]>(`${base(pid)}/acl`) })
}

export function useDocsMutations() {
  const pid = useProjectId()
  const qc = useQueryClient()
  const inv = () => void qc.invalidateQueries({ queryKey: ['docs', pid] })
  const b = base(pid)
  return {
    invalidate: inv,
    patch: useMutation({ mutationFn: (v: { id: string; data: Record<string, unknown> }) => api(`${b}/files/${v.id}`, { method: 'PATCH', json: v.data }), onSettled: inv }),
    trash: useMutation({ mutationFn: (id: string) => api(`${b}/files/${id}`, { method: 'DELETE' }), onSettled: inv }),
    link: useMutation({ mutationFn: (v: { id: string; targetType: LinkTarget; targetId: string }) => api(`${b}/files/${v.id}/links`, { method: 'POST', json: { targetType: v.targetType, targetId: v.targetId } }), onSettled: inv }),
    unlink: useMutation({ mutationFn: (v: { id: string; targetType: LinkTarget; targetId: string }) => api(`${b}/files/${v.id}/links`, { method: 'DELETE', json: { targetType: v.targetType, targetId: v.targetId } }), onSettled: inv }),
    createFolder: useMutation({ mutationFn: (v: { parentId: string; name: string }) => api(`${b}/folders`, { method: 'POST', json: v }), onSettled: inv }),
    fromTemplate: useMutation({ mutationFn: (v: { templateId: string; folderId: string; name: string; link?: { targetType: LinkTarget; targetId: string } }) => api<FileDto>(`${b}/from-template`, { method: 'POST', json: v }), onSettled: inv }),
    saveSettings: useMutation({ mutationFn: (v: { sharedDriveId: string; googleDomain: string | null }) => api<{ driveName: string }>(`${b}/settings`, { method: 'PUT', json: v }), onSettled: inv }),
    initialize: useMutation({ mutationFn: () => api<{ created: number; scanned: number }>(`${b}/initialize`, { method: 'POST' }), onSettled: inv }),
    sync: useMutation({ mutationFn: () => api<{ applied: number }>(`${b}/sync`, { method: 'POST' }), onSettled: inv }),
    saveAcl: useMutation({ mutationFn: (v: { folderId: string; entries: { subject: string; level: string }[] | null }) => api(`${b}/acl/${v.folderId}`, { method: 'PUT', json: { entries: v.entries } }), onSettled: inv }),
    revisions: (id: string) => api<{ id: string; modifiedTime: string; size: number | null; author: string | null }[]>(`${b}/files/${id}/revisions`),
  }
}

export const contentPath = (pid: string, id: string, q = '') => `${base(pid)}/files/${id}/content${q}`
export const thumbnailPath = (pid: string, id: string) => `${base(pid)}/files/${id}/thumbnail`
