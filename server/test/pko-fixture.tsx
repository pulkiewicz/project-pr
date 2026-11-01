import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer'
import { registerFonts } from '../pdf/fonts.ts'

/**
 * Syntetyczny wyciąg PKO BP (PDF) w układzie jak prawdziwy: nagłówek, tabela operacji na dwóch stronach,
 * „Saldo do przeniesienia” / „Saldo końcowe”. Dane fikcyjne — prawdziwych wyciągów nie trzymamy w repozytorium.
 */
export interface FixtureTx {
  date: string
  id: string
  type: string
  amount: number
  /** Wiersze opisu (pierwszy obok daty waluty). */
  desc: string[]
}

export const FIXTURE_ACCOUNT = '11102010680000130205076320'
export const FIXTURE_OPENING = 1_000_000

export const FIXTURE_PAGES: FixtureTx[][] = [
  [
    { date: '01.10.2026', id: '6774FE00600000001', type: 'PRZELEW WYCHODZĄCY', amount: -123_000, desc: ['FV 12/10/2026 USŁUGI 12 3456 7890 1234 5678 9012 3456 FIRMA TESTOWA SP. Z O.O.'] },
    {
      date: '02.10.2026',
      id: '6775FE00200000002',
      type: 'PRZELEW PRZYCH. Z/NA RACH. VAT',
      amount: 23_000,
      desc: ['Kwota VAT:230,00 ID Dostawcy:1234567890 Nr faktury lub okres', 'zbiorczości:FV/1/2026 53102010680000170205076338 ENVCHECK SPÓŁKA Z', 'OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'],
    },
    {
      date: '02.10.2026',
      id: '6775FE00200000002',
      type: 'PRZELEW SPLIT-PAYMENT',
      amount: -123_000,
      desc: ['Kwota VAT:230,00 ID Dostawcy:1234567890 Nr faktury lub okres', 'zbiorczości:FV/1/2026 99 1140 2004 0000 3902 1976 7717 HURTOWNIA TEST', 'S.A.'],
    },
    { date: '02.10.2026', id: '6775FE00200000002', type: 'PROWIZJA SPLIT-PAYMENT ZEW.', amount: -110, desc: [] },
  ],
  [
    {
      date: '05.10.2026',
      id: '6778MX90000000003',
      type: 'ZAKUP PRZY UŻYCIU KARTY',
      amount: -10_050,
      desc: ['Karta:456991******0000 Nazwisko i imię: KOWALSKI JAN Lokalizacja: STACJA PALIW X', 'WARSZAWA PL Nr ref: 74463676200000000000001', 'Kwota oryg.: 100,50 PLN'],
    },
    { date: '06.10.2026', id: '6779FE90000000004', type: 'PRZELEW PRZYCHODZĄCY', amount: 500_000, desc: ['ZAPŁATA FV 7/2026 30124010531111001039682108 KLIENT S.A.'] },
    { date: '31.10.2026', id: '6804FE90000000005', type: 'PRZELEW WYCHODZĄCY', amount: -300_000, desc: ['WYNAGRODZENIE 10/2026 15 2030 0045 1130 0000 1106 9930 JAN KOWALSKI'] },
  ],
]

const pln = (cents: number) => {
  const neg = cents < 0
  const [int, frac] = (Math.abs(cents) / 100).toFixed(2).split('.')
  return `${neg ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${frac}`
}

/** `breakBalanceAt` — numer operacji (od 1) z błędnie wydrukowanym saldem. */
export async function buildPkoFixture(opts: { number?: string; pages?: FixtureTx[][]; breakBalanceAt?: number } = {}): Promise<Uint8Array> {
  registerFonts()
  const pages = opts.pages ?? FIXTURE_PAGES
  const all = pages.flat()
  const credit = all.reduce((s, t) => s + Math.max(t.amount, 0), 0)
  const debit = all.reduce((s, t) => s + Math.min(t.amount, 0), 0)
  let balance = FIXTURE_OPENING
  let seq = 0
  const at = (left: number, top: number, s: string, key: string) => (
    <Text key={key} style={{ position: 'absolute', left, top, fontSize: 7, fontFamily: 'DejaVu' }}>
      {s}
    </Text>
  )
  const doc = (
    <Document>
      {pages.map((rows, p) => {
        const els: JSX.Element[] = [
          at(62, 20, 'WYCIĄG za okres 01.10.2026 - 31.10.2026', 'h1'),
          at(62, 32, `Nr: ${opts.number ?? '10/2026'}`, 'h2'),
          at(187, 32, 'Data: 31.10.2026', 'h3'),
          at(62, 60, 'Nr rachunku/karty:', 'h4'),
          at(126, 60, '11 1020 1068 0000 1302 0507 6320', 'h5'),
        ]
        let top = 100
        if (p === 0) {
          els.push(at(62, 72, 'Waluta rachunku: PLN', 'h6'))
          els.push(at(445, 80, 'Obroty MA', 'ma'), at(520, 80, pln(credit), 'mav'))
          els.push(at(444, 90, 'Obroty WN', 'wn'), at(520, 90, pln(debit), 'wnv'))
          els.push(at(424, 100, 'Saldo poprzednie', 'sp'), at(520, 100, pln(FIXTURE_OPENING), 'spv'))
          top = 120
        } else {
          els.push(at(411, 90, 'Saldo z przeniesienia', 'sz'), at(520, 90, pln(balance), 'szv'))
        }
        els.push(at(62, top, 'Data operacji', 't1'), at(122, top, 'Identyfikator operacji', 't2'), at(221, top, 'TYP OPERACJI', 't3'), at(432, top, 'Kwota operacji', 't4'), at(549, top, 'Saldo', 't5'))
        top += 12
        els.push(at(62, top, 'Data waluty', 't6'), at(122, top, 'Opis operacji', 't7'))
        top += 16
        for (const tx of rows) {
          seq++
          balance += tx.amount
          const printed = opts.breakBalanceAt === seq ? balance + 100 : balance
          els.push(at(62, top, tx.date, `d${seq}`), at(122, top, tx.id, `i${seq}`), at(221, top, tx.type, `y${seq}`), at(440, top, pln(tx.amount), `a${seq}`), at(515, top, pln(printed), `b${seq}`))
          top += 14
          els.push(at(62, top, tx.date, `v${seq}`))
          tx.desc.forEach((line, i) => els.push(at(122, top + i * 8, line, `o${seq}-${i}`)))
          top += Math.max(tx.desc.length, 1) * 8 + 8
          if (opts.breakBalanceAt === seq) balance = printed
        }
        const last = p === pages.length - 1
        els.push(at(411, top + 6, last ? 'Saldo końcowe' : 'Saldo do przeniesienia', 'end'), at(520, top + 6, pln(balance), 'endv'))
        els.push(at(62, 800, 'Niniejszy dokument jest wydrukiem z systemu informatycznego PKO Banku Polskiego SA', 'f'))
        return (
          <Page key={p} size="A4">
            {els}
          </Page>
        )
      })}
    </Document>
  )
  return new Uint8Array(await renderToBuffer(doc))
}
