import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildHrfFixture, FIXTURE_MAPPING } from '../../test/hrf-fixture.ts'
import { buildPreview, cellText, inspectWorkbook, loadWorkbook, parseTasks } from './import.ts'

describe('import HRF — fikstura', () => {
  it('sugeruje mapowanie po nagłówkach', async () => {
    const wb = await loadWorkbook(await buildHrfFixture())
    const r = inspectWorkbook(wb)
    expect(r.suggested).toEqual({ sheet: 'HRF test', headerRow: 5, columns: { code: 'A', name: 'B', weeks: 'C', party: 'D' } })
    expect(r.partyValuesFound['HRF test']).toEqual(['Envcheck / Arsanit', 'Zamawiający'])
  })

  it('parsuje hierarchię, tygodnie, strony, punkty odbioru i § 3 ust. 8; kod „1.10” zostaje tekstem', async () => {
    const wb = await loadWorkbook(await buildHrfFixture())
    const { tasks, issues } = parseTasks(wb, FIXTURE_MAPPING)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(issues.some((i) => i.message.includes('Legenda'))).toBe(true)
    expect(tasks.map((t) => t.code)).toEqual(['1', '1.1', '1.2', '1.10', '2', '2.1', '2.2', '3', '3.1'])
    const t110 = tasks.find((t) => t.code === '1.10')!
    expect(t110).toMatchObject({ parentCode: '1', startOffsetDays: 63, durationDays: 7, party: 'Client', isAcceptancePoint: true })
    expect(tasks.find((t) => t.code === '1')).toMatchObject({ party: 'Konsorcjum', startOffsetDays: 0, durationDays: 70 })
    expect(tasks.find((t) => t.code === '3.1')!.postAcceptanceAllowed).toBe(true)
    expect(tasks.find((t) => t.code === '2.1')!.postAcceptanceAllowed).toBe(false)
  })

  it('błędy: duplikat kodu, brak rodzica, zły termin, nieznana strona', async () => {
    const wb = await loadWorkbook(
      await buildHrfFixture([
        ['1', 'Etap', '1-5', ''],
        ['1.1', 'A', '1-2', 'Envcheck / Arsanit'],
        ['1.1', 'A bis', '1-2', 'Envcheck / Arsanit'],
        ['4.1', 'Sierota', '1-2', 'Envcheck / Arsanit'],
        ['1.2', 'Zły termin', '5-2', 'Envcheck / Arsanit'],
        ['1.3', 'Obca strona', '1-2', 'Ktoś'],
      ]),
    )
    const { issues } = parseTasks(wb, FIXTURE_MAPPING)
    const errors = issues.filter((i) => i.severity === 'error').map((i) => i.code)
    expect(errors).toEqual(['1.1', '4.1', '1.2', '1.3'])
  })

  it('termin umowny: zawsze ostrzeżenie (nie blokuje importu), z podpowiedzią § 3 ust. 8', async () => {
    const wb = await loadWorkbook(await buildHrfFixture())
    const parsed = parseTasks(wb, FIXTURE_MAPPING)
    const p = buildPreview(parsed, [], { dayZero: '2026-09-21', contractEnd: '2027-11-15', notesMapped: false })
    // 2.2: tydz. 59–60 → koniec 14.11.2027 (OK); Etap 3 i 3.1 po terminie → ostrzeżenia
    expect(p.tasks.find((t) => t.code === '2.2')!.plannedEnd).toBe('2027-11-14')
    expect(p.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(p.issues.filter((i) => i.code === '3.1' && i.severity === 'warning')).toHaveLength(1)
    expect(p.canCommit).toBe(true)

    const strict = buildPreview(parseTasks(wb, { ...FIXTURE_MAPPING, postAcceptanceStageCodes: [] }), [], {
      dayZero: '2026-09-21', contractEnd: '2027-11-15', notesMapped: false,
    })
    expect(strict.canCommit).toBe(true)
    const late = strict.issues.filter((i) => i.code === '3.1')
    expect(late).toHaveLength(1)
    expect(late[0]).toMatchObject({ severity: 'warning' })
    expect(late[0]!.message).toContain('§ 3 ust. 8')
  })

  it('diff re-importu: nowe / zmienione / bez zmian / brak w pliku; strona nie jest nadpisywana', async () => {
    const wb = await loadWorkbook(await buildHrfFixture())
    const parsed = parseTasks(wb, FIXTURE_MAPPING)
    const existing = parsed.tasks
      .filter((t) => t.code !== '3.1')
      .map((t) => ({ ...t, name: t.code === '1.1' ? 'Stara nazwa' : t.name, party: t.code === '1.2' ? 'Arsanit' : t.party }))
    existing.push({ ...existing[0]!, code: '9.9', parentCode: null })
    const p = buildPreview(parsed, existing, { dayZero: null, contractEnd: '2027-11-15', notesMapped: false })
    expect(p.diff.created).toEqual(['3.1'])
    expect(p.diff.updated).toEqual([{ code: '1.1', fields: ['name'] }])
    expect(p.diff.missingInFile).toEqual(['9.9'])
    expect(p.issues.some((i) => i.code === '1.2' && i.message.includes('zostaje wartość z aplikacji'))).toBe(true)
  })
})

// Test na prawdziwym pliku Admina (input/ jest poza repozytorium) — uruchamiany tylko lokalnie.
const inputDir = new URL('../../../input/', import.meta.url).pathname
const realFile = existsSync(inputDir) ? readdirSync(inputDir).find((f) => /^HRF.*\.xlsx$/i.test(f)) : undefined

describe.skipIf(!realFile)('import HRF — plik rev.10 (lokalnie)', () => {
  it('importuje 7 Etapów i zadania bez błędów; odbiór końcowy przed terminem umownym', async () => {
    const buf = readFileSync(inputDir + realFile!)
    const wb = await loadWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    const s = inspectWorkbook(wb).suggested!
    const mapping = { ...FIXTURE_MAPPING, sheet: s.sheet!, headerRow: s.headerRow!, columns: s.columns!, postAcceptanceStageCodes: ['7'] }
    const parsed = parseTasks(wb, mapping)
    const p = buildPreview(parsed, [], { dayZero: '2026-09-21', contractEnd: '2027-11-15', notesMapped: false })
    expect(p.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(parsed.tasks.filter((t) => !t.parentCode)).toHaveLength(7)
    expect(parsed.tasks.find((t) => t.code === '2.10')).toBeTruthy()
    expect(parsed.tasks.filter((t) => t.isAcceptancePoint).map((t) => t.code)).toEqual(['1.8', '2.11', '3.2', '3.16', '5.22', '6.22', '6.25'])
    // Zgodność z kolumną F (koniec) z Excela
    expect(p.tasks.find((t) => t.code === '6.25')!.plannedEnd).toBe('2027-11-14')
    expect(p.tasks.find((t) => t.code === '2.2')).toMatchObject({ plannedStart: '2026-10-12', plannedEnd: '2026-11-01' })

    // Każdy wiersz: daty aplikacji = wyniki formuł E/F w Excelu (B2 = 21.09.2026).
    const ws = wb.getWorksheet(mapping.sheet)!
    for (const t of p.tasks) {
      const row = ws.getRow(t.row)
      expect([t.code, cellText(row.getCell(5)), cellText(row.getCell(6))]).toEqual([t.code, t.plannedStart, t.plannedEnd])
    }
  })
})
