import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type FinancePlanResponse, type InvoiceListResponse, type InvoiceSyncResult } from '#shared'
import { INVOICES_SETTING_KEY, MANAGEMENT_SETTING_KEY } from '../../auth/access.ts'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { createUser, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
let ania: TestUser
let kamil: TestUser
let outsider: TestUser

beforeAll(async () => {
  h = await startHarness()
  ania = await createUser(h, 'EnvcheckInternal')
  kamil = await createUser(h, 'EnvcheckInternal')
  outsider = await createUser(h, 'EnvcheckInternal')
  // Ania: Faktury + Zarząd (widzi wynagrodzenia imiennie); Kamil: tylko Faktury.
  await h.db.insert(schema.appSettings).values({ key: INVOICES_SETTING_KEY, value: { userIds: [ania.id, kamil.id], syncFrom: '2026-01-01' } })
  await h.db.insert(schema.appSettings).values({ key: MANAGEMENT_SETTING_KEY, value: { userIds: [ania.id] } })
  await h.db.insert(schema.employees).values([
    { firstName: 'Adam', lastName: 'Etatowy', contractType: 'employment', contractStart: '2026-10-16', payBasis: 'monthly', payAmount: 1_000_000 },
    { firstName: 'Ewa', lastName: 'Zleceniowa', contractType: 'mandate', payBasis: 'hourly', payAmount: 3000, isStudent: true },
    { firstName: 'Bartek', lastName: 'Firmowy', contractType: 'b2b', payBasis: 'monthly', payAmount: 2_000_000 },
    { firstName: 'Stary', lastName: 'Nieaktywny', contractType: 'employment', payBasis: 'monthly', payAmount: 500_000, isActive: false },
  ])
})
afterAll(() => h.stop())

const plan = async (u: TestUser, month: string) => {
  const res = await req(h, 'GET', `/api/finance/plan?month=${month}`, u.headers)
  expect(res.status).toBe(200)
  return (await res.json()) as FinancePlanResponse
}

describe('plan finansowy', () => {
  it('dostęp jak do Faktur; niepoprawny miesiąc → 422', async () => {
    expect((await req(h, 'GET', '/api/finance/plan?month=2026-10', outsider.headers)).status).toBe(403)
    expect((await req(h, 'GET', '/api/finance/plan?month=2026-13', ania.headers)).status).toBe(422)
  })

  it('synchronizacja pobiera też faktury sprzedażowe; błąd uprawnień do nich nie przerywa kosztów', async () => {
    h.infakt.salesForbidden = true
    const denied = (await (await req(h, 'POST', '/api/invoices/sync', ania.headers)).json()) as InvoiceSyncResult
    expect(denied).toMatchObject({ created: 6, sales: null, salesError: 'infakt_unauthorized' })
    h.infakt.salesForbidden = false
    const res = (await (await req(h, 'POST', '/api/invoices/sync', ania.headers)).json()) as InvoiceSyncResult
    expect(res.sales).toMatchObject({ fetched: 5, created: 5, updated: 0 })
    expect(h.infakt.calls).toContain('sales:2026-01-01')
    const again = (await (await req(h, 'POST', '/api/invoices/sync', ania.headers)).json()) as InvoiceSyncResult
    expect(again.sales).toMatchObject({ created: 0, updated: 0 })
    h.infakt.sales[0]!.status = 'paid'
    expect(((await (await req(h, 'POST', '/api/invoices/sync', ania.headers)).json()) as InvoiceSyncResult).sales).toMatchObject({ updated: 1 })
  })

  it('przychody: tylko PLN, bez pro formy; osoba fizyczna jako nabywca', async () => {
    const oct = await plan(ania, '2026-10')
    expect(oct.revenue.net).toBe(3_000_000)
    expect(oct.revenue.gross).toBe(3_690_000)
    expect(oct.revenue.invoices.map((i) => i.number)).toEqual(['1/10/2026', '2/10/2026', '4/10/2026'])
    expect(oct.revenue.foreign).toBe(1)
    const sep = await plan(ania, '2026-09')
    expect(sep.revenue.invoices[0]).toMatchObject({ clientName: 'Jan Kowalski', netPrice: 5_000_000 })
    expect(oct.sales.lastSync).not.toBeNull()
  })

  it('koszty z faktur: projekt × kategoria, reszta podziału jako ogólne, nieprzypisane osobno', async () => {
    const list = (await (await req(h, 'GET', '/api/invoices', ania.headers)).json()) as InvoiceListResponse
    const inv = list.items.find((i) => i.number === 'FV/1/10/2026')!
    expect((await req(h, 'PUT', `/api/invoices/${inv.id}/allocation`, ania.headers, { allocations: [{ projectId: SEED_PROJECT_ID, share: 60 }], version: inv.version })).status).toBe(200)
    const [cat] = await h.db.insert(schema.costCategories).values({ name: 'Materiały' }).returning()
    expect((await req(h, 'PATCH', `/api/invoices/${inv.id}/category`, ania.headers, { costCategoryId: cat!.id })).status).toBe(200)

    const oct = await plan(ania, '2026-10')
    // PLN z kwotą: FV/1 (101 234), FV/2 (201 234), koszt 6 (601 234), plik 8 (12 345); bez kwoty — 1, w EUR — 1.
    expect(oct.costs.net).toBe(916_047)
    expect(oct.costs.missingAmount).toBe(1)
    expect(oct.costs.foreign).toBe(1)
    expect(oct.costs.cells).toEqual(
      expect.arrayContaining([
        { kind: 'project', projectId: SEED_PROJECT_ID, categoryId: cat!.id, net: 60_740 },
        { kind: 'general', projectId: null, categoryId: cat!.id, net: 40_494 },
        { kind: 'unassigned', projectId: null, categoryId: null, net: 814_813 },
      ]),
    )
    expect(oct.costs.categories).toEqual([{ id: cat!.id, name: 'Materiały', staff: false }])
    expect(oct.costs.projects.map((p) => p.id)).toEqual([SEED_PROJECT_ID])
    expect(oct.costs.invoices.find((i) => i.id === inv.id)?.allocation).toMatch(/ 60%, Ogólne 40%$/)
  })

  it('koszty pracownicze: część miesiąca, stawka godzinowa × wymiar, narzut; B2B i nieaktywni pominięci', async () => {
    const oct = await plan(ania, '2026-10')
    const adam = oct.staff.rows!.find((r) => r.name === 'Etatowy Adam')!
    expect(adam).toMatchObject({ fraction: 0.5161, pay: 516_100, employerRate: 20.48 })

    const nov = await plan(ania, '2026-11')
    // Listopad 2026: 20 dni roboczych (11.11 święto) → 160 h; student bez składek.
    expect(nov.staff.rows!.find((r) => r.name === 'Zleceniowa Ewa')).toMatchObject({ hours: 160, pay: 480_000, employerRate: 0, total: 480_000 })
    expect(nov.staff.rows!.find((r) => r.name === 'Firmowy Bartek')).toMatchObject({ invoiced: true })
    expect(nov.staff.rows!.some((r) => r.name === 'Nieaktywny Stary')).toBe(false)
    expect(nov.staff).toMatchObject({ pay: 1_480_000, employer: 204_800, total: 1_684_800, count: 2 })
    expect(nov.result).toBe(nov.revenue.net - nov.costs.net - nov.staff.total)
    expect(nov.year).toHaveLength(12)
    expect(nov.year.find((m) => m.month === '2026-11')).toMatchObject({ staffCosts: 1_684_800 })
  })

  it('bez dostępu do Pracowników — tylko sumy kosztów pracowniczych', async () => {
    const nov = await plan(kamil, '2026-11')
    expect(nov.staff.rows).toBeNull()
    expect(nov.staff.total).toBe(1_684_800)
  })
})
