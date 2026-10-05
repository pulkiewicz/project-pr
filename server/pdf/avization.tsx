import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { ExportTemplateInput } from '#shared'
import { registerFonts } from './fonts.ts'

const NAVY = '#1F3A5F'
const s = StyleSheet.create({
  page: { fontFamily: 'DejaVu', fontSize: 9.5, padding: 36, color: '#1d2733' },
  title: { fontSize: 14, fontWeight: 'bold', color: NAVY, marginBottom: 4 },
  meta: { fontSize: 9, marginBottom: 2 },
  table: { marginTop: 12, borderTopWidth: 0.7, borderLeftWidth: 0.7, borderColor: '#333' },
  row: { flexDirection: 'row' },
  cell: { borderRightWidth: 0.7, borderBottomWidth: 0.7, borderColor: '#333', paddingVertical: 3, paddingHorizontal: 4, minHeight: 17 },
  head: { backgroundColor: '#DCE6F1', fontWeight: 'bold', textAlign: 'center' },
  footer: { position: 'absolute', bottom: 22, left: 36, right: 36, fontSize: 7.5, color: '#777', flexDirection: 'row', justifyContent: 'space-between' },
})

export interface AvizationPdfInput {
  title: string
  meta: string[]
  template: ExportTemplateInput
  rows: string[][]
  generatedBy: string
}

export function AvizationDocument(p: AvizationPdfInput) {
  const total = p.template.columns.reduce((n, c) => n + c.width, 0)
  return (
    <Document title={p.title} author="Envcheck PMO">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{p.title}</Text>
        {p.meta.map((m) => (
          <Text key={m} style={s.meta}>
            {m}
          </Text>
        ))}
        <View style={s.table}>
          <View style={s.row} fixed>
            {p.template.columns.map((c) => (
              <Text key={c.key} style={[s.cell, s.head, { width: `${(c.width / total) * 100}%` }]}>
                {c.header}
              </Text>
            ))}
          </View>
          {p.rows.map((r, i) => (
            <View key={i} style={s.row} wrap={false}>
              {r.map((v, j) => (
                <Text key={j} style={[s.cell, { width: `${(p.template.columns[j]!.width / total) * 100}%`, textAlign: p.template.columns[j]!.key === 'lp' ? 'center' : 'left' }]}>
                  {v}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <View style={s.footer} fixed>
          <Text>Envcheck Sp. z o.o. · wygenerował: {p.generatedBy}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function renderAvizationPdf(input: AvizationPdfInput): Promise<Buffer> {
  registerFonts()
  return renderToBuffer(<AvizationDocument {...input} />)
}
