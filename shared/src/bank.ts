import { z } from 'zod'

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

/**
 * Rozliczenie operacji w kosztach:
 * - `pending` — do ustalenia,
 * - `invoice` — koszt jest w fakturze kosztowej (operacja nie liczy się osobno — bez podwójnego liczenia),
 * - `no_invoice` — koszt bez faktury (wynagrodzenia, ZUS, opłaty…): liczy się w „Kosztach per projekt” kwotą zapłaconą,
 * - `excluded` — nie jest kosztem (przeksięgowanie VAT, wpływ, rozliczenie VAT / CIT).
 */
export const BANK_TX_COST_STATUSES = ['pending', 'invoice', 'no_invoice', 'excluded'] as const
export type BankTxCostStatus = (typeof BANK_TX_COST_STATUSES)[number]

/**
 * Domyślne rozliczenie przy imporcie. Podatki: VAT i CIT nie są kosztem, PIT (zaliczki od wynagrodzeń) jest —
 * rozpoznanie po symbolu formularza w tytule („26M08 VAT-7”, „PIT-4”); pozostałe do ustalenia.
 */
export function defaultCostStatus(kind: BankTxKind, title: string | null): BankTxCostStatus {
  if (kind === 'vat_transfer' || kind === 'income') return 'excluded'
  if (kind === 'salary' || kind === 'zus' || kind === 'bank_fee') return 'no_invoice'
  if (kind === 'tax') {
    if (/\b(VAT|CIT)-?\d/i.test(title ?? '')) return 'excluded'
    if (/\bPIT-?\d/i.test(title ?? '')) return 'no_invoice'
  }
  return 'pending'
}

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
  costStatus: BankTxCostStatus
  costCategoryId: string | null
  costCategoryName: string | null
  /** Projekt kosztu bez faktury; bez projektu: `general` — koszty ogólne, inaczej nieprzypisana. */
  projectId: string | null
  general: boolean
}

export interface BankStatementDetailDto extends BankStatementDto {
  transactions: BankTransactionDto[]
}

/** Zmiana rozliczenia operacji: pola pominięte — bez zmian. Projekt tylko dla kosztu bez faktury (inaczej czyszczony). */
export const bankTxPatch = z.object({
  costStatus: z.enum(BANK_TX_COST_STATUSES).optional(),
  costCategoryId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  general: z.boolean().optional(),
})
export type BankTxPatch = z.input<typeof bankTxPatch>

/** Koszt bez faktury do „Kosztów per projekt”: kwota zapłacona (dodatnia, grosze), miesiąc z daty operacji. */
export interface BankCostDto {
  id: string
  bookingDate: string
  amount: number
  currency: string
  projectId: string | null
  projectCode: string | null
  projectName: string | null
  general: boolean
  costCategoryId: string | null
}
