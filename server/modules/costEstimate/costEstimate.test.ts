import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CostEstimateResponse } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { MIGRATIONS_DIR, createUser, req, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
const u = {} as Record<'admin' | 'env' | 'ars' | 'client' | 'acc', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}/cost-estimate`

beforeAll(async () => {
  h = await startHarness()
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.client = await createUser(h, 'Client')
  u.acc = await createUser(h, 'Accounting')
})
afterAll(() => h.stop())

const get = async (user: TestUser = u.env) => (await (await req(h, 'GET', P, user.headers)).json()) as CostEstimateResponse
const item = (d: CostEstimateResponse, name: string) => d.items.find((i) => i.name === name)!

describe('Kosztorys projektu [W]', () => {
  it('tylko Envcheck: role zewnętrzne i Księgowość bez dostępu', async () => {
    for (const x of [u.ars, u.client, u.acc]) expect((await req(h, 'GET', P, x.headers)).status).toBe(403)
    expect((await req(h, 'GET', P, u.env.headers)).status).toBe(200)
  })

  it("import z arkusza OF14 (sumy jak w Excelu) + bramy i obróbki nierdzewne w budżecie Envcheck", async () => {
    const d = await get()
    expect(d.items).toHaveLength(57)
    expect(d.settings).toMatchObject({ eurRate: 4.4, version: 1 })
    const env = d.summary.budgets.find((b) => b.budget === 'Envcheck')!
    const ars = d.summary.budgets.find((b) => b.budget === 'Arsanit')!
    expect(env.estimate).toBe(11_598_600)
    expect(ars.estimate).toBe(4_010_000)
    // Wycena: (191250+34996+145600+106140+27900+12037+1950+11250) EUR × 4,4
    expect(env.quote).toBe(2_336_941.2)
    // Prognoza: „Osprzęt sprężarek” zostaje na szacunku, mimo wyceny częściowej.
    expect(item(d, 'Osprzęt sprężarek')).toMatchObject({ forecastMode: 'estimate', quotePln: 153_982.4, forecast: 360_000 })
    expect(item(d, 'Sprężarki W75-240Y, 30 szt.').forecast).toBe(841_500)
    expect(d.summary.contract).toMatchObject({ envcheckAmount: 21_925_000, partnerDiff: 942_000, result: 10_326_400, maxReserveReturn: 1_586_397.12 })
    expect(d.summary.categories[0]).toMatchObject({ category: 'Obudowa i prace budowlane', estimate: 575_000 })
  })

  it('podpozycje: tylko w budżecie Envcheck, sumują wycenę i faktyczne, nierozpisany szacunek zostaje w prognozie', async () => {
    const d = await get()
    const zbiorniki = item(d, 'Zbiorniki i separatory')
    const add = (body: object, user = u.env) => req(h, 'POST', `${P}/items`, user.headers, body)
    expect((await add({ parentId: item(d, 'Rolstal: podłogi').id, category: 'x', name: 'x', budget: 'Envcheck' })).status).toBe(422)

    const r1 = await add({ parentId: zbiorniki.id, category: 'dowolna', name: 'Separatory oleju', budget: 'Arsanit', estimate: 300_000, quoteAmount: 50_000, quoteCurrency: 'EUR' })
    expect(r1.status).toBe(201)
    const { id: childId } = (await r1.json()) as { id: string }
    expect((await add({ parentId: zbiorniki.id, category: 'x', name: 'Zbiorniki ciekłego', budget: 'Envcheck', estimate: 200_000, actual: 190_000, quoteCurrency: 'PLN' })).status).toBe(201)
    // Podpozycja podpozycji — niedozwolona.
    expect((await add({ parentId: childId, category: 'x', name: 'x', budget: 'Envcheck' })).status).toBe(422)

    const after = await get()
    const child = after.items.find((i) => i.id === childId)!
    expect(child).toMatchObject({ category: 'Układ chłodzenia', budget: 'Envcheck', quotePln: 220_000, forecast: 220_000 })
    const parent = item(after, 'Zbiorniki i separatory')
    // Szacunek pozycji (OF14) bez zmian, nierozpisane 792 000 − 500 000.
    expect(parent).toMatchObject({ estimate: 792_000, childCount: 2, childrenEstimate: 500_000, unallocated: 292_000, quotePln: 220_000, actualTotal: 190_000, forecast: 220_000 + 190_000 + 292_000 })
    // Podpozycje zaraz pod pozycją nadrzędną.
    const idx = after.items.findIndex((i) => i.id === parent.id)
    expect(after.items[idx + 1]!.parentId).toBe(parent.id)
    expect(after.summary.budgets.find((b) => b.budget === 'Envcheck')!.estimate).toBe(11_598_600)

    // Pozycja z podpozycjami nie może przejść do budżetu Arsanit; zmiana kategorii przechodzi na podpozycje.
    expect((await req(h, 'PATCH', `${P}/items/${parent.id}`, u.env.headers, { version: parent.version, budget: 'Arsanit' })).status).toBe(422)
    const moved = (await (await req(h, 'PATCH', `${P}/items/${parent.id}`, u.env.headers, { version: parent.version, category: 'Rezerwa' })).json()) as CostEstimateResponse
    expect(moved.items.find((i) => i.id === childId)!.category).toBe('Rezerwa')

    // Konflikt wersji.
    expect((await req(h, 'PATCH', `${P}/items/${parent.id}`, u.env.headers, { version: parent.version, name: 'x' })).status).toBe(409)

    // Usunięcie pozycji usuwa też podpozycje.
    const del = (await (await req(h, 'DELETE', `${P}/items/${parent.id}`, u.env.headers)).json()) as CostEstimateResponse
    expect(del.items.some((i) => i.id === childId || i.id === parent.id)).toBe(false)
  })

  it('kolejność pozycji: przesunięcie w górę', async () => {
    const d = await get()
    const tops = d.items.filter((i) => !i.parentId)
    const second = tops[1]!
    const r = (await (await req(h, 'POST', `${P}/items/${second.id}/move`, u.env.headers, { direction: 'up' })).json()) as CostEstimateResponse
    expect(r.items.filter((i) => !i.parentId)[0]!.id).toBe(second.id)
  })

  it('ustawienia: kurs EUR przelicza wyceny; wersja chroni przed nadpisaniem', async () => {
    const d = await get()
    const body = { ...d.settings, eurRate: 4.5 }
    const r = (await (await req(h, 'PUT', `${P}/settings`, u.env.headers, body)).json()) as CostEstimateResponse
    expect(item(r, 'Parowniki').quotePln).toBe(655_200)
    expect((await req(h, 'PUT', `${P}/settings`, u.env.headers, body)).status).toBe(409)
    expect((await req(h, 'PUT', `${P}/settings`, u.ars.headers, { ...body, version: r.settings.version })).status).toBe(403)
  })

  it('migracja: pozycje planu zakupów jako podpozycje właściwych pozycji (bez podwójnego liczenia, ponowne uruchomienie bez duplikatów)', async () => {
    const PZ = `/api/projects/${SEED_PROJECT_ID}/purchases`
    const add = (body: object) => req(h, 'POST', PZ, u.admin.headers, { party: 'Envcheck', ...body })
    expect((await add({ name: 'Sprężarki W75-240Y', quantity: 37, unit: 'szt.', supplierName: 'Frascold', netAmount: 900_000, isCritical: true })).status).toBe(201)
    await add({ name: 'Desuperheatery', quantity: 2, unit: 'szt.' })
    await add({ name: 'Czujniki' })
    await add({ name: 'Ogrzewanie – drut oporowy' })
    await add({ name: 'Stal nierdzewna (elementy wnętrza komór)' })
    await add({ name: 'Coś zupełnie innego' })
    await req(h, 'POST', PZ, u.ars.headers, { party: 'Arsanit', name: 'Parowniki od Arsanit' })

    const file = readFileSync(`${MIGRATIONS_DIR}/20261121185012_cost_estimate_purchases/migration.sql`, 'utf8')
    const block = file.slice(file.indexOf('DO $$'))
    await h.db.execute(sql.raw(block))
    await h.db.execute(sql.raw(block))

    const d = await get()
    const linked = d.items.filter((i) => i.purchaseItemId)
    expect(linked.map((i) => [i.name, d.items.find((p) => p.id === i.parentId)!.name]).sort()).toEqual(
      [
        ['Czujniki', 'Zawory rozprężne i czujniki'],
        ['Desuperheatery — 2 szt.', 'Schładzacze gazu, 2 szt.'],
        ['Ogrzewanie – drut oporowy', 'Ogrzewanie komór'],
        ['Sprężarki W75-240Y — 37 szt.', 'Sprężarki W75-240Y, 30 szt.'],
        ['Stal nierdzewna (elementy wnętrza komór)', 'Obróbki nierdzewne i prefabrykacja komór'],
      ].sort(),
    )
    // Bramy i obróbki nierdzewne przeszły do budżetu Envcheck: −575 000 zł u Arsanit.
    expect(item(d, 'Obróbki nierdzewne i prefabrykacja komór').budget).toBe('Envcheck')
    expect(item(d, 'Bramy, drzwi komór i śluzy').budget).toBe('Envcheck')
    expect(d.summary.budgets.find((b) => b.budget === 'Arsanit')!.estimate).toBe(4_585_000 - 575_000)
    const comp = linked.find((i) => i.name.startsWith('Sprężarki'))!
    expect(comp).toMatchObject({ supplier: 'Frascold', quotePln: 900_000, quoteCurrency: 'PLN', estimate: null, purchase: { status: 'to_inquire', isCritical: true } })
    expect(comp.notes).toContain('komponent krytyczny')
    // Wycena z planu (900 000) zajmuje cały szacunek 900 000 — prognoza pozycji = 900 000, nie 1 800 000.
    expect(item(d, 'Sprężarki W75-240Y, 30 szt.')).toMatchObject({ estimate: 900_000, unallocated: 0, forecast: 900_000 })
    // Wycena z arkusza (EUR) przeszła z pozycji „Schładzacze gazu” na jej jedyną podpozycję; suma i prognoza bez zmian.
    const gas = item(d, 'Schładzacze gazu, 2 szt.')
    expect(gas).toMatchObject({ quoteAmount: null, quotePln: 54_166.5, forecast: 54_166.5, unallocated: 0 })
    expect(item(d, 'Desuperheatery — 2 szt.')).toMatchObject({ quoteAmount: 12_037, quoteCurrency: 'EUR', allocatedEstimate: 44_000 })
    // Jedyna podpozycja przejmuje cały szacunek, więc tańsza wycena obniża prognozę (jak w arkuszu).
    const ogrz = d.items.filter((i) => i.parentId === item(d, 'Ogrzewanie komór').id)
    expect(ogrz.map((i) => i.allocatedEstimate)).toEqual([100_000])
  })

  it('eksport XLSX: Podsumowanie i Pozycje', async () => {
    const res = await req(h, 'GET', `${P}/export.xlsx`, u.env.headers)
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Podsumowanie', 'Pozycje'])
    expect(wb.getWorksheet('Pozycje')!.rowCount).toBeGreaterThan(50)
  })
})
