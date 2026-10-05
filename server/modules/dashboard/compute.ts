import type { DashboardResponse, HrfStatus } from '#shared'
import { addDays, diffDays, maxDate, workingDaysBetween } from '../../lib/dates.ts'

export interface DashTask {
  id: string
  code: string
  name: string
  parentId: string | null
  plannedStart: string | null
  plannedEnd: string | null
  actualEnd: string | null
  forecastEnd: string | null
  durationDays: number
  percentComplete: number
  status: HrfStatus
  isMilestone: boolean
  isAcceptancePoint: boolean
  postAcceptanceAllowed: boolean
  isCriticalPath: boolean
  responsibleUserId: string | null
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Status efektywny zadania: niewykonane po terminie planowanym = opóźnione. */
export function effectiveStatus(t: DashTask, today: string): HrfStatus {
  if (t.status === 'accepted' || t.status === 'ready_for_acceptance') return t.status
  if (t.plannedEnd && t.plannedEnd < today && t.percentComplete < 100) return 'delayed'
  return t.status
}

export function aggregateStatus(statuses: HrfStatus[], percent: number): HrfStatus {
  if (!statuses.length) return 'not_started'
  if (statuses.every((s) => s === 'accepted')) return 'accepted'
  if (statuses.includes('delayed')) return 'delayed'
  if (statuses.includes('at_risk')) return 'at_risk'
  if (statuses.every((s) => s === 'accepted' || s === 'ready_for_acceptance')) return 'ready_for_acceptance'
  if (percent > 0 || statuses.some((s) => s !== 'not_started')) return 'in_progress'
  return 'not_started'
}

function weighted(leaves: DashTask[], value: (t: DashTask) => number) {
  const total = leaves.reduce((s, t) => s + t.durationDays, 0)
  if (!total) return 0
  return (leaves.reduce((s, t) => s + t.durationDays * value(t), 0) / total) * 100
}

const plannedFraction = (t: DashTask, day: string) =>
  !t.plannedStart ? 0 : clamp01((diffDays(day, t.plannedStart) + 1) / t.durationDays)

export function computeDashboard(
  tasks: DashTask[],
  project: { contractEndDate: string; dayZeroDate: string | null },
  today: string,
  userId: string,
): DashboardResponse {
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[])
  const leaves = tasks.filter((t) => !parents.has(t.id))
  const contractLeaves = leaves.filter((t) => !t.postAcceptanceAllowed)
  const contractEnd = project.contractEndDate

  // 1. Odliczanie + prognoza
  const forecastEnd = contractLeaves.reduce<string | null>(
    (m, t) => maxDate(m, t.actualEnd ?? t.forecastEnd ?? t.plannedEnd),
    null,
  )
  const bufferDays = forecastEnd ? diffDays(contractEnd, forecastEnd) : null
  const color: DashboardResponse['countdown']['color'] =
    bufferDays === null ? 'gray' : bufferDays < 30 ? 'red' : bufferDays <= 90 ? 'yellow' : 'green'

  // 2. Postęp ogólny (ważony czasem trwania) + odchylenie w dniach
  let progress: DashboardResponse['progress'] = null
  if (project.dayZeroDate && contractLeaves.length) {
    const actualPercent = weighted(contractLeaves, (t) => t.percentComplete / 100)
    const plannedAt = (day: string) => weighted(contractLeaves, (t) => plannedFraction(t, day))
    const plannedPercent = plannedAt(today)
    // Dzień, w którym plan osiąga bieżące wykonanie: odchylenie = ten dzień − dziś (ujemne = opóźnienie).
    const first = contractLeaves.reduce((m, t) => (t.plannedStart! < m ? t.plannedStart! : m), contractLeaves[0]!.plannedStart!)
    const last = contractLeaves.reduce((m, t) => (t.plannedEnd! > m ? t.plannedEnd! : m), contractLeaves[0]!.plannedEnd!)
    let lo = addDays(first, -1)
    let hi = last
    if (plannedAt(hi) < actualPercent - 1e-9) lo = hi
    while (diffDays(hi, lo) > 1) {
      const mid = addDays(lo, Math.floor(diffDays(hi, lo) / 2))
      if (plannedAt(mid) >= actualPercent - 1e-9) hi = mid
      else lo = mid
    }
    const deviationDays = actualPercent === 0 && plannedPercent === 0 ? 0 : diffDays(hi, today)
    progress = { actualPercent: round1(actualPercent), plannedPercent: round1(plannedPercent), deviationDays }
  }

  // 3. Status Etapów
  const childrenOf = (id: string): DashTask[] => tasks.filter((t) => t.parentId === id).flatMap((c) => (parents.has(c.id) ? childrenOf(c.id) : [c]))
  const stages = tasks
    .filter((t) => !t.parentId)
    .map((s) => {
      const ls = parents.has(s.id) ? childrenOf(s.id) : [s]
      const percent = weighted(ls, (t) => t.percentComplete / 100)
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        percent: round1(percent),
        status: aggregateStatus(ls.map((t) => effectiveStatus(t, today)), percent),
        plannedStart: s.plannedStart,
        plannedEnd: s.plannedEnd,
      }
    })

  // 4. Najbliższe kamienie milowe
  const milestones = tasks
    .filter((t) => (t.isAcceptancePoint || t.isMilestone) && t.plannedEnd && t.plannedEnd >= today && t.status !== 'accepted')
    .sort((a, b) => a.plannedEnd!.localeCompare(b.plannedEnd!))
    .slice(0, 5)
    .map((t) => ({ id: t.id, code: t.code, name: t.name, date: t.plannedEnd!, isAcceptancePoint: t.isAcceptancePoint }))

  // 5. Alerty HRF (lekkie, liczone w locie; alerty z innych modułów dojdą przez tabelę `alerts` w E2+)
  const alerts: DashboardResponse['alerts'] = []
  if (!project.dayZeroDate) alerts.push({ severity: 'yellow', module: 'hrf', message: 'Dzień „0” nie jest ustawiony' })
  for (const t of leaves) {
    if (t.status === 'accepted') continue
    if (t.plannedEnd && t.plannedEnd < today && t.percentComplete < 100) {
      alerts.push({ severity: 'red', module: 'hrf', message: `${t.code} ${t.name}: po terminie planowanym (${diffDays(today, t.plannedEnd)} dni)`, entityId: t.id })
    } else if (t.plannedStart && t.plannedStart <= today && t.percentComplete === 0 && t.status === 'not_started') {
      alerts.push({ severity: 'yellow', module: 'hrf', message: `${t.code} ${t.name}: nierozpoczęte mimo planowanego startu`, entityId: t.id })
    }
  }
  for (const m of milestones) {
    if (diffDays(m.date, today) <= 14) alerts.push({ severity: 'yellow', module: 'hrf', message: `${m.code} ${m.name}: termin za ${diffDays(m.date, today)} dni`, entityId: m.id })
  }
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1))

  // 6. Mini-Gantt: od 1. dnia poprzedniego miesiąca do końca następnego
  const [y, mo] = today.split('-').map(Number) as [number, number]
  const from = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10)
  const to = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10)
  const miniGantt = {
    from,
    to,
    tasks: leaves
      .filter((t) => t.plannedStart && t.plannedEnd && t.plannedStart <= to && t.plannedEnd >= from)
      .map((t) => ({ id: t.id, code: t.code, name: t.name, start: t.plannedStart!, end: t.plannedEnd!, percent: t.percentComplete, status: effectiveStatus(t, today), critical: t.isCriticalPath })),
  }

  // 7. Moje zadania (HRF; action items i plan tygodniowy dojdą w E3/E5)
  const myTasks = leaves
    .filter((t) => t.responsibleUserId === userId && t.status !== 'accepted')
    .sort((a, b) => (a.plannedEnd ?? '9999').localeCompare(b.plannedEnd ?? '9999'))
    .map((t) => ({ id: t.id, code: t.code, name: t.name, plannedEnd: t.plannedEnd, status: effectiveStatus(t, today), source: 'hrf' as const }))

  return {
    today,
    countdown: {
      contractEndDate: contractEnd,
      calendarDays: diffDays(contractEnd, today),
      workingDays: workingDaysBetween(today, contractEnd),
      forecastEnd,
      bufferDays,
      color,
    },
    progress,
    stages,
    milestones,
    alerts: alerts.slice(0, 20),
    miniGantt,
    myTasks,
    dayZeroSet: !!project.dayZeroDate,
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10
