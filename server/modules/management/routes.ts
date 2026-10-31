import { z, type RouteConfig } from '@hono/zod-openapi'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  STAFF_ROLES,
  birthDateFromPesel,
  employeeInput,
  employeePatch,
  fleetVehicleInput,
  fleetVehiclePatch,
  managementSettingsInput,
  type Action,
  type EmployeeDto,
  type FleetVehicleDto,
  type ManagementUserOption,
  type ModuleKey,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import { appSettings, employeeQualifications, employees, fleetInspections, fleetInsurances, fleetVehicles, users } from '../../db/schema.ts'
import { MANAGEMENT_SETTING_KEY, managementSettings } from '../../auth/access.ts'
import { decryptField, encryptField } from '../../lib/field-crypto.ts'
import { HttpProblem, conflict, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'

/** Zarząd Envcheck: ewidencja pojazdów (`fleet`) i pracownicy (`employees`). */
export const managementRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const created = { 201: { description: 'Utworzono', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.code === '23505' || err?.cause?.code === '23505'
}
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`
const maskPesel = (v: string) => `•••••••${v.slice(-4)}`

// ---------------- Pojazdy ----------------

async function listVehicles(db: Database, id?: string): Promise<FleetVehicleDto[]> {
  const rows = await db
    .select({ v: fleetVehicles, e: { firstName: employees.firstName, lastName: employees.lastName } })
    .from(fleetVehicles)
    .leftJoin(employees, eq(employees.id, fleetVehicles.assignedEmployeeId))
    .where(and(isNull(fleetVehicles.deletedAt), id ? eq(fleetVehicles.id, id) : undefined))
    .orderBy(asc(fleetVehicles.registrationNumber))
  const ids = rows.map((r) => r.v.id)
  const [ins, insp] = ids.length
    ? await Promise.all([
        db.select().from(fleetInsurances).where(inArray(fleetInsurances.vehicleId, ids)).orderBy(asc(fleetInsurances.position)),
        db.select().from(fleetInspections).where(inArray(fleetInspections.vehicleId, ids)).orderBy(asc(fleetInspections.position)),
      ])
    : [[], []]
  return rows.map(({ v, e }) => ({
    id: v.id,
    registrationNumber: v.registrationNumber,
    make: v.make,
    model: v.model,
    kind: v.kind as FleetVehicleDto['kind'],
    vin: v.vin,
    productionYear: v.productionYear,
    ownership: v.ownership as FleetVehicleDto['ownership'],
    financingCompany: v.financingCompany,
    financingEndDate: v.financingEndDate,
    assignedEmployeeId: v.assignedEmployeeId,
    assignedEmployeeName: e?.firstName ? fullName(e as { firstName: string; lastName: string }) : null,
    isActive: v.isActive,
    notes: v.notes,
    insurances: ins
      .filter((i) => i.vehicleId === v.id)
      .map((i) => ({ type: i.type as FleetVehicleDto['insurances'][number]['type'], insurer: i.insurer, policyNumber: i.policyNumber, validFrom: i.validFrom, validTo: i.validTo, policyUrl: i.policyUrl, notes: i.notes })),
    inspections: insp
      .filter((i) => i.vehicleId === v.id)
      .map((i) => ({ kind: i.kind as FleetVehicleDto['inspections'][number]['kind'], performedDate: i.performedDate, validUntil: i.validUntil, documentUrl: i.documentUrl, notes: i.notes })),
    version: v.version,
  }))
}

type VehicleChildren = Pick<FleetVehicleDto, 'insurances' | 'inspections'>

/** Zapis zastępuje całą listę polis / przeglądów pojazdu. */
async function replaceVehicleChildren(tx: Database, vehicleId: string, data: Partial<VehicleChildren>) {
  if (data.insurances) {
    await tx.delete(fleetInsurances).where(eq(fleetInsurances.vehicleId, vehicleId))
    if (data.insurances.length) await tx.insert(fleetInsurances).values(data.insurances.map((i, position) => ({ ...i, vehicleId, position })))
  }
  if (data.inspections) {
    await tx.delete(fleetInspections).where(eq(fleetInspections.vehicleId, vehicleId))
    if (data.inspections.length) await tx.insert(fleetInspections).values(data.inspections.map((i, position) => ({ ...i, vehicleId, position })))
  }
}

async function assertEmployee(db: Database, id: string | null | undefined) {
  if (!id) return
  const [e] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt)))
  if (!e) throw new HttpProblem(422, 'employee_not_found')
}

async function oneVehicle(db: Database, id: string) {
  const [dto] = await listVehicles(db, id)
  if (!dto) throw notFound()
  return dto
}

managementRouter.openapi(route({ method: 'get', path: '/fleet', responses: ok }, 'fleet', 'view'), async (c) => c.json(await listVehicles(c.get('deps').db), 200))

/** Lista pracowników do przypisania pojazdu (bez danych osobowych). */
managementRouter.openapi(route({ method: 'get', path: '/fleet/employee-options', responses: ok }, 'fleet', 'view'), async (c) => {
  const rows = await c.get('deps').db
    .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(and(isNull(employees.deletedAt), eq(employees.isActive, true)))
    .orderBy(asc(employees.lastName), asc(employees.firstName))
  return c.json(rows.map((r) => ({ id: r.id, name: fullName(r) })) satisfies ManagementUserOption[], 200)
})

managementRouter.openapi(route({ method: 'post', path: '/fleet', request: { body: body(fleetVehicleInput) }, responses: created }, 'fleet', 'create'), async (c) => {
  const { insurances, inspections, ...input } = c.req.valid('json')
  const db = c.get('deps').db
  const me = c.get('user').id
  await assertEmployee(db, input.assignedEmployeeId)
  try {
    const id = await db.transaction(async (tx) => {
      const [r] = await tx.insert(fleetVehicles).values({ ...input, registrationNumber: input.registrationNumber.toUpperCase(), createdBy: me, updatedBy: me }).returning({ id: fleetVehicles.id })
      await replaceVehicleChildren(tx, r!.id, { insurances, inspections })
      await writeAudit(c, { action: 'fleet.create', entity: 'fleet_vehicles', entityId: r!.id, changes: { ...input, insurances: insurances.length, inspections: inspections.length } }, tx)
      return r!.id
    })
    return c.json(await oneVehicle(db, id), 201)
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpProblem(409, 'vehicle_registration_exists')
    throw e
  }
})

managementRouter.openapi(
  route({ method: 'patch', path: '/fleet/{id}', request: { params: idParam, body: body(fleetVehiclePatch) }, responses: ok }, 'fleet', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { version, insurances, inspections, ...patch } = c.req.valid('json')
    const db = c.get('deps').db
    const [current] = await db.select().from(fleetVehicles).where(and(eq(fleetVehicles.id, id), isNull(fleetVehicles.deletedAt)))
    if (!current) throw notFound()
    if (current.version !== version) throw conflict(await oneVehicle(db, id))
    await assertEmployee(db, patch.assignedEmployeeId)
    if (patch.registrationNumber) patch.registrationNumber = patch.registrationNumber.toUpperCase()
    try {
      const updated = await db.transaction(async (tx) => {
        const [r] = await tx
          .update(fleetVehicles)
          .set({ ...patch, version: sql`${fleetVehicles.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
          .where(and(eq(fleetVehicles.id, id), eq(fleetVehicles.version, version)))
          .returning({ id: fleetVehicles.id })
        if (!r) return false
        await replaceVehicleChildren(tx, id, { insurances, inspections })
        const changes = { ...diffFields(current, patch), ...(insurances ? { insurances: insurances.length } : {}), ...(inspections ? { inspections: inspections.length } : {}) }
        await writeAudit(c, { action: 'fleet.update', entity: 'fleet_vehicles', entityId: id, changes }, tx)
        return true
      })
      const dto = await oneVehicle(db, id)
      if (!updated) throw conflict(dto)
      return c.json(dto, 200)
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpProblem(409, 'vehicle_registration_exists')
      throw e
    }
  },
)

managementRouter.openapi(route({ method: 'delete', path: '/fleet/{id}', request: { params: idParam }, responses: ok }, 'fleet', 'delete'), async (c) => {
  const { id } = c.req.valid('param')
  await c.get('deps').db.transaction(async (tx) => {
    const [r] = await tx
      .update(fleetVehicles)
      .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
      .where(and(eq(fleetVehicles.id, id), isNull(fleetVehicles.deletedAt)))
      .returning({ registrationNumber: fleetVehicles.registrationNumber })
    if (!r) throw notFound()
    await writeAudit(c, { action: 'fleet.delete', entity: 'fleet_vehicles', entityId: id, changes: r }, tx)
  })
  return c.json({ ok: true }, 200)
})

// ---------------- Pracownicy ----------------

async function listEmployees(c: Context<AppEnv>, id?: string): Promise<EmployeeDto[]> {
  const db = c.get('deps').db
  const keyring = c.get('deps').config.keyring
  const rows = await db
    .select({ e: employees, userName: users.name })
    .from(employees)
    .leftJoin(users, eq(users.id, employees.userId))
    .where(and(isNull(employees.deletedAt), id ? eq(employees.id, id) : undefined))
    .orderBy(asc(employees.lastName), asc(employees.firstName))
  const ids = rows.map((r) => r.e.id)
  const quals = ids.length ? await db.select().from(employeeQualifications).where(inArray(employeeQualifications.employeeId, ids)).orderBy(asc(employeeQualifications.position)) : []
  return rows.map(({ e, userName }) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    position: e.position,
    email: e.email,
    phone: e.phone,
    birthDate: e.birthDate,
    peselMasked: e.peselEnc ? maskPesel(decryptField(keyring, e.peselEnc)) : null,
    address: e.address,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    contractType: e.contractType as EmployeeDto['contractType'],
    contractStart: e.contractStart,
    contractEnd: e.contractEnd,
    medicalExamValidUntil: e.medicalExamValidUntil,
    bhpTrainingValidUntil: e.bhpTrainingValidUntil,
    userId: e.userId,
    userName,
    isActive: e.isActive,
    notes: e.notes,
    qualifications: quals.filter((q) => q.employeeId === e.id).map((q) => ({ name: q.name, number: q.number, validUntil: q.validUntil, documentUrl: q.documentUrl, notes: q.notes })),
    version: e.version,
  }))
}

async function oneEmployee(c: Context<AppEnv>, id: string) {
  const [dto] = await listEmployees(c, id)
  if (!dto) throw notFound()
  return dto
}

async function replaceQualifications(tx: Database, employeeId: string, list: EmployeeDto['qualifications'] | undefined) {
  if (!list) return
  await tx.delete(employeeQualifications).where(eq(employeeQualifications.employeeId, employeeId))
  if (list.length) await tx.insert(employeeQualifications).values(list.map((q, position) => ({ ...q, employeeId, position })))
}

/** PESEL → szyfrogram (+ data urodzenia, jeśli nie podano); `undefined` — bez zmian. */
function peselFields(c: Context<AppEnv>, pesel: string | null | undefined, birthDate: string | null | undefined) {
  if (pesel === undefined) return {}
  if (pesel === null) return { peselEnc: null }
  return { peselEnc: encryptField(c.get('deps').config.keyring, pesel), ...(birthDate ? {} : { birthDate: birthDateFromPesel(pesel) }) }
}

async function assertUser(db: Database, id: string | null | undefined) {
  if (!id) return
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), inArray(users.role, [...STAFF_ROLES]), isNull(users.deletedAt)))
  if (!u) throw new HttpProblem(422, 'user_not_staff')
}

managementRouter.openapi(route({ method: 'get', path: '/employees', responses: ok }, 'employees', 'view'), async (c) => c.json(await listEmployees(c), 200))

/** Konta pracowników Envcheck — do połączenia pracownika z kontem w aplikacji. */
managementRouter.openapi(route({ method: 'get', path: '/employees/user-options', responses: ok }, 'employees', 'view'), async (c) => {
  const rows: ManagementUserOption[] = await c.get('deps').db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.role, [...STAFF_ROLES]), isNull(users.deletedAt)))
    .orderBy(asc(users.name))
  return c.json(rows, 200)
})

/** Pełny PESEL — tylko na żądanie, każdy odczyt w audit logu. */
managementRouter.openapi(route({ method: 'get', path: '/employees/{id}/pesel', request: { params: idParam }, responses: ok }, 'employees', 'view'), async (c) => {
  const { id } = c.req.valid('param')
  const [e] = await c.get('deps').db.select({ peselEnc: employees.peselEnc }).from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt)))
  if (!e) throw notFound()
  await writeAudit(c, { action: 'employees.view_pesel', entity: 'employees', entityId: id })
  return c.json({ pesel: e.peselEnc ? decryptField(c.get('deps').config.keyring, e.peselEnc) : null }, 200)
})

managementRouter.openapi(route({ method: 'post', path: '/employees', request: { body: body(employeeInput) }, responses: created }, 'employees', 'create'), async (c) => {
  const { qualifications, pesel, ...input } = c.req.valid('json')
  const db = c.get('deps').db
  const me = c.get('user').id
  await assertUser(db, input.userId)
  const id = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(employees)
      .values({ ...input, ...peselFields(c, pesel, input.birthDate), createdBy: me, updatedBy: me })
      .returning({ id: employees.id })
    await replaceQualifications(tx, r!.id, qualifications)
    // Audit bez danych osobowych — tylko fakt utworzenia.
    await writeAudit(c, { action: 'employees.create', entity: 'employees', entityId: r!.id, changes: { name: fullName(input) } }, tx)
    return r!.id
  })
  return c.json(await oneEmployee(c, id), 201)
})

/** Pola, których wartości nie trafiają do audit logu (tylko informacja o zmianie). */
const PERSONAL = ['birthDate', 'peselEnc', 'address', 'phone', 'email', 'emergencyContactName', 'emergencyContactPhone'] as const

managementRouter.openapi(
  route({ method: 'patch', path: '/employees/{id}', request: { params: idParam, body: body(employeePatch) }, responses: ok }, 'employees', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { version, qualifications, pesel, ...patch } = c.req.valid('json')
    const db = c.get('deps').db
    const [current] = await db.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt)))
    if (!current) throw notFound()
    if (current.version !== version) throw conflict(await oneEmployee(c, id))
    await assertUser(db, patch.userId)
    const values = { ...patch, ...peselFields(c, pesel, patch.birthDate ?? current.birthDate) }
    const updated = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(employees)
        .set({ ...values, version: sql`${employees.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
        .where(and(eq(employees.id, id), eq(employees.version, version)))
        .returning({ id: employees.id })
      if (!r) return false
      await replaceQualifications(tx, id, qualifications)
      const changes = { ...diffFields(current, values, PERSONAL), ...(qualifications ? { qualifications: qualifications.length } : {}) }
      await writeAudit(c, { action: 'employees.update', entity: 'employees', entityId: id, changes }, tx)
      return true
    })
    const dto = await oneEmployee(c, id)
    if (!updated) throw conflict(dto)
    return c.json(dto, 200)
  },
)

managementRouter.openapi(route({ method: 'delete', path: '/employees/{id}', request: { params: idParam }, responses: ok }, 'employees', 'delete'), async (c) => {
  const { id } = c.req.valid('param')
  await c.get('deps').db.transaction(async (tx) => {
    const [r] = await tx
      .update(employees)
      .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
      .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
      .returning({ firstName: employees.firstName, lastName: employees.lastName })
    if (!r) throw notFound()
    // Pojazd nie może wskazywać usuniętego pracownika.
    await tx.update(fleetVehicles).set({ assignedEmployeeId: null }).where(eq(fleetVehicles.assignedEmployeeId, id))
    await writeAudit(c, { action: 'employees.delete', entity: 'employees', entityId: id, changes: { name: fullName(r) } }, tx)
  })
  return c.json({ ok: true }, 200)
})

// ---------------- Ustawienia (Admin): kto ma dostęp ----------------

managementRouter.openapi(
  secureRoute('', { method: 'get', path: '/admin/settings/management', responses: ok }, { permission: { module: 'admin', action: 'view' } }),
  async (c) => {
    const db = c.get('deps').db
    const staff: ManagementUserOption[] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.isActive, true), isNull(users.deletedAt)))
      .orderBy(asc(users.name))
    return c.json({ settings: await managementSettings(db), users: staff }, 200)
  },
)

managementRouter.openapi(
  secureRoute('', { method: 'put', path: '/admin/settings/management', request: { body: body(managementSettingsInput) }, responses: ok }, { permission: { module: 'admin', action: 'edit' } }),
  async (c) => {
    const value = c.req.valid('json')
    const db = c.get('deps').db
    if (value.userIds.length) {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, value.userIds), inArray(users.role, [...STAFF_ROLES]), isNull(users.deletedAt)))
      if (found.length !== new Set(value.userIds).size) throw new HttpProblem(422, 'user_not_staff')
    }
    const before = await managementSettings(db)
    const me = c.get('user').id
    await db.transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: MANAGEMENT_SETTING_KEY, value, updatedBy: me }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: me } })
      await writeAudit(c, { action: 'settings.management', entity: 'app_settings', entityId: MANAGEMENT_SETTING_KEY, changes: { old: before, new: value } }, tx)
    })
    return c.json(value, 200)
  },
)
