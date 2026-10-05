import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { isGoogleNative, type AclLevel, type FileDto, type LinkTarget } from '#shared'
import type { UserRow } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { auditLog, avizations, driveFiles, driveFolders, driveSyncState, folderAcl, hrfTasks, projects, purchaseItems, recordLinks, users, weeklyItems } from '../../db/schema.ts'
import { FOLDER_MIME, type DriveClient, type DriveItem } from '../../integrations/drive/types.ts'
import { HttpProblem } from '../../lib/problem.ts'
import { atLeast, effectiveLevels } from './acl.ts'
import { ROOT_ACL, ROOT_NAME, STRUCTURE, folderNameFor, type FolderSpec } from './structure.ts'

export interface DriveSettings {
  sharedDriveId: string | null
  rootFolderId: string | null
  googleDomain: string | null
}

export function driveSettings(project: typeof projects.$inferSelect): DriveSettings {
  const d = (project.settings as Record<string, unknown>)?.drive as Partial<DriveSettings> | undefined
  return { sharedDriveId: d?.sharedDriveId ?? null, rootFolderId: d?.rootFolderId ?? null, googleDomain: d?.googleDomain ?? null }
}

export async function saveDriveSettings(db: Database, projectId: string, s: DriveSettings) {
  await db
    .update(projects)
    .set({ settings: sql`jsonb_set(coalesce(${projects.settings}, '{}'::jsonb), '{drive}', ${JSON.stringify(s)}::jsonb)`, updatedAt: sql`now()` })
    .where(eq(projects.id, projectId))
}

export function requireDrive(drive: DriveClient | null): DriveClient {
  if (!drive) throw new HttpProblem(503, 'drive_not_configured')
  return drive
}

export async function folderTree(db: Database, projectId: string) {
  const [folders, acl] = await Promise.all([
    db.select().from(driveFolders).where(and(eq(driveFolders.projectId, projectId), isNull(driveFolders.trashedAt))),
    db.select({ folderId: folderAcl.folderId, subject: folderAcl.subject, level: folderAcl.level }).from(folderAcl).innerJoin(driveFolders, eq(driveFolders.id, folderAcl.folderId)).where(eq(driveFolders.projectId, projectId)),
  ])
  return { folders, acl }
}

export async function levelsFor(db: Database, projectId: string, user: UserRow) {
  const { folders, acl } = await folderTree(db, projectId)
  return { folders, acl, levels: effectiveLevels(user, folders, acl) }
}

export async function requireFolderLevel(db: Database, projectId: string, user: UserRow, folderId: string, need: AclLevel) {
  const { folders, levels } = await levelsFor(db, projectId, user)
  const folder = folders.find((f) => f.id === folderId)
  // Brak dostępu do odczytu = folder „nie istnieje” dla użytkownika (bez ujawniania struktury).
  if (!folder || !atLeast(levels.get(folderId) ?? 'none', 'read')) throw new HttpProblem(404, 'not_found')
  if (!atLeast(levels.get(folderId) ?? 'none', need)) throw new HttpProblem(403, 'folder_access_denied', folder.path)
  return folder
}

// ---------- inicjalizacja struktury ----------
async function registerFolder(db: Database, projectId: string, item: DriveItem, parentId: string | null, path: string) {
  const [row] = await db
    .insert(driveFolders)
    .values({ projectId, driveFolderId: item.id, parentId, name: item.name, path })
    .onConflictDoUpdate({ target: [driveFolders.projectId, driveFolders.driveFolderId], set: { name: item.name, parentId, path, trashedAt: null, updatedAt: sql`now()` } })
    .returning()
  return row!
}

async function setAclIfMissing(db: Database, folderId: string, acl: Record<string, AclLevel> | undefined, userId: string | null) {
  if (acl === undefined) return
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(folderAcl).where(eq(folderAcl.folderId, folderId))
  if ((existing?.n ?? 0) > 0) return // nie nadpisujemy ACL zmienionej przez Admina
  const entries = Object.entries(acl)
  // Pusta jawna ACL (tylko Admin) — znacznik `role:Admin=manage`, by odróżnić od dziedziczenia.
  const rows = entries.length ? entries.map(([subject, level]) => ({ folderId, subject, level, updatedBy: userId })) : [{ folderId, subject: 'role:Admin', level: 'manage' as const, updatedBy: userId }]
  await db.insert(folderAcl).values(rows)
}

async function ensureChild(drive: DriveClient, driveId: string, parentDriveId: string, name: string, cache: Map<string, DriveItem[]>) {
  if (!cache.has(parentDriveId)) cache.set(parentDriveId, await drive.listChildren(driveId, parentDriveId))
  const found = cache.get(parentDriveId)!.find((i) => i.mimeType === FOLDER_MIME && i.name === name)
  if (found) return { item: found, created: false }
  const item = await drive.createFolder(parentDriveId, name)
  cache.get(parentDriveId)!.push(item)
  return { item, created: true }
}

/** Tworzy brakujące foldery (istniejące zostawia), rejestruje je w bazie z domyślną ACL i ustawia token zmian. */
export async function initializeStructure(db: Database, drive: DriveClient, projectId: string, settings: DriveSettings, userId: string) {
  const driveId = settings.sharedDriveId!
  const cache = new Map<string, DriveItem[]>()
  let created = 0
  const root = await ensureChild(drive, driveId, driveId, ROOT_NAME, cache)
  if (root.created) created++
  const rootRow = await registerFolder(db, projectId, root.item, null, '/')
  await setAclIfMissing(db, rootRow.id, ROOT_ACL, userId)

  const tasks = await db.select().from(hrfTasks).where(and(eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
  const dynamicChildren = (kind: FolderSpec['dynamic']): FolderSpec[] => {
    if (kind === 'stage1Tasks') {
      const stage = tasks.find((t) => t.code === '1')
      return tasks.filter((t) => stage && t.parentId === stage.id && !t.isAcceptancePoint).map((t) => ({ name: folderNameFor(t.code, t.name) }))
    }
    if (kind === 'acceptancePoints') return tasks.filter((t) => t.isAcceptancePoint).map((t) => ({ name: folderNameFor(t.code, t.name) }))
    return []
  }

  const walk = async (specs: FolderSpec[], parentDriveId: string, parentRowId: string, parentPath: string) => {
    for (const spec of specs) {
      const r = await ensureChild(drive, driveId, parentDriveId, spec.name, cache)
      if (r.created) created++
      const path = `${parentPath === '/' ? '' : parentPath}/${spec.name}`
      const row = await registerFolder(db, projectId, r.item, parentRowId, path)
      await setAclIfMissing(db, row.id, spec.acl, userId)
      await walk([...(spec.children ?? []), ...dynamicChildren(spec.dynamic)], r.item.id, row.id, path)
    }
  }
  await walk(STRUCTURE, root.item.id, rootRow.id, '/')
  await saveDriveSettings(db, projectId, { ...settings, rootFolderId: root.item.id })

  // Import plików już obecnych w strukturze + start śledzenia zmian.
  const token = await drive.startPageToken(driveId)
  const scanned = await fullScan(db, drive, projectId, driveId)
  await db
    .insert(driveSyncState)
    .values({ projectId, pageToken: token, lastRunAt: sql`now()` })
    .onConflictDoUpdate({ target: driveSyncState.projectId, set: { pageToken: token, lastRunAt: sql`now()`, lastError: null } })
  return { created, scanned }
}

async function fullScan(db: Database, drive: DriveClient, projectId: string, driveId: string) {
  const folders = await db.select().from(driveFolders).where(and(eq(driveFolders.projectId, projectId), isNull(driveFolders.trashedAt)))
  let files = 0
  const queue = [...folders]
  while (queue.length) {
    const f = queue.shift()!
    for (const item of await drive.listChildren(driveId, f.driveFolderId)) {
      if (item.mimeType === FOLDER_MIME) {
        if (!folders.some((x) => x.driveFolderId === item.id)) {
          const row = await registerFolder(db, projectId, item, f.id, `${f.path === '/' ? '' : f.path}/${item.name}`)
          folders.push(row)
          queue.push(row)
        }
      } else {
        await upsertFile(db, projectId, item, f.id, null)
        files++
      }
    }
  }
  return files
}

export async function upsertFile(db: Database, projectId: string, item: DriveItem, folderId: string, uploadedBy: string | null) {
  const [row] = await db
    .insert(driveFiles)
    .values({
      projectId,
      driveFileId: item.id,
      folderId,
      name: item.name,
      mimeType: item.mimeType,
      size: item.size,
      driveVersion: item.version,
      md5: item.md5,
      modifiedAt: item.modifiedTime,
      webViewLink: item.webViewLink,
      uploadedBy,
      syncedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [driveFiles.projectId, driveFiles.driveFileId],
      set: { folderId, name: item.name, mimeType: item.mimeType, size: item.size, driveVersion: item.version, md5: item.md5, modifiedAt: item.modifiedTime, webViewLink: item.webViewLink, trashedAt: null, syncedAt: sql`now()`, updatedAt: sql`now()` },
    })
    .returning()
  return row!
}

// ---------- synchronizacja (Drive Changes API) ----------
export async function runSync(db: Database, drive: DriveClient, projectId: string, settings: DriveSettings, deadlineMs: number) {
  const [state] = await db.select().from(driveSyncState).where(eq(driveSyncState.projectId, projectId))
  if (!settings.sharedDriveId || !state?.pageToken) return { applied: 0, done: true }
  let token = state.pageToken
  let applied = 0
  let done = false
  try {
    while (Date.now() < deadlineMs) {
      const page = await drive.changes(settings.sharedDriveId, token)
      const folders = await db.select().from(driveFolders).where(eq(driveFolders.projectId, projectId))
      const byDriveId = new Map(folders.map((f) => [f.driveFolderId, f]))
      for (const ch of page.changes) {
        const f = ch.file
        if (ch.removed || !f || f.trashed) {
          await db.update(driveFiles).set({ trashedAt: sql`now()` }).where(and(eq(driveFiles.projectId, projectId), eq(driveFiles.driveFileId, ch.fileId)))
          await db.update(driveFolders).set({ trashedAt: sql`now()` }).where(and(eq(driveFolders.projectId, projectId), eq(driveFolders.driveFolderId, ch.fileId)))
          applied++
          continue
        }
        const parent = f.parents.map((p) => byDriveId.get(p)).find(Boolean)
        if (!parent) continue // poza strukturą projektu
        if (f.mimeType === FOLDER_MIME) {
          const row = await registerFolder(db, projectId, f, parent.id, `${parent.path === '/' ? '' : parent.path}/${f.name}`)
          byDriveId.set(f.id, row)
        } else {
          await upsertFile(db, projectId, f, parent.id, null)
        }
        applied++
      }
      if (page.nextPageToken) {
        token = page.nextPageToken
      } else {
        token = page.newStartPageToken ?? token
        done = true
      }
      // Postęp zapisywany po każdej stronie — kolejny przebieg kontynuuje od tokenu.
      await db.update(driveSyncState).set({ pageToken: token, lastRunAt: sql`now()`, lastError: null }).where(eq(driveSyncState.projectId, projectId))
      if (done) break
    }
  } catch (e) {
    await db.update(driveSyncState).set({ lastError: e instanceof Error ? e.message : String(e), lastRunAt: sql`now()` }).where(eq(driveSyncState.projectId, projectId))
    throw e
  }
  return { applied, done }
}

// ---------- DTO ----------
export async function linkLabels(db: Database, links: { targetType: LinkTarget; targetId: string }[]) {
  const ids = (t: LinkTarget) => links.filter((l) => l.targetType === t).map((l) => l.targetId)
  const labels = new Map<string, string>()
  const q = async (t: LinkTarget, rows: Promise<{ id: string; label: string }[]>) => (ids(t).length ? (await rows).forEach((r) => labels.set(`${t}:${r.id}`, r.label)) : undefined)
  await Promise.all([
    q('hrf_task', db.select({ id: hrfTasks.id, label: sql<string>`${hrfTasks.code} || ' ' || ${hrfTasks.name}` }).from(hrfTasks).where(inArray(hrfTasks.id, ids('hrf_task').length ? ids('hrf_task') : ['00000000-0000-0000-0000-000000000000']))),
    q('purchase_item', db.select({ id: purchaseItems.id, label: purchaseItems.name }).from(purchaseItems).where(inArray(purchaseItems.id, ids('purchase_item').length ? ids('purchase_item') : ['00000000-0000-0000-0000-000000000000']))),
    q('avization', db.select({ id: avizations.id, label: avizations.number }).from(avizations).where(inArray(avizations.id, ids('avization').length ? ids('avization') : ['00000000-0000-0000-0000-000000000000']))),
    q('weekly_item', db.select({ id: weeklyItems.id, label: sql<string>`${weeklyItems.isoWeek} || ' ' || ${weeklyItems.title}` }).from(weeklyItems).where(inArray(weeklyItems.id, ids('weekly_item').length ? ids('weekly_item') : ['00000000-0000-0000-0000-000000000000']))),
  ])
  return labels
}

export async function toFileDtos(
  db: Database,
  rows: (typeof driveFiles.$inferSelect)[],
  ctx: { folders: { id: string; path: string }[]; levels: Map<string, AclLevel>; user: UserRow; googleDomain: string | null },
): Promise<FileDto[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [links, uploaders] = await Promise.all([
    db.select().from(recordLinks).where(inArray(recordLinks.fileId, ids)),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.uploadedBy).filter(Boolean) as string[])].concat('00000000-0000-0000-0000-000000000000'))),
  ])
  const labels = await linkLabels(db, links)
  const path = new Map(ctx.folders.map((f) => [f.id, f.path]))
  const names = new Map(uploaders.map((u) => [u.id, u.name]))
  // „Otwórz w Google Docs” tylko dla Envcheck z kontem w domenie firmowej (spec. 7.5).
  const google = !!ctx.googleDomain && ['Admin', 'EnvcheckInternal'].includes(ctx.user.role) && ctx.user.email.toLowerCase().endsWith(`@${ctx.googleDomain}`)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mimeType: r.mimeType,
    size: r.size,
    folderId: r.folderId,
    folderPath: path.get(r.folderId) ?? '',
    category: r.category,
    status: r.status,
    tags: r.tags,
    modifiedAt: r.modifiedAt,
    uploadedByName: r.uploadedBy ? (names.get(r.uploadedBy) ?? null) : null,
    googleNative: isGoogleNative(r.mimeType),
    webViewLink: google ? r.webViewLink : null,
    links: links.filter((l) => l.fileId === r.id).map((l) => ({ targetType: l.targetType, targetId: l.targetId, label: labels.get(`${l.targetType}:${l.targetId}`) ?? null })),
    canWrite: atLeast(ctx.levels.get(r.folderId) ?? 'none', 'write'),
  }))
}

// ---------- archiwizacja plików generowanych przez aplikację ----------
/**
 * Zapisuje plik do folderu repozytorium (best-effort — błąd Drive nie przerywa operacji biznesowej).
 * Używane m.in. przez import HRF (archiwum rewizji) i akceptację awizacji (lista PDF).
 */
export async function archiveToDrive(
  db: Database,
  drive: DriveClient | null,
  projectId: string,
  folderPath: string,
  file: { name: string; mimeType: string; data: Uint8Array },
  link?: { targetType: LinkTarget; targetId: string },
) {
  if (!drive) return null
  try {
    const [folder] = await db.select().from(driveFolders).where(and(eq(driveFolders.projectId, projectId), eq(driveFolders.path, folderPath), isNull(driveFolders.trashedAt)))
    if (!folder) return null
    const item = await drive.uploadSmall({ parentId: folder.driveFolderId, name: file.name, mimeType: file.mimeType, data: file.data })
    const row = await upsertFile(db, projectId, item, folder.id, null)
    await db.update(driveFiles).set({ status: 'approved' }).where(eq(driveFiles.id, row.id))
    if (link) await db.insert(recordLinks).values({ fileId: row.id, ...link }).onConflictDoNothing()
    await db.insert(auditLog).values({ action: 'documents.archive', entity: 'drive_files', entityId: row.id, projectId, changes: { path: folderPath, name: file.name } })
    return row
  } catch (e) {
    console.error('[pmo] archiwizacja na Drive nie powiodła się', e)
    return null
  }
}
