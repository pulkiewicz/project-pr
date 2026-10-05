import { describe, expect, it } from 'vitest'
import { aggregateStatus, computeDashboard, type DashTask } from './compute.ts'

const task = (p: Partial<DashTask> & { id: string; code: string }): DashTask => ({
  name: p.code,
  parentId: null,
  plannedStart: null,
  plannedEnd: null,
  actualEnd: null,
  forecastEnd: null,
  durationDays: 10,
  percentComplete: 0,
  status: 'not_started',
  isMilestone: false,
  isAcceptancePoint: false,
  postAcceptanceAllowed: false,
  isCriticalPath: false,
  responsibleUserId: null,
  ...p,
})

const project = { contractEndDate: '2027-11-15', dayZeroDate: '2026-09-21' }

describe('dashboard', () => {
  const tasks = [
    task({ id: 'S1', code: '1', plannedStart: '2026-09-21', plannedEnd: '2026-10-10', durationDays: 20 }),
    task({ id: 'A', code: '1.1', parentId: 'S1', plannedStart: '2026-09-21', plannedEnd: '2026-09-30', durationDays: 10, percentComplete: 100, status: 'accepted' }),
    task({ id: 'B', code: '1.2', parentId: 'S1', plannedStart: '2026-10-01', plannedEnd: '2026-10-10', durationDays: 10, responsibleUserId: 'me' }),
    task({ id: 'M', code: '1.3', parentId: 'S1', plannedStart: '2026-10-11', plannedEnd: '2026-10-17', durationDays: 7, isAcceptancePoint: true }),
    task({ id: 'P', code: '2.1', plannedStart: '2027-11-15', plannedEnd: '2028-01-15', durationDays: 62, postAcceptanceAllowed: true }),
  ]

  it('postęp ważony czasem trwania, plan na dziś i odchylenie w dniach', () => {
    const d = computeDashboard(tasks, project, '2026-10-05', 'me')
    // wykonanie: A 10 dni × 100% z 27 dni (bez § 3 ust. 8) = 37,0%
    expect(d.progress!.actualPercent).toBe(37)
    // plan na 05.10: A 10/10 + B 5/10 → 15/27 = 55,6%
    expect(d.progress!.plannedPercent).toBe(55.6)
    // plan osiągał 37% 30.09 → 5 dni opóźnienia
    expect(d.progress!.deviationDays).toBe(-5)
  })

  it('odliczanie: dni kalendarzowe, robocze, prognoza bez czynności po odbiorze', () => {
    const d = computeDashboard(tasks, project, '2026-10-05', 'me')
    expect(d.countdown.calendarDays).toBe(406)
    expect(d.countdown.workingDays).toBeGreaterThan(270)
    expect(d.countdown.forecastEnd).toBe('2026-10-17')
    expect(d.countdown.color).toBe('green')
  })

  it('kolor czerwony, gdy prognoza przekracza termin', () => {
    const late = [task({ id: 'X', code: '1', plannedStart: '2026-09-21', plannedEnd: '2027-11-10', forecastEnd: '2027-11-20' })]
    expect(computeDashboard(late, project, '2026-10-05', 'me').countdown.color).toBe('red')
  })

  it('status Etapu, kamienie milowe, alerty, moje zadania', () => {
    const d = computeDashboard(tasks, project, '2026-10-12', 'me')
    expect(d.stages[0]).toMatchObject({ code: '1', status: 'delayed' }) // B po terminie
    expect(d.milestones.map((m) => m.code)).toEqual(['1.3', '2.1'].filter((c) => c === '1.3'))
    expect(d.alerts[0]).toMatchObject({ severity: 'red', entityId: 'B' })
    expect(d.myTasks.map((t) => t.id)).toEqual(['B'])
    expect(d.miniGantt.from).toBe('2026-09-01')
    expect(d.miniGantt.to).toBe('2026-11-30')
  })

  it('agregacja statusów', () => {
    expect(aggregateStatus(['accepted', 'accepted'], 100)).toBe('accepted')
    expect(aggregateStatus(['accepted', 'ready_for_acceptance'], 100)).toBe('ready_for_acceptance')
    expect(aggregateStatus(['in_progress', 'at_risk'], 30)).toBe('at_risk')
    expect(aggregateStatus(['not_started'], 0)).toBe('not_started')
  })

  it('bez dnia „0” — brak postępu, kolor szary, alert', () => {
    const d = computeDashboard([task({ id: 'A', code: '1' })], { ...project, dayZeroDate: null }, '2026-10-05', 'me')
    expect(d.progress).toBeNull()
    expect(d.countdown.color).toBe('gray')
    expect(d.alerts[0]!.message).toContain('Dzień „0”')
  })
})
