import { z } from 'zod'
import { ACTIONS, MODULE_KEYS } from './permissions.ts'
import { ROLES } from './roles.ts'

export const roleSchema = z.enum(ROLES)
export const moduleSchema = z.enum(MODULE_KEYS as [string, ...string[]])
export const actionSchema = z.enum(ACTIONS)

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'validation.totpCode')
export const recoveryCodeSchema = z.string().trim().regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/i, 'validation.recoveryCode')

/** `remember: false` → cookie 2FA sesyjne (wygasa po zamknięciu przeglądarki). */
const rememberField = { remember: z.boolean().optional() }
export const mfaVerifyInput = z.union([
  z.object({ code: totpCodeSchema, ...rememberField }),
  z.object({ recoveryCode: recoveryCodeSchema, ...rememberField }),
])
export type MfaVerifyInput = z.infer<typeof mfaVerifyInput>

export const mfaEnableInput = z.object({ code: totpCodeSchema, remember: z.boolean().optional() })

export const inviteUserInput = z
  .object({
    email: z.email(),
    name: z.string().trim().min(1).max(200),
    role: roleSchema,
    subcontractorId: z.uuid().nullish(),
  })
  .refine((v) => v.role !== 'Subcontractor' || !!v.subcontractorId, {
    message: 'validation.subcontractorRequired',
    path: ['subcontractorId'],
  })
export type InviteUserInput = z.infer<typeof inviteUserInput>

export const updateUserInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  role: roleSchema.optional(),
  subcontractorId: z.uuid().nullish(),
  isActive: z.boolean().optional(),
  version: z.number().int(),
})
export type UpdateUserInput = z.infer<typeof updateUserInput>

export const permissionsUpdateInput = z.object({
  entries: z
    .array(z.object({ role: roleSchema, module: moduleSchema, action: actionSchema, allowed: z.boolean() }))
    .min(1),
})
export type PermissionsUpdateInput = z.infer<typeof permissionsUpdateInput>

export const mfaPolicyInput = z.object({ requiredRoles: z.array(roleSchema) })

export const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  userId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  entity: z.string().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
export type AuditQuery = z.infer<typeof auditQuery>
