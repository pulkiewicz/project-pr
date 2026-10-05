import { describe, expect, it } from 'vitest'
import { purchaseAlerts, purchaseDates } from './compute.ts'

const base = { taskPlannedStart: '2027-02-01', bufferDays: null, leadTimeWeeks: 6, status: 'to_inquire' as const, orderDateActual: null, confirmedDeliveryDate: null }

describe('M4 — daty i alerty', () => {
  it('need_date = start − 5 dni roboczych; order_by = need − lead time', () => {
    // 01.02.2027 (pon) − 5 dni roboczych = 25.01.2027 (pon); − 6 tyg. = 14.12.2026
    expect(purchaseDates(base)).toEqual({ needDate: '2027-01-25', orderByDate: '2026-12-14' })
  })

  it('bufor pomija święta PL', () => {
    // 07.01.2027 (czw); wstecz: 05.01 (wt), 04.01 (pn), 01.01 święto, 31.12 (czw), 30.12 (śr), 29.12 (wt) → 5 dni = 29.12.2026
    expect(purchaseDates({ ...base, taskPlannedStart: '2027-01-07' }).needDate).toBe('2026-12-29')
  })

  it('bez zadania HRF lub lead time — brak dat', () => {
    expect(purchaseDates({ ...base, taskPlannedStart: null })).toEqual({ needDate: null, orderByDate: null })
    expect(purchaseDates({ ...base, leadTimeWeeks: null }).orderByDate).toBeNull()
  })

  it('termin zamówienia za ≤ 14 dni → żółty; minął → czerwony; złożone zamówienie → brak', () => {
    expect(purchaseAlerts(base, '2026-12-04')).toEqual([{ code: 'order_due_soon', severity: 'yellow', days: 10 }])
    expect(purchaseAlerts(base, '2026-12-20')).toEqual([{ code: 'order_overdue', severity: 'red', days: 6 }])
    expect(purchaseAlerts(base, '2026-11-01')).toEqual([])
    expect(purchaseAlerts({ ...base, status: 'ordered', orderDateActual: '2026-12-15', confirmedDeliveryDate: '2027-01-20' }, '2026-12-20')).toEqual([])
  })

  it('dostawa po dacie potrzeby → czerwony z liczbą dni', () => {
    const a = purchaseAlerts({ ...base, status: 'confirmed', orderDateActual: '2026-12-10', confirmedDeliveryDate: '2027-01-29' }, '2026-12-20')
    expect(a).toEqual([{ code: 'delivery_after_need', severity: 'red', days: 4 }])
  })

  it('brak potwierdzenia terminu 7 dni po zamówieniu → żółty', () => {
    const a = purchaseAlerts({ ...base, status: 'ordered', orderDateActual: '2026-12-01' }, '2026-12-09')
    expect(a).toEqual([{ code: 'no_confirmation', severity: 'yellow', days: 8 }])
    expect(purchaseAlerts({ ...base, status: 'ordered', orderDateActual: '2026-12-01' }, '2026-12-08')).toEqual([])
  })

  it('dostarczone — bez alertów dostawy', () => {
    expect(purchaseAlerts({ ...base, status: 'delivered', orderDateActual: '2026-12-01', confirmedDeliveryDate: '2027-03-01' }, '2027-03-02')).toEqual([])
  })
})
