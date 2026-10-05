import { createHash } from 'node:crypto'
import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  HRF_STRUCTURE_FIELDS,
  baselineCreateInput,
  dayZeroInput,
  dependenciesInput,
  hrfTaskCreate,
  hrfTaskPatch,
  importMapping,
  importProfileInput,
  type BaselineDto,
  type DayZeroPreview,
  type HrfTasksResponse,
  type Action,
  type ImportMapping,
  type ModuleKey,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import { hrfBaselineTasks, hrfBaselines, hrfDependencies, hrfImportProfiles, hrfTasks, projects } from '../../db/schema.ts'
import { plannedDates, todayWarsaw } from '../../lib/dates.ts'
import { hrfToXlsx } from './export.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { DependencyCycleError, computeCpm } from './cpm.ts'
import { MAX_IMPORT_BYTES, buildPreview, distinctColumnValues, inspectWorkbook, loadWorkbook, parseTasks } from './import.ts'
import { canEditInternal, canEditProgress, canEditStructure, canSeeInternal } from './policy.ts'
import {
  applyImport,
  getProject,
  listDependencies,
  listTasks,
  recomputeCriticalPath,
  recomputePlannedDates,
  toTaskDto,
} from './service.ts'

export const hrfRouter = newRouter()
const BASE = '/projects/{projectId}/hrf'

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const projectParam = z.object({ projectId: z.uuid() })
const taskParam = projectParam.extend({ taskId: z.uuid() })
const baselineParam = projectParam.extend({ baselineId: z.uuid() })
const multipart = { content: { 'multipart/form-data': { schema: z.any() } }, required: true as const }

const route = <R extends RouteConfig>(r: R, permission: { module: ModuleKey; action: Action }) => secureRoute('', r, { permission })

// ---------- lista ----------
hrfRouter.openapi(
  route({ method: 'get', path: `${BASE}/tasks`, request: { params: projectParam }, responses: ok }, { module: 'hrf', action: 'view' }),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const db = c.get('deps').db
    const project = await getProject(db, projectId)
    const [tasks, dependencies] = await Promise.all([listTasks(db, projectId), listDependencies(db, projectId)])
    const perms = c.get('permissions')
    const internal = canSeeInternal(perms)
    const body: HrfTasksResponse = {
      dayZeroDate: project.dayZeroDate,
      contractEndDate: project.contractEndDate,
      tasks: tasks.map((t) => toTaskDto(t, { internal, canEdit: canEditProgress(c.get('user'), perms, t) })),
      dependencies,
      criticalPathComputed: dependencies.length > 0,
    }
    return c.json(body, 200)
  },
)

// ---------- edycja zadania ----------
hrfRouter.openapi(
  route(
    { method: 'patch', path: `${BASE}/tasks/{taskId}`, request: { params: taskParam, body: body(hrfTaskPatch) }, responses: ok },
    { module: 'hrf', action: 'edit' },
  ),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param')
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const perms = c.get('permissions')
    const user = c.get('user')
    const project = await getProject(deps.db, projectId)
    const [current] = await deps.db
      .select()
      .from(hrfTasks)
      .where(and(eq(hrfTasks.id, taskId), eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
    if (!current) throw notFound()
    if (!canEditProgress(user, perms, current)) throw forbidden('not_own_task')
    const structural = HRF_STRUCTURE_FIELDS.filter((f) => input[f] !== undefined)
    if (structural.length && !canEditStructure(perms)) throw forbidden('structure_edit_denied', structural.join(','))
    if (input.contractValue !== undefined && !canEditInternal(perms)) throw forbidden('internal_field_denied', 'contractValue')
    const internal = canSeeInternal(perms)
    if (current.version !== input.version) throw conflict(toTaskDto(current, { internal, canEdit: true }))

    const { version: _v, ...patch } = input
    const offset = patch.startOffsetDays ?? current.startOffsetDays
    const duration = patch.durationDays ?? current.durationDays
    const dates =
      patch.startOffsetDays !== undefined || patch.durationDays !== undefined ? plannedDates(project.dayZeroDate, offset, duration) : {}
    if (patch.actualStart && patch.actualEnd && patch.actualEnd < patch.actualStart) throw new HttpProblem(422, 'actual_end_before_start')

    const updated = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(hrfTasks)
        .set({ ...patch, ...dates, version: sql`${hrfTasks.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(hrfTasks.id, taskId), eq(hrfTasks.version, input.version)))
        .returning()
      if (!row) return null
      // [W] maskowane w audit logu dla czytelników bez uprawnień — wpis zawiera tylko fakt zmiany.
      await writeAudit(c, { action: 'hrf.task_update', entity: 'hrf_tasks', entityId: taskId, projectId, changes: diffFields(current, patch, ['contractValue']) }, tx)
      if (patch.startOffsetDays !== undefined || patch.durationDays !== undefined) await recomputeCriticalPath(tx, projectId)
      return row
    })
    if (!updated) {
      const [fresh] = await deps.db.select().from(hrfTasks).where(eq(hrfTasks.id, taskId))
      throw conflict(fresh ? toTaskDto(fresh, { internal, canEdit: true }) : null)
    }
    const [final] = await deps.db.select().from(hrfTasks).where(eq(hrfTasks.id, taskId))
    return c.json(toTaskDto(final!, { internal, canEdit: canEditProgress(user, perms, final!) }), 200)
  },
)

// ---------- nowe zadanie / usunięcie ----------
hrfRouter.openapi(
  route(
    { method: 'post', path: `${BASE}/tasks`, request: { params: projectParam, body: body(hrfTaskCreate) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } },
    { module: 'hrf', action: 'approve' },
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const project = await getProject(deps.db, projectId)
    const existing = await listTasks(deps.db, projectId)
    if (existing.some((t) => t.code === input.code)) throw new HttpProblem(409, 'hrf_code_exists')
    const parentCode = input.code.includes('.') ? input.code.slice(0, input.code.lastIndexOf('.')) : null
    const parent = parentCode ? existing.find((t) => t.code === parentCode) : null
    if (parentCode && !parent) throw new HttpProblem(422, 'hrf_parent_missing', parentCode)
    const row = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(hrfTasks)
        .values({
          ...input,
          projectId,
          parentId: parent?.id ?? null,
          sortOrder: existing.length,
          ...plannedDates(project.dayZeroDate, input.startOffsetDays, input.durationDays),
          createdBy: c.get('user').id,
          updatedBy: c.get('user').id,
        })
        .returning()
      await writeAudit(c, { action: 'hrf.task_create', entity: 'hrf_tasks', entityId: r!.id, projectId, changes: input }, tx)
      return r!
    })
    return c.json(toTaskDto(row, { internal: canSeeInternal(c.get('permissions')), canEdit: true }), 201)
  },
)

hrfRouter.openapi(
  route({ method: 'delete', path: `${BASE}/tasks/{taskId}`, request: { params: taskParam }, responses: ok }, { module: 'hrf', action: 'delete' }),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param')
    const deps = c.get('deps')
    const [children] = await deps.db.select({ n: count() }).from(hrfTasks).where(and(eq(hrfTasks.parentId, taskId), isNull(hrfTasks.deletedAt)))
    if ((children?.n ?? 0) > 0) throw new HttpProblem(422, 'hrf_has_children')
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(hrfTasks)
        .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
        .where(and(eq(hrfTasks.id, taskId), eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
        .returning({ id: hrfTasks.id, code: hrfTasks.code })
      if (!row) throw notFound()
      await tx.delete(hrfDependencies).where(sql`${hrfDependencies.taskId} = ${taskId} OR ${hrfDependencies.predecessorId} = ${taskId}`)
      await writeAudit(c, { action: 'hrf.task_delete', entity: 'hrf_tasks', entityId: taskId, projectId, changes: { code: row.code } }, tx)
      await recomputeCriticalPath(tx, projectId)
    })
    return c.json({ ok: true }, 200)
  },
)

// ---------- zależności ----------
hrfRouter.openapi(
  route(
    { method: 'put', path: `${BASE}/tasks/{taskId}/dependencies`, request: { params: taskParam, body: body(dependenciesInput) }, responses: ok },
    { module: 'hrf', action: 'approve' },
  ),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param')
    const { predecessors } = c.req.valid('json')
    const deps = c.get('deps')
    const tasks = await listTasks(deps.db, projectId)
    const byId = new Map(tasks.map((t) => [t.id, t]))
    if (!byId.has(taskId)) throw notFound()
    const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean))
    for (const id of [taskId, ...predecessors.map((p) => p.predecessorId)]) {
      if (!byId.has(id)) throw new HttpProblem(422, 'hrf_dependency_unknown_task', id)
      if (parents.has(id)) throw new HttpProblem(422, 'hrf_dependency_on_stage', byId.get(id)!.code)
    }
    if (predecessors.some((p) => p.predecessorId === taskId)) throw new HttpProblem(422, 'hrf_dependency_self')

    // Walidacja cykli przed zapisem.
    const existing = (await listDependencies(deps.db, projectId)).filter((d) => d.taskId !== taskId)
    const next = [...existing, ...predecessors.map((p) => ({ taskId, ...p }))]
    const leaves = tasks.filter((t) => !parents.has(t.id))
    try {
      computeCpm(leaves.map((t) => ({ id: t.id, startOffset: t.startOffsetDays, duration: t.durationDays })), next)
    } catch (e) {
      if (e instanceof DependencyCycleError) {
        throw new HttpProblem(422, 'hrf_dependency_cycle', undefined, { codes: e.taskIds.map((id) => byId.get(id)?.code) })
      }
      throw e
    }

    const before = (await listDependencies(deps.db, projectId)).filter((d) => d.taskId === taskId)
    await deps.db.transaction(async (tx) => {
      await tx.delete(hrfDependencies).where(eq(hrfDependencies.taskId, taskId))
      if (predecessors.length) {
        await tx.insert(hrfDependencies).values(predecessors.map((p) => ({ taskId, ...p, createdBy: c.get('user').id })))
      }
      await writeAudit(c, {
        action: 'hrf.dependencies_update',
        entity: 'hrf_tasks',
        entityId: taskId,
        projectId,
        changes: {
          old: before.map((d) => ({ predecessor: byId.get(d.predecessorId)?.code, type: d.type, lag: d.lagDays })),
          new: predecessors.map((d) => ({ predecessor: byId.get(d.predecessorId)?.code, type: d.type, lag: d.lagDays })),
        },
      }, tx)
      await recomputeCriticalPath(tx, projectId)
    })
    return c.json({ ok: true }, 200)
  },
)

// ---------- import XLSX ----------
async function readUpload(c: Context<AppEnv>) {
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw new HttpProblem(422, 'import_file_missing')
  if (file.size > MAX_IMPORT_BYTES) throw new HttpProblem(422, 'import_file_too_large')
  if (!/\.xlsx$/i.test(file.name)) throw new HttpProblem(422, 'import_file_type')
  const buf = await file.arrayBuffer()
  let wb
  try {
    wb = await loadWorkbook(buf)
  } catch {
    throw new HttpProblem(422, 'import_file_invalid')
  }
  let mapping: ImportMapping | undefined
  if (typeof form.mapping === 'string') {
    const parsed = importMapping.safeParse(JSON.parse(form.mapping))
    if (!parsed.success) throw new HttpProblem(422, 'validation_failed', undefined, { issues: parsed.error.issues })
    mapping = parsed.data
  }
  return { wb, mapping, fileName: file.name, sha256: createHash('sha256').update(new Uint8Array(buf)).digest('hex') }
}

async function previewFor(c: Context<AppEnv>, projectId: string, mapping: ImportMapping, wb: Awaited<ReturnType<typeof loadWorkbook>>) {
  const db = c.get('deps').db
  const project = await getProject(db, projectId)
  const existing = await listTasks(db, projectId)
  const codeById = new Map(existing.map((t) => [t.id, t.code]))
  const parsed = parseTasks(wb, mapping)
  const preview = buildPreview(
    parsed,
    existing.map((t) => ({ ...t, parentCode: t.parentId ? (codeById.get(t.parentId) ?? null) : null })),
    { dayZero: project.dayZeroDate, contractEnd: project.contractEndDate, notesMapped: !!mapping.columns.notes },
  )
  return { parsed, preview }
}

hrfRouter.openapi(
  route({ method: 'post', path: `${BASE}/import/inspect`, request: { params: projectParam, body: multipart }, responses: ok }, { module: 'hrf', action: 'approve' }),
  async (c) => {
    const { projectId } = c.req.valid('param')
    await getProject(c.get('deps').db, projectId)
    const { wb, mapping } = await readUpload(c)
    const result = inspectWorkbook(wb)
    // Wartości kolumny strony dla wskazanego mapowania (gdy kreator zmienił arkusz/kolumnę).
    if (mapping?.columns.party) {
      result.partyValuesFound[mapping.sheet] = distinctColumnValues(wb, mapping.sheet, mapping.headerRow, mapping.columns.party)
    }
    return c.json(result, 200)
  },
)

hrfRouter.openapi(
  route({ method: 'post', path: `${BASE}/import/preview`, request: { params: projectParam, body: multipart }, responses: ok }, { module: 'hrf', action: 'approve' }),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { wb, mapping } = await readUpload(c)
    if (!mapping) throw new HttpProblem(422, 'import_mapping_missing')
    const { preview } = await previewFor(c, projectId, mapping, wb)
    return c.json(preview, 200)
  },
)

hrfRouter.openapi(
  route({ method: 'post', path: `${BASE}/import/commit`, request: { params: projectParam, body: multipart }, responses: ok }, { module: 'hrf', action: 'approve' }),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { wb, mapping, fileName, sha256 } = await readUpload(c)
    if (!mapping) throw new HttpProblem(422, 'import_mapping_missing')
    const { parsed, preview } = await previewFor(c, projectId, mapping, wb)
    if (!preview.canCommit) throw new HttpProblem(422, 'import_has_errors', undefined, { issues: preview.issues.filter((i) => i.severity === 'error') })
    const deps = c.get('deps')
    const project = await getProject(deps.db, projectId)
    const result = await deps.db.transaction(async (tx) => {
      const r = await applyImport(tx, projectId, parsed.tasks, c.get('user').id, !!mapping.columns.notes)
      await recomputePlannedDates(tx, projectId, project.dayZeroDate)
      await recomputeCriticalPath(tx, projectId)
      await writeAudit(c, {
        action: 'hrf.import',
        entity: 'hrf_tasks',
        projectId,
        changes: { fileName, sha256, created: preview.diff.created, updated: preview.diff.updated, missingInFile: preview.diff.missingInFile },
      }, tx)
      return r
    })
    return c.json({ ...result, diff: preview.diff, warnings: preview.issues.filter((i) => i.severity === 'warning') }, 200)
  },
)

hrfRouter.openapi(
  route({ method: 'get', path: `${BASE}/import/profiles`, request: { params: projectParam }, responses: ok }, { module: 'hrf', action: 'approve' }),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const rows = await c.get('deps').db
      .select()
      .from(hrfImportProfiles)
      .where(and(eq(hrfImportProfiles.projectId, projectId), isNull(hrfImportProfiles.deletedAt)))
      .orderBy(asc(hrfImportProfiles.name))
    return c.json(rows.map((r) => ({ id: r.id, name: r.name, mapping: r.columnMapping })), 200)
  },
)

hrfRouter.openapi(
  route(
    { method: 'post', path: `${BASE}/import/profiles`, request: { params: projectParam, body: body(importProfileInput) }, responses: ok },
    { module: 'hrf', action: 'approve' },
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { name, mapping } = c.req.valid('json')
    const db = c.get('deps').db
    await getProject(db, projectId)
    const [existing] = await db
      .select()
      .from(hrfImportProfiles)
      .where(and(eq(hrfImportProfiles.projectId, projectId), eq(hrfImportProfiles.name, name), isNull(hrfImportProfiles.deletedAt)))
    const [row] = existing
      ? await db.update(hrfImportProfiles).set({ columnMapping: mapping, updatedAt: sql`now()`, updatedBy: c.get('user').id }).where(eq(hrfImportProfiles.id, existing.id)).returning()
      : await db.insert(hrfImportProfiles).values({ projectId, name, columnMapping: mapping, createdBy: c.get('user').id }).returning()
    await writeAudit(c, { action: 'hrf.import_profile_save', entity: 'hrf_import_profiles', entityId: row!.id, projectId, changes: { name } })
    return c.json({ id: row!.id, name: row!.name, mapping: row!.columnMapping }, 200)
  },
)

// ---------- dzień „0” ----------
async function dayZeroPreview(c: Context<AppEnv>, projectId: string, date: string): Promise<DayZeroPreview> {
  const db = c.get('deps').db
  const project = await getProject(db, projectId)
  const tasks = await listTasks(db, projectId)
  const changes = tasks.map((t) => {
    const n = plannedDates(date, t.startOffsetDays, t.durationDays)
    return { taskId: t.id, code: t.code, name: t.name, oldStart: t.plannedStart, oldEnd: t.plannedEnd, newStart: n.plannedStart!, newEnd: n.plannedEnd! }
  })
  const warnings = changes
    .filter((ch) => ch.newEnd > project.contractEndDate && !tasks.find((t) => t.id === ch.taskId)!.postAcceptanceAllowed)
    .map((ch) => ({ code: ch.code, message: `Koniec ${ch.newEnd} po terminie umownym ${project.contractEndDate}` }))
  return { from: project.dayZeroDate, to: date, changes: changes.filter((ch) => ch.oldStart !== ch.newStart || ch.oldEnd !== ch.newEnd), warnings }
}

hrfRouter.openapi(
  route(
    { method: 'get', path: `${BASE}/day-zero/preview`, request: { params: projectParam, query: z.object({ date: z.iso.date() }) }, responses: ok },
    { module: 'hrf', action: 'approve' },
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    return c.json(await dayZeroPreview(c, projectId, c.req.valid('query').date), 200)
  },
)

hrfRouter.openapi(
  route({ method: 'put', path: `${BASE}/day-zero`, request: { params: projectParam, body: body(dayZeroInput) }, responses: ok }, { module: 'hrf', action: 'approve' }),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { date, projectVersion } = c.req.valid('json')
    const deps = c.get('deps')
    const preview = await dayZeroPreview(c, projectId, date)
    // Przeliczenie w jednej transakcji: data projektu + wszystkie daty planowane + wpis audytu.
    await deps.db.transaction(async (tx) => {
      const [p] = await tx
        .update(projects)
        .set({ dayZeroDate: date, version: sql`${projects.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
        .where(and(eq(projects.id, projectId), eq(projects.version, projectVersion)))
        .returning()
      if (!p) throw new HttpProblem(409, 'version_conflict')
      await recomputePlannedDates(tx, projectId, date)
      await writeAudit(c, {
        action: 'hrf.recalculate',
        entity: 'projects',
        entityId: projectId,
        projectId,
        changes: { dayZero: { old: preview.from, new: date }, tasksChanged: preview.changes.length },
      }, tx)
    })
    return c.json({ ok: true, tasksChanged: preview.changes.length }, 200)
  },
)

hrfRouter.openapi(
  route({ method: 'get', path: '/projects/{projectId}', request: { params: projectParam }, responses: ok }, { module: 'hrf', action: 'view' }),
  async (c) => {
    const p = await getProject(c.get('deps').db, c.req.valid('param').projectId)
    return c.json({ id: p.id, name: p.name, dayZeroDate: p.dayZeroDate, contractEndDate: p.contractEndDate, version: p.version }, 200)
  },
)

// ---------- baseline ----------
hrfRouter.openapi(
  route({ method: 'get', path: `${BASE}/baselines`, request: { params: projectParam }, responses: ok }, { module: 'hrf', action: 'view' }),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const rows = await c.get('deps').db
      .select({ id: hrfBaselines.id, name: hrfBaselines.name, createdAt: hrfBaselines.createdAt, dayZeroDate: hrfBaselines.dayZeroDate, taskCount: count(hrfBaselineTasks.taskId) })
      .from(hrfBaselines)
      .leftJoin(hrfBaselineTasks, eq(hrfBaselineTasks.baselineId, hrfBaselines.id))
      .where(and(eq(hrfBaselines.projectId, projectId), isNull(hrfBaselines.deletedAt)))
      .groupBy(hrfBaselines.id)
      .orderBy(asc(hrfBaselines.createdAt))
    return c.json(rows satisfies BaselineDto[], 200)
  },
)

hrfRouter.openapi(
  route(
    { method: 'post', path: `${BASE}/baselines`, request: { params: projectParam, body: body(baselineCreateInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } },
    { module: 'hrf', action: 'approve' },
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { name } = c.req.valid('json')
    const deps = c.get('deps')
    const project = await getProject(deps.db, projectId)
    if (!project.dayZeroDate) throw new HttpProblem(422, 'day_zero_not_set')
    const tasks = await listTasks(deps.db, projectId)
    const row = await deps.db.transaction(async (tx) => {
      const [b] = await tx.insert(hrfBaselines).values({ projectId, name, dayZeroDate: project.dayZeroDate, createdBy: c.get('user').id }).returning()
      if (tasks.length) {
        await tx.insert(hrfBaselineTasks).values(tasks.map((t) => ({ baselineId: b!.id, taskId: t.id, start: t.plannedStart, end: t.plannedEnd })))
      }
      await writeAudit(c, { action: 'hrf.baseline_create', entity: 'hrf_baselines', entityId: b!.id, projectId, changes: { name, tasks: tasks.length } }, tx)
      return b!
    })
    return c.json({ id: row.id, name: row.name, createdAt: row.createdAt, dayZeroDate: row.dayZeroDate, taskCount: tasks.length }, 201)
  },
)

hrfRouter.openapi(
  route({ method: 'get', path: `${BASE}/baselines/{baselineId}`, request: { params: baselineParam }, responses: ok }, { module: 'hrf', action: 'view' }),
  async (c) => {
    const { projectId, baselineId } = c.req.valid('param')
    const db = c.get('deps').db
    const [b] = await db
      .select()
      .from(hrfBaselines)
      .where(and(eq(hrfBaselines.id, baselineId), eq(hrfBaselines.projectId, projectId), isNull(hrfBaselines.deletedAt)))
    if (!b) throw notFound()
    const tasks = await db.select({ taskId: hrfBaselineTasks.taskId, start: hrfBaselineTasks.start, end: hrfBaselineTasks.end }).from(hrfBaselineTasks).where(eq(hrfBaselineTasks.baselineId, baselineId))
    return c.json({ baseline: { id: b.id, name: b.name, createdAt: b.createdAt, dayZeroDate: b.dayZeroDate, taskCount: tasks.length }, tasks }, 200)
  },
)

hrfRouter.openapi(
  route({ method: 'delete', path: `${BASE}/baselines/{baselineId}`, request: { params: baselineParam }, responses: ok }, { module: 'hrf', action: 'delete' }),
  async (c) => {
    const { projectId, baselineId } = c.req.valid('param')
    const deps = c.get('deps')
    const [row] = await deps.db
      .update(hrfBaselines)
      .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
      .where(and(eq(hrfBaselines.id, baselineId), eq(hrfBaselines.projectId, projectId), isNull(hrfBaselines.deletedAt)))
      .returning()
    if (!row) throw notFound()
    await writeAudit(c, { action: 'hrf.baseline_delete', entity: 'hrf_baselines', entityId: baselineId, projectId, changes: { name: row.name } })
    return c.json({ ok: true }, 200)
  },
)


// ---------- eksport ----------
async function exportData(c: Context<AppEnv>, projectId: string) {
  const db = c.get('deps').db
  const project = await getProject(db, projectId)
  const perms = c.get('permissions')
  const internal = canSeeInternal(perms)
  const tasks = (await listTasks(db, projectId)).map((t) => toTaskDto(t, { internal, canEdit: false }))
  return { project, tasks }
}

hrfRouter.openapi(
  route(
    { method: 'get', path: `${BASE}/export.xlsx`, request: { params: projectParam }, responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } } },
    { module: 'hrf', action: 'export' },
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { project, tasks } = await exportData(c, projectId)
    const buf = await hrfToXlsx(tasks, { projectName: project.name, dayZero: project.dayZeroDate })
    await writeAudit(c, { action: 'hrf.export_xlsx', entity: 'hrf_tasks', projectId, changes: { rows: tasks.length, internalFields: 'contractValue' in (tasks[0] ?? {}) } })
    return c.body(buf, 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="HRF.xlsx"',
    })
  },
)

/**
 * PDF Gantta (A3 poziomo). Dla ~100–500 zadań render trwa < 5 s, więc w E1 działa synchronicznie;
 * tryb asynchroniczny (background function + zapis na Drive) dochodzi w E2 razem z infrastrukturą zadań.
 */
hrfRouter.openapi(
  route(
    { method: 'get', path: `${BASE}/export.pdf`, request: { params: projectParam }, responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.any() } } } } },
    { module: 'hrf', action: 'export' },
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { project, tasks } = await exportData(c, projectId)
    if (!project.dayZeroDate) throw new HttpProblem(422, 'day_zero_not_set')
    // Import leniwy: @react-pdf ładuje się tylko przy eksporcie PDF (szybszy zimny start, izolacja błędów).
    const { renderGanttPdf } = await import('../../pdf/gantt.tsx')
    const pdf = await renderGanttPdf({
      projectName: project.name,
      contractEnd: project.contractEndDate,
      dayZero: project.dayZeroDate,
      today: todayWarsaw(c.get('deps').now?.()),
      tasks,
      generatedBy: c.get('user').name,
    })
    await writeAudit(c, { action: 'hrf.export_pdf', entity: 'hrf_tasks', projectId, changes: { rows: tasks.length } })
    return c.body(new Uint8Array(pdf), 200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="HRF-Gantt.pdf"' })
  },
)
