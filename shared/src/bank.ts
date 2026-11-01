/**
 * Wyciągi bankowe (PKO BP, PDF) — import operacji z rachunku firmowego do rekoncyliacji z fakturami kosztowymi.
 * Kwoty w groszach; wydatki ujemne, wpływy dodatnie (jak na wyciągu).
 */

/**
 * Rodzaj operacji (ustalany przy imporcie z typu i opisu):
 * - `transfer` / `card` — wydatki, do których szukamy faktury kosztowej,
 * - `vat_transfer` — przeksięgowanie z/na rachunek VAT przy podzielonej płatności (nie jest wydatkiem),
 * - `tax`, `zus`, `salary`, `bank_fee` — wydatki bez faktury kosztowej,
 * - `income` — wpływy (tylko podgląd; faktur sprzedażowych w aplikacji nie ma).
 */
export const BANK_TX_KINDS = ['transfer', 'card', 'vat_transfer', 'tax', 'zus', 'salary', 'bank_fee', 'income'] as const
export type BankTxKind = (typeof BANK_TX_KINDS)[number]
/** Rodzaje, dla których szukamy faktury kosztowej. */
export const BANK_TX_NEEDS_INVOICE: readonly BankTxKind[] = ['transfer', 'card']

/** Operacja odczytana z wyciągu. */
export interface BankTxParsed {
  /** Identyfikator operacji banku; wspólny dla operacji powiązanych (przelew + opłata, split payment + przeksięgowanie VAT). */
  operationId: string
  /** Kolejność na wyciągu (od 1). */
  seq: number
  bookingDate: string
  valueDate: string | null
  type: string
  amount: number
  balance: number
  /** Pełny opis operacji (wiersze złączone spacją). */
  description: string
  /** Tytuł przelewu (tekst przed numerem rachunku kontrahenta). */
  title: string | null
  counterpartyName: string | null
  /** Numer rachunku kontrahenta (26 cyfr, bez spacji). */
  counterpartyAccount: string | null
  /** Split payment: „Nr faktury lub okres zbiorczości”. */
  invoiceRef: string | null
  /** Split payment: kwota VAT w groszach. */
  vatAmount: number | null
  /** Split payment: „ID Dostawcy” (NIP wystawcy faktury). */
  supplierNip: string | null
  /** Płatność kartą: posiadacz karty. */
  cardHolder: string | null
  /** Płatność kartą / BLIK: miejsce („Lokalizacja”). */
  merchant: string | null
  kind: BankTxKind
}

export interface BankStatementHeader {
  bank: string
  /** 26 cyfr, bez spacji. */
  accountNumber: string
  currency: string
  /** Numer wyciągu, np. „9/2026”. */
  number: string
  periodFrom: string
  periodTo: string
  openingBalance: number
  closingBalance: number
  /** Obroty MA (suma wpływów) i WN (suma wydatków, ujemna) z nagłówka wyciągu. */
  creditTurnover: number
  debitTurnover: number
}

/**
 * Problem z odczytem. Błąd (`error`) blokuje import — np. saldo po operacji nie zgadza się z poprzednim saldem i kwotą,
 * co oznacza, że któraś operacja nie została odczytana poprawnie.
 */
export interface BankImportIssue {
  severity: 'error' | 'warning'
  code: 'format' | 'balance' | 'closing' | 'turnover' | 'no_transactions' | 'already_imported'
  /** Numer operacji na wyciągu (gdy dotyczy). */
  seq?: number
  detail?: string
}

export interface BankImportPreview {
  statement: BankStatementHeader
  transactions: (BankTxParsed & { duplicate: boolean })[]
  /** Liczba operacji wg rodzaju (bez duplikatów). */
  kinds: Partial<Record<BankTxKind, number>>
  /** Operacje już zaimportowane wcześniej (np. z wyciągu za nakładający się okres) — zostaną pominięte. */
  duplicates: number
  issues: BankImportIssue[]
  canCommit: boolean
}

export interface BankImportResult {
  statementId: string
  created: number
  duplicates: number
}

export interface BankStatementDto extends BankStatementHeader {
  id: string
  fileName: string
  /** Operacje zapisane z tego wyciągu (bez duplikatów z wcześniejszych importów). */
  transactionCount: number
  importedByName: string | null
  importedAt: string
}

export interface BankTransactionDto extends Omit<BankTxParsed, 'seq'> {
  id: string
  statementId: string
  seq: number
}

export interface BankStatementDetailDto extends BankStatementDto {
  transactions: BankTransactionDto[]
}
