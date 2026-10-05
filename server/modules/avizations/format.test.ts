import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_TEMPLATE } from '#shared'
import { buildExportRows, guessDocType, maskDoc, normalizeId, parseNameDoc, parsePeopleRows, parseVehicle } from './format.ts'

// Dane testowe są fikcyjne.
describe('M5 — parsowanie listy ochrony', () => {
  it('imię, nazwisko i numer dokumentu w różnych zapisach', () => {
    expect(parseNameDoc('Jan Testowy, ABC 123456')).toMatchObject({ firstName: 'Jan', lastName: 'Testowy', doc: 'ABC 123456', warnings: [] })
    expect(parseNameDoc('Anna Próbna: DEF 987654,')).toMatchObject({ firstName: 'Anna', lastName: 'Próbna', doc: 'DEF 987654' })
    expect(parseNameDoc('Piotr Przykładowy GHI123456')).toMatchObject({ lastName: 'Przykładowy', doc: 'GHI123456' })
    expect(parseNameDoc('Olena Testenko, FT123456')).toMatchObject({ firstName: 'Olena', doc: 'FT123456' })
    expect(parseNameDoc('Marek Spacja, DJT 795 657')).toMatchObject({ doc: 'DJT 795 657' })
    expect(parseNameDoc('Bez Numeru')!.warnings).toContain('Nie rozpoznano numeru dokumentu')
  })

  it('pojazd: marka + rejestracja w różnych zapisach', () => {
    expect(parseVehicle('Land Rover, WX 12345A')).toEqual({ makeModel: 'Land Rover', registrationNumber: 'WX 12345A' })
    expect(parseVehicle('Mitsubishi KNT12345')).toEqual({ makeModel: 'Mitsubishi', registrationNumber: 'KNT12345' })
    expect(parseVehicle('WZ 1234U')).toEqual({ makeModel: null, registrationNumber: 'WZ 1234U' })
    expect(parseVehicle('Volkswagen SGL12345')).toEqual({ makeModel: 'Volkswagen', registrationNumber: 'SGL12345' })
    expect(parseVehicle('')).toBeNull()
  })

  it('typ dokumentu i normalizacja', () => {
    expect(guessDocType('ABC 123456')).toBe('id_card')
    expect(guessDocType('FT123456')).toBe('passport')
    expect(normalizeId('dJt 795-657')).toBe('DJT795657')
  })

  it('maskowanie numeru', () => {
    expect(maskDoc('ABC 123456')).toBe('ABC •••456')
    expect(maskDoc('FT123456')).toBe('FT•••456')
  })

  it('wiersze importu z oznaczeniem duplikatów', () => {
    const rows = parsePeopleRows(
      [
        { row: 2, nameDoc: 'Jan Testowy, ABC 123456', vehicle: 'Skoda, WW 111AA', company: 'Envcheck' },
        { row: 3, nameDoc: 'Anna Próbna, DEF 987654', vehicle: '', company: 'Envcheck' },
        { row: 4, nameDoc: '', vehicle: '', company: '' },
      ],
      new Set(['ABC123456']),
      (v) => v,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ duplicate: true, vehicle: { makeModel: 'Skoda', registrationNumber: 'WW 111AA' } })
    expect(rows[1]).toMatchObject({ duplicate: false, vehicle: null })
  })
})

describe('M5 — eksport w formacie ochrony PIT-RADWAR', () => {
  it('Lp | Nazwisko i imię, nr dokumentu | Marka i nr rejestracyjny | Firma; pojazd przy kierowcy; puste wiersze do 20', () => {
    const rows = buildExportRows(
      DEFAULT_EXPORT_TEMPLATE,
      [
        { id: 'p1', firstName: 'Jan', lastName: 'Testowy', idDocType: 'id_card', idDocNumber: 'ABC 123456', company: 'Envcheck', phone: null, roleOnSite: null },
        { id: 'p2', firstName: 'Anna', lastName: 'Próbna', idDocType: 'passport', idDocNumber: 'FT123456', company: 'Envcheck', phone: null, roleOnSite: null },
      ],
      [
        { registrationNumber: 'WW 111AA', makeModel: 'Skoda', company: 'Envcheck', driverPersonId: 'p1' },
        { registrationNumber: 'WZ 1234U', makeModel: null, company: 'Arsanit', driverPersonId: null },
      ],
      { dateFrom: '2026-10-06', dateTo: '2026-10-08', entryPoint: null },
    )
    expect(rows[0]).toEqual(['1', 'Jan Testowy, ABC 123456', 'Skoda, WW 111AA', 'Envcheck'])
    expect(rows[1]).toEqual(['2', 'Anna Próbna, FT123456', '', 'Envcheck'])
    expect(rows[2]).toEqual(['3', '', 'WZ 1234U', 'Arsanit'])
    expect(rows).toHaveLength(20)
    expect(rows[19]).toEqual(['20', '', '', ''])
  })
})
