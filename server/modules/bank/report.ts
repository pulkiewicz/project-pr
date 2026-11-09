import { and, asc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { BANK_TX_NEEDS_INVOICE, invoicePaymentState, paymentState, statementContinuity, type BankReportDto, type BankReportInvoiceDto } from '#shared'
import type { Database } from '../../db/client.ts'
import { bankStatements, bankTransactions, bankTxInvoiceLinks } from '../../db/schema.ts'
import { listInvoices } from '../invoices/service.ts'
import { suggestionsFor } from './reconcile.ts'

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

/**
 * Raport rozliczeń (B3) za okres — domyślnie okres pokryty zaimportowanymi wyciągami:
 * ciągłość wyciągów, wydatki bez faktury (do uzupełnienia w inFakt), faktury niezapłacone i po terminie.
 */
export async function buildReport(db: Database, today: string, range: { from?: string; to?: string } = {}): Promise<BankReportDto> {
  const statements = await db.select().from(bankStatements)
  const coverage = statements.length
    ? { from: statements.map((s) => s.periodFrom).sort()[0]!, to: statements.map((s) => s.periodTo).sort().at(-1)! }
    : null
  const from = range.from ?? coverage?.from ?? `${today.slice(0, 7)}-01`
  const to = range.to ?? coverage?.to ?? today

  const txs = await db
    .select({ t: bankTransactions, statementNumber: bankStatements.number, currency: bankStatements.currency })
    .from(bankTransactions)
    .innerJoin(bankStatements, eq(bankStatements.id, bankTransactions.statementId))
    .where(
      and(
        gte(bankTransactions.bookingDate, from),
        lte(bankTransactions.bookingDate, to),
        inArray(bankTransactions.kind, [...BANK_TX_NEEDS_INVOICE]),
        lt(bankTransactions.amount, 0),
        or(
          eq(bankTransactions.costStatus, 'pending'),
          and(eq(bankTransactions.costStatus, 'invoice'), sql`not exists (select 1 from ${bankTxInvoiceLinks} where ${bankTxInvoiceLinks.transactionId} = ${bankTransactions.id})`),
        ),
      ),
    )
    .orderBy(asc(bankTransactions.bookingDate), asc(bankTransactions.seq))

  const unpaid: BankReportInvoiceDto[] = []
  for (const i of await listInvoices(db)) {
    const date = i.issueDate ?? i.infaktCreatedAt?.slice(0, 10) ?? null
    // Faktury bez pełnej płatności w wyciągach; opłacone wg inFakt oznaczone (widok domyślnie je ukrywa).
    if (!date || date < from || date > to || paymentState(i.grossPrice, i.paidAmount) === 'paid') continue
    const paidInInfakt = invoicePaymentState(i) === 'paid'
    unpaid.push({
      id: i.id,
      number: i.number,
      sellerName: i.sellerName,
      issueDate: date,
      dueDate: i.dueDate,
      currency: i.currency,
      grossPrice: i.grossPrice,
      paidAmount: i.paidAmount,
      openAmount: i.grossPrice == null ? null : i.grossPrice - i.paidAmount,
      overdueDays: !paidInInfakt && i.dueDate && i.dueDate < today ? days(today, i.dueDate) : null,
      infaktPaymentStatus: i.paymentStatus,
      paidInInfakt,
    })
  }
  // Propozycje faktur dla płatności bez faktury (kwota ±7 / ±30 dni, kontrahent) — do ręcznego potwierdzenia.
  const suggestions = await suggestionsFor(db, txs.map(({ t }) => t.id))

  // Najpierw najdłużej po terminie, potem bez terminu / w terminie wg daty.
  unpaid.sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1) || (a.issueDate ?? '').localeCompare(b.issueDate ?? ''))

  return {
    from,
    to,
    coverage,
    continuity: statementContinuity(statements),
    missing: txs.map(({ t, statementNumber, currency }) => ({
      id: t.id,
      statementId: t.statementId,
      statementNumber,
      bookingDate: t.bookingDate,
      amount: -t.amount,
      currency,
      counterparty: t.counterpartyName ?? t.merchant,
      reference: t.invoiceRef ?? t.title,
      cardHolder: t.cardHolder,
      kind: t.kind,
      costStatus: t.costStatus,
      suggestions: suggestions.get(t.id) ?? [],
    })),
    unpaid,
  }
}

const INFAKT_PAYMENT: Record<string, string> = { paid: 'zapłacona', unpaid: 'niezapłacona', partial_payment: 'częściowo', payment_not_applicable: 'nie dotyczy' }
const KIND: Record<string, string> = { transfer: 'Przelew', card: 'Karta / BLIK' }
const CONTINUITY: Record<string, string> = { gap: 'Brakujące dni', overlap: 'Okresy się nakładają', balance: 'Saldo początkowe ≠ końcowe poprzedniego' }

/** Eksport raportu: arkusze „Płatności bez faktury”, „Faktury bez płatności w banku”, „Ciągłość wyciągów”. */
export async function reportWorkbook(r: BankReportDto): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const money = '#,##0.00'
  const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null)
  const pln = (c: number | null) => (c == null ? null : c / 100)
  const sheet = (name: string, columns: Partial<ExcelJS.Column>[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = columns
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
    return ws
  }

  const missing = sheet('Płatności bez faktury', [
    { header: 'Data', key: 'date', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: 'Wyciąg', key: 'statement', width: 10 },
    { header: 'Rodzaj', key: 'kind', width: 13 },
    { header: 'Kontrahent / miejsce', key: 'counterparty', width: 40 },
    { header: 'Tytuł / nr faktury', key: 'reference', width: 40 },
    { header: 'Karta', key: 'card', width: 20 },
    { header: 'Kwota', key: 'amount', width: 14, style: { numFmt: money } },
    { header: 'Uwagi', key: 'note', width: 28 },
  ])
  for (const t of r.missing) {
    missing.addRow({
      date: date(t.bookingDate),
      statement: t.statementNumber,
      kind: KIND[t.kind] ?? t.kind,
      counterparty: t.counterparty ?? '',
      reference: t.reference ?? '',
      card: t.cardHolder ?? '',
      amount: pln(t.amount),
      note: t.costStatus === 'invoice' ? 'faktura do podpięcia' : '',
    })
  }

  const unpaid = sheet('Faktury bez płatności w banku', [
    { header: 'Numer', key: 'number', width: 22 },
    { header: 'Sprzedawca', key: 'seller', width: 32 },
    { header: 'Data', key: 'date', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: 'Termin', key: 'due', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: 'Dni po terminie', key: 'overdue', width: 14 },
    { header: 'Waluta', key: 'currency', width: 8 },
    { header: 'Brutto', key: 'gross', width: 14, style: { numFmt: money } },
    { header: 'Zapłacono', key: 'paid', width: 14, style: { numFmt: money } },
    { header: 'Do zapłaty', key: 'open', width: 14, style: { numFmt: money } },
    { header: 'Status w inFakt', key: 'infakt', width: 18 },
  ])
  for (const i of r.unpaid) {
    unpaid.addRow({
      number: i.number ?? '',
      seller: i.sellerName ?? '',
      date: date(i.issueDate),
      due: date(i.dueDate),
      overdue: i.overdueDays,
      currency: i.currency,
      gross: pln(i.grossPrice),
      paid: pln(i.paidAmount),
      open: pln(i.openAmount),
      infakt: INFAKT_PAYMENT[i.infaktPaymentStatus ?? ''] ?? '',
    })
  }

  const cont = sheet('Ciągłość wyciągów', [
    { header: 'Rachunek', key: 'account', width: 30 },
    { header: 'Problem', key: 'kind', width: 36 },
    { header: 'Wyciąg', key: 'prev', width: 10 },
    { header: 'do', key: 'prevTo', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: 'Saldo końcowe', key: 'closing', width: 16, style: { numFmt: money } },
    { header: 'Następny wyciąg', key: 'next', width: 14 },
    { header: 'od', key: 'nextFrom', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
    { header: 'Saldo początkowe', key: 'opening', width: 16, style: { numFmt: money } },
  ])
  for (const c of r.continuity) {
    cont.addRow({
      account: c.accountNumber,
      kind: CONTINUITY[c.kind],
      prev: c.prevNumber,
      prevTo: date(c.prevTo),
      closing: pln(c.prevClosing),
      next: c.nextNumber,
      nextFrom: date(c.nextFrom),
      opening: pln(c.nextOpening),
    })
  }
  if (!r.continuity.length) cont.addRow({ account: r.coverage ? 'Wyciągi ciągłe — brak problemów' : 'Brak wyciągów' })

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
