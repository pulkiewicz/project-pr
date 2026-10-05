import type { AclLevel } from '#shared'
import type { UserRow } from '../../context.ts'

const RANK: Record<AclLevel, number> = { none: 0, read: 1, write: 2, manage: 3 }
export const atLeast = (have: AclLevel, need: AclLevel) => RANK[have] >= RANK[need]

export function subjectsOf(user: UserRow): string[] {
  const s = [`role:${user.role}`]
  if (user.role === 'Subcontractor') s.push(`party:${user.party}`)
  return s
}

export interface FolderNode {
  id: string
  parentId: string | null
}

/**
 * Uprawnienie efektywne: najbliższy folder (w górę drzewa) z jawną listą ACL rozstrzyga.
 * Na jawnej liście brak podmiotu = brak dostępu. Bez jawnej ACL aż do korzenia — tylko Admin (spec. 7.5).
 * Admin ma zawsze `manage`.
 */
export function effectiveLevels(user: UserRow, folders: FolderNode[], acl: { folderId: string; subject: string; level: AclLevel }[]): Map<string, AclLevel> {
  const out = new Map<string, AclLevel>()
  if (user.role === 'Admin') {
    for (const f of folders) out.set(f.id, 'manage')
    return out
  }
  const subjects = new Set(subjectsOf(user))
  const byFolder = new Map<string, { subject: string; level: AclLevel }[]>()
  for (const e of acl) byFolder.set(e.folderId, [...(byFolder.get(e.folderId) ?? []), e])
  const parent = new Map(folders.map((f) => [f.id, f.parentId]))
  const resolve = (id: string): AclLevel => {
    if (out.has(id)) return out.get(id)!
    const entries = byFolder.get(id)
    let level: AclLevel
    if (entries) {
      level = entries.filter((e) => subjects.has(e.subject)).reduce<AclLevel>((m, e) => (RANK[e.level] > RANK[m] ? e.level : m), 'none')
    } else {
      const p = parent.get(id)
      level = p ? resolve(p) : 'none'
    }
    out.set(id, level)
    return level
  }
  for (const f of folders) resolve(f.id)
  return out
}
