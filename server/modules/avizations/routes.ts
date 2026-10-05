import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import {
  AVIZATION_STATUSES,
  avizationInput,
  avizationPatch,
  avizationSettingsInput,
  avizationTransition,
  type Action,
  type AvizationDto,
  type EntryPointDto,
  type ModuleKey,
  type OnSiteResponse,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import { avizationPersons, avizationVehicles, avizations, entryPoints, hrfTasks, persons, projects, vehicles, weeklyItems } from '../../db/schema.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { defaultPartyFor } from '../../lib/ownership.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { getProject } from '../hrf/service.ts'
import { buildExportRows } from './format.ts'
import { inBackground } from '../../lib/background.ts'
import { archiveToDrive } from '../documents/service.ts'
import { AUTO_FOLDERS } from '../documents/structure.ts'
import { ownOnly } from './people.ts'
import { avizationSettings, exportData, findOverlaps, loadAvizations } from './service.ts'

export const avizationsRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const file = { 200: { description: 'Plik', content: { 'application/octet-stream': { schema: z.any() } } } }
const BASE = '/projects/{projectId}/avizations'
const projectParam = z.object({ projectId: z.uuid() })
const idParam = projectParam.extend({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })
const fmt = (d: string) => d.split('-').reverse().join('.')

async function settingsFor(c: Context<AppEnv>, projectId: string) {
  return avizationSettings(await getProject(c.get('deps').db, projectId))
}

async function getOne(c: Context<AppEnv>, projectId: string, id: string): Promise<AvizationDto> {
  const [a] = await loadAvizations(c, projectId, eq(avizations.id, id), await settingsFor(c, projectId))
  if (!a) throw notFound()
  return a
}

/** Osoby i pojazdy muszą należeć do projektu i być widoczne dla zgłaszającego. */
async function assertRefs(c: Context<AppEnv>, projectId: string, personIds: string[], vehicleIds: string[], driverIds: string[]) {
  const db = c.get('deps').db
  const user = c.get('user')
  const allP = [...new Set([...personIds, ...driverIds])]
  if (allP.length) {
    const found = await db.select({ id: persons.id }).from(persons).where(and(inArray(persons.id, allP), eq(persons.projectId, projectId), isNull(persons.deletedAt), ownOnly(user) ? eq(persons.party, user.party) : undefined))
    if (found.length !== allP.length) throw new HttpProblem(422, 'avization_unknown_person')
  }
  if (vehicleIds.length) {
    const found = await db.select({ id: vehicles.id }).from(vehicles).where(and(inArray(vehicles.id, vehicleIds), eq(vehicles.projectId, projectId), isNull(vehicles.deletedAt), ownOnly(user) ? eq(vehicles.party, user.party) : undefined))
    if (found.length !== new Set(vehicleIds).size) throw new HttpProblem(422, 'avization_unknown_vehicle')
  }
  for (const d of driverIds) if (!personIds.includes(d)) throw new HttpProblem(422, 'avization_driver_not_listed')
}

async function assertNoOverlap(c: Context<AppEnv>, projectId: string, personIds: string[], from: string, to: string, excludeId?: string) {
  const overlaps = await findOverlaps(c.get('deps').db, projectId, personIds, from, to, excludeId)
  if (overlaps.length) {
    throw new HttpProblem(409, 'avization_person_overlap', undefined, { overlaps: overlaps.map((o) => `${o.firstName} ${o.lastName} (${o.number})`) })
  }
}

// ---------- lista / szczegóły ----------
avizationsRouter.openapi(
  route(
    {
      method: 'get',
      path: BASE,
      request: { params: projectParam, query: z.object({ status: z.enum(AVIZATION_STATUSES).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }) },
      responses: ok,
    },
    'avizations',
    'view',
  ),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const q = c.req.valid('query')
    const where = and(q.status ? eq(avizations.status, q.status) : undefined, q.from ? gte(avizations.dateTo, q.from) : undefined, q.to ? lte(avizations.dateFrom, q.to) : undefined)
    return c.json(await loadAvizations(c, projectId, where, await settingsFor(c, projectId)), 200)
  },
)


// ---------- tworzenie / edycja szkicu ----------
avizationsRouter.openapi(
  route({ method: 'post', path: BASE, request: { params: projectParam, body: body(avizationInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, 'avizations', 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const input = c.req.valid('json')
    const user = c.get('user')
    const deps = c.get('deps')
    await getProject(deps.db, projectId)
    await assertRefs(c, projectId, input.personIds, input.vehicles.map((v) => v.vehicleId), input.vehicles.map((v) => v.driverPersonId).filter(Boolean) as string[])
    await assertNoOverlap(c, projectId, input.personIds, input.dateFrom, input.dateTo)
    if (input.hrfTaskId) {
      const [t] = await deps.db.select({ id: hrfTasks.id }).from(hrfTasks).where(and(eq(hrfTasks.id, input.hrfTaskId), eq(hrfTasks.projectId, projectId)))
      if (!t) throw new HttpProblem(422, 'hrf_task_not_found')
    }
    if (input.weeklyItemId) {
      const [w] = await deps.db.select({ id: weeklyItems.id }).from(weeklyItems).where(and(eq(weeklyItems.id, input.weeklyItemId), eq(weeklyItems.projectId, projectId)))
      if (!w) throw new HttpProblem(422, 'weekly_item_not_found')
    }
    const year = todayWarsaw(deps.now?.()).slice(0, 4)
    const id = await deps.db.transaction(async (tx) => {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(avizations).where(and(eq(avizations.projectId, projectId), sql`${avizations.number} like ${`AW/${year}/%`}`))) as [{ n: number }]
      const number = `AW/${year}/${String(n + 1).padStart(3, '0')}`
      const [a] = await tx
        .insert(avizations)
        .values({
          projectId,
          number,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          entryPointId: input.entryPointId ?? null,
          purpose: input.purpose,
          hrfTaskId: input.hrfTaskId ?? null,
          weeklyItemId: input.weeklyItemId ?? null,
          party: defaultPartyFor(user),
          requestedBy: user.id,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: avizations.id })
      if (input.personIds.length) await tx.insert(avizationPersons).values(input.personIds.map((personId) => ({ avizationId: a!.id, personId })))
      if (input.vehicles.length) await tx.insert(avizationVehicles).values(input.vehicles.map((v) => ({ avizationId: a!.id, vehicleId: v.vehicleId, driverPersonId: v.driverPersonId ?? null })))
      await writeAudit(c, { action: 'avizations.create', entity: 'avizations', entityId: a!.id, projectId, changes: { number, dateFrom: input.dateFrom, dateTo: input.dateTo, persons: input.personIds.length, vehicles: input.vehicles.length } }, tx)
      return a!.id
    })
    return c.json(await getOne(c, projectId, id), 201)
  },
)

avizationsRouter.openapi(
  route({ method: 'patch', path: `${BASE}/{id}`, request: { params: idParam, body: body(avizationPatch) }, responses: ok }, 'avizations', 'edit'),
  async (c) => {
    const { projectId, id } = c.req.valid('param')
    const { version, personIds, vehicles: vs, ...patch } = c.req.valid('json')
    const deps = c.get('deps')
    const current = await getOne(c, projectId, id)
    if (!current.canEdit) throw forbidden('not_own_record')
    if (current.status !== 'draft') throw new HttpProblem(422, 'avization_not_draft')
    if (current.version !== version) throw conflict(current)
    const from = patch.dateFrom ?? current.dateFrom
    const to = patch.dateTo ?? current.dateTo
    if (to < from) throw new HttpProblem(422, 'validation.dateRange')
    const pIds = personIds ?? current.persons.map((p) => p.id)
    if (personIds || vs) await assertRefs(c, projectId, pIds, (vs ?? current.vehicles).map((v) => v.vehicleId), (vs ?? current.vehicles).map((v) => v.driverPersonId).filter(Boolean) as string[])
    await assertNoOverlap(c, projectId, pIds, from, to, id)
    await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(avizations)
        .set({ ...patch, version: sql`${avizations.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
        .where(and(eq(avizations.id, id), eq(avizations.version, version)))
        .returning({ id: avizations.id })
      if (!r) throw conflict(null)
      if (personIds) {
        await tx.delete(avizationPersons).where(eq(avizationPersons.avizationId, id))
        if (personIds.length) await tx.insert(avizationPersons).values(personIds.map((personId) => ({ avizationId: id, personId })))
      }
      if (vs) {
        await tx.delete(avizationVehicles).where(eq(avizationVehicles.avizationId, id))
        if (vs.length) await tx.insert(avizationVehicles).values(vs.map((v) => ({ avizationId: id, vehicleId: v.vehicleId, driverPersonId: v.driverPersonId ?? null })))
      }
      await writeAudit(c, { action: 'avizations.update', entity: 'avizations', entityId: id, projectId, changes: { ...patch, persons: personIds?.length, vehicles: vs?.length } }, tx)
    })
    return c.json(await getOne(c, projectId, id), 200)
  },
)

// ---------- workflow ----------
avizationsRouter.openapi(
  route({ method: 'post', path: `${BASE}/{id}/transition`, request: { params: idParam, body: body(avizationTransition) }, responses: ok }, 'avizations', 'view'),
  async (c) => {
    const { projectId, id } = c.req.valid('param')
    const t = c.req.valid('json')
    const deps = c.get('deps')
    const perms = c.get('permissions')
    const user = c.get('user')
    const a = await getOne(c, projectId, id)
    if (a.version !== t.version) throw conflict(a)

    type Status = AvizationDto['status']
    const rules: Record<typeof t.action, { from: Status[]; to: Status; allowed: boolean }> = {
      send: { from: ['draft'], to: 'sent', allowed: a.canEdit && perms.has('avizations:edit') },
      withdraw: { from: ['sent'], to: 'draft', allowed: a.canEdit && perms.has('avizations:edit') },
      accept: { from: ['sent'], to: 'accepted', allowed: perms.has('avizations:approve') },
      reject: { from: ['sent'], to: 'rejected', allowed: perms.has('avizations:approve') },
      cancel: { from: ['draft', 'sent', 'accepted'], to: 'cancelled', allowed: (a.canEdit && perms.has('avizations:edit')) || perms.has('avizations:delete') },
      accept_external: { from: ['draft', 'sent'], to: 'accepted', allowed: perms.has('admin:edit') },
    }
    const rule = rules[t.action]
    if (!rule.allowed) throw forbidden('avization_transition_denied', t.action)
    if (!rule.from.includes(a.status)) throw new HttpProblem(422, 'avization_invalid_transition', `${a.status} → ${rule.to}`)
    if (t.action === 'send' && !a.persons.length && !a.vehicles.length) throw new HttpProblem(422, 'avization_empty')
    if (['send', 'accept', 'accept_external'].includes(t.action)) await assertNoOverlap(c, projectId, a.persons.map((p) => p.id), a.dateFrom, a.dateTo, id)

    const decision = ['accept', 'reject', 'accept_external'].includes(t.action)
    await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(avizations)
        .set({
          status: rule.to,
          ...(t.action === 'send' ? { sentAt: sql`now()` } : {}),
          ...(decision ? { decidedBy: user.id, decidedAt: sql`now()` } : {}),
          ...(t.action === 'reject' ? { rejectionReason: t.reason } : {}),
          ...(t.action === 'accept_external' ? { externalRef: t.externalRef } : {}),
          ...(t.action === 'withdraw' ? { sentAt: null } : {}),
          version: sql`${avizations.version} + 1`,
          updatedAt: sql`now()`,
          updatedBy: user.id,
        })
        .where(and(eq(avizations.id, id), eq(avizations.version, t.version)))
        .returning({ id: avizations.id })
      if (!r) throw conflict(null)
      await writeAudit(c, {
        action: `avizations.${t.action}`,
        entity: 'avizations',
        entityId: id,
        projectId,
        changes: { from: a.status, to: rule.to, ...(t.action === 'reject' ? { reason: t.reason } : {}), ...(t.action === 'accept_external' ? { externalRef: t.externalRef } : {}) },
      }, tx)
    })
    const updated = await getOne(c, projectId, id)
    // Zaakceptowana lista dla ochrony archiwizowana w repozytorium (M7), powiązana z awizacją.
    if (updated.status === 'accepted') {
      await inBackground(c, async () => {
        const project = await getProject(deps.db, projectId)
        const e = await buildExport(c, projectId, [updated], `Awizacja ${updated.number}`, [
          `${project.name} · ${project.client}`,
          `Termin: ${fmt(updated.dateFrom)}${updated.dateTo !== updated.dateFrom ? ` – ${fmt(updated.dateTo)}` : ''}${updated.entryPointName ? ` · Wjazd: ${updated.entryPointName}` : ''}`,
          `Cel: ${updated.purpose}`,
        ])
        const { renderAvizationPdf } = await import('../../pdf/avization.tsx')
        const pdf = await renderAvizationPdf({ title: e.title, meta: e.meta, template: e.settings.exportTemplate, rows: e.rows, generatedBy: user.name })
        await archiveToDrive(deps.db, deps.drive, projectId, AUTO_FOLDERS.avizationLists, { name: `${updated.number.replace(/\//g, '-')}_${updated.dateFrom}.pdf`, mimeType: 'application/pdf', data: new Uint8Array(pdf) }, { targetType: 'avization', targetId: id })
      })
    }
    return c.json(updated, 200)
  },
)

// ---------- kto jest dziś na obiekcie ----------
avizationsRouter.openapi(
  route({ method: 'get', path: `${BASE}/on-site`, request: { params: projectParam, query: z.object({ date: z.iso.date().optional() }) }, responses: ok }, 'avizations', 'view'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const date = c.req.valid('query').date ?? todayWarsaw(c.get('deps').now?.())
    const list = await loadAvizations(c, projectId, and(eq(avizations.status, 'accepted'), lte(avizations.dateFrom, date), gte(avizations.dateTo, date)))
    const body: OnSiteResponse = {
      date,
      avizations: list.map((a) => ({ id: a.id, number: a.number, entryPointName: a.entryPointName, purpose: a.purpose, dateFrom: a.dateFrom, dateTo: a.dateTo })),
      persons: list.flatMap((a) => a.persons.map((p) => ({ id: p.id, name: p.name, company: p.company, avizationNumber: a.number }))),
      vehicles: list.flatMap((a) => a.vehicles.map((v) => ({ id: v.vehicleId, registrationNumber: v.registrationNumber, makeModel: v.makeModel, driverName: v.driverName, avizationNumber: a.number }))),
    }
    return c.json(body, 200)
  },
)

// ---------- eksport listy (szablon ochrony) ----------
async function buildExport(c: Context<AppEnv>, projectId: string, list: AvizationDto[], title: string, meta: string[]) {
  const settings = await settingsFor(c, projectId)
  const data = await exportData(c, list.map((a) => a.id))
  const first = list[0]
  const rows = buildExportRows(settings.exportTemplate, data.persons, data.vehicles, {
    dateFrom: first?.dateFrom ?? '',
    dateTo: first?.dateTo ?? '',
    entryPoint: first?.entryPointName ?? null,
  })
  return { settings, rows, title, meta, counts: { persons: data.persons.length, vehicles: data.vehicles.length } }
}

async function sendExport(c: Context<AppEnv>, kind: 'xlsx' | 'pdf', e: Awaited<ReturnType<typeof buildExport>>, fileBase: string, auditInfo: Record<string, unknown>, projectId: string) {
  // Eksport zawiera odszyfrowane dane — zawsze wpis w audit log (spec. M5).
  await writeAudit(c, { action: `avizations.export_${kind}`, entity: 'avizations', projectId, changes: { ...auditInfo, ...e.counts } })
  const tpl = e.settings.exportTemplate
  if (kind === 'xlsx') {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Awizacja')
    ws.addRow([e.title]).font = { bold: true, size: 13 }
    for (const m of e.meta) ws.addRow([m])
    ws.addRow([])
    const header = ws.addRow(tpl.columns.map((col) => col.header))
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }
      cell.alignment = { horizontal: 'center' }
    })
    for (const r of e.rows) ws.addRow(r)
    tpl.columns.forEach((col, i) => (ws.getColumn(i + 1).width = col.width))
    const firstTable = header.number
    for (let r = firstTable; r <= ws.rowCount; r++) {
      ws.getRow(r).eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > tpl.columns.length) return
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
        if (tpl.columns[col - 1]!.key === 'lp' || tpl.columns[col - 1]!.key === 'company' || tpl.columns[col - 1]!.key === 'vehicle' || tpl.columns[col - 1]!.key === 'nameWithDoc') cell.alignment = { horizontal: 'center' }
      })
    }
    return c.body((await wb.xlsx.writeBuffer()) as ArrayBuffer, 200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileBase}.xlsx"`,
    })
  }
  const { renderAvizationPdf } = await import('../../pdf/avization.tsx')
  const pdf = await renderAvizationPdf({ title: e.title, meta: e.meta, template: tpl, rows: e.rows, generatedBy: c.get('user').name })
  return c.body(new Uint8Array(pdf), 200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${fileBase}.pdf"` })
}

const kindParam = z.enum(['xlsx', 'pdf'])

avizationsRouter.openapi(
  route({ method: 'get', path: `${BASE}/{id}/export/{kind}`, request: { params: idParam.extend({ kind: kindParam }) }, responses: file }, 'avizations', 'export'),
  async (c) => {
    const { projectId, id, kind } = c.req.valid('param')
    const a = await getOne(c, projectId, id)
    const project = await getProject(c.get('deps').db, projectId)
    const e = await buildExport(c, projectId, [a], `Awizacja ${a.number}`, [
      `${project.name} · ${project.client}`,
      `Termin: ${fmt(a.dateFrom)}${a.dateTo !== a.dateFrom ? ` – ${fmt(a.dateTo)}` : ''}${a.entryPointName ? ` · Wjazd: ${a.entryPointName}` : ''}`,
      `Cel: ${a.purpose}`,
    ])
    return sendExport(c, kind, e, a.number.replace(/\//g, '-'), { avization: a.number }, projectId)
  },
)

avizationsRouter.openapi(
  route({ method: 'get', path: `${BASE}/day/{date}/export/{kind}`, request: { params: projectParam.extend({ date: z.iso.date(), kind: kindParam }) }, responses: file }, 'avizations', 'export'),
  async (c) => {
    const { projectId, date, kind } = c.req.valid('param')
    const list = await loadAvizations(c, projectId, and(eq(avizations.status, 'accepted'), lte(avizations.dateFrom, date), gte(avizations.dateTo, date)))
    const project = await getProject(c.get('deps').db, projectId)
    const e = await buildExport(c, projectId, list, `Lista osób i pojazdów — ${fmt(date)}`, [
      `${project.name} · ${project.client}`,
      `Awizacje: ${list.map((a) => a.number).join(', ') || '—'}`,
    ])
    return sendExport(c, kind, e, `awizacje-${date}`, { date, avizations: list.map((a) => a.number) }, projectId)
  },
)

// ---------- bramy i ustawienia ----------
avizationsRouter.openapi(route({ method: 'get', path: '/projects/{projectId}/entry-points', request: { params: projectParam }, responses: ok }, 'avizations', 'view'), async (c) => {
  const rows = await c.get('deps').db.select().from(entryPoints).where(and(eq(entryPoints.projectId, c.req.valid('param').projectId), isNull(entryPoints.deletedAt))).orderBy(asc(entryPoints.name))
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive })) satisfies EntryPointDto[], 200)
})

avizationsRouter.openapi(
  route({ method: 'post', path: '/projects/{projectId}/entry-points', request: { params: projectParam, body: body(z.object({ name: z.string().trim().min(1).max(100) })) }, responses: ok }, 'admin', 'edit'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const [r] = await c.get('deps').db.insert(entryPoints).values({ projectId, name: c.req.valid('json').name, createdBy: c.get('user').id }).returning()
    await writeAudit(c, { action: 'entry_points.create', entity: 'entry_points', entityId: r!.id, projectId, changes: { name: r!.name } })
    return c.json({ id: r!.id, name: r!.name, isActive: r!.isActive }, 200)
  },
)

avizationsRouter.openapi(
  route({ method: 'patch', path: '/projects/{projectId}/entry-points/{id}', request: { params: idParam, body: body(z.object({ name: z.string().trim().min(1).max(100).optional(), isActive: z.boolean().optional() })) }, responses: ok }, 'admin', 'edit'),
  async (c) => {
    const { projectId, id } = c.req.valid('param')
    const [r] = await c.get('deps').db.update(entryPoints).set({ ...c.req.valid('json'), updatedAt: sql`now()` }).where(and(eq(entryPoints.id, id), eq(entryPoints.projectId, projectId))).returning()
    if (!r) throw notFound()
    await writeAudit(c, { action: 'entry_points.update', entity: 'entry_points', entityId: id, projectId, changes: c.req.valid('json') })
    return c.json({ id: r.id, name: r.name, isActive: r.isActive }, 200)
  },
)

avizationsRouter.openapi(route({ method: 'get', path: `${BASE}/settings`, request: { params: projectParam }, responses: ok }, 'avizations', 'view'), async (c) =>
  c.json(await settingsFor(c, c.req.valid('param').projectId), 200),
)

avizationsRouter.openapi(
  route({ method: 'put', path: `${BASE}/settings`, request: { params: projectParam, body: body(avizationSettingsInput) }, responses: ok }, 'admin', 'edit'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const value = c.req.valid('json')
    const before = await settingsFor(c, projectId)
    await c.get('deps').db
      .update(projects)
      .set({ settings: sql`jsonb_set(coalesce(${projects.settings}, '{}'::jsonb), '{avizations}', ${JSON.stringify(value)}::jsonb)`, updatedAt: sql`now()` })
      .where(eq(projects.id, projectId))
    await writeAudit(c, { action: 'avizations.settings', entity: 'projects', entityId: projectId, projectId, changes: { old: before, new: value } })
    return c.json(value, 200)
  },
)

// Szczegóły — rejestrowane na końcu, by `/{id}` nie przechwytywał `/on-site` ani `/settings`.
avizationsRouter.openapi(route({ method: 'get', path: `${BASE}/{id}`, request: { params: idParam }, responses: ok }, 'avizations', 'view'), async (c) => {
  const { projectId, id } = c.req.valid('param')
  return c.json(await getOne(c, projectId, id), 200)
})
