import { describe, expect, it } from 'vitest'
import { computeCostEstimate, type CostItemRow } from './costEstimate.ts'

let seq = 0
const row = (p: Partial<CostItemRow>): CostItemRow => ({
  id: `i${++seq}`,
  parentId: null,
  position: seq,
  category: 'Układ chłodzenia',
  name: `Pozycja ${seq}`,
  budget: 'Envcheck',
  estimate: null,
  quoteAmount: null,
  quoteCurrency: 'EUR',
  actual: null,
  forecastMode: 'auto',
  forecastManual: null,
  supplier: null,
  notes: null,
  inactive: false,
  inactiveReason: null,
  purchaseItemId: null,
  version: 1,
  ...p,
})

describe('computeCostEstimate', () => {
  it('prognoza jak w arkuszu: faktyczne → wycena → szacunek; tryb szacunku pomija wycenę', () => {
    const a = row({ estimate: 900_000, quoteAmount: 191_250 })
    const b = row({ estimate: 360_000, quoteAmount: 34_996, forecastMode: 'estimate' })
    const c = row({ estimate: 100_000, quoteAmount: 10_000, actual: 50_000 })
    const d = row({ estimate: 100_000, forecastMode: 'manual', forecastManual: 120_000 })
    const e = row({ estimate: 200_000, budget: 'Arsanit' })
    const { items, summary } = computeCostEstimate([a, b, c, d, e], { eurRate: 4.4, contract: null })
    expect(items.map((i) => i.forecast)).toEqual([841_500, 360_000, 50_000, 120_000, 200_000])
    expect(summary.envcheck).toEqual({ estimate: 1_460_000, quote: 841_500 + 153_982.4 + 44_000, actual: 50_000, forecast: 1_371_500 })
    expect(items[0]!.share).toBeCloseTo(900_000 / 1_460_000)
    expect(summary.budgets.map((x) => x.budget)).toEqual(['Envcheck', 'Arsanit'])
    expect(summary.contract).toBeNull()
  })

  it('podpozycje: sumy wyceny i faktycznych, nierozpisany szacunek w prognozie, szacunek rodzica bez zmian', () => {
    const p = row({ estimate: 1_000, quoteAmount: 999, actual: 999 })
    const k1 = row({ parentId: p.id, estimate: 400, quoteAmount: 500, quoteCurrency: 'PLN' })
    const k2 = row({ parentId: p.id, estimate: 300, actual: 280 })
    const { items, summary } = computeCostEstimate([k2, p, k1], { eurRate: 4, contract: null })
    expect(items.map((i) => i.id)).toEqual([p.id, k1.id, k2.id])
    expect(items[0]).toMatchObject({ estimate: 1_000, quotePln: 500, actualTotal: 280, childrenEstimate: 700, unallocated: 300, forecast: 500 + 280 + 300, childCount: 2 })
    expect(summary.envcheck).toEqual({ estimate: 1_000, quote: 500, actual: 280, forecast: 1_080 })
  })

  it('podpozycje bez szacunku (z planu zakupów) dzielą nierozpisany szacunek — bez podwójnego liczenia', () => {
    const p = row({ estimate: 1_000 })
    const k1 = row({ parentId: p.id, quoteAmount: 300, quoteCurrency: 'PLN', purchaseItemId: 'pz1' })
    const k2 = row({ parentId: p.id })
    const { items } = computeCostEstimate([p, k1, k2], { eurRate: 4, contract: null }, new Map([['pz1', { status: 'offer' as const, isCritical: true, hrfTaskCode: '4.2' }]]))
    expect(items[0]).toMatchObject({ unallocated: 0, forecast: 800, quotePln: 300 })
    expect(items.slice(1).map((i) => [i.allocatedEstimate, i.forecast])).toEqual([[500, 300], [500, 500]])
    expect(items[1]!.purchase).toEqual({ status: 'offer', isCritical: true, hrfTaskCode: '4.2' })
    expect(items[2]!.purchase).toBeNull()
  })

  it('podział szacunku na podpozycje bez reszt z zaokrągleń', () => {
    const p = row({ estimate: 100_000 })
    const kids = [1, 2, 3].map(() => row({ parentId: p.id }))
    const { items } = computeCostEstimate([p, ...kids], { eurRate: 4, contract: null })
    expect(items.slice(1).map((i) => i.allocatedEstimate)).toEqual([33_333.33, 33_333.33, 33_333.34])
    expect(items[0]!.forecast).toBe(100_000)
  })

  it('pozycja nieaktywna: zostaje na liście, prognoza 0 (także pozycja z podpozycjami i podpozycja)', () => {
    const a = row({ estimate: 500, quoteAmount: 100, quoteCurrency: 'PLN', inactive: true, inactiveReason: 'Poza zakresem' })
    const p = row({ estimate: 1_000 })
    const k1 = row({ parentId: p.id, estimate: 400, inactive: true, inactiveReason: 'Rezygnacja' })
    const k2 = row({ parentId: p.id, estimate: 600 })
    const q = row({ estimate: 300, inactive: true, inactiveReason: 'x' })
    const q1 = row({ parentId: q.id, estimate: 300 })
    const { items, summary } = computeCostEstimate([a, p, k1, k2, q, q1], { eurRate: 4, contract: null })
    expect(items.map((i) => i.forecast)).toEqual([0, 600, 0, 600, 0, 300])
    expect(summary.envcheck).toMatchObject({ estimate: 1_800, quote: 100, forecast: 600 })
  })

  it('wynik w konsorcjum', () => {
    const { summary } = computeCostEstimate([row({ estimate: 1_000_000 }), row({ estimate: 400_000, budget: 'Arsanit' })], {
      eurRate: 4.4,
      contract: { contractValue: 10_000_000, partnerBudget: 500_000, partnerStages: [], partnerMargin: 2_000_000, guaranteeReserve: 500_000, reserveShare: 0.5, source: null },
    })
    expect(summary.contract).toMatchObject({ envcheckAmount: 7_000_000, result: 6_000_000, partnerAssigned: 400_000, partnerDiff: 100_000, maxReserveReturn: 250_000 })
  })
})
