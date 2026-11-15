import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, DEFAULT_RESERVE, priceFor, reservePct, serviceCost, type QuoteParams } from './quotes.ts'
import { ampsToKw, layoutCheck, powerBalance, quoteChecks, quoteMode, shellMassKg, suggestTechnology, type ChecklistMap, type QuoteChecksInput } from './quoteChecks.ts'

const base = (over: Partial<QuoteChecksInput> = {}): QuoteChecksInput => ({
  info: {},
  params: { ...DEFAULT_PARAMS },
  settings: { blockedCerts: ['ATEX'], standardLeadDays: 120, customMarginMin: 2, socketsSimultaneity: 1 },
  net: 1000,
  gross: 1230,
  checklist: new Map(),
  flags: [],
  calcs: [],
  inner: null,
  competitionPln: [],
  criticalOpenQuestions: [],
  ...over,
})
const cl = (entries: Record<string, unknown>): ChecklistMap => new Map(Object.entries(entries).map(([k, v]) => [k, { label: k, value: v as never }]))
const keys = (x: QuoteChecksInput) => quoteChecks(x).map((i) => i.key)

describe('W1 — walidator SWZ', () => {
  it('OF029: 29 A ≈ 20 kW, maszyna 40 kW → czerwony alert z pytaniem o przyłącze 63 A', () => {
    expect(ampsToKw(29)).toBeCloseTo(20.1, 1)
    const p = powerBalance({ powerLimitA: 29, machinePowerKw: 40 })!
    expect(p.ok).toBe(false)
    const issue = quoteChecks(base({ info: { powerLimitA: 29, machinePowerKw: 40 } }))[0]!
    expect(issue).toMatchObject({ key: 'check:power', step: 'formal', severity: 'error' })
    expect(issue.question).toContain('63 A')
  })

  it('gniazda dodatkowe liczą się do bilansu ze współczynnikiem jednoczesności; brak mocy maszyny → ostrzeżenie', () => {
    expect(powerBalance({ powerLimitA: 100, socketsCurrentA: 96, machinePowerKw: 10 })!.ok).toBe(false)
    // OF029: 96 A gniazd × 0,3 = 28,8 A + 40 kW (57,7 A) = 86,5 A → przyłącze 100 A; współczynnik z wyceny ma pierwszeństwo.
    const p = powerBalance({ powerLimitA: 29, socketsCurrentA: 96, machinePowerKw: 40 }, 0.3)!
    expect(p).toMatchObject({ socketsNominalA: 96, socketsFactor: 0.3, socketsA: 28.8, needA: 86.5 })
    expect(powerBalance({ powerLimitA: 63, socketsCurrentA: 96, machinePowerKw: 40, socketsFactor: 0 }, 0.3)!.ok).toBe(true)
    expect(quoteChecks(base({ info: { powerLimitA: 29, socketsCurrentA: 96, machinePowerKw: 40 }, settings: { blockedCerts: [], standardLeadDays: null, customMarginMin: 2, socketsSimultaneity: 0.3 } }))[0]!.question).toContain('100 A')
    expect(quoteChecks(base({ info: { powerLimitA: 63 } }))[0]).toMatchObject({ key: 'check:power_unknown', severity: 'warning' })
  })

  it('certyfikat zablokowany, krótki termin, gwarancja poniżej minimum / punktów', () => {
    expect(keys(base({ info: { requiredCerts: ['atex', 'PCA'], deliveryDays: 90, minWarrantyMonths: 36 } }))).toEqual(['check:certs', 'check:lead_time', 'check:warranty_min'])
    expect(keys(base({ info: { scoredWarrantyMonths: 60, warrantyWeight: 20 }, params: { ...DEFAULT_PARAMS, warrantyMonths: 36 } }))).toEqual(['check:warranty_points'])
  })
})

describe('W2 — tryb, technologia, wymiary', () => {
  it('tryb custom z flag i checklisty', () => {
    expect(quoteMode(cl({ rate: { n: 2 }, material_inner: { v: 'stal nierdzewna 316' } }), ['Wykonanie zewnętrzne (IPX)']).reasons).toEqual(['wykonanie zewnętrzne / IPX', 'stal 316', 'dynamika 2 K/min > 1 K/min'])
    expect(quoteMode(cl({ rate: { n: 1 } }), []).custom).toBe(false)
  })

  it('drzewo doboru technologii', () => {
    expect(suggestTechnology(-10)?.primary).toBe('single')
    expect(suggestTechnology(-40)).toEqual({ primary: 'two_stage', alternative: 'cascade' })
    expect(suggestTechnology(-70)).toEqual({ primary: 'cascade', alternative: null })
  })

  it('clash detection: OF029 — chiller na dachu nie mieści się w wysokości', () => {
    const inner = { w: 2200, h: 2400, d: 2400 }
    const info = { outerMaxMm: { w: 3000, h: 4000, d: 8000 }, layout: { wallMm: 150, roofUnitMm: 1600, frameMm: 200, machineRoomMm: 2500 } }
    const l = layoutCheck(inner, info)!
    expect(l.free).toEqual({ w: 500, h: 1300, d: 5300 })
    expect(l.over).toEqual({ w: false, h: true, d: false })
    expect(quoteChecks(base({ inner, info }))[0]).toMatchObject({ key: 'check:dims', step: 'calc', severity: 'error' })
    expect(shellMassKg(inner)).toBeGreaterThan(600)
  })

  it('kompensacja ciepła bez obciążenia w kalkulatorze; marża custom; dynamika bez normy → pytanie', () => {
    const k = keys(base({ checklist: cl({ heat_compensation: { t: '5 kW @ +20 °C' }, rate: { n: 2 } }), params: { ...DEFAULT_PARAMS, marginMultiplier: 1.6 } }))
    expect(k).toEqual(['check:heat_comp', 'check:rate_definition', 'check:custom_margin'])
  })
})

describe('W4 — cena: rezerwa „za rok”, bufor kar, serwis', () => {
  const p = (o: Partial<QuoteParams> = {}): QuoteParams => ({ ...DEFAULT_PARAMS, marginMultiplier: 2, reservePctOverride: null, ...o })

  it('rezerwa wg Kamila: 20% za 2 lata ± 5% za rok (15 / 20 / 25 / 35%)', () => {
    const s = { ...DEFAULT_RESERVE, formula: 'perYear' as const, baseYears: 2, perYear: 0.05 }
    expect([12, 24, 36, 60].map((m) => reservePct({ complexity: 'medium', warrantyMonths: m, reservePctOverride: null }, s))).toEqual([0.15, 0.2, 0.25, 0.35])
    // Domyślny wzór bez zmian (istniejące wyceny nie zmieniają ceny).
    expect(reservePct({ complexity: 'medium', warrantyMonths: 36, reservePctOverride: null })).toBe(0.4)
  })

  it('OF029 wg arkusza Kamila: 778 000 × 2 + 25% = 1 750 500 zł netto; serwis i kary jako osobne składniki', () => {
    expect(priceFor(778000, p({ reservePctOverride: 0.25 })).net).toBe(1750500)
    const sp = { serviceSpareParts: 30000, serviceInspections: 4, serviceInspectionCost: 5000, serviceVisits: 3, serviceVisitCost: 4000 }
    expect(serviceCost(sp)).toBe(62000)
    const withService = priceFor(778000, p({ reservePctOverride: 0.25, ...sp }))
    expect(withService).toMatchObject({ serviceValue: 62000, net: 1812500 })
    // Kara 0,2%/dzień od brutto × 14 dni: bufor = netto × k(1+VAT) → netto = baza / (1 − k(1+VAT)).
    const pen = priceFor(778000, p({ reservePctOverride: 0.25, delayDays: 14 }), DEFAULT_RESERVE, { pctPerDay: 0.002, base: 'gross' })
    expect(pen.penaltyValue).toBeCloseTo(pen.gross * 0.002 * 14, 0)
    expect(priceFor(778000, p({ delayDays: 14 }), DEFAULT_RESERVE, { pctPerDay: 0.002, base: 'cost' }).penaltyValue).toBeCloseTo(778000 * 0.028, 2)
  })

  it('brak bufora przy karze z SWZ, budżet, rynek, pytania krytyczne', () => {
    const k = keys(base({ info: { penaltyPctPerDay: 0.002, budget: 1000 }, gross: 1500, net: 1220, competitionPln: [900, 1200], criticalOpenQuestions: ['Zasilanie?'] }))
    expect(k).toEqual(['check:penalty_buffer', 'check:budget', 'check:market', 'check:critical_questions'])
  })
})
