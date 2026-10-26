import { z } from '@hono/zod-openapi'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { projectInput, projectPatch, type ProjectAdminDto } from '#shared'
import type { Database } from '../../db/client.ts'
import { opportunities, projects } from '../../db/schema.ts'
import { HttpProblem, conflict, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { diffFields, writeAudit } from '../audit/service.ts'

export const adminProjectsRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const view = { permission: { module: 'admin' as const, action: 'view' as const } }
const edit = { permission: { module: 'admin' as const, action: 'edit' as const } }

/** Wszystkie projekty, także zarchiwizowane (archiwum = `deleted_at`: znikają z menu i list wyboru, dane zostają). */
async function listProjects(db: Database, id?: string): Promise<ProjectAdminDto[]> {
  const rows = await db
    .select({ p: projects, opportunityCode: opportunities.code })
    .from(projects)
    .leftJoin(opportunities, and(eq(opportunities.projectId, projects.id), isNull(opportunities.deletedAt)))
    .where(id ? eq(projects.id, id) : undefined)
    .orderBy(sql`${projects.deletedAt} IS NOT NULL`, asc(projects.code))
  // Projekt z kilkoma szansami (rzadkie) — jeden wiersz.
  const unique = [...new Map(rows.map((r) => [r.p.id, r])).values()]
  return unique.map(({ p, opportunityCode }) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client,
    contractNo: p.contractNo,
    procurementNo: p.procurementNo,
    contractValue: p.contractValue == null ? null : Number(p.contractValue),
    contractEndDate: p.contractEndDate,
    opportunityCode,
    archived: p.deletedAt != null,
    archivedAt: p.deletedAt,
    version: p.version,
  }))
}

async function one(db: Database, id: string) {
  const [dto] = await listProjects(db, id)
  if (!dto) throw notFound()
  return dto
}

adminProjectsRouter.openapi(secureRoute('', { method: 'get', path: '/admin/projects', responses: ok }, view), async (c) => c.json(await listProjects(c.get('deps').db), 200))

adminProjectsRouter.openapi(
  secureRoute('', { method: 'post', path: '/admin/projects', request: { body: body(projectInput) }, responses: { 201: { description: 'Utworzono', ...json(z.any()) } } }, edit),
  async (c) => {
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const user = c.get('user')
    // Unikalność bez względu na wielkość liter, także wśród zarchiwizowanych (adresy i historia).
    const [dup] = await deps.db.select({ id: projects.id }).from(projects).where(sql`lower(${projects.code}) = lower(${input.code})`)
    if (dup) throw new HttpProblem(409, 'project_code_exists', input.code)
    const id = await deps.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({ ...input, contractValue: input.contractValue != null ? String(input.contractValue) : null, createdBy: user.id, updatedBy: user.id })
        .returning({ id: projects.id })
      await writeAudit(c, { action: 'project.create', entity: 'projects', entityId: p!.id, projectId: p!.id, changes: input }, tx)
      return p!.id
    })
    return c.json(await one(deps.db, id), 201)
  },
)

adminProjectsRouter.openapi(
  secureRoute('', { method: 'patch', path: '/admin/projects/{id}', request: { params: idParam, body: body(projectPatch) }, responses: ok }, edit),
  async (c) => {
    const { id } = c.req.valid('param')
    const { version, contractValue, ...rest } = c.req.valid('json')
    const deps = c.get('deps')
    const [cur] = await deps.db.select().from(projects).where(eq(projects.id, id))
    if (!cur) throw notFound()
    const patch = { ...rest, ...(contractValue !== undefined ? { contractValue: contractValue == null ? null : String(contractValue) } : {}) }
    const updated = await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(projects)
        .set({ ...patch, version: sql`${projects.version} + 1`, updatedAt: sql`now()`, updatedBy: c.get('user').id })
        .where(and(eq(projects.id, id), eq(projects.version, version)))
        .returning({ id: projects.id })
      if (r) await writeAudit(c, { action: 'project.update', entity: 'projects', entityId: id, projectId: id, changes: diffFields(cur, patch) }, tx)
      return r
    })
    if (!updated) throw conflict(await one(deps.db, id))
    return c.json(await one(deps.db, id), 200)
  },
)

for (const [path, archive] of [
  ['/admin/projects/{id}/archive', true],
  ['/admin/projects/{id}/restore', false],
] as const) {
  adminProjectsRouter.openapi(secureRoute('', { method: 'post', path, request: { params: idParam }, responses: ok }, edit), async (c) => {
    const { id } = c.req.valid('param')
    const deps = c.get('deps')
    const user = c.get('user')
    await deps.db.transaction(async (tx) => {
      const [r] = await tx
        .update(projects)
        .set(archive ? { deletedAt: sql`now()`, deletedBy: user.id, version: sql`${projects.version} + 1` } : { deletedAt: null, deletedBy: null, version: sql`${projects.version} + 1` })
        .where(and(eq(projects.id, id), archive ? isNull(projects.deletedAt) : isNotNull(projects.deletedAt)))
        .returning({ code: projects.code })
      if (!r) throw notFound()
      await writeAudit(c, { action: archive ? 'project.archive' : 'project.restore', entity: 'projects', entityId: id, projectId: id, changes: { code: r.code } }, tx)
    })
    return c.json(await one(deps.db, id), 200)
  })
}
