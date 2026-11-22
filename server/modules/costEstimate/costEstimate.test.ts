import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CostCommentDto, CostEstimateResponse, CostItemDto } from '#shared'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { MIGRATIONS_DIR, createUser, req, startHarness, type Harness, type TestUser } from '../../test/harness.ts'

let h: Harness
const u = {} as Record<'admin' | 'env' | 'env2' | 'ars' | 'client' | 'acc', TestUser>
const P = `/api/projects/${SEED_PROJECT_ID}/cost-estimate`

beforeAll(async () => {
  h = await startHarness()
  u.admin = await createUser(h, 'Admin')
  u.env = await createUser(h, 'EnvcheckInternal')
  u.ars = await createUser(h, 'Arsanit')
  u.client = await createUser(h, 'Client')
  u.acc = await createUser(h, 'Accounting')
  u.env2 = await createUser(h, 'EnvcheckInternal')
  // Dostęp tylko dla osób z listy `costEstimate.access` (u.env2 celowo poza listą).
  expect((await req(h, 'PUT', '/api/admin/settings/cost-estimate', u.admin.headers, { userIds: [u.admin.id, u.env.id] })).status).toBe(200)
})
afterAll(() => h.stop())

const get = async (user: TestUser = u.env) => (await (await req(h, 'GET', P, user.headers)).json()) as CostEstimateResponse
const item = (d: CostEstimateResponse, name: string) => d.items.find((i) => i.name === name)!

describe('Kosztorys projektu [W]', () => {
  it('tylko Envcheck: role zewnętrzne i Księgowość bez dostępu', async () => {
    for (const x of [u.ars, u.client, u.acc]) expect((await req(h, 'GET', P, x.headers)).status).toBe(403)
    expect((await req(h, 'GET', P, u.env.headers)).status).toBe(200)
  })

  it('tylko osoby z listy w Ustawieniach (jak Plan finansowy); na liście tylko Admin / Envcheck wewnętrzny', async () => {
    // Arsanit nie może trafić na listę; listę zmienia tylko Admin.
    const s0 = (await (await req(h, 'GET', '/api/admin/settings/cost-estimate', u.admin.headers)).json()) as { settings: { userIds: string[] }; users: { id: string }[] }
    expect(s0.users.map((x) => x.id)).not.toContain(u.ars.id)
    expect((await req(h, 'PUT', '/api/admin/settings/cost-estimate', u.admin.headers, { userIds: [u.admin.id, u.env.id, u.ars.id] })).status).toBe(422)
    expect((await req(h, 'PUT', '/api/admin/settings/cost-estimate', u.env.headers, { userIds: [u.env.id] })).status).toBe(403)
    expect((await req(h, 'PUT', '/api/admin/settings/cost-estimate', u.admin.headers, { userIds: [u.admin.id, u.env.id] })).status).toBe(200)

    expect((await req(h, 'GET', P, u.env2.headers)).status).toBe(403)
    const me = (await (await req(h, 'GET', '/api/me', u.env2.headers)).json()) as { permissions: string[] }
    expect(me.permissions.some((p) => p.startsWith('costEstimate:'))).toBe(false)
    expect((await req(h, 'PUT', '/api/admin/settings/cost-estimate', u.admin.headers, { userIds: [u.admin.id, u.env.id, u.env2.id] })).status).toBe(200)
    expect((await req(h, 'GET', P, u.env2.headers)).status).toBe(200)
  })

  it("import z arkusza OF14 (sumy jak w Excelu) + bramy i obróbki nierdzewne w budżecie Envcheck", async () => {
    const d = await get()
    expect(d.items.filter((i) => !i.parentId)).toHaveLength(57)
    // Wycena Elektronika S.A.: 20 linii (531 123 EUR) jako podpozycje — sumy wycen jak w arkuszu.
    const lines = d.items.filter((i) => i.supplier === 'Elektronika S.A.')
    expect(lines).toHaveLength(20)
    expect(lines.reduce((s, i) => s + i.quoteAmount!, 0)).toBe(531_123)
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

  it('dezaktywacja: wymaga powodu, zeruje prognozę, aktywacja czyści powód', async () => {
    const d = await get()
    const it0 = item(d, 'Holownik')
    const path = `${P}/items/${it0.id}`
    expect((await req(h, 'PATCH', path, u.env.headers, { version: it0.version, inactive: true })).status).toBe(422)
    const off = (await (await req(h, 'PATCH', path, u.env.headers, { version: it0.version, inactive: true, inactiveReason: 'Zamawiający zapewnia własny' })).json()) as CostEstimateResponse
    const x = item(off, 'Holownik')
    expect(x).toMatchObject({ inactive: true, inactiveReason: 'Zamawiający zapewnia własny', estimate: 220_000, forecast: 0 })
    expect(off.summary.envcheck.forecast).toBe(d.summary.envcheck.forecast - it0.forecast)
    const on = (await (await req(h, 'PATCH', path, u.env.headers, { version: x.version, inactive: false })).json()) as CostEstimateResponse
    expect(item(on, 'Holownik')).toMatchObject({ inactive: false, inactiveReason: null, forecast: 220_000 })
    expect((await req(h, 'POST', `${P}/items`, u.env.headers, { category: 'Rezerwa', name: 'x', budget: 'Envcheck', inactive: true })).status).toBe(422)
  })

  it('komentarze: historia z autorem, licznik w pozycji, usuwanie tylko własnych (lub z prawem usuwania); dezaktywacja trafia do historii', async () => {
    const d = await get()
    const it0 = item(d, 'Parowniki')
    const C = `${P}/items/${it0.id}/comments`
    expect((await req(h, 'POST', C, u.ars.headers, { body: 'x' })).status).toBe(403)
    expect((await req(h, 'POST', C, u.env.headers, { body: '   ' })).status).toBe(422)
    const r1 = await req(h, 'POST', C, u.env.headers, { body: 'Czekamy na ofertę Güntner' })
    expect(r1.status).toBe(201)
    const list = (await (await req(h, 'POST', C, u.admin.headers, { body: 'Potwierdzić 10 szt.' })).json()) as CostCommentDto[]
    expect(list.map((c) => c.body)).toEqual(['Czekamy na ofertę Güntner', 'Potwierdzić 10 szt.'])
    expect(list[0]).toMatchObject({ authorId: u.env.id, authorName: expect.any(String) })

    const after = await get()
    expect(item(after, 'Parowniki')).toMatchObject({ commentCount: 2, lastCommentAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/) })

    // Autor zawsze może usunąć swój komentarz; z prawem costEstimate:delete (Envcheck wewnętrzny) — także cudzy.
    const asEnv = (await (await req(h, 'GET', C, u.env.headers)).json()) as CostCommentDto[]
    expect(asEnv.every((c) => c.canDelete)).toBe(true)
    const del = (await (await req(h, 'DELETE', `${C}/${asEnv[1]!.id}`, u.env.headers)).json()) as CostCommentDto[]
    expect(del).toHaveLength(1)

    const p2 = item(after, 'Parowniki')
    await req(h, 'PATCH', `${P}/items/${p2.id}`, u.env.headers, { version: p2.version, inactive: true, inactiveReason: 'Zmiana technologii' })
    const hist = (await (await req(h, 'GET', C, u.env.headers)).json()) as CostCommentDto[]
    expect(hist.at(-1)!.body).toBe('Dezaktywowano pozycję: Zmiana technologii')
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

  it('migracje w kolejności z produkcji: plan zakupów → podpozycje, potem wycena Elektronika zastępuje puste podpozycje planu', async () => {
    // Na produkcji plan zakupów został powiązany przed wczytaniem wyceny — cofnij wycenę (linie → kwota w pozycji).
    await h.db.execute(sql.raw(`
      UPDATE cost_estimate_items p SET quote_amount = s.total, quote_currency = 'EUR'
      FROM (SELECT parent_id, sum(quote_amount) AS total FROM cost_estimate_items WHERE supplier = 'Elektronika S.A.' AND deleted_at IS NULL GROUP BY parent_id) s
      WHERE p.id = s.parent_id;
      DELETE FROM cost_estimate_items WHERE supplier = 'Elektronika S.A.';`))
    const before = await get()
    expect(item(before, 'Sprężarki W75-240Y, 30 szt.')).toMatchObject({ quoteAmount: 191_250, childCount: 0 })

    const PZ = `/api/projects/${SEED_PROJECT_ID}/purchases`
    const add = (body: object) => req(h, 'POST', PZ, u.admin.headers, { party: 'Envcheck', ...body })
    expect((await add({ name: 'Sprężarki W75-240Y', quantity: 37, unit: 'szt.', isCritical: true })).status).toBe(201)
    await add({ name: 'Parowniki', quantity: 10, unit: 'szt.', isCritical: true })
    await add({ name: 'Desuperheatery', quantity: 2, unit: 'szt.', netAmount: 50_000 })
    await add({ name: 'Czujniki' })
    await add({ name: 'Holownik', quantity: 1, unit: 'szt.', supplierName: 'Linde', netAmount: 200_000 })
    await add({ name: 'Stal nierdzewna (elementy wnętrza komór)' })
    await add({ name: 'Coś zupełnie innego' })
    await req(h, 'POST', PZ, u.ars.headers, { party: 'Arsanit', name: 'Parowniki od Arsanit' })

    const run = async (name: string) => {
      const file = readFileSync(`${MIGRATIONS_DIR}/${name}/migration.sql`, 'utf8')
      const block = file.slice(file.indexOf('DO $$'))
      await h.db.execute(sql.raw(block))
      await h.db.execute(sql.raw(block)) // ponowne uruchomienie bez duplikatów
    }
    await run('20261121185012_cost_estimate_purchases')
    const mid = await get()
    const parentOf = (d: CostEstimateResponse, i: CostItemDto) => d.items.find((p) => p.id === i.parentId)!.name
    expect(mid.items.filter((i) => i.purchaseItemId).map((i) => [i.name, parentOf(mid, i)]).sort()).toEqual(
      [
        ['Czujniki', 'Zawory rozprężne i czujniki'],
        ['Desuperheatery — 2 szt.', 'Schładzacze gazu, 2 szt.'],
        ['Holownik — 1 szt.', 'Holownik'],
        ['Parowniki — 10 szt.', 'Parowniki'],
        ['Sprężarki W75-240Y — 37 szt.', 'Sprężarki W75-240Y, 30 szt.'],
        ['Stal nierdzewna (elementy wnętrza komór)', 'Obróbki nierdzewne i prefabrykacja komór'],
      ].sort(),
    )
    // Wycena z arkusza przeszła z pozycji na jej jedyną (pustą) podpozycję z planu.
    expect(item(mid, 'Sprężarki W75-240Y — 37 szt.')).toMatchObject({ quoteAmount: 191_250, quoteCurrency: 'EUR', purchase: { isCritical: true } })
    expect(item(mid, 'Sprężarki W75-240Y — 37 szt.').notes).toContain('komponent krytyczny')
    // Kwota netto z planu jako wycena: zajmuje szacunek, prognoza bez podwójnego liczenia.
    expect(item(mid, 'Holownik')).toMatchObject({ estimate: 220_000, quotePln: 200_000, unallocated: 0, forecast: 200_000 })
    expect(item(mid, 'Holownik — 1 szt.')).toMatchObject({ supplier: 'Linde', quoteCurrency: 'PLN', allocatedEstimate: 220_000 })
    expect(item(mid, 'Obróbki nierdzewne i prefabrykacja komór').budget).toBe('Envcheck')
    expect(mid.summary.budgets.find((b) => b.budget === 'Arsanit')!.estimate).toBe(4_585_000 - 575_000)

    await run('20261121201451_cost_estimate_elektronika_quote')
    const d = await get()
    const lines = (parent: string) => d.items.filter((i) => i.parentId === item(d, parent).id)
    // Sprężarki: pusta podpozycja z planu zastąpiona dwiema liniami, które przejęły powiązanie (krytyczny).
    expect(lines('Sprężarki W75-240Y, 30 szt.').map((i) => [i.name, i.quoteAmount, i.purchase?.isCritical])).toEqual([
      ['Sprężarka W75-240Y 4RSH — 18 szt.', 114_750, true],
      ['Sprężarka W75-240Y 3RSH — 12 szt.', 76_500, true],
    ])
    expect(item(d, 'Sprężarki W75-240Y, 30 szt.')).toMatchObject({ quoteAmount: null, forecast: 191_250 * 4.5 })
    expect(lines('Parowniki')).toHaveLength(1)
    // Schładzacze: podpozycja z planu ma własną kwotę — pominięte, bez linii (bez podwójnej wyceny).
    expect(lines('Schładzacze gazu, 2 szt.').map((i) => i.name)).toEqual(['Desuperheatery — 2 szt.'])
    const res = (await h.db.execute(sql.raw(`SELECT changes FROM audit_log WHERE action = 'costEstimate.elektronika_quote' ORDER BY ts DESC, id DESC LIMIT 1`))) as unknown as { rows: { changes: { skipped: string[] } }[] }
    const [audit] = res.rows
    expect(audit!.changes.skipped).toEqual(['Schładzacze gazu, 2 szt.'])
    // Dostawca uzupełniony w planie zakupów.
    const plan = (await (await req(h, 'GET', PZ, u.admin.headers)).json()) as { items: { name: string; supplierName: string | null }[] }
    expect(plan.items.find((i) => i.name === 'Parowniki')!.supplierName).toBe('Elektronika S.A.')
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
