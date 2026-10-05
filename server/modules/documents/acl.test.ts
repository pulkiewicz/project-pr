import { describe, expect, it } from 'vitest'
import type { UserRow } from '../../context.ts'
import { effectiveLevels } from './acl.ts'

const user = (role: UserRow['role'], party = role === 'Subcontractor' ? 'Subcontractor:abc' : 'Envcheck') => ({ role, party }) as UserRow
const folders = [
  { id: 'root', parentId: null },
  { id: '07', parentId: 'root' },
  { id: '07w', parentId: '07' },
  { id: '07i', parentId: '07' },
  { id: '08', parentId: 'root' },
  { id: '08firma', parentId: '08' },
  { id: '98', parentId: 'root' },
  { id: 'loose', parentId: null },
]
const acl = [
  { folderId: 'root', subject: 'role:EnvcheckInternal', level: 'read' as const },
  { folderId: '07', subject: 'role:EnvcheckInternal', level: 'write' as const },
  { folderId: '07', subject: 'role:Client', level: 'read' as const },
  { folderId: '07i', subject: 'role:EnvcheckInternal', level: 'write' as const },
  { folderId: '08', subject: 'role:Client', level: 'read' as const },
  { folderId: '08firma', subject: 'role:Client', level: 'read' as const },
  { folderId: '08firma', subject: 'party:Subcontractor:abc', level: 'write' as const },
]

describe('ACL folderów — dziedziczenie i nadpisanie', () => {
  it('dziedziczenie w dół i jawne nadpisanie na podfolderze', () => {
    const c = effectiveLevels(user('Client'), folders, acl)
    expect(c.get('07w')).toBe('read') // dziedziczy z 07
    expect(c.get('07i')).toBe('none') // jawna ACL bez Client
    expect(c.get('root')).toBe('none')
  })

  it('podwykonawca ma dostęp tylko do folderu swojej firmy', () => {
    const s = effectiveLevels(user('Subcontractor'), folders, acl)
    expect(s.get('08firma')).toBe('write')
    expect(s.get('08')).toBe('none')
  })

  it('folder bez ACL aż do korzenia — tylko Admin', () => {
    expect(effectiveLevels(user('EnvcheckInternal'), folders, acl).get('loose')).toBe('none')
    expect(effectiveLevels(user('Admin'), folders, acl).get('loose')).toBe('manage')
  })
})
