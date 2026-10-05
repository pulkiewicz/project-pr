import type { DependencyType } from '#shared'

export interface CpmTask {
  id: string
  /** Najwcześniejszy dopuszczalny start (offset planowany względem dnia „0”) — ograniczenie „start nie wcześniej niż”. */
  startOffset: number
  duration: number
}

export interface CpmDependency {
  taskId: string
  predecessorId: string
  type: DependencyType
  lagDays: number
}

export interface CpmResult {
  /** Najwcześniejszy start/koniec (koniec wyłączny), najpóźniejszy start/koniec, zapas całkowity — w dniach od dnia „0”. */
  schedule: Map<string, { es: number; ef: number; ls: number; lf: number; float: number; critical: boolean }>
  projectFinish: number
}

export class DependencyCycleError extends Error {
  constructor(public readonly taskIds: string[]) {
    super('dependency_cycle')
  }
}

/**
 * Metoda ścieżki krytycznej (CPM) na dniach kalendarzowych.
 * Zależności: FS (koniec→start), SS (start→start), FF (koniec→koniec), z opóźnieniem `lagDays` (może być ujemne).
 * Planowany offset zadania działa jako ograniczenie „start nie wcześniej niż”.
 * Zadanie krytyczne = zapas całkowity ≤ 0.
 */
export function computeCpm(tasks: CpmTask[], deps: CpmDependency[]): CpmResult {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const preds = new Map<string, CpmDependency[]>()
  const succs = new Map<string, CpmDependency[]>()
  for (const t of tasks) {
    preds.set(t.id, [])
    succs.set(t.id, [])
  }
  for (const d of deps) {
    if (!byId.has(d.taskId) || !byId.has(d.predecessorId)) continue
    preds.get(d.taskId)!.push(d)
    succs.get(d.predecessorId)!.push(d)
  }

  // Sortowanie topologiczne (Kahn) z wykrywaniem cykli.
  const indeg = new Map(tasks.map((t) => [t.id, preds.get(t.id)!.length]))
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const s of succs.get(id)!) {
      const n = indeg.get(s.taskId)! - 1
      indeg.set(s.taskId, n)
      if (n === 0) queue.push(s.taskId)
    }
  }
  if (order.length !== tasks.length) {
    throw new DependencyCycleError(tasks.filter((t) => indeg.get(t.id)! > 0).map((t) => t.id))
  }

  const es = new Map<string, number>()
  const ef = new Map<string, number>()
  for (const id of order) {
    const t = byId.get(id)!
    let start = t.startOffset
    for (const d of preds.get(id)!) {
      const p = d.predecessorId
      if (d.type === 'FS') start = Math.max(start, ef.get(p)! + d.lagDays)
      else if (d.type === 'SS') start = Math.max(start, es.get(p)! + d.lagDays)
      else start = Math.max(start, ef.get(p)! + d.lagDays - t.duration)
    }
    es.set(id, start)
    ef.set(id, start + t.duration)
  }
  const projectFinish = Math.max(0, ...ef.values())

  const ls = new Map<string, number>()
  const lf = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const t = byId.get(id)!
    let finish = projectFinish
    for (const d of succs.get(id)!) {
      const s = d.taskId
      if (d.type === 'FS') finish = Math.min(finish, ls.get(s)! - d.lagDays)
      else if (d.type === 'SS') finish = Math.min(finish, ls.get(s)! - d.lagDays + t.duration)
      else finish = Math.min(finish, lf.get(s)! - d.lagDays)
    }
    lf.set(id, finish)
    ls.set(id, finish - t.duration)
  }

  const schedule: CpmResult['schedule'] = new Map()
  for (const t of tasks) {
    const float = ls.get(t.id)! - es.get(t.id)!
    schedule.set(t.id, { es: es.get(t.id)!, ef: ef.get(t.id)!, ls: ls.get(t.id)!, lf: lf.get(t.id)!, float, critical: float <= 0 })
  }
  return { schedule, projectFinish }
}
