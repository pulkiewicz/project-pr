import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultPermissionEntries, DEFAULT_LEVELS } from '#shared'
import { startHarness, schema, type Harness } from '../test/harness.ts'
import { SEED_PROJECT_ID } from './seed-sql.ts'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(() => h.stop())

describe('migracje i seed', () => {
  it('seed projektu zawiera wyłącznie dane z sekcji 2; dzień „0” pusty', async () => {
    const [p] = await h.db.select().from(schema.projects)
    expect(p).toMatchObject({
      id: SEED_PROJECT_ID,
      name: 'Stacja badań klimatycznych — bud. XIXa, Kobyłka',
      client: 'PIT-RADWAR S.A.',
      contractNo: '4500010164',
      procurementNo: 'ZZ-024886',
      contractValue: '36062120.00',
      contractEndDate: '2027-11-15',
      dayZeroDate: null,
    })
  })

  it('tabela permissions odpowiada domyślnej macierzy z shared/permissions.ts', async () => {
    const rows = await h.db.select().from(schema.permissions)
    const key = (r: { role: string; module: string; action: string; allowed: boolean }) =>
      `${r.role}|${r.module}|${r.action}|${r.allowed}`
    expect(rows.map(key).sort()).toEqual(defaultPermissionEntries().map(key).sort())
  })

  it('macierz zgodna z sekcją 4.3 w kluczowych punktach', () => {
    expect(DEFAULT_LEVELS.penalties.Arsanit).toBe('-')
    expect(DEFAULT_LEVELS.auditLog.EnvcheckInternal).toBe('-')
    expect(DEFAULT_LEVELS.avizations.Client).toBe('A')
    expect(DEFAULT_LEVELS.weeklyPlan.Subcontractor).toBe('O')
    expect(DEFAULT_LEVELS.purchases.Client).toBe('-')
  })

  it('audit_log jest tylko do dopisywania (trigger blokuje UPDATE i DELETE)', async () => {
    await h.db.insert(schema.auditLog).values({ action: 'test.entry' })
    await expect(h.pg.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/)
    await expect(h.pg.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/)
    await expect(h.pg.query(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/)
  })
})
