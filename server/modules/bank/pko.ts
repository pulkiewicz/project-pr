import type { BankImportIssue, BankStatementHeader, BankTxKind, BankTxParsed } from '#shared'

/**
 * Odczyt wyciągu PKO BP (PDF „WYCIĄG za okres …” z iPKO biznes) z tekstu stron i pozycji napisów.
 *
 * Układ tabeli: każda operacja to wiersz główny (data operacji | identyfikator | typ | kwota | saldo),
 * pod nim wiersz z datą waluty i opisem oraz ewentualne kolejne wiersze opisu. Kolumny rozpoznajemy po współrzędnej X
 * nagłówków tabeli, więc odczyt nie zależy od kolejności napisów w pliku.
 *
 * Poprawność sprawdza saldo: saldo poprzednie + kwota = saldo po każdej operacji, saldo końcowe i obroty z nagłówka.
 */

/** Napis ze strony PDF: X/Y lewego dolnego rogu w punktach (Y rośnie ku górze). */
export interface PdfTextItem {
  page: number
  x: number
  y: number
  str: string
}

export interface ParsedStatement {
  statement: BankStatementHeader | null
  transactions: BankTxParsed[]
  issues: BankImportIssue[]
}

const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const MONEY = /^-?\d{1,3}(?: \d{3})*,\d{2}$/
const OPERATION_ID = /^(?=.*\d)[0-9A-Z]{12,24}$/
/** Numer rachunku NRB: 26 cyfr, ze spacjami co 4 (po pierwszych 2) albo bez. */
const ACCOUNT = /(?<!\d)(\d{2}(?: ?\d{4}){6})(?!\d)/g

const isoDate = (s: string) => {
  const m = DATE.exec(s.trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
/** „-1 118 171,48” → -111817148 (grosze). */
export function parseMoney(s: string): number | null {
  const t = s.trim().replace(/\u00a0/g, ' ')
  if (!/^-?[\d ]+,\d{2}$/.test(t)) return null
  return Math.round(Number(t.replace(/ /g, '').replace(',', '.')) * 100)
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const digits = (s: string) => s.replace(/\D/g, '')

/** Wiersze strony: napisy o (prawie) tej samej współrzędnej Y, od góry; w wierszu od lewej. */
function lines(items: PdfTextItem[]) {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)
  const out: PdfTextItem[][] = []
  for (const it of sorted) {
    const last = out.at(-1)
    if (last && Math.abs(last[0]!.y - it.y) < 2) last.push(it)
    else out.push([it])
  }
  for (const l of out) l.sort((a, b) => a.x - b.x)
  return out
}

/** Wartość kwotowa w tym samym wierszu, co etykieta (na prawo od niej). */
function amountNextTo(all: PdfTextItem[][], label: RegExp) {
  for (const l of all) {
    const i = l.findIndex((it) => label.test(it.str.trim()))
    if (i < 0) continue
    const v = l.slice(i + 1).find((it) => MONEY.test(it.str.trim()))
    if (v) return parseMoney(v.str)
  }
  return null
}

/** Rodzaj operacji z typu i opisu (patrz `BANK_TX_KINDS`). */
export function classify(type: string, description: string, amount: number): BankTxKind {
  const t = type.toUpperCase()
  if (t.includes('RACH. VAT') || t.includes('RACHUNKU VAT')) return 'vat_transfer'
  if (amount > 0) return 'income'
  if (/^(OPŁATA|OPŁ\.|PROWIZJA)/.test(t)) return 'bank_fee'
  if (t.includes('US VAT') || t.includes('ORG. PODATKOWEGO') || t.includes('PODATK')) return 'tax'
  if (t.includes('ZUS')) return 'zus'
  if (t.includes('KARTY') || t.includes('KOD MOBILNY') || t.includes('BLIK')) return 'card'
  if (/^WYNAGRODZENIE\b/i.test(description)) return 'salary'
  return 'transfer'
}

/** Pola strukturalne z opisu operacji. */
export function describe(description: string) {
  const d = clean(description)
  const accounts = [...d.matchAll(ACCOUNT)]
  const lastAcc = accounts.at(-1)
  const firstAcc = accounts[0]
  const vat = /Kwota VAT:\s*([\d ]+,\d{2})/.exec(d)
  const nip = /ID Dostawcy:\s*(\d{10})/.exec(d)
  const ref = /zbiorczości:\s*(.+?)(?=\s+\d{2} ?\d{4} ?\d{4}|$)/.exec(d)
  const holder = /Nazwisko i imię:\s*(.+?)\s+(?:Godz\.|Lokalizacja:)/.exec(d)
  const merchant = /Lokalizacja:\s*(.+?)\s+Nr\s+ref/.exec(d)
  const card = /^(Karta:|Tel\.:)/.test(d)
  const split = /^Kwota VAT:/.test(d)
  const title = card || split || !firstAcc ? null : clean(d.slice(0, firstAcc.index)) || null
  return {
    title,
    counterpartyName: card || !lastAcc ? null : clean(d.slice(lastAcc.index! + lastAcc[0].length).replace(/\s*Data dokumentu:.*$/, '')) || null,
    counterpartyAccount: card || !lastAcc ? null : digits(lastAcc[1]!),
    invoiceRef: ref ? clean(ref[1]!) || null : null,
    vatAmount: vat ? parseMoney(vat[1]!) : null,
    supplierNip: nip ? nip[1]! : null,
    cardHolder: holder ? clean(holder[1]!) : null,
    merchant: merchant ? clean(merchant[1]!) : null,
  }
}

interface Columns {
  id: number
  type: number
  amount: number
}

export function parsePkoStatement(items: PdfTextItem[]): ParsedStatement {
  const issues: BankImportIssue[] = []
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b)
  const byPage = new Map(pages.map((p) => [p, lines(items.filter((i) => i.page === p))]))
  const first = byPage.get(pages[0] ?? 1) ?? []
  const allLines = [...byPage.values()].flat()
  const text = (re: RegExp) => {
    for (const l of first) {
      const m = re.exec(l.map((i) => i.str).join(' '))
      if (m) return m
    }
    return null
  }

  const period = text(/WYCIĄG za okres (\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/)
  const number = text(/Nr: (\d+\/\d{4})/)
  const account = text(/Nr rachunku\/karty:\s*(\d{2}(?: ?\d{4}){6})/)
  const currency = text(/Waluta rachunku:\s*([A-Z]{3})/)
  const opening = amountNextTo(first, /^Saldo poprzednie$/)
  const closing = amountNextTo(allLines, /^Saldo końcowe$/)
  const credit = amountNextTo(first, /^Obroty MA$/)
  const debit = amountNextTo(first, /^Obroty WN$/)
  if (!period || !number || !account || opening == null || closing == null) {
    issues.push({ severity: 'error', code: 'format', detail: 'Nie rozpoznano nagłówka wyciągu PKO BP (okres, numer, rachunek, saldo poprzednie / końcowe).' })
    return { statement: null, transactions: [], issues }
  }
  const statement: BankStatementHeader = {
    bank: 'PKO BP',
    accountNumber: digits(account[1]!),
    currency: currency?.[1] ?? 'PLN',
    number: number[1]!,
    periodFrom: isoDate(period[1]!)!,
    periodTo: isoDate(period[2]!)!,
    openingBalance: opening,
    closingBalance: closing,
    creditTurnover: credit ?? 0,
    debitTurnover: debit ?? 0,
  }

  // Operacje: wiersz główny + wiersze opisu do następnego wiersza głównego (w obrębie tabeli na stronie).
  interface Raw {
    bookingDate: string
    operationId: string
    type: string
    amount: number | null
    balance: number | null
    valueDate: string | null
    desc: string[]
  }
  const raws: Raw[] = []
  for (const p of pages) {
    const pl = byPage.get(p)!
    const header = pl.findIndex((l) => l.some((i) => i.str.trim() === 'Identyfikator operacji'))
    if (header < 0) continue
    const col = (label: string) => pl[header]!.find((i) => i.str.trim() === label)?.x
    const cols: Columns = { id: col('Identyfikator operacji') ?? 120, type: col('TYP OPERACJI') ?? 220, amount: col('Kwota operacji') ?? 430 }
    const dateLimit = cols.id - 4
    let cur: Raw | null = null
    for (const l of pl.slice(header + 1)) {
      const joined = l.map((i) => i.str.trim()).join(' ')
      if (/^(Data waluty|Opis operacji)/.test(joined)) continue
      if (/^Saldo (do przeniesienia|końcowe)/.test(joined)) break
      const date = l[0]!.x < dateLimit ? isoDate(l[0]!.str) : null
      const idItem = l.find((i) => i.x >= dateLimit && i.x < cols.type - 4 && OPERATION_ID.test(i.str.trim()))
      if (date && idItem) {
        const money = l.filter((i) => i.x >= cols.amount - 40 && MONEY.test(i.str.trim()))
        cur = {
          bookingDate: date,
          operationId: idItem.str.trim(),
          type: clean(l.filter((i) => i.x >= cols.type - 4 && i.x < cols.amount - 40).map((i) => i.str).join(' ')),
          amount: money.length >= 2 ? parseMoney(money[0]!.str) : null,
          balance: money.length >= 2 ? parseMoney(money.at(-1)!.str) : null,
          valueDate: null,
          desc: [],
        }
        raws.push(cur)
        continue
      }
      if (!cur) continue
      const rest = date ? l.slice(1) : l
      if (date && cur.valueDate == null && !cur.desc.length) cur.valueDate = date
      const s = clean(rest.filter((i) => i.x >= dateLimit).map((i) => i.str).join(' '))
      if (s) cur.desc.push(s)
    }
  }

  const transactions: BankTxParsed[] = []
  let prev = statement.openingBalance
  raws.forEach((r, i) => {
    const seq = i + 1
    if (r.amount == null || r.balance == null) {
      issues.push({ severity: 'error', code: 'format', seq, detail: `Nie odczytano kwoty lub salda operacji ${r.operationId}.` })
      return
    }
    if (prev + r.amount !== r.balance) {
      issues.push({ severity: 'error', code: 'balance', seq, detail: `Operacja ${r.operationId} (${r.bookingDate}): saldo ${fmt(r.balance)} ≠ ${fmt(prev)} + ${fmt(r.amount)}.` })
    }
    prev = r.balance
    const description = clean(r.desc.join(' '))
    transactions.push({
      operationId: r.operationId,
      seq,
      bookingDate: r.bookingDate,
      valueDate: r.valueDate,
      type: r.type,
      amount: r.amount,
      balance: r.balance,
      description,
      ...describe(description),
      kind: classify(r.type, description, r.amount),
    })
  })

  if (!transactions.length) issues.push({ severity: 'error', code: 'no_transactions' })
  else if (prev !== statement.closingBalance) {
    issues.push({ severity: 'error', code: 'closing', detail: `Saldo po ostatniej operacji ${fmt(prev)} ≠ saldo końcowe ${fmt(statement.closingBalance)}.` })
  }
  if (credit != null && debit != null) {
    const ma = transactions.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0)
    const wn = transactions.reduce((s, t) => s + (t.amount < 0 ? t.amount : 0), 0)
    if (ma !== credit || wn !== debit) {
      issues.push({ severity: 'warning', code: 'turnover', detail: `Obroty z operacji MA ${fmt(ma)} / WN ${fmt(wn)}, w nagłówku MA ${fmt(credit)} / WN ${fmt(debit)}.` })
    }
  }
  return { statement, transactions, issues }
}

const fmt = (cents: number) => (cents / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Napisy ze wszystkich stron PDF (pdf.js w wersji serwerowej `unpdf`). */
export async function extractPdfItems(data: Uint8Array): Promise<PdfTextItem[]> {
  const { getDocumentProxy } = await import('unpdf')
  // pdf.js przejmuje (odłącza) przekazany bufor — kopia, żeby wywołujący mógł dalej używać danych.
  const pdf = await getDocumentProxy(data.slice())
  const out: PdfTextItem[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    for (const it of content.items) {
      if ('str' in it && it.str) out.push({ page: p, x: it.transform[4] as number, y: it.transform[5] as number, str: it.str })
    }
  }
  await pdf.cleanup()
  return out
}
