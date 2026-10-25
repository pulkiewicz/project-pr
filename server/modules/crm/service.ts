import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import {
  NO_RESPONSE_DAYS,
  formatOpportunityCode,
  opportunityCodePrefix,
  type ActivityDto,
  type CompanyDto,
  type ContactDto,
  type OpportunityDto,
} from '#shared'
import type { Database } from '../../db/client.ts'
import { companies, contacts, crmActivities, opportunities, opportunityCodeSeq, projects, users } from '../../db/schema.ts'

const owners = aliasedTable(users, 'owner')

/** Ostatnia „ręczna” aktywność (bez zmian etapu i notatek importu) — podstawa etykiety „brak odpowiedzi”. */
const lastActivity = sql<string | null>`(
  SELECT max(a.occurred_at) FROM ${crmActivities} a
  WHERE a.opportunity_id = ${opportunities.id} AND a.kind <> 'stage_change' AND (a.meta ->> 'import') IS NULL
)`

function opportunitySelect() {
  return {
    o: opportunities,
    companyName: companies.name,
    contactName: contacts.name,
    ownerName: owners.name,
    projectCode: projects.code,
    lastActivityAt: lastActivity,
  }
}

type OpportunityRow = {
  o: typeof opportunities.$inferSelect
  companyName: string | null
  contactName: string | null
  ownerName: string | null
  projectCode: string | null
  lastActivityAt: string | null
}

export function toOpportunityDto(r: OpportunityRow, now: Date): OpportunityDto {
  const o = r.o
  const lastActivityAt = r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null
  const touched = [o.stageChangedAt, lastActivityAt].filter(Boolean).map((d) => new Date(d!).getTime())
  const lastTouch = touched.length ? Math.max(...touched) : null
  const noResponse = o.stage === 'submitted' && (lastTouch === null || now.getTime() - lastTouch > NO_RESPONSE_DAYS * 86_400_000)
  return {
    id: o.id,
    code: o.code,
    name: o.name,
    stage: o.stage,
    companyId: o.companyId,
    companyName: r.companyName,
    contactId: o.contactId,
    contactName: r.contactName,
    ownerId: o.ownerId,
    ownerName: r.ownerName,
    type: o.type,
    source: o.source,
    value: o.value,
    submissionDeadline: o.submissionDeadline,
    decisionDate: o.decisionDate,
    nextStep: o.nextStep,
    nextStepDate: o.nextStepDate,
    link: o.link,
    notes: o.notes,
    lossReason: o.lossReason,
    projectId: o.projectId,
    projectCode: r.projectCode,
    driveFolderId: o.driveFolderId,
    stageChangedAt: o.stageChangedAt,
    lastActivityAt,
    noResponse,
    createdAt: o.createdAt,
    version: o.version,
  }
}

export async function listOpportunities(db: Database, now: Date, where?: SQL) {
  const rows = await db
    .select(opportunitySelect())
    .from(opportunities)
    .leftJoin(companies, eq(companies.id, opportunities.companyId))
    .leftJoin(contacts, eq(contacts.id, opportunities.contactId))
    .leftJoin(owners, eq(owners.id, opportunities.ownerId))
    .leftJoin(projects, eq(projects.id, opportunities.projectId))
    .where(and(isNull(opportunities.deletedAt), where))
    .orderBy(desc(opportunities.createdAt), desc(opportunities.code))
  return rows.map((r) => toOpportunityDto(r, now))
}

export async function getOpportunity(db: Database, id: string, now: Date) {
  const [dto] = await listOpportunities(db, now, eq(opportunities.id, id))
  return dto ?? null
}

export async function listActivities(db: Database, opportunityId: string): Promise<ActivityDto[]> {
  const rows = await db
    .select({ a: crmActivities, userName: users.name })
    .from(crmActivities)
    .leftJoin(users, eq(users.id, crmActivities.userId))
    .where(eq(crmActivities.opportunityId, opportunityId))
    .orderBy(desc(crmActivities.occurredAt), desc(crmActivities.createdAt))
  return rows.map(({ a, userName }) => ({
    id: a.id,
    kind: a.kind,
    body: a.body,
    meta: a.meta ?? null,
    occurredAt: new Date(a.occurredAt).toISOString(),
    userId: a.userId,
    userName,
  }))
}

/**
 * Kolejny kod oferty w roku (OF038, OG001…), atomowo: licznik per prefiks, a gdy brak wpisu —
 * start od najwyższego numeru istniejących kodów z tym prefiksem (także historycznych typu OF015_S).
 */
export async function nextOpportunityCode(tx: Database, year: number): Promise<string> {
  const prefix = opportunityCodePrefix(year)
  const pattern = `^${prefix}0*([0-9]+)`
  const maxExisting = sql`(SELECT coalesce(max(substring(o.code from ${pattern})::int), 0) FROM ${opportunities} o WHERE o.code ~* ${pattern})`
  const [row] = await tx
    .insert(opportunityCodeSeq)
    .values({ prefix, last: sql`${maxExisting} + 1` })
    .onConflictDoUpdate({ target: opportunityCodeSeq.prefix, set: { last: sql`greatest(${opportunityCodeSeq.last} + 1, ${maxExisting} + 1)` } })
    .returning({ last: opportunityCodeSeq.last })
  return formatOpportunityCode(prefix, row!.last)
}

export function toContactDto(c: typeof contacts.$inferSelect): ContactDto {
  return { id: c.id, companyId: c.companyId, name: c.name, position: c.position, email: c.email, phone: c.phone, notes: c.notes, version: c.version }
}

export async function listCompanies(db: Database, where?: SQL): Promise<CompanyDto[]> {
  const counts = db
    .select({
      companyId: opportunities.companyId,
      total: sql<number>`count(*)::int`.as('total'),
      open: sql<number>`count(*) FILTER (WHERE ${opportunities.stage} IN ('new', 'quoting', 'submitted'))::int`.as('open'),
    })
    .from(opportunities)
    .where(isNull(opportunities.deletedAt))
    .groupBy(opportunities.companyId)
    .as('counts')
  const rows = await db
    .select({ c: companies, ownerName: owners.name, total: counts.total, open: counts.open })
    .from(companies)
    .leftJoin(owners, eq(owners.id, companies.ownerId))
    .leftJoin(counts, eq(counts.companyId, companies.id))
    .where(and(isNull(companies.deletedAt), where))
    .orderBy(asc(sql`lower(${companies.name})`))
  return rows.map(({ c, ownerName, total, open }) => ({
    id: c.id,
    name: c.name,
    nip: c.nip,
    regon: c.regon,
    address: c.address,
    website: c.website,
    industry: c.industry,
    notes: c.notes,
    ownerId: c.ownerId,
    ownerName,
    opportunityCount: total ?? 0,
    openOpportunityCount: open ?? 0,
    version: c.version,
  }))
}

export async function listContacts(db: Database, companyIds: string[]) {
  if (!companyIds.length) return []
  const rows = await db
    .select()
    .from(contacts)
    .where(and(inArray(contacts.companyId, companyIds), isNull(contacts.deletedAt)))
    .orderBy(asc(contacts.name))
  return rows.map(toContactDto)
}
