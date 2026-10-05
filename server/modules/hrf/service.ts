import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { HrfDependencyDto, HrfTaskDto } from '#shared'
import type { Database } from '../../db/client.ts'
import { hrfDependencies, hrfTasks, projects } from '../../db/schema.ts'
import { notFound } from '../../lib/problem.ts'
import { computeCpm } from './cpm.ts'
import type { ParsedTask } from './import.ts'

export type TaskRow = typeof hrfTasks.$inferSelect
type Tx = Database

export async function getProject(db: Database, projectId: string) {
  const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
  if (!p) throw notFound('project_not_found')
  return p
}

export async function listTasks(db: Database, projectId: string) {
  return db
    .select()
    .from(hrfTasks)
    .where(and(eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
    .orderBy(asc(hrfTasks.sortOrder), asc(hrfTasks.code))
}

export async function listDependencies(db: Database, projectId: string): Promise<HrfDependencyDto[]> {
  const rows = await db
    .select({ taskId: hrfDependencies.taskId, predecessorId: hrfDependencies.predecessorId, type: hrfDependencies.type, lagDays: hrfDependencies.lagDays })
    .from(hrfDependencies)
    .innerJoin(hrfTasks, eq(hrfTasks.id, hrfDependencies.taskId))
    .where(and(eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
  return rows
}

export function toTaskDto(t: TaskRow, opts: { internal: boolean; canEdit: boolean }): HrfTaskDto {
  const dto: HrfTaskDto = {
    id: t.id,
    code: t.code,
    name: t.name,
    parentId: t.parentId,
    party: t.party,
    responsibleUserId: t.responsibleUserId,
    startOffsetDays: t.startOffsetDays,
    durationDays: t.durationDays,
    plannedStart: t.plannedStart,
    plannedEnd: t.plannedEnd,
    actualStart: t.actualStart,
    actualEnd: t.actualEnd,
    forecastEnd: t.forecastEnd,
    percentComplete: Number(t.percentComplete),
    status: t.status,
    isMilestone: t.isMilestone,
    isAcceptancePoint: t.isAcceptancePoint,
    postAcceptanceAllowed: t.postAcceptanceAllowed,
    isCriticalPath: t.isCriticalPath,
    totalFloatDays: t.totalFloatDays,
    notes: t.notes,
    sortOrder: t.sortOrder,
    version: t.version,
    canEdit: opts.canEdit,
  }
  // Field-level authorization: pole [W] usuwane z DTO (nie tylko ukrywane w UI).
  if (opts.internal) dto.contractValue = t.contractValue
  return dto
}

/** Przeliczenie dat planowanych wszystkich zadań od dnia „0” (jedno zapytanie). */
export async function recomputePlannedDates(tx: Tx, projectId: string, dayZero: string | null) {
  if (!dayZero) {
    await tx.update(hrfTasks).set({ plannedStart: null, plannedEnd: null }).where(eq(hrfTasks.projectId, projectId))
    return
  }
  await tx
    .update(hrfTasks)
    .set({
      plannedStart: sql`(${dayZero}::date + ${hrfTasks.startOffsetDays})`,
      plannedEnd: sql`(${dayZero}::date + ${hrfTasks.startOffsetDays} + ${hrfTasks.durationDays} - 1)`,
    })
    .where(eq(hrfTasks.projectId, projectId))
}

/**
 * Ścieżka krytyczna: CPM na zadaniach-liściach; Etap krytyczny, gdy krytyczne jest któreś jego zadanie.
 * Czynności dopuszczone po odbiorze (§ 3 ust. 8) są poza ścieżką — nie wpływają na termin umowny.
 * Bez żadnej zależności — brak ścieżki (wszystko `false`, zapas null).
 */
export async function recomputeCriticalPath(tx: Tx, projectId: string) {
  const tasks = await listTasks(tx, projectId)
  let deps = await listDependencies(tx, projectId)
  if (!tasks.length) return { computed: false }
  if (!deps.length) {
    await tx.update(hrfTasks).set({ isCriticalPath: false, totalFloatDays: null }).where(eq(hrfTasks.projectId, projectId))
    return { computed: false }
  }
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean))
  const leaves = tasks.filter((t) => !parents.has(t.id) && !t.postAcceptanceAllowed)
  await tx.update(hrfTasks).set({ isCriticalPath: false, totalFloatDays: null }).where(eq(hrfTasks.projectId, projectId))
  const leafIds = new Set(leaves.map((t) => t.id))
  deps = deps.filter((d) => leafIds.has(d.taskId) && leafIds.has(d.predecessorId))
  const result = computeCpm(
    leaves.map((t) => ({ id: t.id, startOffset: t.startOffsetDays, duration: t.durationDays })),
    deps,
  )
  const values = new Map<string, { critical: boolean; float: number }>()
  for (const [id, s] of result.schedule) values.set(id, { critical: s.critical, float: s.float })
  // Agregacja w górę hierarchii.
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const leaf of leaves) {
    const v = values.get(leaf.id)!
    let p = leaf.parentId ? byId.get(leaf.parentId) : undefined
    while (p) {
      const cur = values.get(p.id)
      values.set(p.id, { critical: (cur?.critical ?? false) || v.critical, float: Math.min(cur?.float ?? Infinity, v.float) })
      p = p.parentId ? byId.get(p.parentId) : undefined
    }
  }
  if (!values.size) return { computed: true }
  const rows = [...values].map(([id, v]) => sql`(${id}::uuid, ${v.critical}::boolean, ${v.float}::int)`)
  await tx.execute(sql`
    UPDATE hrf_tasks AS t SET is_critical_path = v.critical, total_float_days = v.float
    FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, critical, float)
    WHERE t.id = v.id`)
  return { computed: true }
}

/** Zadanie nie może mieć zależności, jeśli jest Etapem (ma podzadania) — CPM liczy się na liściach. */
export async function assertLeafTasks(db: Database, ids: string[]) {
  if (!ids.length) return []
  return db.select({ id: hrfTasks.id }).from(hrfTasks).where(and(inArray(hrfTasks.parentId, ids), isNull(hrfTasks.deletedAt)))
}

export interface ImportApplyResult {
  created: number
  updated: number
}

/** Zastosowanie importu w transakcji: insert nowych, update pól strukturalnych istniejących (bez actual_*, statusu, %). */
export async function applyImport(tx: Tx, projectId: string, parsed: ParsedTask[], userId: string, notesMapped: boolean): Promise<ImportApplyResult> {
  const existing = await listTasks(tx, projectId)
  const byCode = new Map(existing.map((t) => [t.code, t]))
  const idByCode = new Map(existing.map((t) => [t.code, t.id]))
  let created = 0
  let updated = 0

  for (const p of parsed) {
    const e = byCode.get(p.code)
    const parentId = p.parentCode ? idByCode.get(p.parentCode)! : null
    const structural = {
      name: p.name,
      parentId,
      startOffsetDays: p.startOffsetDays,
      durationDays: p.durationDays,
      isAcceptancePoint: p.isAcceptancePoint,
      isMilestone: p.isAcceptancePoint,
      postAcceptanceAllowed: p.postAcceptanceAllowed,
      sortOrder: p.sortOrder,
      ...(notesMapped ? { notes: p.notes } : {}),
    }
    if (!e) {
      const [row] = await tx
        .insert(hrfTasks)
        .values({ projectId, code: p.code, party: p.party, notes: p.notes, ...structural, createdBy: userId, updatedBy: userId })
        .returning({ id: hrfTasks.id })
      idByCode.set(p.code, row!.id)
      created++
    } else {
      const changed =
        e.name !== structural.name ||
        e.parentId !== structural.parentId ||
        e.startOffsetDays !== structural.startOffsetDays ||
        e.durationDays !== structural.durationDays ||
        e.isAcceptancePoint !== structural.isAcceptancePoint ||
        e.postAcceptanceAllowed !== structural.postAcceptanceAllowed ||
        (notesMapped && e.notes !== p.notes)
      await tx
        .update(hrfTasks)
        .set({ ...structural, ...(changed ? { version: sql`${hrfTasks.version} + 1`, updatedAt: sql`now()`, updatedBy: userId } : {}) })
        .where(eq(hrfTasks.id, e.id))
      if (changed) updated++
    }
  }
  return { created, updated }
}
