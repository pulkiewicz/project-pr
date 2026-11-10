import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BankImportResult, BankMatchResult, BankRuleDto, BankRuleResult, BankStatementDetailDto, BankStatementDto, BankTransactionDto, InvoiceDetailDto, InvoiceListResponse, InvoiceSyncResult } from '#shared'
import { counterpartyKey, invoiceDueState, invoicePaymentState, paymentState, statementContinuity, type BankReportDto } from '#shared'
import { INVOICES_SETTING_KEY } from '../../auth/access.ts'
import { createUser, eq, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'
import { FIXTURE_PAGES, buildPkoFixture, type FixtureTx } from '../../test/pko-fixture.tsx'
import { isSyncHour } from '../invoices/sync.ts'
import { findMatches, normNumber, similarName, type MatchInvoice, type MatchTx } from './match.ts'

describe('silnik dopasowań', () => {
  const tx = (id: string, open: number, texts: string[], counterparty: string | null = null, date = '2026-09-15'): MatchTx => ({ id, open, bookingDate: date, valueDate: null, texts, counterparty })
  const inv = (id: string, number: string | null, open: number | null, sellerName: string | null = null, date = '2026-09-10'): MatchInvoice => ({ id, number, open, sellerName, date })

  it('numery i nazwy firm', () => {
    expect(normNumber('FVS/526/2026')).toBe('FVS5262026')
    expect(normNumber('FV')).toBeNull()
    expect(normNumber('ABCDE')).toBeNull()
    expect(similarName('KACZMAREK ELECTRIC SP. Z O.O', 'Kaczmarek Electric Sp. z o.o.')).toBe(true)
    expect(similarName('ELEKTRONIKA S.A.', 'Kaczmarek Electric Sp. z o.o.')).toBe(false)
    expect(similarName('BAŁTYKGAZ SP. Z O.O.', 'Baltykgaz sp. z o.o.')).toBe(true)
  })

  it('numer + kwota łączy automatycznie; numer przy innej kwocie — propozycja', () => {
    const m = findMatches([tx('t1', 349_320, ['FVS/526/2026']), tx('t2', 100, ['FV402433091'])], [inv('i1', 'FVS/526/2026', 349_320), inv('i2', 'FV402433091', 95_056)])
    expect(m).toEqual([
      { txId: 't1', invoiceId: 'i1', amount: 349_320, reason: 'number', auto: true },
      { txId: 't2', invoiceId: 'i2', amount: 100, reason: 'number', auto: false },
    ])
  })

  it('numer w tytule zwykłego przelewu, także rozdzielony spacją („FV 12/2026”)', () => {
    const m = findMatches([tx('t1', 5_000, ['ZAPŁATA FV 12/2026 DZIĘKUJEMY'])], [inv('i1', 'FV12/2026', 5_000)])
    expect(m[0]).toMatchObject({ invoiceId: 'i1', auto: true })
  })

  it('ten sam numer w dwóch przelewach o sumie równej brutto (część netto + VAT) — propozycje', () => {
    const m = findMatches([tx('n', 26_498_698, ['SR2600307 CZĘŚĆ NETTO']), tx('v', 6_094_701, ['SR2600307 CZĘŚĆ VAT'])], [inv('i', 'SR2600307', 32_593_399)])
    expect(m).toEqual([
      { txId: 'n', invoiceId: 'i', amount: 26_498_698, reason: 'number_sum', auto: false },
      { txId: 'v', invoiceId: 'i', amount: 6_094_701, reason: 'number_sum', auto: false },
    ])
  })

  it('ten sam numer w kilku płatnościach, faktura bez tego numeru — propozycja faktury na łączną kwotę', () => {
    const txs = [tx('a', 60_000, ['ZAPŁATA ZA ZAM/77/2026 RATA 1'], 'KLIMA SERWIS', '2026-09-05'), tx('b', 40_000, ['ZAM/77/2026 RATA 2'], 'KLIMA SERWIS', '2026-09-20'), tx('x', 40_000, ['INNY PRZELEW'], 'ABC', '2026-12-20')]
    const m = findMatches(txs, [inv('fv', null, 100_000, 'Klima Serwis Sp. z o.o.', '2026-09-25'), inv('other', 'Z/1', 100_000, 'Kto inny', '2026-09-24'), inv('old', 'S/1', 100_000, 'Klima Serwis', '2026-05-01')])
    expect(m).toEqual([
      { txId: 'a', invoiceId: 'fv', amount: 60_000, reason: 'number_sum', auto: false },
      { txId: 'a', invoiceId: 'other', amount: 60_000, reason: 'number_sum', auto: false },
      { txId: 'b', invoiceId: 'fv', amount: 40_000, reason: 'number_sum', auto: false },
      { txId: 'b', invoiceId: 'other', amount: 40_000, reason: 'number_sum', auto: false },
    ])
    // Część płatności z tym numerem już połączona — wystarczy, że pozostałe dają resztę do zapłaty.
    // (rata 1 połączona — w operacjach otwartych zostały raty 2 i 3, a faktura ma do zapłaty ich sumę).
    const rest = [tx('b', 40_000, ['ZAM/77/2026 RATA 2'], 'KLIMA SERWIS', '2026-09-20'), tx('c', 25_000, ['ZAM/77/2026 RATA 3'], 'KLIMA SERWIS', '2026-10-05')]
    expect(findMatches(rest, [inv('fv', null, 65_000, 'Klima Serwis', '2026-09-25')]).map((x) => [x.txId, x.reason])).toEqual([
      ['b', 'number_sum'],
      ['c', 'number_sum'],
    ])
    // Daty (RRRR-MM-DD) i długie ciągi cyfr nie tworzą grupy „ten sam numer”.
    expect(findMatches([tx('d1', 1_000, ['DATA 2026-09-05']), tx('d2', 2_000, ['DATA 2026-09-05'])], [inv('s', null, 3_000)])).toEqual([])
  })

  it('płatność z grupy „ten sam numer” nie łączy się automatycznie z fakturą na samą swoją kwotę', () => {
    const m = findMatches([tx('a', 1_000, ['ZAM 55/2026'], null, '2026-09-10'), tx('b', 2_000, ['ZAM 55/2026'], null, '2026-09-11')], [inv('sum', null, 3_000, null, '2026-09-12'), inv('one', null, 1_000, null, '2026-09-10')])
    expect(m.every((x) => !x.auto)).toBe(true)
    expect(m.filter((x) => x.txId === 'a').map((x) => x.invoiceId)).toEqual(['sum', 'one'])
  })

  it('niejednoznaczne: dwie faktury z tym samym numerem albo dwie operacje z numerem jednej faktury — bez auto', () => {
    const two = findMatches([tx('t', 1_000, ['FV/1/2026'])], [inv('a', 'FV/1/2026', 1_000, 'A'), inv('b', 'FV/1/2026', 1_000, 'B')])
    expect(two.every((x) => !x.auto)).toBe(true)
    const dup = findMatches([tx('t1', 1_000, ['FV/1/2026']), tx('t2', 1_000, ['FV/1/2026'])], [inv('a', 'FV/1/2026', 1_000)])
    expect(dup.every((x) => !x.auto)).toBe(true)
  })

  it('bez numeru: kontrahent + kwota (proforma, faktura po zapłacie); sama kwota ±7 dni jednoznacznie — automatycznie', () => {
    const m = findMatches(
      [tx('p', 20_467_200, ['260PRO0170'], 'BAŁTYKGAZ SP. Z O.O.', '2026-09-18'), tx('c', 20_200, [], 'BP - STARE BABICE 803', '2026-09-01')],
      [inv('final', 'FV/2026/09/111', 20_467_200, 'Bałtykgaz Sp. z o.o.', '2026-10-05'), inv('fuel', 'F/1', 20_200, 'Orlen S.A.', '2026-09-03'), inv('far', 'F/2', 20_200, 'Orlen S.A.', '2026-09-20')],
    )
    expect(m).toEqual([
      { txId: 'p', invoiceId: 'final', amount: 20_467_200, reason: 'seller_amount', auto: false },
      { txId: 'c', invoiceId: 'fuel', amount: 20_200, reason: 'amount_date', auto: true },
    ])
  })

  it('sama kwota: 8–30 dni różnicy albo kilka możliwości — propozycje do ręcznego potwierdzenia', () => {
    // 8–30 dni: propozycja; ponad 30 dni: nic.
    expect(findMatches([tx('t', 5_000, [], 'SKLEP', '2026-10-20')], [inv('a', 'A/1', 5_000, 'Hurtownia', '2026-10-05'), inv('b', 'B/1', 5_000, 'Hurtownia', '2026-09-10')])).toEqual([
      { txId: 't', invoiceId: 'a', amount: 5_000, reason: 'amount_date_30', auto: false },
    ])
    // Dwie faktury z tą kwotą w ciągu 7 dni — niejednoznaczne, obie jako propozycje.
    expect(findMatches([tx('t', 5_000, [], 'SKLEP', '2026-10-20')], [inv('a', 'A/1', 5_000, 'Hurtownia', '2026-10-18'), inv('b', 'B/1', 5_000, 'Hurtownia', '2026-10-22')])).toEqual([
      { txId: 't', invoiceId: 'a', amount: 5_000, reason: 'amount_date', auto: false },
      { txId: 't', invoiceId: 'b', amount: 5_000, reason: 'amount_date', auto: false },
    ])
    // Dwie płatności z tą kwotą w ciągu 7 dni od jednej faktury — też tylko propozycje.
    expect(findMatches([tx('t1', 5_000, [], 'SKLEP', '2026-10-20'), tx('t2', 5_000, [], 'SKLEP', '2026-10-21')], [inv('a', 'A/1', 5_000, 'Hurtownia', '2026-10-18')]).map((m) => m.auto)).toEqual([false, false])
  })

  it('stan zapłaty i klucz kontrahenta', () => {
    expect(paymentState(1000, 0)).toBe('unpaid')
    expect(paymentState(1000, 400)).toBe('partial')
    expect(paymentState(1000, 1000)).toBe('paid')
    expect(paymentState(null, 1)).toBe('paid')
    // Stan w aplikacji: status z inFakt albo wyciągi — korzystniejszy.
    const inv = (paidAmount: number, paymentStatus: string | null) => ({ grossPrice: 1000, paidAmount, paymentStatus })
    expect(invoicePaymentState(inv(0, 'paid'))).toBe('paid')
    expect(invoicePaymentState(inv(0, 'payment_not_applicable'))).toBe('paid')
    expect(invoicePaymentState(inv(1000, 'unpaid'))).toBe('paid')
    expect(invoicePaymentState(inv(0, 'partial_payment'))).toBe('partial')
    expect(invoicePaymentState(inv(400, null))).toBe('partial')
    expect(invoicePaymentState(inv(0, 'unpaid'))).toBe('unpaid')
    expect(invoiceDueState({ ...inv(0, 'paid'), dueDate: '2026-01-01' }, '2026-11-03')).toBe('paid')
    expect(invoiceDueState({ ...inv(0, 'unpaid'), dueDate: '2026-01-01' }, '2026-11-03')).toBe('overdue')
    expect(counterpartyKey({ counterpartyAccount: '11', counterpartyName: 'X', merchant: null })).toBe('11')
    expect(counterpartyKey({ counterpartyAccount: null, counterpartyName: null, merchant: 'Allegro.pl' })).toBe('ALLEGRO PL')
    expect(counterpartyKey({ counterpartyAccount: null, counterpartyName: null, merchant: null })).toBeNull()
  })
})

let h: Harness
let ania: TestUser
let outsider: TestUser
const ids = {} as Record<'fv12' | 'fv1' | 'fuel', string>

beforeAll(async () => {
  h = await startHarness()
  ania = await createUser(h, 'EnvcheckInternal')
  outsider = await createUser(h, 'EnvcheckInternal')
  await h.db.insert(schema.appSettings).values({ key: INVOICES_SETTING_KEY, value: { userIds: [ania.id], syncFrom: '2026-01-01' } })
  const base = { kind: 'document_scan', currency: 'PLN' }
  const rows = await h.db
    .insert(schema.costInvoices)
    .values([
      { ...base, infaktUuid: 'u-fv12', number: 'FV 12/10/2026', sellerName: 'Firma Testowa Sp. z o.o.', grossPrice: 123_000, netPrice: 100_000, issueDate: '2026-09-30' },
      { ...base, infaktUuid: 'u-fv1', number: 'FV/1/2026', sellerName: 'Hurtownia Test S.A.', grossPrice: 123_000, netPrice: 100_000, issueDate: '2026-09-28' },
      // Paliwo: numer nie występuje w opisie płatności kartą, faktura 15 dni przed płatnością — propozycja po kontrahencie i kwocie.
      { ...base, infaktUuid: 'u-fuel', number: 'PAL/77/2026', sellerName: 'Stacja Paliw X Sp. z o.o.', grossPrice: 10_050, netPrice: 8_171, issueDate: '2026-09-20' },
    ])
    .returning({ id: schema.costInvoices.id, uuid: schema.costInvoices.infaktUuid })
  for (const r of rows) ids[r.uuid.slice(2) as keyof typeof ids] = r.id
})
afterAll(() => h.stop())

const upload = (data: Uint8Array, name: string) => {
  const form = new FormData()
  form.set('file', new File([data], name, { type: 'application/pdf' }))
  return h.app.request('/api/bank/import', { method: 'POST', headers: ania.headers, body: form })
}
const txsOf = async (number: string) => {
  const list = (await (await req(h, 'GET', '/api/bank/statements', ania.headers)).json()) as BankStatementDto[]
  const st = list.find((x) => x.number === number)!
  return ((await (await req(h, 'GET', `/api/bank/statements/${st.id}`, ania.headers)).json()) as BankStatementDetailDto).transactions
}
const invoice = async (id: string) => (await (await req(h, 'GET', `/api/invoices/${id}`, ania.headers)).json()) as InvoiceDetailDto

describe('rekoncyliacja przez API', () => {
  it('import łączy automatycznie numer + kwotę, kartę proponuje; faktura ma płatność i stan zapłaty', async () => {
    const res = await upload(await buildPkoFixture(), 'Wyciag_10.pdf')
    expect(res.status).toBe(200)
    expect(((await res.json()) as BankImportResult).match).toEqual({ linked: 2, suggested: 1, ruled: 0 })

    const tx = await txsOf('10/2026')
    expect(tx[0]).toMatchObject({ costStatus: 'invoice', links: [{ invoiceId: ids.fv12, invoiceNumber: 'FV 12/10/2026', amount: 123_000, source: 'auto' }] })
    expect(tx[2]).toMatchObject({ type: 'PRZELEW SPLIT-PAYMENT', costStatus: 'invoice', links: [{ invoiceId: ids.fv1, amount: 123_000 }] })
    expect(tx[1]).toMatchObject({ kind: 'vat_transfer', links: [], suggestions: [] })
    expect(tx[4]).toMatchObject({ kind: 'card', costStatus: 'pending', links: [], suggestions: [{ invoiceId: ids.fuel, reason: 'seller_amount', amount: 10_050 }] })

    const list = (await (await req(h, 'GET', '/api/invoices', ania.headers)).json()) as InvoiceListResponse
    expect(list.items.find((i) => i.id === ids.fv12)).toMatchObject({ paidAmount: 123_000 })
    expect(list.items.find((i) => i.id === ids.fuel)).toMatchObject({ paidAmount: 0 })
    expect((await invoice(ids.fv1)).payments).toEqual([expect.objectContaining({ statementNumber: '10/2026', bookingDate: '2026-10-02', amount: 123_000, counterparty: 'HURTOWNIA TEST S.A.', source: 'auto' })])
  })

  it('zatwierdzenie propozycji, rozłączenie, blokada zmiany statusu połączonej operacji', async () => {
    const card = (await txsOf('10/2026'))[4]!
    let res = await req(h, 'POST', `/api/bank/transactions/${card.id}/links`, ania.headers, { invoiceId: ids.fuel })
    expect(res.status).toBe(200)
    expect((await res.json()) as BankTransactionDto).toMatchObject({ costStatus: 'invoice', links: [{ invoiceId: ids.fuel, amount: 10_050, source: 'manual' }], suggestions: [] })
    expect((await req(h, 'PATCH', `/api/bank/transactions/${card.id}`, ania.headers, { costStatus: 'no_invoice' })).status).toBe(409)
    expect((await req(h, 'POST', `/api/bank/transactions/${card.id}/links`, outsider.headers, { invoiceId: ids.fuel })).status).toBe(403)

    res = await req(h, 'DELETE', `/api/bank/transactions/${card.id}/links/${ids.fuel}`, ania.headers)
    expect((await res.json()) as BankTransactionDto).toMatchObject({ costStatus: 'pending', links: [], suggestions: [{ invoiceId: ids.fuel }] })
    expect((await req(h, 'DELETE', `/api/bank/transactions/${card.id}/links/${ids.fuel}`, ania.headers)).status).toBe(404)

    // Wpływ nie jest wydatkiem — nie łączy się z fakturą kosztową.
    const income = (await txsOf('10/2026'))[5]!
    expect((await req(h, 'POST', `/api/bank/transactions/${income.id}/links`, ania.headers, { invoiceId: ids.fuel })).status).toBe(422)

    const audit = await h.db.select().from(schema.auditLog)
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['bank.link', 'bank.unlink']))
  })

  it('„Dopasuj automatycznie” łączy fakturę z inFakt, która doszła po imporcie wyciągu', async () => {
    // Faktura „FV 12/10/2026” wycofana z aplikacji (jakby jeszcze jej nie było w inFakt) — przelew wraca do „do ustalenia”.
    const first = (await txsOf('10/2026'))[0]!
    await req(h, 'DELETE', `/api/bank/transactions/${first.id}/links/${ids.fv12}`, ania.headers)
    await h.db.delete(schema.costInvoices).where(eq(schema.costInvoices.id, ids.fv12))
    const st = (await (await req(h, 'GET', '/api/bank/statements', ania.headers)).json()) as BankStatementDto[]
    let r = (await (await req(h, 'POST', '/api/bank/match', ania.headers, { statementId: st[0]!.id })).json()) as BankMatchResult
    expect(r).toMatchObject({ linked: 0 })
    const [late] = await h.db
      .insert(schema.costInvoices)
      .values({ infaktUuid: 'u-late', kind: 'cost', currency: 'PLN', number: 'FV 12/10/2026', sellerName: 'Firma Testowa Sp. z o.o.', grossPrice: 123_000, issueDate: '2026-09-30' })
      .returning({ id: schema.costInvoices.id })
    r = (await (await req(h, 'POST', '/api/bank/match', ania.headers, { statementId: st[0]!.id })).json()) as BankMatchResult
    expect(r).toMatchObject({ linked: 1 })
    expect((await txsOf('10/2026'))[0]).toMatchObject({ costStatus: 'invoice', links: [{ invoiceId: late!.id, source: 'auto' }] })
    expect((await req(h, 'POST', '/api/bank/match', ania.headers, { statementId: crypto.randomUUID() })).status).toBe(404)
  })

  it('synchronizacja z inFakt sama aktualizuje Rozliczenia (bez „Dopasuj automatycznie”)', async () => {
    const first = (await txsOf('10/2026'))[0]!
    const [linkedId] = first.links.map((l) => l.invoiceId)
    await req(h, 'DELETE', `/api/bank/transactions/${first.id}/links/${linkedId}`, ania.headers)
    await h.db.delete(schema.costInvoices).where(eq(schema.costInvoices.id, linkedId!))
    expect((await txsOf('10/2026'))[0]).toMatchObject({ costStatus: 'pending', links: [] })
    // Faktura pojawia się w inFakt — synchronizacja ją pobiera i od razu łączy z przelewem.
    h.infakt.costs = [
      { uuid: '00000000-0000-4000-8000-00000000f012', kind: 'document_scan', number: 'FV 12/10/2026', seller_name: 'Firma Testowa Sp. z o.o.', description: null, category: null,
        issue_date: '2026-09-30', due_date: null, currency: 'PLN', net_price: 100_000, gross_price: 123_000, tax_price: 23_000, created_at: '2026-10-01T10:00:00.000+02:00', statuses: [] },
    ]
    const r = (await (await req(h, 'POST', '/api/invoices/sync', ania.headers)).json()) as InvoiceSyncResult
    expect(r).toMatchObject({ created: 1, match: { linked: 1 } })
    expect((await txsOf('10/2026'))[0]).toMatchObject({ costStatus: 'invoice', links: [{ invoiceNumber: 'FV 12/10/2026', source: 'auto' }] })
  })

  it('harmonogram: 8:00 i 14:00 czasu warszawskiego, latem i zimą', () => {
    expect(isSyncHour(new Date('2026-11-09T07:00:00Z'))).toBe(true) // 8:00 CET
    expect(isSyncHour(new Date('2026-11-09T13:00:00Z'))).toBe(true) // 14:00 CET
    expect(isSyncHour(new Date('2026-11-09T06:00:00Z'))).toBe(false) // 7:00 CET
    expect(isSyncHour(new Date('2026-07-01T06:00:00Z'))).toBe(true) // 8:00 CEST
    expect(isSyncHour(new Date('2026-07-01T12:00:00Z'))).toBe(true) // 14:00 CEST
    expect(isSyncHour(new Date('2026-07-01T07:00:00Z'))).toBe(false) // 9:00 CEST
  })

  it('reguła kontrahenta: z ustawień operacji, od razu i przy kolejnych importach', async () => {
    const card = (await txsOf('10/2026'))[4]!
    // Bez „kosztu bez faktury” reguły nie ma.
    expect((await req(h, 'POST', '/api/bank/rules', ania.headers, { transactionId: card.id })).status).toBe(422)
    await req(h, 'PATCH', `/api/bank/transactions/${card.id}`, ania.headers, { costStatus: 'no_invoice', general: true, vatRate: 23 })
    const res = await req(h, 'POST', '/api/bank/rules', ania.headers, { transactionId: card.id })
    expect(res.status).toBe(200)
    const { rule } = (await res.json()) as BankRuleResult
    expect(rule).toMatchObject({ key: 'STACJA PALIW X WARSZAWA PL', label: 'STACJA PALIW X WARSZAWA PL', general: true, vatRate: 23 })
    expect((await txsOf('10/2026'))[4]).toMatchObject({ hasRule: true })

    // Kolejny wyciąg z zakupem w tym samym miejscu — reguła przy imporcie.
    const again: FixtureTx = { ...FIXTURE_PAGES[1]![0]!, date: '20.11.2026', id: '6824MX90000000200', amount: -5_000 }
    const imp = (await (await upload(await buildPkoFixture({ number: '11/2026', pages: [[again]] }), 'Wyciag_11.pdf')).json()) as BankImportResult
    expect(imp.match).toMatchObject({ ruled: 1 })
    expect((await txsOf('11/2026'))[0]).toMatchObject({ costStatus: 'no_invoice', general: true, vatRate: 23, hasRule: true })

    const rules = (await (await req(h, 'GET', '/api/bank/rules', ania.headers)).json()) as BankRuleDto[]
    expect(rules).toHaveLength(1)
    expect((await req(h, 'DELETE', `/api/bank/rules/${rule.id}`, ania.headers)).status).toBe(200)
    expect((await txsOf('11/2026'))[0]).toMatchObject({ costStatus: 'no_invoice', hasRule: false })
  })

  it('raport rozliczeń: ciągłość, wydatki bez faktury, faktury niezapłacone i po terminie; eksport XLSX', async () => {
    // Przelew split payment rozłączony z FV/1/2026 — wraca na listę braków, a faktura do niezapłaconych.
    const split = (await txsOf('10/2026'))[2]!
    await req(h, 'DELETE', `/api/bank/transactions/${split.id}/links/${ids.fv1}`, ania.headers)
    await h.db.update(schema.costInvoices).set({ issueDate: '2026-10-02', dueDate: '2026-10-10' }).where(eq(schema.costInvoices.id, ids.fv1))

    const res = await req(h, 'GET', '/api/bank/report', ania.headers)
    expect(res.status).toBe(200)
    const r = (await res.json()) as BankReportDto
    expect(r).toMatchObject({ from: '2026-10-01', to: '2026-10-31', coverage: { from: '2026-10-01', to: '2026-10-31' } })
    // Wyciąg testowy 11/2026 ma w nagłówku ten sam okres co 10/2026 — nakładanie się okresów.
    expect(r.continuity).toEqual([expect.objectContaining({ kind: 'overlap', prevNumber: expect.any(String), nextNumber: expect.any(String) })])
    expect(r.missing.map((x) => x.id)).toContain(split.id)
    expect(r.missing.find((x) => x.id === split.id)).toMatchObject({ amount: 123_000, reference: 'FV/1/2026', counterparty: 'HURTOWNIA TEST S.A.', costStatus: 'pending' })
    // Propozycja faktury do potwierdzenia w Rozliczeniach.
    expect(r.missing.find((x) => x.id === split.id)!.suggestions).toEqual([expect.objectContaining({ invoiceId: ids.fv1, invoiceNumber: 'FV/1/2026', amount: 123_000 })])
    // Połączone i oznaczone jako koszt bez faktury nie są brakami.
    expect(r.missing.every((x) => x.costStatus === 'pending' || x.costStatus === 'invoice')).toBe(true)
    const fv1 = r.unpaid.find((x) => x.id === ids.fv1)!
    expect(fv1).toMatchObject({ number: 'FV/1/2026', grossPrice: 123_000, paidAmount: 0, openAmount: 123_000 })
    expect(fv1.overdueDays).toBeGreaterThan(0)
    expect(r.unpaid[0]!.id).toBe(ids.fv1)
    // Zapłacona (połączona) faktura nie jest na liście.
    expect(r.unpaid.map((x) => x.number)).not.toContain('FV 12/10/2026')
    expect(fv1).toMatchObject({ paidInInfakt: false })

    // Opłacona wg inFakt (np. z innego rachunku): zostaje na liście, oznaczona i bez dni po terminie.
    await h.db.update(schema.costInvoices).set({ paymentStatus: 'paid' }).where(eq(schema.costInvoices.id, ids.fv1))
    const r2 = (await (await req(h, 'GET', '/api/bank/report', ania.headers)).json()) as BankReportDto
    expect(r2.unpaid.find((x) => x.id === ids.fv1)).toMatchObject({ paidInInfakt: true, infaktPaymentStatus: 'paid', overdueDays: null })
    await h.db.update(schema.costInvoices).set({ paymentStatus: null }).where(eq(schema.costInvoices.id, ids.fv1))

    // Okres bez operacji.
    const empty = (await (await req(h, 'GET', '/api/bank/report?from=2025-01-01&to=2025-01-31', ania.headers)).json()) as BankReportDto
    expect(empty).toMatchObject({ from: '2025-01-01', to: '2025-01-31', missing: [], unpaid: [] })
    expect((await req(h, 'GET', '/api/bank/report?from=2025-1-1', ania.headers)).status).toBe(422)

    const xlsx = await req(h, 'GET', '/api/bank/report.xlsx', ania.headers)
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers.get('content-disposition')).toContain('rozliczenia-2026-10-01_2026-10-31.xlsx')
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(1000)
    expect((await req(h, 'GET', '/api/bank/report', outsider.headers)).status).toBe(403)
  })
})

describe('ciągłość wyciągów', () => {
  const st = (number: string, periodFrom: string, periodTo: string, openingBalance: number, closingBalance: number, accountNumber = 'A') => ({ accountNumber, number, periodFrom, periodTo, openingBalance, closingBalance })
  it('styk dni i sald; brakujący miesiąc, nakładanie, niezgodne saldo; rachunki osobno', () => {
    expect(statementContinuity([st('9/2026', '2026-09-01', '2026-09-30', 0, 100), st('10/2026', '2026-10-01', '2026-10-31', 100, 50)])).toEqual([])
    expect(statementContinuity([st('10/2026', '2026-10-01', '2026-10-31', 100, 50), st('8/2026', '2026-08-01', '2026-08-31', 0, 100)])).toEqual([
      expect.objectContaining({ kind: 'gap', prevNumber: '8/2026', nextNumber: '10/2026', prevTo: '2026-08-31', nextFrom: '2026-10-01' }),
    ])
    expect(statementContinuity([st('9/2026', '2026-09-01', '2026-09-30', 0, 100), st('9a', '2026-09-15', '2026-10-15', 100, 50)])[0]).toMatchObject({ kind: 'overlap' })
    expect(statementContinuity([st('9/2026', '2026-09-01', '2026-09-30', 0, 100), st('10/2026', '2026-10-01', '2026-10-31', 90, 50)])[0]).toMatchObject({ kind: 'balance', prevClosing: 100, nextOpening: 90 })
    expect(statementContinuity([st('9/2026', '2026-09-01', '2026-09-30', 0, 100, 'A'), st('10/2026', '2026-10-01', '2026-10-31', 5, 50, 'B')])).toEqual([])
  })
})
