import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { personInput, personPatch, vehicleInput, vehiclePatch, type Action, type ModuleKey, type PersonDto, type VehicleDto } from '#shared'
import type { AppEnv, UserRow } from '../../context.ts'
import { persons, vehicles } from '../../db/schema.ts'
import { decryptField, encryptField, hmacField, keyIdOf } from '../../lib/field-crypto.ts'
import { canEditAvizationRecord, defaultPartyFor } from '../../lib/ownership.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'
import { MAX_IMPORT_BYTES, cellText, loadWorkbook } from '../hrf/import.ts'
import { getProject } from '../hrf/service.ts'
import { maskDoc, normalizeId, parsePeopleRows } from './format.ts'

export const peopleRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const created = { 201: { description: 'Utworzono', ...json(z.any()) } }
const P = '/projects/{projectId}'
const projectParam = z.object({ projectId: z.uuid() })
const idParam = projectParam.extend({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

export type PersonRow = typeof persons.$inferSelect
export type VehicleRow = typeof vehicles.$inferSelect

/** Podwykonawca widzi wyłącznie własne wpisy. */
export const ownOnly = (user: UserRow) => user.role === 'Subcontractor'

export function personDto(c: Context<AppEnv>, p: PersonRow): PersonDto {
  const number = decryptField(c.get('deps').config.keyring, p.idDocNumberEnc)
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    idDocType: p.idDocType,
    idDocNumberMasked: maskDoc(number),
    company: p.company,
    subcontractorId: p.subcontractorId,
    phone: p.phone,
    roleOnSite: p.roleOnSite,
    notes: p.notes,
    party: p.party,
    version: p.version,
    canEdit: canEditAvizationRecord(c.get('user'), c.get('permissions'), p),
  }
}

export function vehicleDto(c: Context<AppEnv>, v: VehicleRow): VehicleDto {
  return {
    id: v.id,
    registrationNumber: decryptField(c.get('deps').config.keyring, v.registrationNumberEnc),
    makeModel: v.makeModel,
    vehicleType: v.vehicleType,
    company: v.company,
    defaultDriverId: v.defaultDriverId,
    party: v.party,
    version: v.version,
    canEdit: canEditAvizationRecord(c.get('user'), c.get('permissions'), v),
  }
}

const hmac = (c: Context<AppEnv>, v: string) => hmacField(c.get('deps').config.hmacKey, normalizeId(v))

function encDoc(c: Context<AppEnv>, number: string) {
  const enc = encryptField(c.get('deps').config.keyring, number.trim())
  return { idDocNumberEnc: enc, idDocKeyId: keyIdOf(enc), idDocNumberHmac: hmac(c, number) }
}
function encReg(c: Context<AppEnv>, reg: string) {
  const enc = encryptField(c.get('deps').config.keyring, reg.trim().toUpperCase())
  return { registrationNumberEnc: enc, keyId: keyIdOf(enc), registrationNumberHmac: hmac(c, reg) }
}

async function listPersons(c: Context<AppEnv>, projectId: string) {
  const user = c.get('user')
  return c.get('deps').db
    .select()
    .from(persons)
    .where(and(eq(persons.projectId, projectId), isNull(persons.deletedAt), ownOnly(user) ? eq(persons.party, user.party) : undefined))
    .orderBy(asc(persons.lastName), asc(persons.firstName))
}

async function findPerson(c: Context<AppEnv>, projectId: string, id: string) {
  const user = c.get('user')
  const [p] = await c.get('deps').db
    .select()
    .from(persons)
    .where(and(eq(persons.id, id), eq(persons.projectId, projectId), isNull(persons.deletedAt), ownOnly(user) ? eq(persons.party, user.party) : undefined))
  if (!p) throw notFound()
  return p
}

async function findVehicle(c: Context<AppEnv>, projectId: string, id: string) {
  const user = c.get('user')
  const [v] = await c.get('deps').db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, id), eq(vehicles.projectId, projectId), isNull(vehicles.deletedAt), ownOnly(user) ? eq(vehicles.party, user.party) : undefined))
  if (!v) throw notFound()
  return v
}

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.code === '23505' || err?.cause?.code === '23505'
}

// ---------- osoby ----------
peopleRouter.openapi(route({ method: 'get', path: `${P}/persons`, request: { params: projectParam }, responses: ok }, 'avizations', 'view'), async (c) => {
  const { projectId } = c.req.valid('param')
  await getProject(c.get('deps').db, projectId)
  return c.json((await listPersons(c, projectId)).map((p) => personDto(c, p)), 200)
})

peopleRouter.openapi(
  route({ method: 'post', path: `${P}/persons`, request: { params: projectParam, body: body(personInput) }, responses: created }, 'avizations', 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { idDocNumber, ...input } = c.req.valid('json')
    const user = c.get('user')
    const deps = c.get('deps')
    await getProject(deps.db, projectId)
    try {
      const row = await deps.db.transaction(async (tx) => {
        const [r] = await tx.insert(persons).values({ ...input, ...encDoc(c, idDocNumber), projectId, party: defaultPartyFor(user), createdBy: user.id, updatedBy: user.id }).returning()
        // Audit bez numeru dokumentu (dane osobowe) — tylko fakt utworzenia.
        await writeAudit(c, { action: 'persons.create', entity: 'persons', entityId: r!.id, projectId, changes: { name: `${input.firstName} ${input.lastName}`, company: input.company } }, tx)
        return r!
      })
      return c.json(personDto(c, row), 201)
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpProblem(409, 'person_doc_exists')
      throw e
    }
  },
)

peopleRouter.openapi(
  route({ method: 'patch', path: `${P}/persons/{id}`, request: { params: idParam, body: body(personPatch) }, responses: ok }, 'avizations', 'edit'),
  async (c) => {
    const { projectId, id } = c.req.valid('param')
    const { version, idDocNumber, ...patch } = c.req.valid('json')
    const deps = c.get('deps')
    const current = await findPerson(c, projectId, id)
    if (!canEditAvizationRecord(c.get('user'), c.get('permissions'), current)) throw forbidden('not_own_record')
    if (current.version !== version) throw conflict(personDto(c, current))
    try {
      const row = await deps.db.transaction(async (tx) => {
        const [r] = await tx
          .update(persons)
          .set({ ...patch, ...(idDocNumber ? encDoc(c, idDocNumber) : {}), version: sql`${persons.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
          .where(and(eq(persons.id, id), eq(persons.version, version)))
          .returning()
        if (r) await writeAudit(c, { action: 'persons.update', entity: 'persons', entityId: id, projectId, changes: { ...diffFields(current, patch), ...(idDocNumber ? { idDocNumber: { old: '***', new: '***' } } : {}) } }, tx)
        return r
      })
      if (!row) throw conflict(null)
      return c.json(personDto(c, row), 200)
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpProblem(409, 'person_doc_exists')
      throw e
    }
  },
)

peopleRouter.openapi(route({ method: 'delete', path: `${P}/persons/{id}`, request: { params: idParam }, responses: ok }, 'avizations', 'delete'), async (c) => {
  const { projectId, id } = c.req.valid('param')
  await findPerson(c, projectId, id)
  await c.get('deps').db.transaction(async (tx) => {
    await tx.update(persons).set({ deletedAt: sql`now()`, deletedBy: c.get('user').id }).where(eq(persons.id, id))
    await writeAudit(c, { action: 'persons.delete', entity: 'persons', entityId: id, projectId }, tx)
  })
  return c.json({ ok: true }, 200)
})

/** Pełny numer dokumentu — każdy odczyt w audit log (spec. M5). */
peopleRouter.openapi(route({ method: 'get', path: `${P}/persons/{id}/document`, request: { params: idParam }, responses: ok }, 'avizations', 'export'), async (c) => {
  const { projectId, id } = c.req.valid('param')
  const p = await findPerson(c, projectId, id)
  await writeAudit(c, { action: 'persons.decrypt_read', entity: 'persons', entityId: id, projectId, changes: { field: 'idDocNumber' } })
  return c.json({ idDocNumber: decryptField(c.get('deps').config.keyring, p.idDocNumberEnc) }, 200)
})

// ---------- pojazdy ----------
peopleRouter.openapi(
  route({ method: 'get', path: `${P}/vehicles`, request: { params: projectParam, query: z.object({ registration: z.string().trim().min(2).max(20).optional() }) }, responses: ok }, 'avizations', 'view'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { registration } = c.req.valid('query')
    const user = c.get('user')
    await getProject(c.get('deps').db, projectId)
    const rows = await c.get('deps').db
      .select()
      .from(vehicles)
      .where(
        and(
          eq(vehicles.projectId, projectId),
          isNull(vehicles.deletedAt),
          ownOnly(user) ? eq(vehicles.party, user.party) : undefined,
          // Wyszukiwanie po numerze rejestracyjnym przez HMAC (bez odszyfrowania bazy).
          registration ? eq(vehicles.registrationNumberHmac, hmac(c, registration)) : undefined,
        ),
      )
      .orderBy(asc(vehicles.company))
    await writeAudit(c, { action: 'vehicles.decrypt_read', entity: 'vehicles', projectId, changes: { field: 'registrationNumber', rows: rows.length } })
    return c.json(rows.map((v) => vehicleDto(c, v)), 200)
  },
)

peopleRouter.openapi(
  route({ method: 'post', path: `${P}/vehicles`, request: { params: projectParam, body: body(vehicleInput) }, responses: created }, 'avizations', 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { registrationNumber, ...input } = c.req.valid('json')
    const user = c.get('user')
    const deps = c.get('deps')
    await getProject(deps.db, projectId)
    if (input.defaultDriverId) await findPerson(c, projectId, input.defaultDriverId)
    try {
      const row = await deps.db.transaction(async (tx) => {
        const [r] = await tx.insert(vehicles).values({ ...input, ...encReg(c, registrationNumber), projectId, party: defaultPartyFor(user), createdBy: user.id, updatedBy: user.id }).returning()
        await writeAudit(c, { action: 'vehicles.create', entity: 'vehicles', entityId: r!.id, projectId, changes: { makeModel: input.makeModel, company: input.company } }, tx)
        return r!
      })
      return c.json(vehicleDto(c, row), 201)
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpProblem(409, 'vehicle_exists')
      throw e
    }
  },
)

peopleRouter.openapi(
  route({ method: 'patch', path: `${P}/vehicles/{id}`, request: { params: idParam, body: body(vehiclePatch) }, responses: ok }, 'avizations', 'edit'),
  async (c) => {
    const { projectId, id } = c.req.valid('param')
    const { version, registrationNumber, ...patch } = c.req.valid('json')
    const current = await findVehicle(c, projectId, id)
    if (!canEditAvizationRecord(c.get('user'), c.get('permissions'), current)) throw forbidden('not_own_record')
    if (current.version !== version) throw conflict(vehicleDto(c, current))
    if (patch.defaultDriverId) await findPerson(c, projectId, patch.defaultDriverId)
    try {
      const row = await c.get('deps').db.transaction(async (tx) => {
        const [r] = await tx
          .update(vehicles)
          .set({ ...patch, ...(registrationNumber ? encReg(c, registrationNumber) : {}), version: sql`${vehicles.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
          .where(and(eq(vehicles.id, id), eq(vehicles.version, version)))
          .returning()
        if (r) await writeAudit(c, { action: 'vehicles.update', entity: 'vehicles', entityId: id, projectId, changes: { ...diffFields(current, patch), ...(registrationNumber ? { registrationNumber: { old: '***', new: '***' } } : {}) } }, tx)
        return r
      })
      if (!row) throw conflict(null)
      return c.json(vehicleDto(c, row), 200)
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpProblem(409, 'vehicle_exists')
      throw e
    }
  },
)

peopleRouter.openapi(route({ method: 'delete', path: `${P}/vehicles/{id}`, request: { params: idParam }, responses: ok }, 'avizations', 'delete'), async (c) => {
  const { projectId, id } = c.req.valid('param')
  await findVehicle(c, projectId, id)
  await c.get('deps').db.transaction(async (tx) => {
    await tx.update(vehicles).set({ deletedAt: sql`now()`, deletedBy: c.get('user').id }).where(eq(vehicles.id, id))
    await writeAudit(c, { action: 'vehicles.delete', entity: 'vehicles', entityId: id, projectId }, tx)
  })
  return c.json({ ok: true }, 200)
})

// ---------- import listy osób i pojazdów (format listy ochrony) ----------
const NAME_HDR = /nazwisko|imi[eę]/i
const VEHICLE_HDR = /rejestr|auto|pojazd/i
const COMPANY_HDR = /firma/i

peopleRouter.openapi(
  route({ method: 'post', path: `${P}/people/import/preview`, request: { params: projectParam, body: { content: { 'multipart/form-data': { schema: z.any() } }, required: true as const } }, responses: ok }, 'avizations', 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const form = await c.req.parseBody()
    const file = form.file
    if (!(file instanceof File)) throw new HttpProblem(422, 'import_file_missing')
    if (file.size > MAX_IMPORT_BYTES) throw new HttpProblem(422, 'import_file_too_large')
    let wb
    try {
      wb = await loadWorkbook(await file.arrayBuffer())
    } catch {
      throw new HttpProblem(422, 'import_file_invalid')
    }
    const ws = wb.worksheets.find((w) => w.state === 'visible')
    if (!ws) throw new HttpProblem(422, 'import_file_invalid')
    let header = 0
    const cols = { name: 0, vehicle: 0, company: 0 }
    for (let r = 1; r <= Math.min(ws.rowCount, 20) && !header; r++) {
      const row = ws.getRow(r)
      for (let i = 1; i <= Math.min(ws.columnCount, 20); i++) {
        const t = cellText(row.getCell(i))
        if (!cols.name && NAME_HDR.test(t)) cols.name = i
        else if (!cols.vehicle && VEHICLE_HDR.test(t)) cols.vehicle = i
        else if (!cols.company && COMPANY_HDR.test(t)) cols.company = i
      }
      if (cols.name) header = r
    }
    if (!header) throw new HttpProblem(422, 'people_import_header_missing')
    const raw: { row: number; nameDoc: string; vehicle: string; company: string }[] = []
    for (let r = header + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      raw.push({
        row: r,
        nameDoc: cellText(row.getCell(cols.name)),
        vehicle: cols.vehicle ? cellText(row.getCell(cols.vehicle)) : '',
        company: cols.company ? cellText(row.getCell(cols.company)) : '',
      })
    }
    const existing = await listPersons(c, projectId)
    const rows = parsePeopleRows(raw, new Set(existing.map((p) => p.idDocNumberHmac)), (v) => hmacField(c.get('deps').config.hmacKey, v))
    return c.json({ rows }, 200)
  },
)

const importCommit = z.object({
  rows: z
    .array(
      personInput.pick({ firstName: true, lastName: true, idDocType: true, idDocNumber: true, company: true }).extend({
        vehicle: z.object({ makeModel: z.string().trim().max(100).nullable(), registrationNumber: z.string().trim().min(2).max(20) }).nullable(),
      }),
    )
    .min(1)
    .max(500),
})

peopleRouter.openapi(
  route({ method: 'post', path: `${P}/people/import/commit`, request: { params: projectParam, body: body(importCommit) }, responses: ok }, 'avizations', 'create'),
  async (c) => {
    const { projectId } = c.req.valid('param')
    const { rows } = c.req.valid('json')
    const user = c.get('user')
    const deps = c.get('deps')
    await getProject(deps.db, projectId)
    const party = defaultPartyFor(user)
    const existingP = new Set((await deps.db.select({ h: persons.idDocNumberHmac }).from(persons).where(and(eq(persons.projectId, projectId), isNull(persons.deletedAt)))).map((r) => r.h))
    const existingV = new Set((await deps.db.select({ h: vehicles.registrationNumberHmac }).from(vehicles).where(and(eq(vehicles.projectId, projectId), isNull(vehicles.deletedAt)))).map((r) => r.h))
    const result = await deps.db.transaction(async (tx) => {
      let personsCreated = 0
      let vehiclesCreated = 0
      let skipped = 0
      for (const r of rows) {
        const doc = encDoc(c, r.idDocNumber)
        if (existingP.has(doc.idDocNumberHmac)) {
          skipped++
          continue
        }
        existingP.add(doc.idDocNumberHmac)
        const [p] = await tx
          .insert(persons)
          .values({ projectId, firstName: r.firstName, lastName: r.lastName, idDocType: r.idDocType, company: r.company, ...doc, party, createdBy: user.id, updatedBy: user.id })
          .returning({ id: persons.id })
        personsCreated++
        if (r.vehicle) {
          const reg = encReg(c, r.vehicle.registrationNumber)
          if (!existingV.has(reg.registrationNumberHmac)) {
            existingV.add(reg.registrationNumberHmac)
            await tx.insert(vehicles).values({ projectId, makeModel: r.vehicle.makeModel, company: r.company, ...reg, defaultDriverId: p!.id, party, createdBy: user.id, updatedBy: user.id })
            vehiclesCreated++
          }
        }
      }
      await writeAudit(c, { action: 'people.import', entity: 'persons', projectId, changes: { personsCreated, vehiclesCreated, skipped } }, tx)
      return { personsCreated, vehiclesCreated, skipped }
    })
    return c.json(result, 200)
  },
)
