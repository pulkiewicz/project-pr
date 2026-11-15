import { describe, expect, it } from 'vitest'
import { evaluateBom, normalizeText, ruleSatisfied, type BomContext, type BomRuleDto } from './bom.ts'

const rule = (over: Partial<BomRuleDto> = {}): BomRuleDto => ({
  id: 'r1',
  name: 'Skraplanie wodne → chiller',
  description: null,
  active: true,
  when: [{ kind: 'flag', flag: 'Skraplanie wodne' }, { kind: 'checklist', key: 'heat_rejection', op: 'eq', value: 'woda' }],
  require: { section: null, keywords: ['chiller', 'dry-cooler'], positiveCost: true },
  suggestion: { name: 'Chiller / dry-cooler', section: 'Wyposażenie dodatkowe' },
  exceptionLabel: 'Woda lodowa po stronie klienta',
  sortOrder: 0,
  updatedAt: '2026-11-15',
  ...over,
})
const ctx = (over: Partial<BomContext> = {}): BomContext => ({ flags: [], checklist: new Map(), lines: [], ...over })
const line = (name: string, cost = 1000, section = 'Wyposażenie dodatkowe', counted = true) => ({ name, group: null, section, cost, counted })

describe('kompletność kosztorysu (W3)', () => {
  it('normalizacja: bez wielkości liter i polskich znaków', () => {
    expect(normalizeText('  Gospodarka OLEJOWA – Łódź ')).toBe('gospodarka olejowa – lodz')
  })

  it('reguła nieaktywna, gdy żaden warunek nie jest spełniony', () => {
    expect(evaluateBom([rule()], ctx(), new Map()).issues).toEqual([])
  })

  it('flaga bez pozycji → alert z podpowiedzią i wyjątkiem; pozycja z kwotą spełnia regułę', () => {
    const r = evaluateBom([rule()], ctx({ flags: ['skraplanie WODNE'] }), new Map())
    expect(r.open).toBe(1)
    expect(r.issues[0]).toMatchObject({ key: 'rule:r1', triggers: ['flaga: Skraplanie wodne'], exceptionLabel: 'Woda lodowa po stronie klienta', suggestion: { section: 'Wyposażenie dodatkowe' } })
    expect(evaluateBom([rule()], ctx({ flags: ['Skraplanie wodne'], lines: [line('Chiller (praca do +45°C)', 85000)] }), new Map()).issues).toEqual([])
  })

  it('pozycja z kwotą 0, w opcji albo w innej sekcji nie spełnia wymagania', () => {
    const r = rule({ require: { section: 'Wyposażenie dodatkowe', keywords: ['chiller'], positiveCost: true } })
    expect(ruleSatisfied(r, [line('Chiller', 0)])).toBe(false)
    expect(ruleSatisfied(r, [line('Chiller', 1000, 'Wyposażenie dodatkowe', false)])).toBe(false)
    expect(ruleSatisfied(r, [line('Chiller', 1000, 'Układ chłodzenia')])).toBe(false)
    expect(ruleSatisfied(r, [line('Chiller', 1000)])).toBe(true)
  })

  it('warunki checklisty: eq / contains / true / gte / lte (zakres) / filled', () => {
    const cl = (key: string, value: unknown) => ({ checklist: new Map([[key, { label: key, value: value as never }]]) })
    const r = (c: BomRuleDto['when'][number]) => rule({ when: [c] })
    expect(evaluateBom([r({ kind: 'checklist', key: 'heat_rejection', op: 'eq', value: 'Woda' })], ctx(cl('heat_rejection', { v: 'woda' })), new Map()).open).toBe(1)
    expect(evaluateBom([r({ kind: 'checklist', key: 'calibration', op: 'contains', value: 'pca' })], ctx(cl('calibration', { t: 'Wzorcowanie PCA, 8 pkt' })), new Map()).open).toBe(1)
    expect(evaluateBom([r({ kind: 'checklist', key: 'x', op: 'true' })], ctx(cl('x', { b: false })), new Map()).open).toBe(0)
    expect(evaluateBom([r({ kind: 'checklist', key: 'temp', op: 'lte', value: -45 })], ctx(cl('temp', { min: -50, max: 80 })), new Map()).open).toBe(1)
    expect(evaluateBom([r({ kind: 'checklist', key: 'rate', op: 'gte', value: '1,5' })], ctx(cl('rate', { n: 2 })), new Map()).open).toBe(1)
    expect(evaluateBom([r({ kind: 'checklist', key: 'h', op: 'filled' })], ctx(cl('h', { t: '  ' })), new Map()).open).toBe(0)
  })

  it('pozycje bez ceny jako osobny alert; akceptacja zamyka alert', () => {
    const c = ctx({ lines: [line('PC', 0), line('Okno', 3000)] })
    const r = evaluateBom([], c, new Map())
    expect(r.issues).toMatchObject([{ key: 'zero_cost', lines: ['Wyposażenie dodatkowe: PC'] }])
    expect(evaluateBom([], c, new Map([['zero_cost', { reason: 'PC po stronie klienta', byName: 'K', at: 'x' }]])).open).toBe(0)
  })

  it('dostępne flagi z aktywnych reguł', () => {
    expect(evaluateBom([rule(), rule({ id: 'r2', active: false, when: [{ kind: 'flag', flag: 'Shelter' }] })], ctx(), new Map()).availableFlags).toEqual(['Skraplanie wodne'])
  })
})
