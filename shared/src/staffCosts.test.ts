import { describe, expect, it } from 'vitest'
import { addMonths, buildStaffCosts, matchesPerson, payoutMonth, type StaffBankTxInput, type StaffEmployeeInput } from './staffCosts.ts'

const emp = (v: Partial<StaffEmployeeInput>): StaffEmployeeInput => ({
  id: crypto.randomUUID(),
  firstName: 'Jan',
  lastName: 'Kowalski',
  position: null,
  contractType: 'employment',
  contractStart: null,
  contractEnd: null,
  payBasis: 'monthly',
  payAmount: 1_000_000,
  isStudent: false,
  studentUntil: null,
  isActive: true,
  billingName: null,
  ...v,
})
const tx = (date: string, amount: number, name: string, title = 'PRZELEW', kind = 'transfer'): StaffBankTxInput => ({
  id: crypto.randomUUID(),
  bookingDate: date,
  amount,
  kind,
  counterpartyName: name,
  title,
  description: `${title} ${name}`,
})
const wd = () => 20
const today = '2026-11-10'

describe('koszty pracownicze', () => {
  it('dopasowanie osoby: imię i nazwisko w dowolnej kolejności, bez polskich znaków, albo nazwa z karty', () => {
    const e = { firstName: 'Łukasz', lastName: 'Żółć-Nowak', billingName: 'ELTECH Sp. z o.o.' }
    expect(matchesPerson('ZOLC-NOWAK LUKASZ UL. POLNA 1', e)).toBe(true)
    expect(matchesPerson('Łukasz Żółć Nowak', e)).toBe(true)
    expect(matchesPerson('ELTECH SP Z O O', e)).toBe(true)
    expect(matchesPerson('Łukasz Nowakowski', e)).toBe(false)
    expect(matchesPerson('', e)).toBe(false)
  })

  it('okres wypłaty z tytułu „WYNAGRODZENIE mm/rrrr”, inaczej miesiąc księgowania', () => {
    expect(payoutMonth({ bookingDate: '2026-11-10', title: 'WYNAGRODZENIE 10/2026', description: '' })).toBe('2026-10')
    expect(payoutMonth({ bookingDate: '2026-11-10', title: 'Rachunek 3/2026', description: '' })).toBe('2026-11')
    expect(payoutMonth({ bookingDate: '2026-01-08', title: 'WYNAGRODZENIE 12/2025', description: '' })).toBe('2025-12')
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('UoP z karty z narzutem; koniec umowy: puste miesiące, prognoza „po przedłużeniu” i problem', () => {
    const e = emp({ contractEnd: '2026-12-31' })
    const r = buildStaffCosts({ year: '2026', today, employees: [e], bank: [], invoices: [], workingDays: wd })
    const row = r.rows[0]!
    expect(row.group).toBe('employment')
    expect(row.cells[0]).toMatchObject({ amount: 1_000_000, employer: 204_800, source: 'card' })
    expect(row.cells[11]).toMatchObject({ source: 'forecast', marks: ['contract_end'] })
    expect(row.issues).toEqual([{ code: 'ends_soon', severity: 'orange', date: '2026-12-31' }])

    const next = buildStaffCosts({ year: '2027', today, employees: [e], bank: [], invoices: [], workingDays: wd })
    expect(next.rows[0]!.cells[0]).toMatchObject({ amount: 0, source: null, extended: { amount: 1_000_000, employer: 204_800 }, marks: ['after_end'] })
  })

  it('zlecenie: wypłaty z banku, prognoza ze średniej 3 ostatnich miesięcy, student bez ZUS', () => {
    const e = emp({ firstName: 'Anna', lastName: 'Nowak', contractType: 'mandate', payAmount: null, payBasis: null, isStudent: true, studentUntil: '2027-06-30' })
    const bank = [
      tx('2026-07-10', 300_000, 'ANNA NOWAK'),
      tx('2026-08-10', 400_000, 'NOWAK ANNA'),
      tx('2026-09-10', 500_000, 'ANNA NOWAK', 'WYNAGRODZENIE 9/2026', 'salary'),
      tx('2026-10-31', 600_000, 'ANNA NOWAK', 'WYNAGRODZENIE 10/2026', 'salary'),
      tx('2026-10-15', 999_000, 'PIOTR ZIELINSKI', 'WYNAGRODZENIE 10/2026', 'salary'),
    ]
    const r = buildStaffCosts({ year: '2026', today, employees: [e], bank, invoices: [], workingDays: wd })
    const row = r.rows[0]!
    expect(row.cells[9]).toMatchObject({ amount: 600_000, employer: 0, source: 'bank' })
    expect(row.forecastBasis).toBe('avg')
    expect(row.cells[10]).toMatchObject({ amount: 500_000, source: 'forecast' })
    expect(r.unmatched).toEqual([expect.objectContaining({ name: 'PIOTR ZIELINSKI', amount: 999_000 })])
    expect(r.bank[9]).toMatchObject({ salaries: 600_000 + 999_000 })
  })

  it('B2B z faktur kosztowych (netto, bez narzutu); płatność po końcu umowy jest oznaczona', () => {
    const e = emp({ firstName: 'Ewa', lastName: 'Lis', contractType: 'b2b', billingName: 'Lis Consulting', contractEnd: '2026-06-30', isActive: true })
    const invoices = [
      { id: '1', number: 'FV 1/05', sellerName: 'LIS CONSULTING EWA LIS', date: '2026-05-31', net: 1_500_000 },
      { id: '2', number: 'FV 1/09', sellerName: 'Lis Consulting', date: '2026-09-30', net: 1_500_000 },
      { id: '3', number: 'X', sellerName: 'Inna firma', date: '2026-09-30', net: 7 },
    ]
    const r = buildStaffCosts({ year: '2026', today, employees: [e], bank: [], invoices, workingDays: wd })
    const row = r.rows[0]!
    expect(row.cells[4]).toMatchObject({ amount: 1_500_000, employer: 0, source: 'invoice' })
    expect(row.cells[8]!.marks).toContain('paid_after_end')
    expect(row.issues.map((i) => i.code)).toEqual(['expired', 'paid_after_end'])
  })

  it('pracownik bez rodzaju umowy — pominięty, na liście do uzupełnienia', () => {
    const r = buildStaffCosts({ year: '2026', today, employees: [emp({ contractType: null })], bank: [], invoices: [], workingDays: wd })
    expect(r.rows).toEqual([])
    expect(r.missingContract).toEqual(['Kowalski Jan'])
  })
})
