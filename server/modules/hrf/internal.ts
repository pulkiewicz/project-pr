import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  hrfInternalTaskCreate,
  hrfInternalTaskPatch,
  type Action,
  type HrfInternalAssigneeOption,
  type HrfInternalTaskDto,
  type ModuleKey,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { hrfInternalTaskAssignees, hrfInternalTasks, hrfTasks, permissions, users } from '../../db/schema.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { HttpProblem, conflict, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { getProject } from './service.ts'

/** Zadania wewnętrzne: doprecyzowanie zadań formalnych HRF, widoczne tylko z uprawnieniem `hrfInternal:view`. */
export const hrfInternalRouter = newRouter()
const BASE = '/projects/{projectId}/hrf/internal-tasks'

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const projectParam = z.object({ projectId: z.uuid() })
const itemParam = projectParam.extend({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'hrfInternal' as ModuleKey, action } })

type Row = typeof hrfInternalTasks.$inferSelect

/** Aktywni użytkownicy, których rola widzi zadania wewnętrzne. */
async function assigneeOptions(db: Database): Promise<HrfInternalAssigneeOption[]> {
  const roles = db
    .select({ role: permissions.role })
    .from(permissions)
    .where(and(eq(permissions.module, 'hrfInternal'), eq(permissions.action, 'view'), eq(permissions.allowed, true)))
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.isActive, true), inArray(users.role, roles)))
    .orderBy(asc(users.name))
}

async function assertAssignable(db: Database, ids: string[]) {
  if (!ids.length) return
  const allowed = new Set((await assigneeOptions(db)).map((u) => u.id))
  const bad = ids.filter((id) => !allowed.has(id))
  if (bad.length) throw new HttpProblem(422, 'assignee_not_allowed', bad.join(','))
}

async function assertParent(db: Database, projectId: string, parentTaskId: string) {
  const [parent] = await db
    .select({ id: hrfTasks.id })
    .from(hrfTasks)
    .where(and(eq(hrfTasks.id, parentTaskId), eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
  if (!parent) throw new HttpProblem(422, 'hrf_parent_not_found')
}

async function toDtos(db: Database, rows: Row[], today: string): Promise<HrfInternalTaskDto[]> {
  if (!rows.length) return []
  const links = await db
    .select({ taskId: hrfInternalTaskAssignees.taskId, id: users.id, name: users.name })
    .from(hrfInternalTaskAssignees)
    .innerJoin(users, eq(users.id, hrfInternalTaskAssignees.userId))
    .where(inArray(hrfInternalTaskAssignees.taskId, rows.map((r) => r.id)))
    .orderBy(asc(users.name))
  return rows.map((r) => ({
    id: r.id,
    parentTaskId: r.parentTaskId,
    name: r.name,
    assignees: links.filter((l) => l.taskId === r.id).map(({ id, name }) => ({ id, name })),
    startDate: r.startDate,
    endDate: r.endDate,
    percentComplete: r.percentComplete,
    notes: r.notes,
    link: r.link,
    overdue: !!r.endDate && r.endDate < today && r.percentComplete < 100,
    version: r.version,
  }))
}

/** Zadania wewnętrzne projektu z pominięciem tych, których zadanie formalne usunięto. */
export async function listInternalTasks(db: Database, projectId: string, today: string, assigneeId?: string) {
  const rows = await db
    .select({ task: hrfInternalTasks })
    .from(hrfInternalTasks)
    .innerJoin(hrfTasks, and(eq(hrfTasks.id, hrfInternalTasks.parentTaskId), isNull(hrfTasks.deletedAt)))
    .where(
      and(
        eq(hrfInternalTasks.projectId, projectId),
        isNull(hrfInternalTasks.deletedAt),
        assigneeId
          ? inArray(
              hrfInternalTasks.id,
              db.select({ id: hrfInternalTaskAssignees.taskId }).from(hrfInternalTaskAssignees).where(eq(hrfInternalTaskAssignees.userId, assigneeId)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(hrfTasks.sortOrder), asc(hrfInternalTasks.startDate), asc(hrfInternalTasks.createdAt))
  return toDtos(db, rows.map((r) => r.task), today)
}

async function loadOne(c: Context<AppEnv>, projectId: string, id: string) {
  const [row] = await c
    .get('deps')
    .db.select()
    .from(hrfInternalTasks)
    .where(and(eq(hrfInternalTasks.id, id), eq(hrfInternalTasks.projectId, projectId), isNull(hrfInternalTasks.deletedAt)))
  if (!row) throw notFound()
  return row
}

const today = (c: Context<AppEnv>) => todayWarsaw(c.get('deps').now?.())

hrfInternalRouter.openapi(route({ method: 'get', path: BASE, request: { params: projectParam }, responses: ok }, 'view'), async (c) => {
  const { projectId } = c.req.valid('param')
  const db = c.get('deps').db
  await getProject(db, projectId)
  return c.json(await listInternalTasks(db, projectId, today(c)), 200)
})

hrfInternalRouter.openapi(route({ method: 'get', path: `${BASE}/assignees`, request: { params: projectParam }, responses: ok }, 'view'), async (c) => {
  return c.json(await assigneeOptions(c.get('deps').db), 200)
})

hrfInternalRouter.openapi(
  route({ method: 'post', path: BASE, request: { params: projectParam, body: body(hrfInternalTaskCreate) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const user = c.get('user')
    await getProject(db, projectId)
    await assertParent(db, projectId, input.parentTaskId)
    const assigneeIds = [...new Set(input.assigneeIds)]
    await assertAssignable(db, assigneeIds)
    const { assigneeIds: _a, ...fields } = input
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(hrfInternalTasks)
        .values({ ...fields, projectId, createdBy: user.id, updatedBy: user.id })
        .returning()
      if (assigneeIds.length) await tx.insert(hrfInternalTaskAssignees).values(assigneeIds.map((userId) => ({ taskId: created!.id, userId })))
      await writeAudit(c, { action: 'hrf.internal_create', entity: 'hrf_internal_tasks', entityId: created!.id, projectId, changes: { ...fields, assigneeIds } }, tx)
      return created!
    })
    const [dto] = await toDtos(db, [row], today(c))
    return c.json(dto, 201)
  },
)

hrfInternalRouter.openapi(
  route({ method: 'patch', path: `${BASE}/{id}`, request: { params: itemParam, body: body(hrfInternalTaskPatch) }, responses: ok }, 'edit'),
  async (c) => {
    const { projectId, id } = c.req.valid('param')
    const input = c.req.valid('json')
    const db = c.get('deps').db
    const user = c.get('user')
    const current = await loadOne(c, projectId, id)
    if (current.version !== input.version) throw conflict((await toDtos(db, [current], today(c)))[0])
    const { version: _v, assigneeIds, ...patch } = input
    const start = patch.startDate !== undefined ? patch.startDate : current.startDate
    const end = patch.endDate !== undefined ? patch.endDate : current.endDate
    if (start && end && end < start) throw new HttpProblem(422, 'validation.dateRange')
    if (patch.parentTaskId) await assertParent(db, projectId, patch.parentTaskId)
    const nextAssignees = assigneeIds ? [...new Set(assigneeIds)] : undefined
    if (nextAssignees) await assertAssignable(db, nextAssignees)

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(hrfInternalTasks)
        .set({ ...patch, version: sql`${hrfInternalTasks.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(hrfInternalTasks.id, id), eq(hrfInternalTasks.version, input.version)))
        .returning()
      if (!row) return null
      const changes: Record<string, unknown> = diffFields(current, patch)
      if (nextAssignees) {
        const before = (await tx.select({ userId: hrfInternalTaskAssignees.userId }).from(hrfInternalTaskAssignees).where(eq(hrfInternalTaskAssignees.taskId, id))).map((r) => r.userId).sort()
        if (JSON.stringify(before) !== JSON.stringify([...nextAssignees].sort())) {
          await tx.delete(hrfInternalTaskAssignees).where(eq(hrfInternalTaskAssignees.taskId, id))
          if (nextAssignees.length) await tx.insert(hrfInternalTaskAssignees).values(nextAssignees.map((userId) => ({ taskId: id, userId })))
          changes.assigneeIds = { old: before, new: nextAssignees }
        }
      }
      await writeAudit(c, { action: 'hrf.internal_update', entity: 'hrf_internal_tasks', entityId: id, projectId, changes }, tx)
      return row
    })
    if (!updated) throw conflict((await toDtos(db, [await loadOne(c, projectId, id)], today(c)))[0])
    const [dto] = await toDtos(db, [updated], today(c))
    return c.json(dto, 200)
  },
)

hrfInternalRouter.openapi(route({ method: 'delete', path: `${BASE}/{id}`, request: { params: itemParam }, responses: ok }, 'delete'), async (c) => {
  const { projectId, id } = c.req.valid('param')
  const db = c.get('deps').db
  const current = await loadOne(c, projectId, id)
  await db.transaction(async (tx) => {
    await tx.update(hrfInternalTasks).set({ deletedAt: sql`now()`, deletedBy: c.get('user').id }).where(eq(hrfInternalTasks.id, id))
    await writeAudit(c, { action: 'hrf.internal_delete', entity: 'hrf_internal_tasks', entityId: id, projectId, changes: { name: current.name, parentTaskId: current.parentTaskId } }, tx)
  })
  return c.json({ ok: true }, 200)
})
