import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import {
  WEEKLY_OPEN_STATUSES,
  addWeeks,
  isoWeekSchema,
  maskToDays,
  overlapsWeek,
  weekCloseInput,
  weekEnd,
  weekStart,
  weeklyItemInput,
  weeklyItemPatch,
  type Action,
  type ModuleKey,
  type PersonOption,
  type WeekMatrixResponse,
  type WeekViewResponse,
  type WeeklyItemDto,
} from '#shared'
import i18nPl from '../../../shared/i18n/pl.json' with { type: 'json' }
import type { AppEnv, UserRow } from '../../context.ts'
import { hrfTasks, users, weeklyItems } from '../../db/schema.ts'
import { canCreateForParty, canEditRecord } from '../../lib/ownership.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { getProject, listTasks } from '../hrf/service.ts'

export const weeklyRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const P = '/projects/{projectId}'
const projectParam = z.object({ projectId: z.uuid() })
const weekParam = projectParam.extend({ isoWeek: isoWeekSchema })
const itemParam = projectParam.extend({ itemId: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

type ItemRow = typeof weeklyItems.$inferSelect

/** Podwykonawca widzi wyłącznie pozycje przypisane do swojej firmy. */
function visibilityFilter(user: UserRow) {
  if (user.role !== 'Subcontractor') return undefined
  return eq(weeklyItems.assigneeSubcontractorId, user.subcontractorId ?? '00000000-0000-0000-0000-000000000000')
}

async function loadItems(c: Context<AppEnv>, projectId: string, weeks: string[]) {
  const db = c.get('deps').db
  const rows = await db
    .select({ item: weeklyItems, assigneeName: users.name, hrfCode: hrfTasks.code })
    .from(weeklyItems)
    .leftJoin(users, eq(users.id, weeklyItems.assigneeUserId))
    .leftJoin(hrfTasks, eq(hrfTasks.id, weeklyItems.hrfTaskId))
    .where(and(eq(weeklyItems.projectId, projectId), inArray(weeklyItems.isoWeek, weeks), isNull(weeklyItems.deletedAt), visibilityFilter(c.get('user'))))
    .orderBy(asc(weeklyItems.createdAt))
  const carriedIds = rows.map((r) => r.item.carryOverFromId).filter(Boolean) as string[]
  const origins = carriedIds.length
    ? await db.select({ id: weeklyItems.id, isoWeek: weeklyItems.isoWeek }).from(weeklyItems).where(inArray(weeklyItems.id, carriedIds))
    : []
  const originWeek = new Map(origins.map((o) => [o.id, o.isoWeek]))
  return rows.map((r) => toDto(c, r.item, r.assigneeName, r.hrfCode, r.item.carryOverFromId ? (originWeek.get(r.item.carryOverFromId) ?? null) : null))
}

function toDto(c: Context<AppEnv>, i: ItemRow, assigneeName: string | null, hrfCode: string | null, carriedFrom: string | null): WeeklyItemDto {
  return {
    id: i.id,
    isoWeek: i.isoWeek,
    hrfTaskId: i.hrfTaskId,
    hrfTaskCode: hrfCode,
    title: i.title,
    description: i.description,
    party: i.party,
    assigneeUserId: i.assigneeUserId,
    assigneeName,
    assigneeSubcontractorId: i.assigneeSubcontractorId,
    plannedDays: i.plannedDays,
    status: i.status,
    carryOverFromId: i.carryOverFromId,
    carriedOverFromWeek: carriedFrom,
    version: i.version,
    canEdit: canEditRecord(c.get('user'), c.get('permissions'), 'weeklyPlan', i),
  }
}

// ---------- widok tygodnia ----------
weeklyRouter.openapi(route({ method: 'get', path: `${P}/weekly/{isoWeek}`, request: { params: weekParam }, responses: ok }, 'weeklyPlan', 'view'), async (c) => {
  const { projectId, isoWeek } = c.req.valid('param')
  const db = c.get('deps').db
  await getProject(db, projectId)
  const items = await loadItems(c, projectId, [isoWeek])
  let hrf: WeekViewResponse['hrfTasks'] = null
  if (c.get('permissions').has('hrf:view')) {
    const tasks = await listTasks(db, projectId)
    const parents = new Set(tasks.map((t) => t.parentId))
    hrf = tasks
      .filter((t) => !parents.has(t.id))
      .filter((t) => overlapsWeek(isoWeek, t.plannedStart, t.plannedEnd) || overlapsWeek(isoWeek, t.actualStart, t.actualEnd ?? t.actualStart))
      .map((t) => ({ id: t.id, code: t.code, name: t.name, party: t.party, plannedStart: t.plannedStart, plannedEnd: t.plannedEnd, percentComplete: Number(t.percentComplete), status: t.status }))
  }
  const body: WeekViewResponse = {
    isoWeek,
    start: weekStart(isoWeek),
    end: weekEnd(isoWeek),
    items,
    hrfTasks: hrf,
    stats: {
      total: items.length,
      done: items.filter((i) => i.status === 'done').length,
      moved: items.filter((i) => i.status === 'moved').length,
      carriedIn: items.filter((i) => i.carryOverFromId).length,
    },
  }
  return c.json(body, 200)
})

// ---------- macierz wielotygodniowa ----------
weeklyRouter.openapi(
  route(
    {
      method: 'get',
      path: `${P}/weekly-matrix`,
      request: { params: projectParam, query: z.object({ from: isoWeekSchema, weeks: z.coerce.number().int().min(1).max(26).default(8) }) },
      responses: ok,
    },
    'weeklyPlan',
    'view',
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { from, weeks: n } = c.req.valid('query')
    const db = c.get('deps').db
    await getProject(db, projectId)
    const weeks = Array.from({ length: n }, (_, i) => addWeeks(from, i))
    const items = await loadItems(c, projectId, weeks)
    const rows: WeekMatrixResponse['rows'] = []
    const cell = (filter: (i: WeeklyItemDto) => boolean, w: string, hrfActive = false) => {
      const its = items.filter((i) => i.isoWeek === w && filter(i))
      return { hrfActive, items: its.length, done: its.filter((i) => i.status === 'done').length }
    }
    if (c.get('permissions').has('hrf:view')) {
      const tasks = await listTasks(db, projectId)
      const parents = new Set(tasks.map((t) => t.parentId))
      for (const t of tasks.filter((x) => !parents.has(x.id))) {
        const active = weeks.map((w) => overlapsWeek(w, t.plannedStart, t.plannedEnd))
        const hasItems = items.some((i) => i.hrfTaskId === t.id)
        if (!active.some(Boolean) && !hasItems) continue
        rows.push({ key: t.id, kind: 'hrf', label: `${t.code} ${t.name}`, party: t.party, cells: weeks.map((w, k) => cell((i) => i.hrfTaskId === t.id, w, active[k])) })
      }
    }
    for (const party of [...new Set(items.filter((i) => !i.hrfTaskId || !rows.some((r) => r.key === i.hrfTaskId)).map((i) => i.party))].sort()) {
      rows.push({
        key: `party:${party}`,
        kind: 'party',
        label: (i18nPl.parties as Record<string, string>)[party] ?? party,
        party,
        cells: weeks.map((w) => cell((i) => i.party === party && (!i.hrfTaskId || !rows.some((r) => r.key === i.hrfTaskId)), w)),
      })
    }
    const body: WeekMatrixResponse = { weeks: weeks.map((w) => ({ isoWeek: w, start: weekStart(w), end: weekEnd(w) })), rows }
    return c.json(body, 200)
  },
)

// ---------- CRUD ----------
async function assertTaskInProject(c: Context<AppEnv>, projectId: string, taskId: string | null | undefined) {
  if (!taskId) return
  const [t] = await c.get('deps').db.select({ id: hrfTasks.id }).from(hrfTasks).where(and(eq(hrfTasks.id, taskId), eq(hrfTasks.projectId, projectId), isNull(hrfTasks.deletedAt)))
  if (!t) throw new HttpProblem(422, 'hrf_task_not_found')
}

weeklyRouter.openapi(
  route({ method: 'post', path: `${P}/weekly-items`, request: { params: projectParam, body: body(weeklyItemInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, 'weeklyPlan', 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const user = c.get('user')
    const deps = c.get('deps')
    await getProject(deps.db, projectId)
    if (!canCreateForParty(user, c.get('permissions'), 'weeklyPlan', input.party)) throw forbidden('party_not_allowed', input.party)
    await assertTaskInProject(c, projectId, input.hrfTaskId)
    const row = await deps.db.transaction(async (tx) => {
      const [r] = await tx.insert(weeklyItems).values({ ...input, projectId, createdBy: user.id, updatedBy: user.id }).returning()
      await writeAudit(c, { action: 'weekly.create', entity: 'weekly_items', entityId: r!.id, projectId, changes: input }, tx)
      return r!
    })
    return c.json(toDto(c, row, null, null, null), 201)
  },
)

weeklyRouter.openapi(
  route({ method: 'patch', path: `${P}/weekly-items/{itemId}`, request: { params: itemParam, body: body(weeklyItemPatch) }, responses: ok }, 'weeklyPlan', 'edit'),
  async (c) => {
    const { projectId, itemId } = c.req.valid('param')
    const { version, ...patch } = c.req.valid('json')
    const user = c.get('user')
    const perms = c.get('permissions')
    const deps = c.get('deps')
    const [current] = await deps.db.select().from(weeklyItems).where(and(eq(weeklyItems.id, itemId), eq(weeklyItems.projectId, projectId), isNull(weeklyItems.deletedAt), visibilityFilter(user)))
    if (!current) throw notFound()
    if (!canEditRecord(user, perms, 'weeklyPlan', current)) throw forbidden('not_own_record')
    if (patch.party && patch.party !== current.party && !canCreateForParty(user, perms, 'weeklyPlan', patch.party)) throw forbidden('party_not_allowed', patch.party)
    if (current.version !== version) throw conflict(toDto(c, current, null, null, null))
    await assertTaskInProject(c, projectId, patch.hrfTaskId)
    const row = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(weeklyItems)
        .set({ ...patch, version: sql`${weeklyItems.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(and(eq(weeklyItems.id, itemId), eq(weeklyItems.version, version)))
        .returning()
      if (r) await writeAudit(c, { action: 'weekly.update', entity: 'weekly_items', entityId: itemId, projectId, changes: diffFields(current, patch) }, tx)
      return r
    })
    if (!row) throw conflict(null)
    return c.json(toDto(c, row, null, null, null), 200)
  },
)

weeklyRouter.openapi(
  route({ method: 'delete', path: `${P}/weekly-items/{itemId}`, request: { params: itemParam }, responses: ok }, 'weeklyPlan', 'delete'),
  async (c) => {
    const { projectId, itemId } = c.req.valid('param')
    const deps = c.get('deps')
    await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(weeklyItems)
        .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
        .where(and(eq(weeklyItems.id, itemId), eq(weeklyItems.projectId, projectId), isNull(weeklyItems.deletedAt)))
        .returning({ id: weeklyItems.id, title: weeklyItems.title })
      if (!r) throw notFound()
      await writeAudit(c, { action: 'weekly.delete', entity: 'weekly_items', entityId: itemId, projectId, changes: { title: r.title } }, tx)
    })
    return c.json({ ok: true }, 200)
  },
)

// ---------- zamknięcie tygodnia ----------
weeklyRouter.openapi(
  route({ method: 'post', path: `${P}/weekly/{isoWeek}/close`, request: { params: weekParam, body: body(weekCloseInput) }, responses: ok }, 'weeklyPlan', 'edit'),
  async (c) => {
    const { projectId, isoWeek } = c.req.valid('param')
    const { carryItemIds } = c.req.valid('json')
    const user = c.get('user')
    const perms = c.get('permissions')
    const deps = c.get('deps')
    const next = addWeeks(isoWeek, 1)
    const open = (
      await deps.db
        .select()
        .from(weeklyItems)
        .where(and(eq(weeklyItems.projectId, projectId), eq(weeklyItems.isoWeek, isoWeek), isNull(weeklyItems.deletedAt), inArray(weeklyItems.status, [...WEEKLY_OPEN_STATUSES])))
    ).filter((i) => canEditRecord(user, perms, 'weeklyPlan', i))
    const toCarry = open.filter((i) => carryItemIds.includes(i.id))
    if (toCarry.length !== carryItemIds.length) throw new HttpProblem(422, 'weekly_items_not_open_or_not_own')
    await deps.db.transaction(async (tx) => {
      for (const i of toCarry) {
        await tx.update(weeklyItems).set({ status: 'moved', version: sql`${weeklyItems.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id }).where(eq(weeklyItems.id, i.id))
        const { id: _id, createdAt: _c, updatedAt: _u, version: _v, ...rest } = i
        await tx.insert(weeklyItems).values({ ...rest, isoWeek: next, status: 'plan', carryOverFromId: i.id, createdBy: user.id, updatedBy: user.id })
      }
      await writeAudit(c, { action: 'weekly.close', entity: 'weekly_items', projectId, changes: { isoWeek, carried: toCarry.map((i) => i.title), nextWeek: next } }, tx)
    })
    return c.json({ carried: toCarry.length, nextWeek: next }, 200)
  },
)

// ---------- osoby do przypisania ----------
weeklyRouter.openapi(
  route({ method: 'get', path: `${P}/people`, request: { params: projectParam }, responses: ok }, 'weeklyPlan', 'create'),
  async (c) => {
    const rows = await c.get('deps').db
      .select({ id: users.id, name: users.name, party: users.party })
      .from(users)
      .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.name))
    return c.json(rows satisfies PersonOption[], 200)
  },
)

// ---------- eksport ----------
weeklyRouter.openapi(
  route(
    {
      method: 'get',
      path: `${P}/weekly/{isoWeek}/export.xlsx`,
      request: { params: weekParam, query: z.object({ weeks: z.coerce.number().int().min(1).max(26).default(1) }) },
      responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } },
    },
    'weeklyPlan',
    'export',
  ),
  async (c) => {
    const { projectId, isoWeek } = c.req.valid('param')
    const { weeks: n } = c.req.valid('query')
    await getProject(c.get('deps').db, projectId)
    const weeks = Array.from({ length: n }, (_, i) => addWeeks(isoWeek, i))
    const items = await loadItems(c, projectId, weeks)
    const t = i18nPl as unknown as { weekly: { status: Record<string, string>; days: string[] }; parties: Record<string, string> }
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Plan tygodniowy', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [
      { header: 'Tydzień', key: 'w', width: 10 },
      { header: 'HRF', key: 'hrf', width: 8 },
      { header: 'Pozycja', key: 'title', width: 50 },
      { header: 'Strona', key: 'party', width: 18 },
      { header: 'Wykonawca', key: 'who', width: 24 },
      { header: 'Dni', key: 'days', width: 20 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Przeniesione z', key: 'from', width: 14 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }
    for (const i of items) {
      ws.addRow({
        w: i.isoWeek,
        hrf: i.hrfTaskCode ?? '',
        title: i.title,
        party: t.parties[i.party] ?? i.party,
        who: i.assigneeName ?? '',
        days: maskToDays(i.plannedDays).map((d) => t.weekly.days[d]).join(', '),
        status: t.weekly.status[i.status],
        from: i.carriedOverFromWeek ?? '',
      })
    }
    await writeAudit(c, { action: 'weekly.export_xlsx', entity: 'weekly_items', projectId, changes: { weeks, rows: items.length } })
    return c.body((await wb.xlsx.writeBuffer()) as ArrayBuffer, 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="plan-${isoWeek}.xlsx"`,
    })
  },
)

