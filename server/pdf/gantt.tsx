import { Document, Line, Page, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { HrfTaskDto } from '#shared'
import { addDays, diffDays, parseDate } from '../lib/dates.ts'
import { registerFonts } from './fonts.ts'

const NAVY = '#1F3A5F'
// A3 poziomo (pt)
const PAGE_W = 1190.55
const PAGE_H = 841.89
const MARGIN = 24
const LABEL_W = 330
const ROW_H = 11
const HEADER_H = 64
const FOOTER_H = 18
const ROWS_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN - HEADER_H - FOOTER_H - 22) / ROW_H)

const STATUS_COLOR: Record<string, string> = {
  not_started: '#9AA5B1',
  in_progress: '#406CAB',
  at_risk: '#F2A900',
  delayed: '#D64545',
  ready_for_acceptance: '#7E57C2',
  accepted: '#2E9D57',
}

const s = StyleSheet.create({
  page: { fontFamily: 'DejaVu', fontSize: 7, padding: MARGIN, color: '#1d2733' },
  title: { fontSize: 13, fontWeight: 'bold', color: NAVY },
  sub: { fontSize: 8, color: '#555', marginTop: 2 },
  row: { flexDirection: 'row', height: ROW_H, alignItems: 'center' },
  code: { width: 34 },
  name: { width: LABEL_W - 34, paddingRight: 6 },
  footer: { position: 'absolute', bottom: MARGIN - 6, left: MARGIN, right: MARGIN, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#777' },
})

const fmt = (d: string) => d.split('-').reverse().join('.')

export interface GanttPdfInput {
  projectName: string
  contractEnd: string
  dayZero: string
  today: string
  tasks: HrfTaskDto[]
  generatedBy: string
}

/** Wykres Gantta jako PDF A3 poziomo — rysowany prymitywami @react-pdf z danych (bez zrzutu ekranu). */
export function GanttDocument(p: GanttPdfInput) {
  const dated = p.tasks.filter((t) => t.plannedStart && t.plannedEnd)
  const start = dated.reduce((m, t) => (t.plannedStart! < m ? t.plannedStart! : m), p.dayZero)
  const endRaw = dated.reduce((m, t) => (t.plannedEnd! > m ? t.plannedEnd! : m), p.contractEnd)
  // Zakres osi: od 1. dnia miesiąca startu do końca miesiąca końca.
  const axisStart = `${start.slice(0, 7)}-01`
  const e = new Date(parseDate(endRaw))
  const axisEnd = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
  const totalDays = diffDays(axisEnd, axisStart)
  const chartW = PAGE_W - 2 * MARGIN - LABEL_W
  const x = (d: string) => (diffDays(d, axisStart) / totalDays) * chartW

  const months: { label: string; x: number; w: number }[] = []
  for (let d = axisStart; d < axisEnd; ) {
    const dt = new Date(parseDate(d))
    const next = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    const label = dt.toLocaleDateString('pl-PL', { month: 'short', timeZone: 'UTC' }) + (dt.getUTCMonth() === 0 || months.length === 0 ? ` ${dt.getUTCFullYear()}` : '')
    months.push({ label, x: x(d), w: x(next) - x(d) })
    d = next
  }

  const pages: HrfTaskDto[][] = []
  for (let i = 0; i < p.tasks.length; i += ROWS_PER_PAGE) pages.push(p.tasks.slice(i, i + ROWS_PER_PAGE))
  if (!pages.length) pages.push([])
  const bodyH = ROWS_PER_PAGE * ROW_H

  return (
    <Document title={`HRF — ${p.projectName}`} author="Envcheck PMO">
      {pages.map((rows, pageIdx) => (
        <Page key={pageIdx} size="A3" orientation="landscape" style={s.page}>
          <View style={{ height: HEADER_H - 22 }}>
            <Text style={s.title}>Harmonogram rzeczowo-finansowy — {p.projectName}</Text>
            <Text style={s.sub}>
              Dzień „0”: {fmt(p.dayZero)} · Termin umowny: {fmt(p.contractEnd)} · Stan na: {fmt(p.today)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: LABEL_W }}>
              <View style={[s.row, { height: 22, borderBottomWidth: 0.5, borderColor: '#999' }]}>
                <Text style={[s.code, { fontWeight: 'bold' }]}>Kod</Text>
                <Text style={[s.name, { fontWeight: 'bold' }]}>Etap / zadanie</Text>
              </View>
              {rows.map((t) => (
                <View key={t.id} style={s.row}>
                  <Text style={[s.code, !t.parentId ? { fontWeight: 'bold' } : {}]}>{t.code}</Text>
                  <Text style={[s.name, !t.parentId ? { fontWeight: 'bold' } : {}, { paddingLeft: (t.code.split('.').length - 1) * 6 }]}>
                    {t.name.length > 70 ? `${t.name.slice(0, 68)}…` : t.name}
                  </Text>
                </View>
              ))}
            </View>
            <Svg width={chartW} height={22 + bodyH}>
              {months.map((m, i) => (
                <Rect key={`m${i}`} x={m.x} y={0} width={m.w} height={22 + bodyH} fill={i % 2 ? '#F4F6F9' : '#FFFFFF'} />
              ))}
              {months.map((m, i) => (
                <Text key={`ml${i}`} x={m.x + 2} y={14} style={{ fontSize: 6.5 }}>
                  {m.label}
                </Text>
              ))}
              <Line x1={0} y1={22} x2={chartW} y2={22} stroke="#999" strokeWidth={0.5} />
              {rows.map((t, i) => {
                if (!t.plannedStart || !t.plannedEnd) return null
                const y = 22 + i * ROW_H
                const bx = x(t.plannedStart)
                const bw = Math.max(1.5, x(addDays(t.plannedEnd, 1)) - bx)
                const summary = !t.parentId
                const color = t.isCriticalPath ? '#D64545' : STATUS_COLOR[t.status] ?? '#406CAB'
                if (t.isAcceptancePoint) {
                  const cx = bx + bw / 2
                  return (
                    <Rect key={t.id} x={cx - 3} y={y + 2.5} width={6} height={6} fill="#7E57C2" transform={`rotate(45 ${cx} ${y + 5.5})`} />
                  )
                }
                return (
                  <Svg key={t.id}>
                    <Rect x={bx} y={y + (summary ? 4 : 2)} width={bw} height={summary ? 3 : 7} fill={summary ? NAVY : '#C9D3E0'} />
                    {!summary && t.percentComplete > 0 && (
                      <Rect x={bx} y={y + 2} width={(bw * t.percentComplete) / 100} height={7} fill={color} />
                    )}
                    {!summary && t.isCriticalPath && <Rect x={bx} y={y + 2} width={bw} height={7} fill="none" stroke="#D64545" strokeWidth={0.8} />}
                  </Svg>
                )
              })}
              {p.today >= axisStart && p.today <= axisEnd && (
                <Line x1={x(p.today)} y1={18} x2={x(p.today)} y2={22 + bodyH} stroke="#2E9D57" strokeWidth={0.8} />
              )}
              <Line x1={x(p.contractEnd)} y1={18} x2={x(p.contractEnd)} y2={22 + bodyH} stroke="#D64545" strokeWidth={1.2} strokeDasharray="3 2" />
            </Svg>
          </View>
          <View style={s.footer} fixed>
            <Text>Envcheck Sp. z o.o. · Envcheck PMO · wygenerował: {p.generatedBy}</Text>
            <Text>Legenda: ▬ Etap · pasek = postęp (czerwona ramka: ścieżka krytyczna) · ◆ odbiór · linia zielona: dziś · czerwona przerywana: termin umowny</Text>
            <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ))}
    </Document>
  )
}

export async function renderGanttPdf(input: GanttPdfInput): Promise<Buffer> {
  registerFonts()
  return renderToBuffer(<GanttDocument {...input} />)
}
