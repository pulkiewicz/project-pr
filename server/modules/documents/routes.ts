import { createHash } from 'node:crypto'
import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  ALLOWED_UPLOAD_MIME,
  DOWNLOAD_CHUNK_BYTES,
  GOOGLE_NATIVE_MIME,
  LINK_TARGETS,
  driveSettingsInput,
  fileMetaPatch,
  folderAclInput,
  isGoogleNative,
  linkInput,
  templateCopyInput,
  uploadCompleteInput,
  uploadSessionInput,
  type AclMatrixRow,
  type Action,
  type DriveStatus,
  type FolderDto,
  type ModuleKey,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import { driveFiles, driveFolders, driveSyncState, folderAcl, pendingUploads, recordLinks } from '../../db/schema.ts'
import { HttpProblem, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { getProject } from '../hrf/service.ts'
import { atLeast } from './acl.ts'
import { AUTO_FOLDERS } from './structure.ts'
import {
  driveSettings,
  folderTree,
  initializeStructure,
  levelsFor,
  requireDrive,
  requireFolderLevel,
  runSync,
  saveDriveSettings,
  toFileDtos,
  upsertFile,
} from './service.ts'

export const documentsRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const fileResp = { 200: { description: 'Plik', content: { 'application/octet-stream': { schema: z.any() } } }, 206: { description: 'Zakres', content: { 'application/octet-stream': { schema: z.any() } } } }
const BASE = '/projects/{projectId}/documents'
const projectParam = z.object({ projectId: z.uuid() })
const fileParam = projectParam.extend({ fileId: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

async function ctx(c: Context<AppEnv>, projectId: string) {
  const db = c.get('deps').db
  const project = await getProject(db, projectId)
  return { db, project, settings: driveSettings(project) }
}

async function loadFile(c: Context<AppEnv>, projectId: string, fileId: string, need: 'read' | 'write' | 'manage') {
  const db = c.get('deps').db
  const [f] = await db.select().from(driveFiles).where(and(eq(driveFiles.id, fileId), eq(driveFiles.projectId, projectId), isNull(driveFiles.trashedAt)))
  if (!f) throw notFound()
  await requireFolderLevel(db, projectId, c.get('user'), f.folderId, need)
  return f
}

// ---------- status i konfiguracja (Admin) ----------
documentsRouter.openapi(route({ method: 'get', path: `${BASE}/status`, request: { params: projectParam }, responses: ok }, 'documents', 'view'), async (c) => {
  const { db, settings } = await ctx(c, c.req.valid('param').projectId)
  const projectId = c.req.valid('param').projectId
  const [[state], [counts]] = await Promise.all([
    db.select().from(driveSyncState).where(eq(driveSyncState.projectId, projectId)),
    db.select({ folders: sql<number>`(select count(*)::int from drive_folders where project_id = ${projectId} and trashed_at is null)`, files: sql<number>`(select count(*)::int from drive_files where project_id = ${projectId} and trashed_at is null)` }).from(sql`(select 1) x`),
  ])
  const body: DriveStatus = {
    configured: !!settings.sharedDriveId && !!settings.rootFolderId,
    sharedDriveId: c.get('permissions').has('admin:view') ? settings.sharedDriveId : null,
    rootFolderId: c.get('permissions').has('admin:view') ? settings.rootFolderId : null,
    googleDomain: settings.googleDomain,
    credentials: !!c.get('deps').drive,
    lastSyncAt: state?.lastRunAt ?? null,
    folders: counts?.folders ?? 0,
    files: counts?.files ?? 0,
  }
  return c.json(body, 200)
})

documentsRouter.openapi(
  route({ method: 'put', path: `${BASE}/settings`, request: { params: projectParam, body: body(driveSettingsInput) }, responses: ok }, 'admin', 'edit'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const { db, settings } = await ctx(c, projectId)
    const drive = requireDrive(c.get('deps').drive)
    // Test połączenia: konto serwisowe musi widzieć Shared Drive.
    let name: string
    try {
      name = (await drive.getDrive(input.sharedDriveId)).name
    } catch (e) {
      throw new HttpProblem(422, 'drive_connection_failed', e instanceof Error ? e.message.slice(0, 300) : undefined)
    }
    const next = { sharedDriveId: input.sharedDriveId, googleDomain: input.googleDomain ?? null, rootFolderId: input.sharedDriveId === settings.sharedDriveId ? settings.rootFolderId : null }
    await saveDriveSettings(db, projectId, next)
    await writeAudit(c, { action: 'documents.settings', entity: 'projects', entityId: projectId, projectId, changes: { sharedDriveId: input.sharedDriveId, googleDomain: next.googleDomain } })
    return c.json({ ok: true, driveName: name }, 200)
  },
)

documentsRouter.openapi(route({ method: 'post', path: `${BASE}/initialize`, request: { params: projectParam }, responses: ok }, 'admin', 'edit'), async (c) => {
  const { projectId } = c.req.valid('param')
  const { db, settings } = await ctx(c, projectId)
  if (!settings.sharedDriveId) throw new HttpProblem(422, 'drive_not_configured')
  const result = await initializeStructure(db, requireDrive(c.get('deps').drive), projectId, settings, c.get('user').id)
  await writeAudit(c, { action: 'documents.initialize', entity: 'drive_folders', projectId, changes: result })
  return c.json(result, 200)
})

documentsRouter.openapi(route({ method: 'post', path: `${BASE}/sync`, request: { params: projectParam }, responses: ok }, 'admin', 'edit'), async (c) => {
  const { projectId } = c.req.valid('param')
  const { db, settings } = await ctx(c, projectId)
  // Synchroniczny przebieg ograniczony do 20 s (limit funkcji 60 s); resztę dokończy zadanie co 5 min.
  return c.json(await runSync(db, requireDrive(c.get('deps').drive), projectId, settings, Date.now() + 20_000), 200)
})

// ---------- foldery ----------
documentsRouter.openapi(route({ method: 'get', path: `${BASE}/folders`, request: { params: projectParam }, responses: ok }, 'documents', 'view'), async (c) => {
  const { projectId } = c.req.valid('param')
  const { folders, acl, levels } = await levelsFor(c.get('deps').db, projectId, c.get('user'))
  const explicit = new Set(acl.map((a) => a.folderId))
  const readable = folders.filter((f) => atLeast(levels.get(f.id) ?? 'none', 'read'))
  // Przodkowie folderów dostępnych są pokazywani do nawigacji (z poziomem „none”), bez ich zawartości.
  const byId = new Map(folders.map((f) => [f.id, f]))
  const shown = new Map(readable.map((f) => [f.id, f]))
  for (const f of readable) {
    let p = f.parentId ? byId.get(f.parentId) : undefined
    while (p && !shown.has(p.id)) {
      shown.set(p.id, p)
      p = p.parentId ? byId.get(p.parentId) : undefined
    }
  }
  const list: FolderDto[] = [...shown.values()]
    .sort((a, b) => a.path.localeCompare(b.path, 'pl', { numeric: true }))
    .map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, path: f.path, level: levels.get(f.id) ?? 'none', explicitAcl: explicit.has(f.id) }))
  return c.json(list, 200)
})

documentsRouter.openapi(
  route({ method: 'post', path: `${BASE}/folders`, request: { params: projectParam, body: body(z.object({ parentId: z.uuid(), name: z.string().trim().min(1).max(120).refine((n) => !/[\\/]/.test(n)) })) }, responses: ok }, 'documents', 'view'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { parentId, name } = c.req.valid('json')
    const db = c.get('deps').db
    const parent = await requireFolderLevel(db, projectId, c.get('user'), parentId, 'write')
    const item = await requireDrive(c.get('deps').drive).createFolder(parent.driveFolderId, name)
    const [row] = await db.insert(driveFolders).values({ projectId, driveFolderId: item.id, parentId, name, path: `${parent.path === '/' ? '' : parent.path}/${name}` }).returning()
    await writeAudit(c, { action: 'documents.folder_create', entity: 'drive_folders', entityId: row!.id, projectId, changes: { path: row!.path } })
    return c.json({ id: row!.id, path: row!.path }, 200)
  },
)

// ---------- pliki ----------
documentsRouter.openapi(
  route(
    {
      method: 'get',
      path: `${BASE}/files`,
      request: { params: projectParam, query: z.object({ folderId: z.uuid().optional(), q: z.string().trim().max(100).optional(), targetType: z.enum(LINK_TARGETS).optional(), targetId: z.uuid().optional() }) },
      responses: ok,
    },
    'documents',
    'view',
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const q = c.req.valid('query')
    const db = c.get('deps').db
    const { folders, levels, project } = { ...(await levelsFor(db, projectId, c.get('user'))), project: await getProject(db, projectId) }
    const readable = folders.filter((f) => atLeast(levels.get(f.id) ?? 'none', 'read')).map((f) => f.id)
    if (!readable.length) return c.json([], 200)
    let linked: string[] | undefined
    if (q.targetType && q.targetId) {
      linked = (await db.select({ id: recordLinks.fileId }).from(recordLinks).where(and(eq(recordLinks.targetType, q.targetType), eq(recordLinks.targetId, q.targetId)))).map((r) => r.id)
      if (!linked.length) return c.json([], 200)
    }
    const term = q.q ? `%${q.q.replace(/[%_]/g, '')}%` : undefined
    const rows = await db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.projectId, projectId),
          isNull(driveFiles.trashedAt),
          inArray(driveFiles.folderId, q.folderId ? (readable.includes(q.folderId) ? [q.folderId] : []) : readable),
          linked ? inArray(driveFiles.id, linked) : undefined,
          // Wyszukiwanie po nazwie i metadanych (kategoria, tagi); filtr ACL powyżej.
          term ? sql`(${ilike(driveFiles.name, term)} or ${ilike(driveFiles.category, term)} or ${driveFiles.tags}::text ilike ${term})` : undefined,
        ),
      )
      .orderBy(desc(driveFiles.modifiedAt))
      .limit(500)
    if (q.folderId && !readable.includes(q.folderId)) return c.json([], 200)
    return c.json(await toFileDtos(db, rows, { folders, levels, user: c.get('user'), googleDomain: driveSettings(project).googleDomain }), 200)
  },
)

documentsRouter.openapi(
  route({ method: 'patch', path: `${BASE}/files/{fileId}`, request: { params: fileParam, body: body(fileMetaPatch) }, responses: ok }, 'documents', 'view'),
  async (c) => {
    const { projectId, fileId } = c.req.valid('param')
    const patch = c.req.valid('json')
    const db = c.get('deps').db
    const f = await loadFile(c, projectId, fileId, 'write')
    const drive = c.get('deps').drive
    let folderId = f.folderId
    if (patch.folderId && patch.folderId !== f.folderId) {
      const [from, to] = await Promise.all([
        requireFolderLevel(db, projectId, c.get('user'), f.folderId, 'write'),
        requireFolderLevel(db, projectId, c.get('user'), patch.folderId, 'write'),
      ])
      await requireDrive(drive).update(f.driveFileId, { addParent: to.driveFolderId, removeParent: from.driveFolderId })
      folderId = to.id
    }
    if (patch.name && patch.name !== f.name) await requireDrive(drive).update(f.driveFileId, { name: patch.name })
    await db
      .update(driveFiles)
      .set({ name: patch.name ?? f.name, category: patch.category !== undefined ? patch.category : f.category, status: patch.status ?? f.status, tags: patch.tags ?? f.tags, folderId, version: sql`${driveFiles.version} + 1`, updatedAt: sql`now()` })
      .where(eq(driveFiles.id, fileId))
    await writeAudit(c, { action: 'documents.update', entity: 'drive_files', entityId: fileId, projectId, changes: patch })
    return c.json({ ok: true }, 200)
  },
)

documentsRouter.openapi(route({ method: 'delete', path: `${BASE}/files/{fileId}`, request: { params: fileParam }, responses: ok }, 'documents', 'view'), async (c) => {
  const { projectId, fileId } = c.req.valid('param')
  const db = c.get('deps').db
  const f = await loadFile(c, projectId, fileId, 'write')
  // Usunąć cudzy plik może tylko `manage`; własny upload — `write`.
  if (f.uploadedBy !== c.get('user').id) await requireFolderLevel(db, projectId, c.get('user'), f.folderId, 'manage')
  await requireDrive(c.get('deps').drive).update(f.driveFileId, { trashed: true })
  await db.update(driveFiles).set({ trashedAt: sql`now()` }).where(eq(driveFiles.id, fileId))
  await writeAudit(c, { action: 'documents.trash', entity: 'drive_files', entityId: fileId, projectId, changes: { name: f.name } })
  return c.json({ ok: true }, 200)
})

documentsRouter.openapi(
  route({ method: 'post', path: `${BASE}/files/{fileId}/links`, request: { params: fileParam, body: body(linkInput) }, responses: ok }, 'documents', 'view'),
  async (c) => {
    const { projectId, fileId } = c.req.valid('param')
    const link = c.req.valid('json')
    await loadFile(c, projectId, fileId, 'write')
    await c.get('deps').db.insert(recordLinks).values({ fileId, ...link, createdBy: c.get('user').id }).onConflictDoNothing()
    await writeAudit(c, { action: 'documents.link', entity: 'drive_files', entityId: fileId, projectId, changes: link })
    return c.json({ ok: true }, 200)
  },
)

documentsRouter.openapi(
  route({ method: 'delete', path: `${BASE}/files/{fileId}/links`, request: { params: fileParam, body: body(linkInput) }, responses: ok }, 'documents', 'view'),
  async (c) => {
    const { projectId, fileId } = c.req.valid('param')
    const link = c.req.valid('json')
    await loadFile(c, projectId, fileId, 'write')
    await c.get('deps').db.delete(recordLinks).where(and(eq(recordLinks.fileId, fileId), eq(recordLinks.targetType, link.targetType), eq(recordLinks.targetId, link.targetId)))
    await writeAudit(c, { action: 'documents.unlink', entity: 'drive_files', entityId: fileId, projectId, changes: link })
    return c.json({ ok: true }, 200)
  },
)

// ---------- upload bezpośrednio do Google (spec. 7.3) ----------
const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
const sha = (v: string) => createHash('sha256').update(v).digest('hex')

documentsRouter.openapi(
  route({ method: 'post', path: `${BASE}/upload-sessions`, request: { params: projectParam, body: body(uploadSessionInput.extend({ link: linkInput.optional() })) }, responses: ok }, 'documents', 'view'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const folder = await requireFolderLevel(db, projectId, c.get('user'), input.folderId, 'write')
    const allowed = ALLOWED_UPLOAD_MIME[input.mimeType]
    if (!allowed || !allowed.includes(extOf(input.name))) throw new HttpProblem(422, 'upload_type_not_allowed', `${input.mimeType} .${extOf(input.name)}`)
    const origin = new URL(c.req.url).origin
    const uploadUrl = await requireDrive(c.get('deps').drive).createUploadSession({ parentId: folder.driveFolderId, name: input.name, mimeType: input.mimeType, size: input.size, origin })
    const [p] = await db
      .insert(pendingUploads)
      .values({ projectId, userId: c.get('user').id, folderId: folder.id, name: input.name, size: input.size, mimeType: input.mimeType, sessionUriHash: sha(uploadUrl), link: input.link ?? null, expiresAt: sql`now() + interval '24 hours'` })
      .returning()
    return c.json({ pendingUploadId: p!.id, uploadUrl }, 200)
  },
)

documentsRouter.openapi(
  route({ method: 'post', path: `${BASE}/upload-complete`, request: { params: projectParam, body: body(uploadCompleteInput) }, responses: ok }, 'documents', 'view'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { pendingUploadId, driveFileId } = c.req.valid('json')
    const db = c.get('deps').db
    const drive = requireDrive(c.get('deps').drive)
    const [p] = await db.select().from(pendingUploads).where(and(eq(pendingUploads.id, pendingUploadId), eq(pendingUploads.projectId, projectId), eq(pendingUploads.userId, c.get('user').id), isNull(pendingUploads.completedAt)))
    if (!p || new Date(p.expiresAt) < new Date()) throw new HttpProblem(404, 'upload_not_found')
    const folder = await requireFolderLevel(db, projectId, c.get('user'), p.folderId, 'write')
    const item = await drive.getFile(driveFileId)
    // Weryfikacja po uploadzie: folder, rozmiar, typ. Niezgodność → usunięcie pliku z Drive.
    if (!item.parents.includes(folder.driveFolderId) || item.size !== p.size || item.mimeType !== p.mimeType || item.name !== p.name) {
      await drive.update(driveFileId, { trashed: true }).catch(() => undefined)
      await writeAudit(c, { action: 'documents.upload_rejected', entity: 'drive_files', projectId, changes: { expected: { name: p.name, size: p.size, mime: p.mimeType }, got: { name: item.name, size: item.size, mime: item.mimeType } } })
      throw new HttpProblem(422, 'upload_verification_failed')
    }
    const row = await upsertFile(db, projectId, item, folder.id, c.get('user').id)
    await db.update(pendingUploads).set({ completedAt: sql`now()` }).where(eq(pendingUploads.id, p.id))
    if (p.link) await db.insert(recordLinks).values({ fileId: row.id, targetType: p.link.targetType as never, targetId: p.link.targetId, createdBy: c.get('user').id }).onConflictDoNothing()
    await writeAudit(c, { action: 'documents.upload', entity: 'drive_files', entityId: row.id, projectId, changes: { name: p.name, size: p.size, path: folder.path } })
    return c.json({ id: row.id }, 200)
  },
)

// ---------- pobieranie / podgląd (spec. 7.4) ----------
documentsRouter.openapi(
  route(
    { method: 'get', path: `${BASE}/files/{fileId}/content`, request: { params: fileParam, query: z.object({ format: z.enum(['pdf', 'docx', 'xlsx', 'pptx']).optional(), preview: z.coerce.boolean().optional() }) }, responses: fileResp },
    'documents',
    'view',
  ),
  async (c) => {
    const { projectId, fileId } = c.req.valid('param')
    const { format, preview } = c.req.valid('query')
    const f = await loadFile(c, projectId, fileId, 'read')
    const drive = requireDrive(c.get('deps').drive)
    const range = c.req.header('range')
    // Audit: jeden wpis na pobranie/podgląd (pierwsza porcja), nie na każdą porcję.
    if (!range || /^bytes=0-/.test(range)) {
      await writeAudit(c, { action: preview ? 'documents.preview' : 'documents.download', entity: 'drive_files', entityId: fileId, projectId, changes: { name: f.name, format: format ?? null } })
    }
    if (isGoogleNative(f.mimeType)) {
      const exports = GOOGLE_NATIVE_MIME[f.mimeType as keyof typeof GOOGLE_NATIVE_MIME].exports as Record<string, string>
      const target = exports[format ?? 'pdf'] ?? exports.pdf!
      const res = await drive.exportFile(f.driveFileId, target)
      const ext = Object.entries(exports).find(([, m]) => m === target)?.[0] ?? 'pdf'
      return new Response(res.body, { status: 200, headers: { 'content-type': target, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${f.name}.${ext}`)}`, 'cache-control': 'no-store' } })
    }
    const size = f.size ?? 0
    // Porcje ≤ 4 MB (limit buforowanej odpowiedzi funkcji); klient składa plik z kolejnych zakresów.
    let start = 0
    let end = Math.min(size, DOWNLOAD_CHUNK_BYTES) - 1
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range)
      if (!m) throw new HttpProblem(416, 'range_invalid')
      start = Number(m[1])
      end = Math.min(m[2] ? Number(m[2]) : size - 1, start + DOWNLOAD_CHUNK_BYTES - 1, size - 1)
      if (start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    }
    const res = await drive.download(f.driveFileId, size ? `bytes=${start}-${end}` : undefined)
    const partial = size > 0 && !(start === 0 && end === size - 1)
    return new Response(res.body, {
      status: partial ? 206 : 200,
      headers: {
        'content-type': f.mimeType,
        'accept-ranges': 'bytes',
        'content-length': String(size ? end - start + 1 : 0),
        ...(partial ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'cache-control': 'no-store',
        'x-file-size': String(size),
      },
    })
  },
)

documentsRouter.openapi(
  route({ method: 'get', path: `${BASE}/files/{fileId}/thumbnail`, request: { params: fileParam }, responses: fileResp }, 'documents', 'view'),
  async (c) => {
    const { projectId, fileId } = c.req.valid('param')
    const f = await loadFile(c, projectId, fileId, 'read')
    const drive = requireDrive(c.get('deps').drive)
    const item = await drive.getFile(f.driveFileId)
    if (!item.thumbnailLink) throw notFound('no_thumbnail')
    const res = await drive.fetchThumbnail(item.thumbnailLink)
    return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') ?? 'image/png', 'cache-control': 'no-store' } })
  },
)

documentsRouter.openapi(route({ method: 'get', path: `${BASE}/files/{fileId}/revisions`, request: { params: fileParam }, responses: ok }, 'documents', 'view'), async (c) => {
  const { projectId, fileId } = c.req.valid('param')
  const f = await loadFile(c, projectId, fileId, 'read')
  return c.json(await requireDrive(c.get('deps').drive).revisions(f.driveFileId), 200)
})

// ---------- szablony Google Docs ----------
documentsRouter.openapi(route({ method: 'get', path: `${BASE}/templates`, request: { params: projectParam }, responses: ok }, 'documents', 'view'), async (c) => {
  const { projectId } = c.req.valid('param')
  const db = c.get('deps').db
  const { folders, levels } = await levelsFor(db, projectId, c.get('user'))
  const folder = folders.find((f) => f.path === AUTO_FOLDERS.templates)
  if (!folder || !atLeast(levels.get(folder.id) ?? 'none', 'read')) return c.json([], 200)
  const rows = await db.select().from(driveFiles).where(and(eq(driveFiles.folderId, folder.id), isNull(driveFiles.trashedAt)))
  return c.json(rows.filter((r) => isGoogleNative(r.mimeType)).map((r) => ({ id: r.id, name: r.name, mimeType: r.mimeType })), 200)
})

documentsRouter.openapi(
  route({ method: 'post', path: `${BASE}/from-template`, request: { params: projectParam, body: body(templateCopyInput) }, responses: ok }, 'documents', 'view'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const tpl = await loadFile(c, projectId, input.templateId, 'read')
    if (!isGoogleNative(tpl.mimeType)) throw new HttpProblem(422, 'template_not_google')
    const target = await requireFolderLevel(db, projectId, c.get('user'), input.folderId, 'write')
    const item = await requireDrive(c.get('deps').drive).copy(tpl.driveFileId, target.driveFolderId, input.name)
    const row = await upsertFile(db, projectId, item, target.id, c.get('user').id)
    if (input.link) await db.insert(recordLinks).values({ fileId: row.id, ...input.link, createdBy: c.get('user').id }).onConflictDoNothing()
    await writeAudit(c, { action: 'documents.from_template', entity: 'drive_files', entityId: row.id, projectId, changes: { template: tpl.name, name: input.name, path: target.path } })
    const { folders, levels, project } = { ...(await levelsFor(db, projectId, c.get('user'))), project: await getProject(db, projectId) }
    const [dto] = await toFileDtos(db, [row], { folders, levels, user: c.get('user'), googleDomain: driveSettings(project).googleDomain })
    return c.json(dto, 200)
  },
)

// ---------- uprawnienia folderów (Admin) ----------
documentsRouter.openapi(route({ method: 'get', path: `${BASE}/acl`, request: { params: projectParam }, responses: ok }, 'admin', 'view'), async (c) => {
  const { projectId } = c.req.valid('param')
  const { folders, acl } = await folderTree(c.get('deps').db, projectId)
  const rows: AclMatrixRow[] = folders
    .sort((a, b) => a.path.localeCompare(b.path, 'pl', { numeric: true }))
    .map((f) => {
      const entries = acl.filter((a) => a.folderId === f.id && a.subject !== 'role:Admin').map((a) => ({ subject: a.subject, level: a.level }))
      return { folderId: f.id, path: f.path, explicit: acl.some((a) => a.folderId === f.id), entries }
    })
  return c.json(rows, 200)
})

documentsRouter.openapi(
  route({ method: 'put', path: `${BASE}/acl/{folderId}`, request: { params: projectParam.extend({ folderId: z.uuid() }), body: body(folderAclInput) }, responses: ok }, 'admin', 'edit'),
  async (c) => {
    const { projectId, folderId } = c.req.valid('param')
    const { entries } = c.req.valid('json')
    const db = c.get('deps').db
    const [folder] = await db.select().from(driveFolders).where(and(eq(driveFolders.id, folderId), eq(driveFolders.projectId, projectId)))
    if (!folder) throw notFound()
    const before = await db.select({ subject: folderAcl.subject, level: folderAcl.level }).from(folderAcl).where(eq(folderAcl.folderId, folderId))
    await db.transaction(async (tx) => {
      await tx.delete(folderAcl).where(eq(folderAcl.folderId, folderId))
      if (entries !== null) {
        const rows = entries.filter((e) => e.level !== 'none').map((e) => ({ folderId, subject: e.subject, level: e.level, updatedBy: c.get('user').id }))
        // Jawna ACL bez wpisów = tylko Admin (znacznik odróżniający od dziedziczenia).
        await tx.insert(folderAcl).values(rows.length ? rows : [{ folderId, subject: 'role:Admin', level: 'manage' as const, updatedBy: c.get('user').id }])
      }
      await writeAudit(c, { action: 'documents.acl', entity: 'drive_folders', entityId: folderId, projectId, changes: { path: folder.path, old: before, new: entries } }, tx)
    })
    return c.json({ ok: true }, 200)
  },
)
