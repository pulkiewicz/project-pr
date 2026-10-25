import { randomBytes } from 'node:crypto'
import { z, type RouteConfig } from '@hono/zod-openapi'
import { aliasedTable, and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import {
  AI_MODEL,
  AI_READABLE_MIME,
  DIRECT_UPLOAD_MAX_BYTES,
  aiJobInput,
  aiSettingsInput,
  driveSettingsInput,
  lineCost,
  questionInput,
  questionPatch,
  textInput,
  uploadSessionInput,
  type Action,
  type AiJobDto,
  type AiStatusDto,
  type AiSuggestionDto,
  type DriveStatusDto,
  type ModuleKey,
  type QuestionDto,
  type QuoteInputDto,
} from '#shared'
import type { AppEnv } from '../../context.ts'
import type { Database } from '../../db/client.ts'
import {
  aiCalls,
  aiJobs,
  aiSuggestions,
  appSettings,
  opportunities,
  quoteDevices,
  quoteInputs,
  quoteLines,
  quoteQuestions,
  quoteSections,
  quotes,
  users,
} from '../../db/schema.ts'
import type { DriveClient } from '../../integrations/drive/types.ts'
import { HttpProblem, forbidden, notFound } from '../../lib/problem.ts'
import { newRouter, secureRoute } from '../../routing.ts'
import { writeAudit } from '../audit/service.ts'
import { assertEditable, getQuoteRow, touch } from '../quotes/service.ts'
import { AI_SETTINGS_KEY, expireStaleJobs, loadAiSettings, sha256 } from './ops.ts'

export const aiRouter = newRouter()

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } })
const body = <T extends z.ZodType>(schema: T) => ({ ...json(schema), required: true as const })
const ok = { 200: { description: 'OK', ...json(z.any()) } }
const idParam = z.object({ id: z.uuid() })
const route = <R extends RouteConfig>(r: R, module: ModuleKey, action: Action) => secureRoute('', r, { permission: { module, action } })
const has = (c: Context<AppEnv>, p: `${ModuleKey}:${Action}`) => c.get('permissions').has(p)

export const DRIVE_SETTINGS_KEY = 'drive.config'

// ---------------- Google Drive: konfiguracja i folder szansy ----------------

async function driveConfig(db: Database) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, DRIVE_SETTINGS_KEY))
  return (row?.value ?? null) as { sharedDriveId: string; driveName: string } | null
}

function requireDrive(c: Context<AppEnv>): DriveClient {
  const d = c.get('deps').drive
  if (!d) throw new HttpProblem(503, 'drive_unavailable')
  return d
}

/** Folder szansy na Shared Drive („OF038 — nazwa”); tworzony przy pierwszej potrzebie (C4). */
export async function ensureOpportunityFolder(db: Database, drive: DriveClient, opportunityId: string): Promise<string> {
  const [o] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId))
  if (!o) throw notFound()
  if (o.driveFolderId) return o.driveFolderId
  const cfg = await driveConfig(db)
  if (!cfg) throw new HttpProblem(409, 'drive_not_configured')
  const folder = await drive.createFolder(cfg.sharedDriveId, `${o.code} — ${o.name}`.slice(0, 200))
  // Wyścig dwóch żądań: zostaje pierwszy zapisany folder.
  const [saved] = await db
    .update(opportunities)
    .set({ driveFolderId: folder.id })
    .where(and(eq(opportunities.id, opportunityId), isNull(opportunities.driveFolderId)))
    .returning({ id: opportunities.driveFolderId })
  if (saved?.id) return saved.id
  const [again] = await db.select({ id: opportunities.driveFolderId }).from(opportunities).where(eq(opportunities.id, opportunityId))
  return again!.id!
}

aiRouter.openapi(route({ method: 'get', path: '/drive/status', responses: ok }, 'quotes', 'view'), async (c) => {
  const deps = c.get('deps')
  const cfg = await driveConfig(deps.db)
  const status: DriveStatusDto = {
    configured: !!cfg && !!deps.drive,
    available: !!deps.drive,
    fake: deps.drive?.constructor.name === 'FakeDrive',
    sharedDriveId: cfg?.sharedDriveId ?? null,
    driveName: cfg?.driveName ?? null,
  }
  return c.json(status, 200)
})

aiRouter.openapi(route({ method: 'put', path: '/drive/settings', request: { body: body(driveSettingsInput) }, responses: ok }, 'admin', 'edit'), async (c) => {
  const { sharedDriveId } = c.req.valid('json')
  const drive = requireDrive(c)
  let driveName: string
  try {
    driveName = (await drive.getDrive(sharedDriveId)).name
  } catch (e) {
    throw new HttpProblem(422, 'drive_not_accessible', e instanceof Error ? e.message.slice(0, 300) : undefined)
  }
  const value = { sharedDriveId, driveName }
  await c
    .get('deps')
    .db.insert(appSettings)
    .values({ key: DRIVE_SETTINGS_KEY, value, updatedBy: c.get('user').id })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: c.get('user').id } })
  await writeAudit(c, { action: 'settings.drive', entity: 'app_settings', entityId: DRIVE_SETTINGS_KEY, changes: value })
  return c.json({ sharedDriveId, driveName }, 200)
})

aiRouter.openapi(route({ method: 'post', path: '/crm/opportunities/{id}/folder', request: { params: idParam }, responses: ok }, 'crm', 'edit'), async (c) => {
  const folderId = await ensureOpportunityFolder(c.get('deps').db, requireDrive(c), c.req.valid('param').id)
  return c.json({ driveFolderId: folderId }, 200)
})

// ---------------- Materiały wejściowe (krok 2) ----------------

const creators = aliasedTable(users, 'creator')

async function listInputs(db: Database, quoteId: string): Promise<QuoteInputDto[]> {
  const rows = await db
    .select({ i: quoteInputs, createdByName: creators.name })
    .from(quoteInputs)
    .leftJoin(creators, eq(creators.id, quoteInputs.createdBy))
    .where(and(eq(quoteInputs.quoteId, quoteId), isNull(quoteInputs.deletedAt)))
    .orderBy(asc(quoteInputs.createdAt))
  return rows.map(({ i, createdByName }) => ({
    id: i.id,
    kind: i.kind,
    name: i.name,
    mimeType: i.mimeType,
    size: i.size,
    driveFileId: i.driveFileId,
    webViewLink: i.driveFileId ? `https://drive.google.com/file/d/${i.driveFileId}/view` : null,
    textPreview: i.text ? i.text.slice(0, 500) : null,
    aiReadable: i.kind === 'text' || AI_READABLE_MIME.includes(i.mimeType ?? ''),
    status: i.uploadSessionHash ? 'uploading' : 'ready',
    createdAt: i.createdAt,
    createdByName,
  }))
}

async function quoteForInputs(c: Context<AppEnv>, id: string) {
  const db = c.get('deps').db
  const q = await assertEditable(db, c.get('permissions'), id)
  if (q.kind !== 'quote' || !q.opportunityId) throw new HttpProblem(422, 'not_a_quote')
  return q
}

aiRouter.openapi(route({ method: 'get', path: '/quotes/{id}/inputs', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const { id } = c.req.valid('param')
  await getQuoteRow(c.get('deps').db, id)
  return c.json(await listInputs(c.get('deps').db, id), 200)
})

aiRouter.openapi(route({ method: 'post', path: '/quotes/{id}/inputs/text', request: { params: idParam, body: body(textInput) }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const input = c.req.valid('json')
  await quoteForInputs(c, id)
  const db = c.get('deps').db
  await db.transaction(async (tx) => {
    const [r] = await tx.insert(quoteInputs).values({ quoteId: id, kind: 'text', name: input.name, mimeType: 'text/plain', size: input.text.length, text: input.text, createdBy: c.get('user').id, updatedBy: c.get('user').id }).returning({ id: quoteInputs.id })
    await touch(tx, id, c.get('user').id)
    await writeAudit(c, { action: 'quote.input_text', entity: 'quotes', entityId: id, changes: { inputId: r!.id, name: input.name } }, tx)
  })
  return c.json(await listInputs(db, id), 200)
})

/** Plik do 4 MB przez serwer (multipart, pole „file”) — wystarcza dla maili i większości SIWZ; większe przez sesję resumable. */
aiRouter.openapi(route({ method: 'post', path: '/quotes/{id}/inputs/file', request: { params: idParam }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const q = await quoteForInputs(c, id)
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw new HttpProblem(422, 'validation_failed', 'file')
  if (file.size > DIRECT_UPLOAD_MAX_BYTES) throw new HttpProblem(413, 'file_too_large_direct')
  const drive = requireDrive(c)
  const db = c.get('deps').db
  const folderId = await ensureOpportunityFolder(db, drive, q.opportunityId!)
  const item = await drive.uploadSmall({ parentId: folderId, name: file.name, mimeType: file.type || 'application/octet-stream', data: new Uint8Array(await file.arrayBuffer()) })
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(quoteInputs)
      .values({ quoteId: id, kind: 'file', name: file.name, mimeType: item.mimeType || file.type, size: file.size, driveFileId: item.id, createdBy: c.get('user').id, updatedBy: c.get('user').id })
      .returning({ id: quoteInputs.id })
    await touch(tx, id, c.get('user').id)
    await writeAudit(c, { action: 'quote.input_file', entity: 'quotes', entityId: id, changes: { inputId: r!.id, name: file.name, size: file.size, driveFileId: item.id } }, tx)
  })
  return c.json(await listInputs(db, id), 200)
})

aiRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/inputs/upload-session', request: { params: idParam, body: body(uploadSessionInput) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    const q = await quoteForInputs(c, id)
    const drive = requireDrive(c)
    const db = c.get('deps').db
    const folderId = await ensureOpportunityFolder(db, drive, q.opportunityId!)
    const origin = c.req.header('origin') ?? new URL(c.req.url).origin
    const uploadUrl = await drive.createUploadSession({ parentId: folderId, name: input.name, mimeType: input.mimeType, size: input.size, origin })
    const [r] = await db
      .insert(quoteInputs)
      .values({ quoteId: id, kind: 'file', name: input.name, mimeType: input.mimeType, size: input.size, uploadSessionHash: sha256(uploadUrl), createdBy: c.get('user').id, updatedBy: c.get('user').id })
      .returning({ id: quoteInputs.id })
    return c.json({ inputId: r!.id, uploadUrl }, 200)
  },
)

aiRouter.openapi(
  route(
    { method: 'post', path: '/quotes/{id}/inputs/{inputId}/complete', request: { params: idParam.extend({ inputId: z.uuid() }), body: body(z.object({ driveFileId: z.string().min(1).max(200) })) }, responses: ok },
    'quotes',
    'edit',
  ),
  async (c) => {
    const { id, inputId } = c.req.valid('param')
    const { driveFileId } = c.req.valid('json')
    const q = await quoteForInputs(c, id)
    const db = c.get('deps').db
    const [input] = await db.select().from(quoteInputs).where(and(eq(quoteInputs.id, inputId), eq(quoteInputs.quoteId, id), isNull(quoteInputs.deletedAt)))
    if (!input?.uploadSessionHash) throw notFound()
    // Plik musi trafić do folderu szansy i zgadzać się z zadeklarowanym rozmiarem — inaczej odrzucony.
    const [opp] = await db.select({ folder: opportunities.driveFolderId }).from(opportunities).where(eq(opportunities.id, q.opportunityId!))
    const file = await requireDrive(c).getFile(driveFileId)
    if (!opp?.folder || !file.parents.includes(opp.folder) || (file.size != null && file.size !== input.size)) throw new HttpProblem(422, 'upload_mismatch')
    await db.transaction(async (tx) => {
      await tx.update(quoteInputs).set({ driveFileId, uploadSessionHash: null, mimeType: file.mimeType || input.mimeType, updatedAt: sql`now()` }).where(eq(quoteInputs.id, inputId))
      await touch(tx, id, c.get('user').id)
      await writeAudit(c, { action: 'quote.input_file', entity: 'quotes', entityId: id, changes: { inputId, name: input.name, size: input.size, driveFileId } }, tx)
    })
    return c.json(await listInputs(db, id), 200)
  },
)

aiRouter.openapi(
  route({ method: 'delete', path: '/quotes/{id}/inputs/{inputId}', request: { params: idParam.extend({ inputId: z.uuid() }) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id, inputId } = c.req.valid('param')
    await quoteForInputs(c, id)
    const db = c.get('deps').db
    await db.transaction(async (tx) => {
      // Plik zostaje w folderze szansy na Drive — usuwamy tylko z materiałów wyceny.
      const [r] = await tx
        .update(quoteInputs)
        .set({ deletedAt: sql`now()`, deletedBy: c.get('user').id })
        .where(and(eq(quoteInputs.id, inputId), eq(quoteInputs.quoteId, id), isNull(quoteInputs.deletedAt)))
        .returning({ name: quoteInputs.name })
      if (!r) throw notFound()
      await touch(tx, id, c.get('user').id)
      await writeAudit(c, { action: 'quote.input_delete', entity: 'quotes', entityId: id, changes: { inputId, name: r.name } }, tx)
    })
    return c.json(await listInputs(db, id), 200)
  },
)

// ---------------- Zadania AI ----------------

async function listJobs(db: Database, quoteId: string): Promise<AiJobDto[]> {
  await expireStaleJobs(db, quoteId)
  const rows = await db
    .select({ j: aiJobs, createdByName: users.name, cost: sql<string | null>`(SELECT sum(${aiCalls.costUsd}) FROM ${aiCalls} WHERE ${aiCalls.jobId} = ${aiJobs.id})` })
    .from(aiJobs)
    .leftJoin(users, eq(users.id, aiJobs.createdBy))
    .where(eq(aiJobs.quoteId, quoteId))
    .orderBy(desc(aiJobs.createdAt))
    .limit(20)
  return rows.map(({ j, createdByName, cost }) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    summary: j.summary,
    error: j.error,
    costUsd: cost != null ? Number(cost) : null,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    createdByName,
  }))
}

aiRouter.openapi(route({ method: 'get', path: '/quotes/{id}/ai/jobs', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const { id } = c.req.valid('param')
  await getQuoteRow(c.get('deps').db, id)
  return c.json(await listJobs(c.get('deps').db, id), 200)
})

aiRouter.openapi(route({ method: 'post', path: '/quotes/{id}/ai/jobs', request: { params: idParam, body: body(aiJobInput) }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const input = c.req.valid('json')
  const deps = c.get('deps')
  if (!deps.ai || !deps.dispatchJob) throw new HttpProblem(503, 'ai_unavailable')
  const q = await assertEditable(deps.db, c.get('permissions'), id)
  if (q.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
  // Propozycje kosztów czytają i zapisują koszty — tylko z uprawnieniem do kosztów.
  if ((input.kind === 'propose_lines' || input.kind === 'reestimate_line') && !has(c, 'quotesCost:edit')) throw forbidden('cost_forbidden')
  await expireStaleJobs(deps.db, id)
  const [busy] = await deps.db.select({ id: aiJobs.id }).from(aiJobs).where(and(eq(aiJobs.quoteId, id), eq(aiJobs.kind, input.kind), inArray(aiJobs.status, ['queued', 'running'])))
  if (busy) throw new HttpProblem(409, 'ai_job_running')
  const token = randomBytes(32).toString('base64url')
  const { kind, ...params } = input
  const [job] = await deps.db.insert(aiJobs).values({ quoteId: id, kind, params, tokenHash: sha256(token), createdBy: c.get('user').id }).returning({ id: aiJobs.id })
  await writeAudit(c, { action: 'ai.job_create', entity: 'quotes', entityId: id, changes: { jobId: job!.id, kind } })
  try {
    await deps.dispatchJob(job!.id, token, new URL(c.req.url).origin)
  } catch (e) {
    await deps.db.update(aiJobs).set({ status: 'error', error: e instanceof Error ? e.message : String(e), finishedAt: sql`now()` }).where(eq(aiJobs.id, job!.id))
  }
  return c.json((await listJobs(deps.db, id)).find((j) => j.id === job!.id), 200)
})

// ---------------- Sugestie AI (krok 5) ----------------

async function listSuggestions(c: Context<AppEnv>, quoteId: string): Promise<AiSuggestionDto[]> {
  const db = c.get('deps').db
  const canSee = has(c, 'quotesCost:view')
  const rows = await db
    .select({ s: aiSuggestions, sectionName: quoteSections.name, deviceName: quoteDevices.name, line: quoteLines })
    .from(aiSuggestions)
    .innerJoin(quoteSections, eq(quoteSections.id, aiSuggestions.sectionId))
    .innerJoin(quoteDevices, eq(quoteDevices.id, quoteSections.deviceId))
    .leftJoin(quoteLines, eq(quoteLines.id, aiSuggestions.lineId))
    .where(and(eq(aiSuggestions.quoteId, quoteId), eq(aiSuggestions.status, 'pending')))
    .orderBy(asc(quoteDevices.sortOrder), asc(quoteSections.sortOrder), asc(aiSuggestions.createdAt))
  return rows.map(({ s, sectionName, deviceName, line }) => {
    const p = s.payload
    return {
      id: s.id,
      action: s.lineId ? 'update' : 'add',
      sectionId: s.sectionId,
      sectionName,
      deviceName,
      lineId: s.lineId,
      current: line ? { name: line.name, quantity: line.quantity, unitCost: canSee ? line.unitCost : null, cost: canSee ? lineCost(line) : null } : null,
      payload: canSee ? p : { ...p, unitCost: null, laborRate: null },
      cost: canSee ? lineCost({ quantity: p.quantity, unitCost: p.unitCost, laborHours: p.laborHours, laborRate: p.laborRate }) : null,
      status: s.status,
      jobId: s.jobId,
      createdAt: s.createdAt,
    }
  })
}

aiRouter.openapi(route({ method: 'get', path: '/quotes/{id}/ai/suggestions', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const { id } = c.req.valid('param')
  await getQuoteRow(c.get('deps').db, id)
  return c.json(await listSuggestions(c, id), 200)
})

/** Akceptacja: pozycja zmieniona/dodana ze źródłem „AI”, niezatwierdzona — dalej jak każda pozycja. */
async function applySuggestions(c: Context<AppEnv>, quoteId: string, ids: string[] | 'all', accept: boolean) {
  const db = c.get('deps').db
  await assertEditable(db, c.get('permissions'), quoteId)
  const rows = await db
    .select()
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.quoteId, quoteId), eq(aiSuggestions.status, 'pending'), ids === 'all' ? undefined : inArray(aiSuggestions.id, ids)))
  if (ids !== 'all' && rows.length !== ids.length) throw notFound()
  if (accept && rows.some((r) => r.payload.unitCost != null || r.payload.laborRate != null) && !has(c, 'quotesCost:edit')) throw forbidden('cost_forbidden')
  const user = c.get('user')
  await db.transaction(async (tx) => {
    for (const s of rows) {
      if (accept) {
        const p = s.payload
        const fields = { name: p.name, group: p.group, quantity: p.quantity, unit: p.unit, unitCost: p.unitCost, laborHours: p.laborHours, laborRate: p.laborRate, justification: p.justification, confidence: p.confidence, source: 'ai' as const, approved: false }
        if (s.lineId) await tx.update(quoteLines).set(fields).where(eq(quoteLines.id, s.lineId))
        else {
          const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(sort_order), -1)::int` }).from(quoteLines).where(eq(quoteLines.sectionId, s.sectionId))) as [{ n: number }]
          await tx.insert(quoteLines).values({ ...fields, sectionId: s.sectionId, sortOrder: n + 1 })
        }
      }
      await tx.update(aiSuggestions).set({ status: accept ? 'accepted' : 'rejected', decidedBy: user.id, decidedAt: sql`now()` }).where(eq(aiSuggestions.id, s.id))
    }
    if (rows.length) {
      await touch(tx, quoteId, user.id)
      await writeAudit(c, { action: accept ? 'ai.suggestions_accept' : 'ai.suggestions_reject', entity: 'quotes', entityId: quoteId, changes: { count: rows.length, ids: rows.map((r) => r.id) } }, tx)
    }
  })
}

const suggestionDecision = z.object({ ids: z.union([z.array(z.uuid()).min(1).max(500), z.literal('all')]), accept: z.boolean() })

aiRouter.openapi(
  route({ method: 'post', path: '/quotes/{id}/ai/suggestions/decide', request: { params: idParam, body: body(suggestionDecision) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const { ids, accept } = c.req.valid('json')
    await applySuggestions(c, id, ids, accept)
    return c.json(await listSuggestions(c, id), 200)
  },
)

// ---------------- Pytania (krok 6) ----------------

const assignees = aliasedTable(users, 'assignee')
const answerers = aliasedTable(users, 'answerer')

async function listQuestions(db: Database, where: ReturnType<typeof and>): Promise<QuestionDto[]> {
  const rows = await db
    .select({ q: quoteQuestions, assigneeName: assignees.name, answeredByName: answerers.name, code: opportunities.code, revision: quotes.revision })
    .from(quoteQuestions)
    .innerJoin(quotes, eq(quotes.id, quoteQuestions.quoteId))
    .leftJoin(opportunities, eq(opportunities.id, quotes.opportunityId))
    .leftJoin(assignees, eq(assignees.id, quoteQuestions.assigneeId))
    .leftJoin(answerers, eq(answerers.id, quoteQuestions.answeredBy))
    .where(where)
    .orderBy(asc(quoteQuestions.createdAt))
  return rows.map(({ q, assigneeName, answeredByName, code, revision }) => ({
    id: q.id,
    quoteId: q.quoteId,
    quoteLabel: `${code ?? ''} rew. ${revision ?? ''}`.trim(),
    audience: q.audience,
    text: q.text,
    context: q.context,
    checklistKey: q.checklistKey,
    status: q.status,
    answer: q.answer,
    assigneeId: q.assigneeId,
    assigneeName,
    answeredByName,
    answeredAt: q.answeredAt,
    source: q.source === 'ai' ? 'ai' : 'manual',
    createdAt: q.createdAt,
  }))
}

aiRouter.openapi(route({ method: 'get', path: '/quotes/{id}/questions', request: { params: idParam }, responses: ok }, 'quotes', 'view'), async (c) => {
  const { id } = c.req.valid('param')
  await getQuoteRow(c.get('deps').db, id)
  return c.json(await listQuestions(c.get('deps').db, and(eq(quoteQuestions.quoteId, id))), 200)
})

/** Otwarte pytania wewnętrzne przypisane do mnie (pulpit). */
aiRouter.openapi(route({ method: 'get', path: '/questions/mine', responses: ok }, 'quotes', 'view'), async (c) =>
  c.json(await listQuestions(c.get('deps').db, and(eq(quoteQuestions.assigneeId, c.get('user').id), eq(quoteQuestions.status, 'open'), isNull(quotes.deletedAt))), 200),
)

aiRouter.openapi(route({ method: 'post', path: '/quotes/{id}/questions', request: { params: idParam, body: body(questionInput) }, responses: ok }, 'quotes', 'edit'), async (c) => {
  const { id } = c.req.valid('param')
  const input = c.req.valid('json')
  const db = c.get('deps').db
  const q = await getQuoteRow(db, id)
  if (q.kind !== 'quote') throw new HttpProblem(422, 'not_a_quote')
  const settings = await loadAiSettings(db)
  const [row] = await db
    .insert(quoteQuestions)
    .values({
      quoteId: id,
      audience: input.audience,
      text: input.text,
      context: input.context ?? null,
      checklistKey: input.checklistKey ?? null,
      assigneeId: input.assigneeId !== undefined ? input.assigneeId : input.audience === 'internal' ? settings.questionsAssigneeId : null,
      source: 'manual',
      createdBy: c.get('user').id,
    })
    .returning({ id: quoteQuestions.id })
  await writeAudit(c, { action: 'quote.question_create', entity: 'quotes', entityId: id, changes: { questionId: row!.id, audience: input.audience } })
  return c.json(await listQuestions(db, and(eq(quoteQuestions.quoteId, id))), 200)
})

aiRouter.openapi(
  route({ method: 'patch', path: '/questions/{id}', request: { params: idParam, body: body(questionPatch) }, responses: ok }, 'quotes', 'edit'),
  async (c) => {
    const { id } = c.req.valid('param')
    const patch = c.req.valid('json')
    const db = c.get('deps').db
    const [cur] = await db.select().from(quoteQuestions).where(eq(quoteQuestions.id, id))
    if (!cur) throw notFound()
    const answering = patch.answer !== undefined && patch.answer !== null && patch.answer !== cur.answer
    const set = {
      ...patch,
      ...(answering ? { status: patch.status ?? ('answered' as const), answeredBy: c.get('user').id, answeredAt: sql`now()` } : {}),
    }
    await db.update(quoteQuestions).set(set).where(eq(quoteQuestions.id, id))
    await writeAudit(c, { action: 'quote.question_update', entity: 'quotes', entityId: cur.quoteId, changes: { questionId: id, ...patch } })
    return c.json(await listQuestions(db, and(eq(quoteQuestions.quoteId, cur.quoteId))), 200)
  },
)

// ---------------- Status AI i koszty (G6) ----------------

aiRouter.openapi(route({ method: 'get', path: '/ai/status', responses: ok }, 'quotes', 'view'), async (c) => {
  const deps = c.get('deps')
  const settings = await loadAiSettings(deps.db)
  const now = deps.now?.() ?? new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const [m] = await deps.db
    .select({ usd: sql<string | null>`sum(${aiCalls.costUsd})`, n: sql<number>`count(*)::int` })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, monthStart))
  const monthUsd = Math.round(Number(m?.usd ?? 0) * 100) / 100
  const status: AiStatusDto = {
    available: !!deps.ai,
    fake: !!deps.ai?.fake,
    model: AI_MODEL,
    monthUsd,
    monthCalls: m?.n ?? 0,
    warn: settings.monthlyWarnUsd != null && monthUsd >= settings.monthlyWarnUsd,
    settings,
  }
  return c.json(status, 200)
})

aiRouter.openapi(route({ method: 'put', path: '/ai/settings', request: { body: body(aiSettingsInput) }, responses: ok }, 'admin', 'edit'), async (c) => {
  const value = c.req.valid('json')
  const db = c.get('deps').db
  if (value.questionsAssigneeId) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, value.questionsAssigneeId), inArray(users.role, ['Admin', 'EnvcheckInternal']), isNull(users.deletedAt)))
    if (!u) throw new HttpProblem(422, 'owner_not_allowed')
  }
  await db
    .insert(appSettings)
    .values({ key: AI_SETTINGS_KEY, value, updatedBy: c.get('user').id })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()`, updatedBy: c.get('user').id } })
  await writeAudit(c, { action: 'settings.ai', entity: 'app_settings', entityId: AI_SETTINGS_KEY, changes: value })
  return c.json(value, 200)
})
