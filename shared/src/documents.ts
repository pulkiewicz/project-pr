import { z } from 'zod'

export const DOC_STATUSES = ['draft', 'review', 'approved', 'obsolete'] as const
export type DocStatus = (typeof DOC_STATUSES)[number]
export const ACL_LEVELS = ['none', 'read', 'write', 'manage'] as const
export type AclLevel = (typeof ACL_LEVELS)[number]
export const LINK_TARGETS = ['hrf_task', 'purchase_item', 'avization', 'weekly_item'] as const
export type LinkTarget = (typeof LINK_TARGETS)[number]

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
/** Porcja pobierania — limit buforowanej odpowiedzi funkcji (spec. 3.3). */
export const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024
/** Porcja uploadu bezpośrednio do Google — wielokrotność 256 KiB. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export const GOOGLE_NATIVE_MIME = {
  'application/vnd.google-apps.document': { label: 'Dokument Google', exports: { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } },
  'application/vnd.google-apps.spreadsheet': { label: 'Arkusz Google', exports: { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } },
  'application/vnd.google-apps.presentation': { label: 'Prezentacja Google', exports: { pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' } },
} as const
export const isGoogleNative = (mime: string) => mime in GOOGLE_NATIVE_MIME

/** Biała lista typów (spec. §10). */
export const ALLOWED_UPLOAD_MIME: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.oasis.opendocument.text': ['odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/zip': ['zip'],
  'application/acad': ['dwg'],
  'image/vnd.dwg': ['dwg'],
  'application/dxf': ['dxf'],
  'application/vnd.ms-outlook': ['msg'],
  'message/rfc822': ['eml'],
}

export const uploadSessionInput = z.object({
  folderId: z.uuid(),
  name: z.string().trim().min(1).max(255).refine((n) => !/[\\/]/.test(n), 'validation.fileName'),
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  mimeType: z.string().min(3).max(200),
})
export const uploadCompleteInput = z.object({ pendingUploadId: z.uuid(), driveFileId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/) })

export const fileMetaPatch = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().max(100).nullable().optional(),
  status: z.enum(DOC_STATUSES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  folderId: z.uuid().optional(),
})

export const linkInput = z.object({ targetType: z.enum(LINK_TARGETS), targetId: z.uuid() })
export const templateCopyInput = z.object({ templateId: z.uuid(), folderId: z.uuid(), name: z.string().trim().min(1).max(255), link: linkInput.optional() })

export const aclSubjectSchema = z.string().regex(/^(role:(EnvcheckInternal|Arsanit|Client|Subcontractor)|party:Subcontractor:[0-9a-f-]{36})$/)
export const folderAclInput = z.object({
  /** null = dziedzicz z folderu nadrzędnego. */
  entries: z.array(z.object({ subject: aclSubjectSchema, level: z.enum(ACL_LEVELS) })).nullable(),
})

export const driveSettingsInput = z.object({
  sharedDriveId: z.string().trim().min(5).max(200),
  /** Domena kont Google firmy — przycisk „Otwórz w Google Docs” dla Envcheck. */
  googleDomain: z.string().trim().toLowerCase().max(100).nullable().optional(),
})

export interface FolderDto {
  id: string
  name: string
  parentId: string | null
  path: string
  level: AclLevel
  explicitAcl: boolean
}

export interface FileDto {
  id: string
  name: string
  mimeType: string
  size: number | null
  folderId: string
  folderPath: string
  category: string | null
  status: DocStatus
  tags: string[]
  modifiedAt: string | null
  uploadedByName: string | null
  googleNative: boolean
  /** Tylko dla Envcheck z kontem w domenie Google. */
  webViewLink: string | null
  links: { targetType: LinkTarget; targetId: string; label: string | null }[]
  canWrite: boolean
}

export interface DriveStatus {
  configured: boolean
  sharedDriveId: string | null
  rootFolderId: string | null
  googleDomain: string | null
  credentials: boolean
  lastSyncAt: string | null
  folders: number
  files: number
}

export interface AclMatrixRow {
  folderId: string
  path: string
  explicit: boolean
  entries: { subject: string; level: AclLevel }[]
}
