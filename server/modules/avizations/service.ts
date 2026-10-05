import { and, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm'
import type { Context } from 'hono'
import { AVIZATION_ACTIVE, DEFAULT_EXPORT_TEMPLATE, type AvizationDto, type AvizationSettings } from '#shared'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { avizationPersons, avizationVehicles, avizations, entryPoints, hrfTasks, persons, projects, users, vehicles } from '../../db/schema.ts'
import { decryptField } from '../../lib/field-crypto.ts'
import { canEditAvizationRecord } from '../../lib/ownership.ts'
import { todayWarsaw, workingDaysBetween } from '../../lib/dates.ts'
import { formatInTimeZone } from 'date-fns-tz'
import { maskDoc } from './format.ts'

export const DEFAULT_MIN_LEAD_DAYS = 1

export function avizationSettings(project: typeof projects.$inferSelect): AvizationSettings {
  const s = (project.settings as Record<string, unknown>)?.avizations as Partial<AvizationSettings> | undefined
  return { minLeadWorkingDays: s?.minLeadWorkingDays ?? DEFAULT_MIN_LEAD_DAYS, exportTemplate: s?.exportTemplate ?? DEFAULT_EXPORT_TEMPLATE }
}

/** Widoczność: podwykonawca — tylko własne; Zamawiający — bez szkiców. */
export function visibility(c: Context<AppEnv>): SQL | undefined {
  const user = c.get('user')
  if (user.role === 'Subcontractor') return eq(avizations.party, user.party)
  if (user.role === 'Client') return ne(avizations.status, 'draft')
  return undefined
}

export async function loadAvizations(c: Context<AppEnv>, projectId: string, where?: SQL, settings?: AvizationSettings): Promise<AvizationDto[]> {
  const db = c.get('deps').db
  const keyring = c.get('deps').config.keyring
  const decider = sql<string | null>`(select name from users d where d.id = ${avizations.decidedBy})`
  const rows = await db
    .select({ a: avizations, ep: entryPoints.name, hrf: hrfTasks.code, requester: users.name, decider })
    .from(avizations)
    .leftJoin(entryPoints, eq(entryPoints.id, avizations.entryPointId))
    .leftJoin(hrfTasks, eq(hrfTasks.id, avizations.hrfTaskId))
    .leftJoin(users, eq(users.id, avizations.requestedBy))
    .where(and(eq(avizations.projectId, projectId), isNull(avizations.deletedAt), visibility(c), where))
    .orderBy(sql`${avizations.dateFrom} desc`, sql`${avizations.number} desc`)
  if (!rows.length) return []
  const ids = rows.map((r) => r.a.id)
  const [ps, vs] = await Promise.all([
    db.select({ avizationId: avizationPersons.avizationId, p: persons }).from(avizationPersons).innerJoin(persons, eq(persons.id, avizationPersons.personId)).where(inArray(avizationPersons.avizationId, ids)),
    db.select({ avizationId: avizationVehicles.avizationId, driver: avizationVehicles.driverPersonId, v: vehicles }).from(avizationVehicles).innerJoin(vehicles, eq(vehicles.id, avizationVehicles.vehicleId)).where(inArray(avizationVehicles.avizationId, ids)),
  ])
  const names = new Map(ps.map((x) => [x.p.id, `${x.p.firstName} ${x.p.lastName}`]))
  const perms = c.get('permissions')
  const user = c.get('user')
  const today = todayWarsaw(c.get('deps').now?.())
  return rows.map(({ a, ep, hrf, requester, decider: dn }) => {
    const ref = a.sentAt ? formatInTimeZone(new Date(a.sentAt), 'Europe/Warsaw', 'yyyy-MM-dd') : today
    const lead = workingDaysBetween(ref, a.dateFrom)
    const warnings: AvizationDto['warnings'] =
      settings && ['draft', 'sent'].includes(a.status) && lead < settings.minLeadWorkingDays
        ? [{ code: 'short_notice', message: `Zgłoszenie z wyprzedzeniem ${lead} dni roboczych (wymagane ${settings.minLeadWorkingDays})` }]
        : []
    return {
      id: a.id,
      number: a.number,
      dateFrom: a.dateFrom,
      dateTo: a.dateTo,
      entryPointId: a.entryPointId,
      entryPointName: ep,
      purpose: a.purpose,
      hrfTaskId: a.hrfTaskId,
      hrfTaskCode: hrf,
      status: a.status,
      party: a.party,
      requestedBy: a.requestedBy,
      requestedByName: requester,
      decidedAt: a.decidedAt,
      decidedByName: dn,
      rejectionReason: a.rejectionReason,
      externalRef: a.externalRef,
      persons: ps
        .filter((x) => x.avizationId === a.id)
        .map((x) => ({ id: x.p.id, name: `${x.p.firstName} ${x.p.lastName}`, company: x.p.company, idDocNumberMasked: maskDoc(decryptField(keyring, x.p.idDocNumberEnc)) })),
      vehicles: vs
        .filter((x) => x.avizationId === a.id)
        .map((x) => ({ vehicleId: x.v.id, registrationNumber: decryptField(keyring, x.v.registrationNumberEnc), makeModel: x.v.makeModel, driverPersonId: x.driver, driverName: x.driver ? (names.get(x.driver) ?? null) : null })),
      warnings,
      version: a.version,
      canEdit: canEditAvizationRecord(user, perms, a),
      canDecide: perms.has('avizations:approve') && a.status === 'sent',
    }
  })
}

/** Ta sama osoba nie może mieć dwóch nakładających się awizacji (szkic / wysłana / zaakceptowana). */
export async function findOverlaps(db: Database, projectId: string, personIds: string[], dateFrom: string, dateTo: string, excludeId?: string) {
  if (!personIds.length) return []
  return db
    .select({ number: avizations.number, firstName: persons.firstName, lastName: persons.lastName })
    .from(avizationPersons)
    .innerJoin(avizations, eq(avizations.id, avizationPersons.avizationId))
    .innerJoin(persons, eq(persons.id, avizationPersons.personId))
    .where(
      and(
        eq(avizations.projectId, projectId),
        isNull(avizations.deletedAt),
        inArray(avizations.status, [...AVIZATION_ACTIVE]),
        inArray(avizationPersons.personId, personIds),
        lte(avizations.dateFrom, dateTo),
        gte(avizations.dateTo, dateFrom),
        excludeId ? ne(avizations.id, excludeId) : undefined,
      ),
    )
}

/** Dane do eksportu z odszyfrowanymi numerami (wywołujący zapisuje audit). */
export async function exportData(c: Context<AppEnv>, avizationIds: string[]) {
  const db = c.get('deps').db
  const keyring = c.get('deps').config.keyring
  if (!avizationIds.length) return { persons: [], vehicles: [] }
  const [ps, vs] = await Promise.all([
    db.select({ p: persons }).from(avizationPersons).innerJoin(persons, eq(persons.id, avizationPersons.personId)).where(inArray(avizationPersons.avizationId, avizationIds)),
    db.select({ v: vehicles, driver: avizationVehicles.driverPersonId }).from(avizationVehicles).innerJoin(vehicles, eq(vehicles.id, avizationVehicles.vehicleId)).where(inArray(avizationVehicles.avizationId, avizationIds)),
  ])
  const uniqP = new Map(ps.map(({ p }) => [p.id, p]))
  const uniqV = new Map(vs.map((x) => [x.v.id, x]))
  return {
    persons: [...uniqP.values()]
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'pl'))
      .map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, idDocType: p.idDocType, idDocNumber: decryptField(keyring, p.idDocNumberEnc), company: p.company, phone: p.phone, roleOnSite: p.roleOnSite })),
    vehicles: [...uniqV.values()].map(({ v, driver }) => ({ registrationNumber: decryptField(keyring, v.registrationNumberEnc), makeModel: v.makeModel, company: v.company, driverPersonId: driver })),
  }
}
