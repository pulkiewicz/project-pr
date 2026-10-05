import Gantt, { type FrappeTask } from 'frappe-gantt'
import { useEffect, useMemo, useRef } from 'react'
import type { HrfDependencyDto, HrfTaskDto } from '#shared'
import 'frappe-gantt.css'
import './gantt.css'

export type GanttView = 'Day' | 'Week' | 'Month'

interface Props {
  tasks: HrfTaskDto[]
  dependencies: HrfDependencyDto[]
  view: GanttView
  contractEndDate: string
  deadlineLabel: string
  baseline?: Map<string, { start: string | null; end: string | null }>
  onTaskClick?: (id: string) => void
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const DAY = 86_400_000

/** Pozycja X daty w układzie frappe-gantt (ta sama formuła co dla pasków). */
function xFor(g: Gantt, date: string): number {
  const d = new Date(`${date}T00:00:00`)
  const start = g.gantt_start
  if (g.config.unit === 'month') {
    const months = (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth()
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    return ((months + (d.getDate() - 1) / dim) / g.config.step) * g.config.column_width
  }
  if (g.config.unit === 'year') return ((d.getTime() - start.getTime()) / (365.25 * DAY) / g.config.step) * g.config.column_width
  const units = g.config.unit === 'hour' ? (d.getTime() - start.getTime()) / 3_600_000 : (d.getTime() - start.getTime()) / DAY
  return (units / g.config.step) * g.config.column_width
}

function drawOverlays(g: Gantt, p: Pick<Props, 'contractEndDate' | 'deadlineLabel' | 'baseline'>) {
  g.$svg.querySelector('g.pmo-overlay')?.remove()
  const layer = document.createElementNS(SVG_NS, 'g')
  layer.setAttribute('class', 'pmo-overlay')
  const height = g.$svg.getBoundingClientRect().height || g.grid_height

  // Plan bazowy: przerywany prostokąt pod paskiem bieżącym.
  if (p.baseline) {
    g.$svg.querySelectorAll<SVGGElement>('.bar-wrapper').forEach((wrapper) => {
      const id = wrapper.getAttribute('data-id')
      const b = id ? p.baseline!.get(id) : undefined
      const bar = wrapper.querySelector('.bar')
      if (!b?.start || !b.end || !bar) return
      const y = Number(bar.getAttribute('y')) + Number(bar.getAttribute('height')) + 1
      const x1 = xFor(g, b.start)
      const end = new Date(new Date(`${b.end}T00:00:00`).getTime() + DAY)
      const x2 = xFor(g, `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)
      const rect = document.createElementNS(SVG_NS, 'rect')
      rect.setAttribute('x', String(x1))
      rect.setAttribute('y', String(y))
      rect.setAttribute('width', String(Math.max(2, x2 - x1)))
      rect.setAttribute('height', '4')
      rect.setAttribute('class', 'pmo-baseline')
      layer.appendChild(rect)
    })
  }

  // Termin umowny: pionowa linia na koniec dnia terminu.
  const deadlineNext = new Date(new Date(`${p.contractEndDate}T00:00:00`).getTime() + DAY)
  const x = xFor(g, `${deadlineNext.getFullYear()}-${String(deadlineNext.getMonth() + 1).padStart(2, '0')}-${String(deadlineNext.getDate()).padStart(2, '0')}`)
  const line = document.createElementNS(SVG_NS, 'line')
  line.setAttribute('x1', String(x))
  line.setAttribute('x2', String(x))
  line.setAttribute('y1', String(g.config.header_height))
  line.setAttribute('y2', String(height))
  line.setAttribute('class', 'pmo-deadline')
  const label = document.createElementNS(SVG_NS, 'text')
  label.setAttribute('x', String(x + 4))
  label.setAttribute('y', String(g.config.header_height + 14))
  label.setAttribute('class', 'pmo-deadline-label')
  label.textContent = p.deadlineLabel
  layer.append(line, label)
  g.$svg.appendChild(layer)
}

export function GanttChart(props: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const gantt = useRef<Gantt | null>(null)
  const latest = useRef(props)
  latest.current = props

  const frappeTasks = useMemo<FrappeTask[]>(() => {
    const parents = new Set(props.tasks.map((t) => t.parentId).filter(Boolean))
    const deps = new Map<string, string[]>()
    for (const d of props.dependencies) deps.set(d.taskId, [...(deps.get(d.taskId) ?? []), d.predecessorId])
    return props.tasks
      .filter((t) => t.plannedStart && t.plannedEnd)
      .map((t) => ({
        id: t.id,
        name: `${t.code} ${t.name}`,
        start: t.plannedStart!,
        end: t.plannedEnd!,
        progress: t.percentComplete,
        dependencies: (deps.get(t.id) ?? []).join(', '),
        // frappe-gantt przyjmuje jeden token klasy: g-<rodzaj>-<status>-c<0|1>
        custom_class: `g-${parents.has(t.id) ? 'sum' : t.isAcceptancePoint ? 'acc' : 'task'}-${t.status}-c${t.isCriticalPath && !parents.has(t.id) ? 1 : 0}`,
      }))
  }, [props.tasks, props.dependencies])

  useEffect(() => {
    if (!ref.current) return
    if (!frappeTasks.length) {
      ref.current.innerHTML = ''
      gantt.current = null
      return
    }
    if (!gantt.current) {
      ref.current.innerHTML = ''
      gantt.current = new Gantt(ref.current, frappeTasks, {
        view_mode: props.view,
        language: 'pl',
        readonly: true,
        popup_on: 'hover',
        bar_height: 22,
        padding: 14,
        today_button: false,
        infinite_padding: false,
        scroll_to: 'today',
        on_click: (task) => latest.current.onTaskClick?.(task.id),
        on_view_change: () => queueMicrotask(() => gantt.current && drawOverlays(gantt.current, latest.current)),
      })
    } else {
      gantt.current.refresh(frappeTasks)
    }
    drawOverlays(gantt.current, latest.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frappeTasks])

  useEffect(() => {
    gantt.current?.change_view_mode(props.view, true)
  }, [props.view])

  useEffect(() => {
    if (gantt.current) drawOverlays(gantt.current, props)
  }, [props.baseline, props.contractEndDate, props.deadlineLabel]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={ref} className="pmo-gantt" data-testid="gantt" />
}
