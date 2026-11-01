import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultCostStatus, type BankCostDto, type BankImportPreview, type BankImportResult, type BankStatementDetailDto, type BankStatementDto, type BankTransactionDto, type CostCategoryDto } from '#shared'
import { INVOICES_SETTING_KEY } from '../../auth/access.ts'
import { SEED_PROJECT_ID } from '../../db/seed-sql.ts'
import { createUser, req, schema, startHarness, type Harness, type TestUser } from '../../test/harness.ts'
import { FIXTURE_ACCOUNT, FIXTURE_OPENING, FIXTURE_PAGES, buildPkoFixture, type FixtureTx } from '../../test/pko-fixture.tsx'
import { classify, describe as describeTx, extractPdfItems, parseMoney, parsePkoStatement } from './pko.ts'

let h: Harness
let ania: TestUser
let outsider: TestUser
let pdf: Uint8Array

beforeAll(async () => {
  h = await startHarness()
  ania = await createUser(h, 'EnvcheckInternal')
  outsider = await createUser(h, 'EnvcheckInternal')
  await h.db.insert(schema.appSettings).values({ key: INVOICES_SETTING_KEY, value: { userIds: [ania.id], syncFrom: '2026-01-01' } })
  pdf = await buildPkoFixture()
})
afterAll(() => h.stop())

const txsOf = async (number: string) => {
  const list = (await (await req(h, 'GET', '/api/bank/statements', ania.headers)).json()) as BankStatementDto[]
  const st = list.find((x) => x.number === number)!
  return ((await (await req(h, 'GET', `/api/bank/statements/${st.id}`, ania.headers)).json()) as BankStatementDetailDto).transactions
}
const bankCosts = async () => (await (await req(h, 'GET', '/api/bank/costs', ania.headers)).json()) as BankCostDto[]

const upload = (path: string, user: TestUser, data: Uint8Array, name = 'Wyciag_10.pdf') => {
  const form = new FormData()
  form.set('file', new File([data], name, { type: 'application/pdf' }))
  return h.app.request(`/api${path}`, { method: 'POST', headers: user.headers, body: form })
}

describe('odczyt wyciągu PKO BP', () => {
  it('kwoty, rodzaje operacji i pola z opisu', () => {
    expect(parseMoney('-1 118 171,48')).toBe(-111817148)
    expect(parseMoney('653,20')).toBe(65320)
    expect(parseMoney('abc')).toBeNull()
    expect(classify('PRZELEW PRZYCH. Z/NA RACH. VAT', '', 100)).toBe('vat_transfer')
    expect(classify('PRZELEW Z/NA RACHUNKU VAT', '', -100)).toBe('vat_transfer')
    expect(classify('PRZELEW SPLIT-PAYMENT', '', -100)).toBe('transfer')
    expect(classify('PROWIZJA SPLIT-PAYMENT ZEW.', '', -110)).toBe('bank_fee')
    expect(classify('OPŁ. ZA KORZYST. Z USŁUGI POW. SMS', '', -1000)).toBe('bank_fee')
    expect(classify('PRZELEW US VAT', '', -100)).toBe('tax')
    expect(classify('PRZEL DO ORG. PODATKOWEGO/CELNEGO', '', -100)).toBe('tax')
    expect(classify('PRZELEW ZEWNĘTRZNY NZUS', '', -100)).toBe('zus')
    expect(classify('PŁATNOŚĆ WEB - KOD MOBILNY', '', -100)).toBe('card')
    expect(classify('ZAKUP W TERMINALU-KOD MOBILNY', '', -100)).toBe('card')
    expect(classify('PRZELEW WYCHODZĄCY', 'WYNAGRODZENIE 9/2026 15 2030 …', -100)).toBe('salary')
    expect(classify('PRZELEW PRZYCHODZĄCY', '', 100)).toBe('income')

    expect(describeTx('RACHUNEK 1/08/2026 NAJEM 95 1140 2004 0000 3902 1976 7717 JAN NOWAK')).toMatchObject({
      title: 'RACHUNEK 1/08/2026 NAJEM',
      counterpartyName: 'JAN NOWAK',
      counterpartyAccount: '95114020040000390219767717',
    })
    expect(
      describeTx('Kwota VAT:3355,15 ID Dostawcy:8361527589 Nr faktury lub okres zbiorczości:18175/WAW/09/2026 PROFORMA 85 1240 1082 1111 0010 3136 3995 FIRMA SP. Z O.O.'),
    ).toMatchObject({ title: null, invoiceRef: '18175/WAW/09/2026 PROFORMA', vatAmount: 335515, supplierNip: '8361527589', counterpartyName: 'FIRMA SP. Z O.O.' })
    expect(describeTx('Tel.:48500000000 Godz.21:22:31 Lokalizacja: Allegro.pl Nr ref: 00000094918983786')).toMatchObject({ merchant: 'Allegro.pl', counterpartyName: null })
  })

  it('PDF na dwóch stronach: nagłówek, operacje z opisami, salda zgodne', async () => {
    const { statement, transactions, issues } = parsePkoStatement(await extractPdfItems(pdf))
    expect(issues).toEqual([])
    expect(statement).toMatchObject({ bank: 'PKO BP', accountNumber: FIXTURE_ACCOUNT, number: '10/2026', periodFrom: '2026-10-01', periodTo: '2026-10-31', openingBalance: FIXTURE_OPENING })
    expect(transactions.map((t) => t.kind)).toEqual(['transfer', 'vat_transfer', 'transfer', 'bank_fee', 'card', 'income', 'salary'])
    expect(transactions[0]).toMatchObject({ seq: 1, bookingDate: '2026-10-01', valueDate: '2026-10-01', amount: -123_000, title: 'FV 12/10/2026 USŁUGI', counterpartyName: 'FIRMA TESTOWA SP. Z O.O.' })
    expect(transactions[2]).toMatchObject({ operationId: '6775FE00200000002', invoiceRef: 'FV/1/2026', vatAmount: 23_000, supplierNip: '1234567890', counterpartyName: 'HURTOWNIA TEST S.A.', counterpartyAccount: '99114020040000390219767717' })
    expect(transactions[3]).toMatchObject({ type: 'PROWIZJA SPLIT-PAYMENT ZEW.', description: '' })
    expect(transactions[4]).toMatchObject({ bookingDate: '2026-10-05', cardHolder: 'KOWALSKI JAN', merchant: 'STACJA PALIW X WARSZAWA PL' })
    const total = FIXTURE_PAGES.flat().reduce((s, t) => s + t.amount, FIXTURE_OPENING)
    expect(statement!.closingBalance).toBe(total)
    expect(transactions.at(-1)!.balance).toBe(total)
  })

  it('błędne saldo po operacji blokuje import (operacja odczytana niepoprawnie)', async () => {
    const { issues } = parsePkoStatement(await extractPdfItems(await buildPkoFixture({ breakBalanceAt: 3 })))
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', code: 'balance', seq: 3 })])
  })

  it('obcy PDF nie jest rozpoznany jako wyciąg', () => {
    const r = parsePkoStatement([{ page: 1, x: 10, y: 10, str: 'Faktura VAT 1/2026' }])
    expect(r.statement).toBeNull()
    expect(r.issues[0]).toMatchObject({ code: 'format' })
  })
})

describe('import przez API', () => {
  it('tylko osoby z listy Faktur', async () => {
    expect((await req(h, 'GET', '/api/bank/statements', outsider.headers)).status).toBe(403)
    expect((await upload('/bank/import/preview', outsider, pdf)).status).toBe(403)
  })

  it('podgląd → import → lista i operacje; ten sam plik drugi raz odrzucony', async () => {
    const pre = await upload('/bank/import/preview', ania, pdf)
    expect(pre.status).toBe(200)
    const preview = (await pre.json()) as BankImportPreview
    expect(preview).toMatchObject({ canCommit: true, duplicates: 0, kinds: { transfer: 2, vat_transfer: 1, bank_fee: 1, card: 1, income: 1, salary: 1 } })

    const res = await upload('/bank/import', ania, pdf)
    expect(res.status).toBe(200)
    const result = (await res.json()) as BankImportResult
    expect(result).toMatchObject({ created: 7, duplicates: 0 })

    const list = (await (await req(h, 'GET', '/api/bank/statements', ania.headers)).json()) as BankStatementDto[]
    expect(list).toEqual([expect.objectContaining({ id: result.statementId, number: '10/2026', transactionCount: 7, fileName: 'Wyciag_10.pdf' })])
    const detail = (await (await req(h, 'GET', `/api/bank/statements/${result.statementId}`, ania.headers)).json()) as BankStatementDetailDto
    expect(detail.transactions.map((t) => t.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])

    const again = (await (await upload('/bank/import/preview', ania, pdf)).json()) as BankImportPreview
    expect(again.canCommit).toBe(false)
    expect(again.issues).toContainEqual(expect.objectContaining({ code: 'already_imported', detail: '10/2026' }))
    expect(again.duplicates).toBe(7)
    expect((await upload('/bank/import', ania, pdf)).status).toBe(422)
  })

  it('wyciąg za nakładający się okres: operacje już zapisane są pomijane', async () => {
    const extra: FixtureTx = { date: '31.10.2026', id: '6804FE90000000099', type: 'PRZELEW WYCHODZĄCY', amount: -5_000, desc: ['FV 99/2026 12 3456 7890 1234 5678 9012 3456 FIRMA TESTOWA SP. Z O.O.'] }
    const other = await buildPkoFixture({ number: '11/2026', pages: [FIXTURE_PAGES[0]!, [...FIXTURE_PAGES[1]!, extra]] })
    const preview = (await (await upload('/bank/import/preview', ania, other, 'Wyciag_10A.pdf')).json()) as BankImportPreview
    expect(preview).toMatchObject({ canCommit: true, duplicates: 7, kinds: { transfer: 1 } })
    const result = (await (await upload('/bank/import', ania, other, 'Wyciag_10A.pdf')).json()) as BankImportResult
    expect(result).toMatchObject({ created: 1, duplicates: 7 })
  })

  it('odrzuca plik inny niż PDF i PDF, który nie jest wyciągiem', async () => {
    expect((await upload('/bank/import/preview', ania, new Uint8Array([1, 2, 3]), 'wyciag.csv')).status).toBe(422)
    const bad = await upload('/bank/import/preview', ania, new Uint8Array([1, 2, 3]), 'wyciag.pdf')
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { code: string }).code).toBe('bank_file_invalid')
  })

  it('rozliczenie domyślne: koszty bez faktury (opłaty, wynagrodzenia), VAT i wpływy poza kosztami, reszta do ustalenia', async () => {
    const tx = await txsOf('10/2026')
    expect(tx.map((t) => t.costStatus)).toEqual(['pending', 'excluded', 'pending', 'no_invoice', 'pending', 'excluded', 'no_invoice'])
    expect(defaultCostStatus('tax', 'N 9512591569 26M08 VAT-7')).toBe('excluded')
    expect(defaultCostStatus('tax', 'N 9512591569 26M08 CIT-8E')).toBe('excluded')
    expect(defaultCostStatus('tax', 'N 9512591569 26M08 PIT-4')).toBe('no_invoice')
    expect(defaultCostStatus('tax', 'MANDAT')).toBe('pending')
    const costs = await bankCosts()
    expect(costs.map((c) => c.amount).sort((a, b) => a - b)).toEqual([110, 300_000])
    expect(costs.every((c) => !c.projectId && !c.general)).toBe(true)
  })

  it('kategoria, projekt i koszty ogólne; zmiana rozliczenia czyści projekt', async () => {
    const tx = await txsOf('10/2026')
    const salary = tx.find((t) => t.kind === 'salary')!
    const card = tx.find((t) => t.kind === 'card')!
    const categories = (await (await req(h, 'GET', '/api/invoices/categories', ania.headers)).json()) as CostCategoryDto[]
    const fuel = categories.find((k) => k.name === 'Paliwo')!

    const patch = (id: string, body: object, user = ania) => req(h, 'PATCH', `/api/bank/transactions/${id}`, user.headers, body)
    let res = await patch(salary.id, { projectId: SEED_PROJECT_ID, costCategoryId: categories.find((k) => k.name === 'Pensje')!.id })
    expect(res.status).toBe(200)
    expect((await res.json()) as BankTransactionDto).toMatchObject({ projectId: SEED_PROJECT_ID, general: false, costCategoryName: 'Pensje' })

    res = await patch(card.id, { costStatus: 'no_invoice', general: true, costCategoryId: fuel.id })
    expect((await res.json()) as BankTransactionDto).toMatchObject({ costStatus: 'no_invoice', projectId: null, general: true, costCategoryId: fuel.id })

    const costs = await bankCosts()
    expect(costs).toHaveLength(3)
    expect(costs.find((c) => c.id === salary.id)).toMatchObject({ amount: 300_000, projectCode: expect.any(String) })
    expect(costs.find((c) => c.id === card.id)).toMatchObject({ amount: 10_050, general: true })

    // Koszt z faktury przypisuje się w fakturze — operacja traci projekt, kategoria zostaje.
    res = await patch(salary.id, { costStatus: 'invoice' })
    expect((await res.json()) as BankTransactionDto).toMatchObject({ costStatus: 'invoice', projectId: null, general: false, costCategoryName: 'Pensje' })
    expect(await bankCosts()).toHaveLength(2)

    expect((await patch(card.id, { costCategoryId: crypto.randomUUID() })).status).toBe(422)
    expect((await patch(card.id, { projectId: crypto.randomUUID() })).status).toBe(422)
    expect((await patch(card.id, { costStatus: 'paid' })).status).toBe(422)
    expect((await patch(card.id, { general: false }, outsider)).status).toBe(403)

    // Kategoria używana na operacji nie może zostać usunięta.
    const cats = (await (await req(h, 'GET', '/api/invoices/categories', ania.headers)).json()) as CostCategoryDto[]
    expect(cats.find((k) => k.id === fuel.id)).toMatchObject({ invoiceCount: 0, transactionCount: 1 })
    const admin = await createUser(h, 'Admin')
    expect((await req(h, 'DELETE', `/api/admin/settings/cost-categories/${fuel.id}`, admin.headers)).status).toBe(409)
  })

  it('usunięcie wyciągu usuwa jego operacje (z wpisem w audit logu)', async () => {
    const list = (await (await req(h, 'GET', '/api/bank/statements', ania.headers)).json()) as BankStatementDto[]
    const first = list.find((s) => s.number === '10/2026')!
    expect((await req(h, 'DELETE', `/api/bank/statements/${first.id}`, ania.headers)).status).toBe(200)
    expect((await req(h, 'GET', `/api/bank/statements/${first.id}`, ania.headers)).status).toBe(404)
    const left = await h.db.select().from(schema.bankTransactions)
    expect(left).toHaveLength(1)
    const audit = await h.db.select().from(schema.auditLog)
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['bank.import', 'bank.delete']))
  })
})
