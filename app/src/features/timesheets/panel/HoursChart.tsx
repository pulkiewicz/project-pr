import { useElementSize } from '@mantine/hooks'
import { useMemo, useState } from 'react'
import { hours as H, type TimesheetSummaryResponse } from '#shared'

/** Paleta i kolejność z workload-calendar (chartPalette.js) — zwalidowana jakościowo, nigdy nie zapętlana. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const OTHER_COLOR = '#8a8f98'

export interface Series {
  id: string
  name: string
  color: string
  values: number[]
  total: number
}

/**
 * Kolory według kolejności alfabetycznej (zmiana okresu nie przemalowuje osób); powyżej 8 osób najmniejsze wyniki
 * zwijane do szarej pozycji „Pozostali”.
 */
export function buildSeries(employees: TimesheetSummaryResponse['employees'], buckets: string[]): Series[] {
  if (!employees.length) return []
  const valuesFor = (e: (typeof employees)[number]) => buckets.map((b) => Number(e.byBucket?.[b]) || 0)
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pl')
  const colored = (list: typeof employees) => [...list].sort(byName).map((e, i) => ({ id: e.id, name: e.name, color: SERIES_COLORS[i]!, values: valuesFor(e), total: e.total }))
  if (employees.length <= SERIES_COLORS.length) return colored(employees)
  const ranked = [...employees].sort((a, b) => b.total - a.total)
  const kept = ranked.slice(0, SERIES_COLORS.length - 1)
  const folded = ranked.slice(SERIES_COLORS.length - 1)
  const foldedValues = folded.map(valuesFor)
  return [
    ...colored(kept),
    {
      id: '__other__',
      name: `Pozostali (${folded.length} ${folded.length === 1 ? 'osoba' : 'osób'})`,
      color: OTHER_COLOR,
      values: buckets.map((_, i) => foldedValues.reduce((s, row) => s + row[i]!, 0)),
      total: folded.reduce((s, e) => s + e.total, 0),
    },
  ]
}

const PAD = { top: 12, right: 12, bottom: 34, left: 46 }
const PLOT_HEIGHT = 230
const BAR_GAP = 2
const MAX_BAR_WIDTH = 24
const MIN_BAR_WIDTH = 3
const GROUP_PAD = 8

/** Wykres słupkowy grupowany: oś X — dni albo miesiące, słupek na osobę; klik w legendę ukrywa serię. */
export function HoursChart({ buckets, granularity, series }: { buckets: string[]; granularity: 'day' | 'month'; series: Series[] }) {
  const { ref, width } = useElementSize()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = series.filter((s) => !hidden.has(s.id))
  const toggle = (id: string) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else if (next.size < series.length - 1) next.add(id) // zawsze zostaje jedna seria
    setHidden(next)
  }

  const available = Math.max(240, width - PAD.left - PAD.right)
  const perGroup = available / Math.max(1, buckets.length)
  const count = visible.length || 1
  const barWidth = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, Math.floor((perGroup - GROUP_PAD - (count - 1) * BAR_GAP) / count)))
  const groupWidth = Math.max(perGroup, count * barWidth + (count - 1) * BAR_GAP + GROUP_PAD)
  const plotWidth = groupWidth * buckets.length
  const max = Math.max(1, ...visible.flatMap((s) => s.values))
  const step = max <= 8 ? 2 : max <= 16 ? 4 : max <= 40 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 50) * 50
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  const y = (v: number) => PAD.top + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT
  const label = (b: string) => (granularity === 'day' ? String(Number(b.slice(8, 10))) : H.formatMonth(b).replace(/ \d{4}$/, '').slice(0, 3))
  const labelEvery = granularity === 'day' && groupWidth < 18 ? 2 : 1

  const svgWidth = PAD.left + plotWidth + PAD.right
  const legend = useMemo(() => series, [series])
  return (
    <div>
      <div ref={ref} style={{ overflowX: 'auto' }}>
        <svg width={Math.max(svgWidth, width)} height={PAD.top + PLOT_HEIGHT + PAD.bottom} role="img" aria-label="Wykres godzin">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(t)} y2={y(t)} stroke="#e6e8ec" />
              <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#6b7280">
                {H.formatHours(t)}
              </text>
            </g>
          ))}
          {buckets.map((b, gi) => {
            const x0 = PAD.left + gi * groupWidth + (groupWidth - (count * barWidth + (count - 1) * BAR_GAP)) / 2
            const weekend = granularity === 'day' && H.isWeekend(b)
            return (
              <g key={b}>
                {weekend && <rect x={PAD.left + gi * groupWidth} y={PAD.top} width={groupWidth} height={PLOT_HEIGHT} fill="#fafbfc" />}
                {visible.map((s, si) => {
                  const v = s.values[gi] ?? 0
                  if (!v) return null
                  return (
                    <rect key={s.id} x={x0 + si * (barWidth + BAR_GAP)} y={y(v)} width={barWidth} height={PLOT_HEIGHT + PAD.top - y(v)} fill={s.color} rx={2}>
                      <title>{`${s.name} · ${granularity === 'day' ? `${H.DAY_SHORT[H.dayOfWeek(b)]} ${H.formatDayMonth(b)}` : H.formatMonth(b)}: ${H.formatHours(v)} h`}</title>
                    </rect>
                  )
                })}
                {gi % labelEvery === 0 && (
                  <text x={PAD.left + gi * groupWidth + groupWidth / 2} y={PAD.top + PLOT_HEIGHT + 16} textAnchor="middle" fontSize={11} fill={weekend ? '#9aa1ab' : '#616874'}>
                    {label(b)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {legend.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            aria-pressed={!hidden.has(s.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 0, padding: 0, cursor: 'pointer', opacity: hidden.has(s.id) ? 0.4 : 1, font: 'inherit', fontSize: 13 }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
            {s.name} <span style={{ color: '#616874' }}>{H.formatHours(s.total)} h</span>
          </button>
        ))}
      </div>
    </div>
  )
}
