import { describe, expect, it } from 'vitest'
import { addDays, isWorkingDay, plannedDates, todayWarsaw, workingDaysBetween } from './dates.ts'

describe('daty', () => {
  it('daty planowane jak w HRF: tydzień a–b → start = d0+(a−1)·7, koniec = d0+b·7−1', () => {
    // Zadanie 2.2, tygodnie 4–6, dzień „0” = 21.09.2026
    const offset = (4 - 1) * 7
    const duration = (6 - 4 + 1) * 7
    expect(plannedDates('2026-09-21', offset, duration)).toEqual({ plannedStart: '2026-10-12', plannedEnd: '2026-11-01' })
    expect(plannedDates(null, 0, 7)).toEqual({ plannedStart: null, plannedEnd: null })
  })

  it('arytmetyka dat jest odporna na zmianę czasu', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29')
  })

  it('święta PL i weekendy nie są dniami roboczymi', () => {
    expect(isWorkingDay('2027-11-11')).toBe(false) // Święto Niepodległości
    expect(isWorkingDay('2027-11-01')).toBe(false) // Wszystkich Świętych
    expect(isWorkingDay('2027-11-13')).toBe(false) // sobota
    expect(isWorkingDay('2027-11-12')).toBe(true)
  })

  it('dni robocze w listopadzie 2027 (od 31.10 do 15.11)', () => {
    // 1.11 i 11.11 święta; robocze: 2,3,4,5,8,9,10,12,15 = 9
    expect(workingDaysBetween('2027-10-31', '2027-11-15')).toBe(9)
  })

  it('dzisiejsza data liczona w strefie Europe/Warsaw', () => {
    expect(todayWarsaw(new Date('2026-10-04T22:30:00Z'))).toBe('2026-10-05')
  })
})
