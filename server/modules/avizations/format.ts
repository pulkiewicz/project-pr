import type { AvizationExportColumn, ExportTemplateInput, IdDocType, PeopleImportRow } from '#shared'

/** Normalizacja do HMAC: wielkie litery, bez spacji i myślników. */
export const normalizeId = (v: string) => v.toUpperCase().replace(/[\s-]/g, '')

/** „CGS 515311” → „CGS •••311”: litery zostają, cyfry poza trzema ostatnimi znakami maskowane. */
export function maskDoc(v: string): string {
  const keep = 3
  let seen = 0
  const chars = [...v]
  const total = chars.filter((c) => /[A-Za-z0-9]/.test(c)).length
  return chars
    .map((c) => {
      if (!/[A-Za-z0-9]/.test(c)) return c
      seen++
      if (seen > total - keep) return c
      return /\d/.test(c) ? '•' : c
    })
    .join('')
}

/** Polski dowód osobisty: 3 litery + 6 cyfr; pozostałe formaty traktowane jako paszport. */
export const guessDocType = (doc: string): IdDocType => (/^[A-Z]{3}\d{6}$/i.test(normalizeId(doc)) ? 'id_card' : 'passport')

const DOC_AT_END = /([A-Z]{1,4}[\s-]?\d[\d\s]{4,10}\d)\s*[,.;]?\s*$/i

/** „Krzysztof Pulkiewicz, CGS 515311” / „Kamil Pielechowski: DEC 987445,” / „Janusz Jankowski CDL235901”. */
export function parseNameDoc(raw: string): { firstName: string; lastName: string; doc: string; warnings: string[] } | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const warnings: string[] = []
  const m = DOC_AT_END.exec(text)
  if (!m) return { firstName: '', lastName: text, doc: '', warnings: ['Nie rozpoznano numeru dokumentu'] }
  const doc = m[1]!.trim()
  const name = text.slice(0, m.index).replace(/[,:;]\s*$/, '').trim()
  const parts = name.split(' ').filter(Boolean)
  if (parts.length < 2) warnings.push('Nie rozpoznano imienia i nazwiska')
  // Lista ochrony zawiera głównie „Imię Nazwisko” — kolejność do weryfikacji w podglądzie.
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' '), doc, warnings }
}

/** „Land Rover, WH 91701A” / „Mitsubishi KNT31132” / „WZ 7669U”. */
export function parseVehicle(raw: string): { makeModel: string | null; registrationNumber: string } | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.includes(',')) {
    const [make, ...rest] = text.split(',')
    return { makeModel: make!.trim() || null, registrationNumber: rest.join(',').trim() }
  }
  const tokens = text.split(' ')
  const regTokens: string[] = []
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!
    const hasDigit = /\d/.test(t)
    if (hasDigit || (regTokens.length > 0 && /^[A-Z]{1,3}$/.test(t))) {
      regTokens.unshift(t)
      if (!hasDigit) break
    } else break
  }
  if (!regTokens.length) return { makeModel: text, registrationNumber: '' }
  const make = tokens.slice(0, tokens.length - regTokens.length).join(' ')
  return { makeModel: make || null, registrationNumber: regTokens.join(' ') }
}

export function parsePeopleRows(rows: { row: number; nameDoc: string; vehicle: string; company: string }[], existingDocHmacs: Set<string>, hmac: (v: string) => string): PeopleImportRow[] {
  const out: PeopleImportRow[] = []
  for (const r of rows) {
    const p = parseNameDoc(r.nameDoc)
    if (!p) continue
    const v = parseVehicle(r.vehicle)
    const warnings = [...p.warnings]
    if (v && !v.registrationNumber) warnings.push('Nie rozpoznano numeru rejestracyjnego')
    if (!r.company.trim()) warnings.push('Brak firmy')
    out.push({
      row: r.row,
      firstName: p.firstName,
      lastName: p.lastName,
      idDocType: guessDocType(p.doc),
      idDocNumber: p.doc,
      company: r.company.trim(),
      vehicle: v && v.registrationNumber ? v : null,
      warnings,
      duplicate: !!p.doc && existingDocHmacs.has(hmac(normalizeId(p.doc))),
    })
  }
  return out
}

// ---------- eksport ----------
export interface ExportPerson {
  firstName: string
  lastName: string
  idDocType: IdDocType
  idDocNumber: string
  company: string
  phone: string | null
  roleOnSite: string | null
}
export interface ExportVehicle {
  registrationNumber: string
  makeModel: string | null
  company: string
}
export interface ExportContext {
  dateFrom: string
  dateTo: string
  entryPoint: string | null
}

const DOC_LABEL: Record<IdDocType, string> = { id_card: 'dowód osobisty', passport: 'paszport' }
const fmt = (d: string) => d.split('-').reverse().join('.')
const vehicleText = (v: ExportVehicle | undefined) => (v ? [v.makeModel, v.registrationNumber].filter(Boolean).join(', ') : '')

/**
 * Wiersze listy: osoba + pojazd, którego jest kierowcą (jak w formularzu ochrony).
 * Pojazdy bez przypisanego kierowcy — osobne wiersze. Uzupełnienie pustymi wierszami do `minRows`.
 */
export function buildExportRows(
  template: ExportTemplateInput,
  persons: (ExportPerson & { id: string })[],
  vehicles: (ExportVehicle & { driverPersonId: string | null })[],
  ctx: ExportContext,
): string[][] {
  const byDriver = new Map(vehicles.filter((v) => v.driverPersonId).map((v) => [v.driverPersonId!, v]))
  const lines: { p?: ExportPerson; v?: ExportVehicle }[] = persons.map((p) => ({ p, v: byDriver.get(p.id) }))
  for (const v of vehicles) if (!v.driverPersonId || !persons.some((p) => p.id === v.driverPersonId)) lines.push({ v })

  const cell = (key: AvizationExportColumn, l: { p?: ExportPerson; v?: ExportVehicle }, i: number): string => {
    const p = l.p
    switch (key) {
      case 'lp': return String(i + 1)
      case 'nameWithDoc': return p ? `${p.firstName} ${p.lastName}, ${p.idDocNumber}` : ''
      case 'nameWithDocLastFirst': return p ? `${p.lastName} ${p.firstName}, ${p.idDocNumber}` : ''
      case 'lastFirst': return p ? `${p.lastName} ${p.firstName}` : ''
      case 'firstLast': return p ? `${p.firstName} ${p.lastName}` : ''
      case 'docType': return p ? DOC_LABEL[p.idDocType] : ''
      case 'docNumber': return p?.idDocNumber ?? ''
      case 'vehicle': return vehicleText(l.v)
      case 'makeModel': return l.v?.makeModel ?? ''
      case 'registration': return l.v?.registrationNumber ?? ''
      case 'company': return p?.company ?? l.v?.company ?? ''
      case 'phone': return p?.phone ?? ''
      case 'roleOnSite': return p?.roleOnSite ?? ''
      case 'dateFrom': return fmt(ctx.dateFrom)
      case 'dateTo': return fmt(ctx.dateTo)
      case 'entryPoint': return ctx.entryPoint ?? ''
    }
  }
  const rows = lines.map((l, i) => template.columns.map((c) => cell(c.key, l, i)))
  for (let i = rows.length; i < template.minRows; i++) rows.push(template.columns.map((c) => (c.key === 'lp' ? String(i + 1) : '')))
  return rows
}
