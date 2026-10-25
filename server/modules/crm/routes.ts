import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Context } from 'hono'
import {
  STAFF_ROLES,
  activityInput,
  companyInput,
  companyPatch,
  contactInput,
  contactPatch,
  opportunityInput,
  opportunityPatch,
  projectFromOpportunityInput,
  stageChangeInput,
  type Action,
  type CompanyDetailDto,
  type CrmOwnerOption,
  type OpportunityDetailDto,
} from '#shared'
import i18nPl from '../../../shared/i18n/pl.json' with { type: 'json' }
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { companies, contacts, crmActivities, opportunities, projects, users } from '../../db/schema.ts'
import { todayWarsaw } from '../../lib/dates.ts'
import { HttpProblem, conflict, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { ensureOpportunityFolder } from '../ai/routes.ts'
import { lookupNip } from './nip.ts'
import { getOpportunity, listActivities, listCompanies, listContacts, listOpportunities, nextOpportunityCode, toContactDto } from './service.ts'

export const crmRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const created = { 201: { description: 'Utworzono', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, action: Action) => secureRoute('', r, { permission: { module: 'crm', action } })
const now = (c: Context<AppEnv>) => c.get('deps').now?.() ?? new Date()

async function opportunityOr404(c: Context<AppEnv>, id: string) {
  const dto = await getOpportunity(c.get('deps').db, id, now(c))
  if (!dto) throw notFound()
  return dto
}

async function detail(c: Context<AppEnv>, id: string): Promise<OpportunityDetailDto> {
  const dto = await opportunityOr404(c, id)
  return { ...dto, activities: await listActivities(c.get('deps').db, id) }
}

/** Firma i kontakt muszą istnieć, a kontakt należeć do firmy szansy. */
async function assertRefs(db: Database, companyId: string | null | undefined, contactId: string | null | undefined) {
  if (companyId) {
    const [co] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
    if (!co) throw new HttpProblem(422, 'company_not_found')
  }
  if (contactId) {
    const [ct] = await db.select({ companyId: contacts.companyId }).from(contacts).where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    if (!ct || ct.companyId !== companyId) throw new HttpProblem(422, 'contact_not_in_company')
  }
}

async function assertOwner(db: Database, ownerId: string | null | undefined) {
  if (!ownerId) return
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerId), inArray(users.role, [...STAFF_ROLES]), eq(users.isActive, true), isNull(users.deletedAt)))
  if (!u) throw new HttpProblem(422, 'owner_not_allowed')
}

async function assertNipFree(db: Database, nip: string | null | undefined, exceptId?: string) {
  if (!nip) return
  const [dup] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.nip, nip), isNull(companies.deletedAt)))
  if (dup && dup.id !== exceptId) throw new HttpProblem(409, 'company_nip_exists', dup.name, { companyId: dup.id })
}

// ---------------- Słowniki ----------------

crmRouter.openapi(route({ method: 'get', path: '/crm/owners', responses: ok }, 'view'), async (c) => {
  const rows = await c
    .get('deps')
    .db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.isActive, true), isNull(users.deletedAt)))
    .orderBy(asc(users.name))
  return c.json(rows satisfies CrmOwnerOption[], 200)
})

crmRouter.openapi(route({ method: 'get', path: '/crm/nip/{nip}', request: { params: z.object({ nip: z.string().max(20) }) }, responses: ok }, 'view'), async (c) => {
  const deps = c.get('deps')
  const result = await lookupNip(deps.fetch ?? fetch, c.req.valid('param').nip, todayWarsaw(now(c)))
  if (!result) throw new HttpProblem(404, 'nip_not_found')
  const [existing] = await deps.db.select({ id: companies.id }).from(companies).where(and(eq(companies.nip, result.nip), isNull(companies.deletedAt)))
  return c.json({ ...result, existingCompanyId: existing?.id ?? null }, 200)
})

// ---------------- Firmy ----------------

crmRouter.openapi(route({ method: 'get', path: '/crm/companies', responses: ok }, 'view'), async (c) => c.json(await listCompanies(c.get('deps').db), 200))

crmRouter.openapi(route({ method: 'post', path: '/crm/companies', request: { body: body(companyInput) }, responses: created }, 'create'), async (c) => {
  const input = c.req.valid('json')
  const deps = c.get('deps')
  const user = c.get('user')
  await assertNipFree(deps.db, input.nip)
  await assertOwner(deps.db, input.ownerId)
  const id = await deps.db.transaction(async (tx) => {
    const [r] = await tx.insert(companies).values({ ...input, createdBy: user.id, updatedBy: user.id }).returning({ id: companies.id })
    await writeAudit(c, { action: 'crm.company_create', entity: 'companies', entityId: r!.id, changes: input }, tx)
    return r!.id
  })
  const [dto] = await listCompanies(deps.db, eq(companies.id, id))
  return c.json(dto, 201)
})

crmRouter.openapi(route({ method: 'get', path: '/crm/companies/{id}', request: { params: idParam }, responses: ok }, 'view'), async (c) => {
  const { id } = c.req.valid('param')
  const db = c.get('deps').db
  const [company] = await listCompanies(db, eq(companies.id, id))
  if (!company) throw notFound()
  const result: CompanyDetailDto = {
    ...company,
    contacts: await listContacts(db, [id]),
    opportunities: await listOpportunities(db, now(c), eq(opportunities.companyId, id)),
  }
  return c.json(result, 200)
})

crmRouter.openapi(route({ method: 'patch', path: '/crm/companies/{id}', request: { params: idParam, body: body(companyPatch) }, responses: ok }, 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const { version, ...patch } = c.req.valid('json')
  const deps = c.get('deps')
  const [current] = await deps.db.select().from(companies).where(and(eq(companies.id, id), isNull(companies.deletedAt)))
  if (!current) throw notFound()
  await assertNipFree(deps.db, patch.nip, id)
  await assertOwner(deps.db, patch.ownerId)
  const updated = await deps.db.transaction(async (tx) => {
    const [r] = await tx
      .update(companies)
      .set({ ...patch, version: sql`${companies.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
      .where(and(eq(companies.id, id), eq(companies.version, version)))
      .returning({ id: companies.id })
    if (r) await writeAudit(c, { action: 'crm.company_update', entity: 'companies', entityId: id, changes: diffFields(current, patch) }, tx)
    return r
  })
  const [dto] = await listCompanies(deps.db, eq(companies.id, id))
  if (!updated) throw conflict(dto ?? null)
  return c.json(dto, 200)
})

crmRouter.openapi(route({ method: 'delete', path: '/crm/companies/{id}', request: { params: idParam }, responses: ok }, 'delete'), async (c) => {
  const { id } = c.req.valid('param')
  const deps = c.get('deps')
  const [used] = await deps.db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.companyId, id), isNull(opportunities.deletedAt))).limit(1)
  if (used) throw new HttpProblem(409, 'company_has_opportunities')
  await deps.db.transaction(async (tx) => {
    const [r] = await tx
      .update(companies)
      .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
      .returning({ name: companies.name })
    if (!r) throw notFound()
    await writeAudit(c, { action: 'crm.company_delete', entity: 'companies', entityId: id, changes: { name: r.name } }, tx)
  })
  return c.json({ ok: true }, 200)
})

// ---------------- Kontakty ----------------

crmRouter.openapi(
  route({ method: 'post', path: '/crm/companies/{id}/contacts', request: { params: idParam, body: body(contactInput) }, responses: created }, 'create'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    await assertRefs(deps.db, id, null)
    const row = await deps.db.transaction(async (tx) => {
      const [r] = await tx.insert(contacts).values({ ...input, companyId: id, createdBy: user.id, updatedBy: user.id }).returning()
      await writeAudit(c, { action: 'crm.contact_create', entity: 'contacts', entityId: r!.id, changes: { companyId: id, name: input.name } }, tx)
      return r!
    })
    return c.json(toContactDto(row), 201)
  },
)

crmRouter.openapi(route({ method: 'patch', path: '/crm/contacts/{id}', request: { params: idParam, body: body(contactPatch) }, responses: ok }, 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const { version, ...patch } = c.req.valid('json')
  const deps = c.get('deps')
  const [current] = await deps.db.select().from(contacts).where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
  if (!current) throw notFound()
  const updated = await deps.db.transaction(async (tx) => {
    const [r] = await tx
      .update(contacts)
      .set({ ...patch, version: sql`${contacts.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
      .where(and(eq(contacts.id, id), eq(contacts.version, version)))
      .returning()
    if (r) await writeAudit(c, { action: 'crm.contact_update', entity: 'contacts', entityId: id, changes: diffFields(current, patch) }, tx)
    return r
  })
  if (!updated) throw conflict(toContactDto(current))
  return c.json(toContactDto(updated), 200)
})

crmRouter.openapi(route({ method: 'delete', path: '/crm/contacts/{id}', request: { params: idParam }, responses: ok }, 'delete'), async (c) => {
  const { id } = c.req.valid('param')
  await c.get('deps').db.transaction(async (tx) => {
    const [r] = await tx
      .update(contacts)
      .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .returning({ name: contacts.name })
    if (!r) throw notFound()
    // Szanse wskazujące usunięty kontakt tracą tylko to powiązanie.
    await tx.update(opportunities).set({ contactId: null }).where(eq(opportunities.contactId, id))
    await writeAudit(c, { action: 'crm.contact_delete', entity: 'contacts', entityId: id, changes: { name: r.name } }, tx)
  })
  return c.json({ ok: true }, 200)
})

// ---------------- Szanse ----------------

crmRouter.openapi(route({ method: 'get', path: '/crm/opportunities', responses: ok }, 'view'), async (c) => c.json(await listOpportunities(c.get('deps').db, now(c)), 200))

crmRouter.openapi(
  route(
    {
      method: 'get',
      path: '/crm/opportunities/export.xlsx',
      responses: { 200: { description: 'XLSX', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.any() } } } },
    },
    'export',
  ),
  async (c) => {
    const items = await listOpportunities(c.get('deps').db, now(c))
    const t = i18nPl as unknown as { crm: { stage: Record<string, string>; type: Record<string, string> } }
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Envcheck Hub'
    const ws = wb.addWorksheet('Szanse', { views: [{ state: 'frozen', ySplit: 1 }] })
    const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null)
    ws.columns = [
      { header: 'Kod', key: 'code', width: 10 },
      { header: 'Nazwa', key: 'name', width: 45 },
      { header: 'Firma', key: 'companyName', width: 28 },
      { header: 'Etap', key: 'stage', width: 16 },
      { header: 'Brak odpowiedzi', key: 'noResponse', width: 14 },
      { header: 'Wartość netto (PLN)', key: 'value', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Typ postępowania', key: 'type', width: 20 },
      { header: 'Źródło', key: 'source', width: 18 },
      { header: 'Opiekun', key: 'ownerName', width: 20 },
      { header: 'Termin złożenia', key: 'submissionDeadline', width: 14, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Dalsze działania', key: 'nextStep', width: 40 },
      { header: 'Data kolejnego kroku', key: 'nextStepDate', width: 14, style: { numFmt: 'dd.mm.yyyy' } },
      { header: 'Powód przegranej', key: 'lossReason', width: 30 },
      { header: 'Projekt', key: 'projectCode', width: 10 },
    ]
    ws.getRow(1).font = { bold: true }
    for (const o of items) {
      ws.addRow({
        ...o,
        stage: t.crm.stage[o.stage],
        type: o.type ? t.crm.type[o.type] : null,
        noResponse: o.noResponse ? 'tak' : '',
        submissionDeadline: date(o.submissionDeadline),
        nextStepDate: date(o.nextStepDate),
      })
    }
    await writeAudit(c, { action: 'crm.export', entity: 'opportunities', changes: { count: items.length } })
    const buf = await wb.xlsx.writeBuffer()
    return c.body(buf as ArrayBuffer, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="szanse-crm.xlsx"',
    })
  },
)

crmRouter.openapi(route({ method: 'post', path: '/crm/opportunities', request: { body: body(opportunityInput) }, responses: created }, 'create'), async (c) => {
  const input = c.req.valid('json')
  const deps = c.get('deps')
  const user = c.get('user')
  await assertRefs(deps.db, input.companyId, input.contactId)
  await assertOwner(deps.db, input.ownerId)
  const year = Number(todayWarsaw(now(c)).slice(0, 4))
  const id = await deps.db.transaction(async (tx) => {
    const code = await nextOpportunityCode(tx, year)
    const [r] = await tx
      .insert(opportunities)
      .values({ ...input, ownerId: input.ownerId ?? user.id, code, stage: 'new', stageChangedAt: sql`now()`, createdBy: user.id, updatedBy: user.id })
      .returning({ id: opportunities.id })
    await writeAudit(c, { action: 'crm.opportunity_create', entity: 'opportunities', entityId: r!.id, changes: { code, ...input } }, tx)
    return r!.id
  })
  // Folder szansy na Drive (C4) — od razu, jeśli Drive jest skonfigurowany; błąd nie blokuje założenia szansy.
  if (deps.drive) {
    await ensureOpportunityFolder(deps.db, deps.drive, id).catch((e: unknown) => {
      if (!(e instanceof HttpProblem && e.code === 'drive_not_configured')) console.warn('[pmo] drive folder for opportunity failed', e instanceof Error ? e.message : e)
    })
  }
  return c.json(await detail(c, id), 201)
})

crmRouter.openapi(route({ method: 'get', path: '/crm/opportunities/{id}', request: { params: idParam }, responses: ok }, 'view'), async (c) =>
  c.json(await detail(c, c.req.valid('param').id), 200),
)

crmRouter.openapi(
  route({ method: 'patch', path: '/crm/opportunities/{id}', request: { params: idParam, body: body(opportunityPatch) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { version, ...patch } = c.req.valid('json')
    const deps = c.get('deps')
    const [current] = await deps.db.select().from(opportunities).where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
    if (!current) throw notFound()
    const companyId = patch.companyId !== undefined ? patch.companyId : current.companyId
    // Zmiana firmy bez wskazania kontaktu zeruje kontakt poprzedniej firmy.
    const contactId = patch.contactId !== undefined ? patch.contactId : companyId === current.companyId ? current.contactId : null
    await assertRefs(deps.db, companyId, contactId)
    await assertOwner(deps.db, patch.ownerId)
    const set = { ...patch, contactId }
    const updated = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(opportunities)
        .set({ ...set, version: sql`${opportunities.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
        .where(and(eq(opportunities.id, id), eq(opportunities.version, version)))
        .returning({ id: opportunities.id })
      if (r) await writeAudit(c, { action: 'crm.opportunity_update', entity: 'opportunities', entityId: id, changes: diffFields(current, set) }, tx)
      return r
    })
    if (!updated) throw conflict(await getOpportunity(deps.db, id, now(c)))
    return c.json(await detail(c, id), 200)
  },
)

crmRouter.openapi(
  route({ method: 'post', path: '/crm/opportunities/{id}/stage', request: { params: idParam, body: body(stageChangeInput) }, responses: ok }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { stage, lossReason, version } = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    const [current] = await deps.db.select().from(opportunities).where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
    if (!current) throw notFound()
    if (current.stage === stage) return c.json(await detail(c, id), 200)
    const updated = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(opportunities)
        .set({
          stage,
          stageChangedAt: sql`now()`,
          ...(stage === 'lost' ? { lossReason: lossReason!.trim() } : {}),
          version: sql`${opportunities.version} + 1`,
          updatedAt: sql`now()`,
          updatedBy: user.id,
        })
        .where(and(eq(opportunities.id, id), eq(opportunities.version, version)))
        .returning({ id: opportunities.id })
      if (!r) return null
      const meta = { from: current.stage, to: stage, ...(stage === 'lost' ? { lossReason } : {}) }
      await tx.insert(crmActivities).values({ opportunityId: id, kind: 'stage_change', body: stage === 'lost' ? lossReason!.trim() : '', meta, userId: user.id })
      await writeAudit(c, { action: 'crm.opportunity_stage', entity: 'opportunities', entityId: id, changes: meta }, tx)
      return r
    })
    if (!updated) throw conflict(await getOpportunity(deps.db, id, now(c)))
    return c.json(await detail(c, id), 200)
  },
)

crmRouter.openapi(
  route({ method: 'post', path: '/crm/opportunities/{id}/activities', request: { params: idParam, body: body(activityInput) }, responses: created }, 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const deps = c.get('deps')
    await opportunityOr404(c, id)
    await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(crmActivities)
        .values({ opportunityId: id, kind: input.kind, body: input.body, occurredAt: input.occurredAt ?? sql`now()`, userId: c.get('user').id })
        .returning({ id: crmActivities.id })
      await writeAudit(c, { action: 'crm.activity_create', entity: 'crm_activities', entityId: r!.id, changes: { opportunityId: id, kind: input.kind } }, tx)
    })
    return c.json(await detail(c, id), 201)
  },
)

crmRouter.openapi(route({ method: 'delete', path: '/crm/opportunities/{id}', request: { params: idParam }, responses: ok }, 'delete'), async (c) => {
  const { id } = c.req.valid('param')
  await c.get('deps').db.transaction(async (tx) => {
    const [r] = await tx
      .update(opportunities)
      .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
      .returning({ code: opportunities.code, name: opportunities.name })
    if (!r) throw notFound()
    await writeAudit(c, { action: 'crm.opportunity_delete', entity: 'opportunities', entityId: id, changes: r }, tx)
  })
  return c.json({ ok: true }, 200)
})

/** Wygrana szansa → projekt (kod projektu = kod oferty). Zakłada projekt tylko Admin (`crm:approve`). */
crmRouter.openapi(
  route({ method: 'post', path: '/crm/opportunities/{id}/project', request: { params: idParam, body: body(projectFromOpportunityInput) }, responses: created }, 'approve'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    const opp = await opportunityOr404(c, id)
    if (opp.stage !== 'won') throw new HttpProblem(422, 'opportunity_not_won')
    if (opp.projectId) throw new HttpProblem(409, 'opportunity_has_project')
    const [dup] = await deps.db.select({ id: projects.id }).from(projects).where(sql`lower(${projects.code}) = lower(${opp.code})`)
    if (dup) throw new HttpProblem(409, 'project_code_exists', opp.code)
    const projectId = await deps.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({
          code: opp.code,
          name: input.name,
          client: input.client,
          contractNo: input.contractNo,
          procurementNo: input.procurementNo,
          contractValue: input.contractValue != null ? String(input.contractValue) : null,
          contractEndDate: input.contractEndDate,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: projects.id })
      await tx
        .update(opportunities)
        .set({ projectId: p!.id, version: sql`${opportunities.version} + 1`, updatedAt: sql`now()`, updatedBy: user.id })
        .where(eq(opportunities.id, id))
      await writeAudit(c, { action: 'project.create_from_opportunity', entity: 'projects', entityId: p!.id, projectId: p!.id, changes: { opportunityId: id, code: opp.code, ...input } }, tx)
      return p!.id
    })
    return c.json({ projectId, code: opp.code, opportunity: await detail(c, id) }, 201)
  },
)
