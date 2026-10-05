import { describe, expect, it } from 'vitest'
import { DependencyCycleError, computeCpm } from './cpm.ts'

const t = (id: string, startOffset: number, duration: number) => ({ id, startOffset, duration })

describe('CPM', () => {
  it('łańcuch FS: dłuższa gałąź jest krytyczna, krótsza ma zapas', () => {
    //   A(5) → B(10) → D(3)
    //   A(5) → C(4)  → D
    const r = computeCpm(
      [t('A', 0, 5), t('B', 0, 10), t('C', 0, 4), t('D', 0, 3)],
      [
        { taskId: 'B', predecessorId: 'A', type: 'FS', lagDays: 0 },
        { taskId: 'C', predecessorId: 'A', type: 'FS', lagDays: 0 },
        { taskId: 'D', predecessorId: 'B', type: 'FS', lagDays: 0 },
        { taskId: 'D', predecessorId: 'C', type: 'FS', lagDays: 0 },
      ],
    )
    expect(r.projectFinish).toBe(18)
    expect(r.schedule.get('B')).toMatchObject({ es: 5, ef: 15, float: 0, critical: true })
    expect(r.schedule.get('C')).toMatchObject({ es: 5, ef: 9, float: 6, critical: false })
    expect(['A', 'B', 'D'].every((id) => r.schedule.get(id)!.critical)).toBe(true)
  })

  it('opóźnienie (lag) i typy SS / FF', () => {
    const r = computeCpm(
      [t('A', 0, 10), t('B', 0, 6), t('C', 0, 4)],
      [
        { taskId: 'B', predecessorId: 'A', type: 'SS', lagDays: 3 }, // B start ≥ A start + 3
        { taskId: 'C', predecessorId: 'A', type: 'FF', lagDays: 2 }, // C koniec ≥ A koniec + 2
      ],
    )
    expect(r.schedule.get('B')!.es).toBe(3)
    expect(r.schedule.get('C')).toMatchObject({ es: 8, ef: 12 })
    expect(r.projectFinish).toBe(12)
    expect(r.schedule.get('C')!.critical).toBe(true)
    expect(r.schedule.get('A')!.critical).toBe(true) // FF wiąże A z końcem projektu
    expect(r.schedule.get('B')!.float).toBe(3)
  })

  it('planowany offset działa jak „start nie wcześniej niż”', () => {
    const r = computeCpm([t('A', 0, 5), t('B', 20, 5)], [{ taskId: 'B', predecessorId: 'A', type: 'FS', lagDays: 0 }])
    expect(r.schedule.get('B')!.es).toBe(20)
    expect(r.schedule.get('A')!.float).toBe(15)
  })

  it('wykrywa cykl zależności', () => {
    expect(() =>
      computeCpm(
        [t('A', 0, 1), t('B', 0, 1), t('C', 0, 1)],
        [
          { taskId: 'B', predecessorId: 'A', type: 'FS', lagDays: 0 },
          { taskId: 'C', predecessorId: 'B', type: 'FS', lagDays: 0 },
          { taskId: 'A', predecessorId: 'C', type: 'FS', lagDays: 0 },
        ],
      ),
    ).toThrow(DependencyCycleError)
  })

  it('500 zadań w łańcuchu liczy się szybko', () => {
    const tasks = Array.from({ length: 500 }, (_, i) => t(`T${i}`, 0, 3))
    const deps = tasks.slice(1).map((x, i) => ({ taskId: x.id, predecessorId: `T${i}`, type: 'FS' as const, lagDays: 0 }))
    const start = performance.now()
    const r = computeCpm(tasks, deps)
    expect(performance.now() - start).toBeLessThan(200)
    expect(r.projectFinish).toBe(1500)
  })
})
