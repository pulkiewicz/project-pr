import { describe, expect, it } from 'vitest'
import { addWeeks, daysToMask, isoWeekOf, maskToDays, overlapsWeek, weekEnd, weekStart } from './isoweek.ts'

describe('tydzień ISO', () => {
  it('2026-W41 = 05.10–11.10 (przykład ze specyfikacji)', () => {
    expect(isoWeekOf('2026-10-05')).toBe('2026-W41')
    expect(isoWeekOf('2026-10-11')).toBe('2026-W41')
    expect(weekStart('2026-W41')).toBe('2026-10-05')
    expect(weekEnd('2026-W41')).toBe('2026-10-11')
  })

  it('przełom roku: 01.01.2027 (pt) należy do 2026-W53; 04.01.2027 = 2027-W01', () => {
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53')
    expect(isoWeekOf('2027-01-04')).toBe('2027-W01')
    expect(addWeeks('2026-W53', 1)).toBe('2027-W01')
    expect(addWeeks('2027-W01', -1)).toBe('2026-W53')
  })

  it('nakładanie się przedziału na tydzień', () => {
    expect(overlapsWeek('2026-W41', '2026-09-21', '2026-10-05')).toBe(true)
    expect(overlapsWeek('2026-W41', '2026-10-12', '2026-10-20')).toBe(false)
    expect(overlapsWeek('2026-W41', null, null)).toBe(false)
  })

  it('maska dni pon–niedz', () => {
    expect(daysToMask([0, 2, 4])).toBe(0b10101)
    expect(maskToDays(0b1100000)).toEqual([5, 6])
  })
})
