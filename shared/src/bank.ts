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

/** Koszty pracownicze (wynagrodzenia, ZUS, zaliczki PIT) — przy imporcie dostają kategorię „Pracownicze” (flaga `staff` w słowniku). */
export function isStaffCost(kind: BankTxKind, title: string | null): boolean {
  return kind === 'salary' || kind === 'zus' || (kind === 'tax' && /\bPIT-?\d/i.test(title ?? ''))
}

/** Stawki VAT kosztu bez faktury; netto liczone z kwoty zapłaconej (domyślnie 0% — wynagrodzenia, ZUS, opłaty). */
export const BANK_VAT_RATES = [0, 8, 23] as const
export type BankVatRate = (typeof BANK_VAT_RATES)[number]
/** Netto z brutto w groszach. */
export const netOfGross = (gross: number, rate: number) => Math.round((gross * 100) / (100 + rate))

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
  /** Dopasowanie automatyczne uruchomione po imporcie (dla operacji z tego wyciągu). */
  match: BankMatchResult
}

export interface BankStatementDto extends BankStatementHeader {
  id: string
  fileName: string
  /** Operacje zapisane z tego wyciągu (bez duplikatów z wcześniejszych importów). */
  transactionCount: number
  importedByName: string | null
  importedAt: string
}

/**
 * Powód dopasowania operacji do faktury (B2):
 * - `number` — numer faktury w opisie przelewu (z zgodną kwotą łączy się automatycznie, gdy jednoznaczne),
 * - `number_sum` — ten sam numer w kilku przelewach, których suma daje brutto (np. „CZĘŚĆ NETTO” + „CZĘŚĆ VAT”);
 *   faktura o tym numerze albo — gdy takiej nie ma — faktura na łączną kwotę (propozycja),
 * - `seller_amount` — kwota równa brutto i podobny kontrahent, faktura od 60 dni przed do 30 dni po operacji,
 * - `amount_date` — sama kwota i data (±7 dni) — karty, BLIK, Przelewy24 / PayU; jednoznaczne łączy się automatycznie,
 * - `amount_date_30` — sama kwota, daty różnią się o 8–30 dni — tylko propozycja do ręcznego potwierdzenia.
 */
export const BANK_MATCH_REASONS = ['number', 'number_sum', 'seller_amount', 'amount_date', 'amount_date_30'] as const
export type BankMatchReason = (typeof BANK_MATCH_REASONS)[number]

/** Powiązanie operacji z fakturą kosztową; `amount` — część operacji rozliczona tą fakturą (grosze, dodatnia). */
export interface BankLinkDto {
  invoiceId: string
  invoiceNumber: string | null
  sellerName: string | null
  amount: number
  /** `auto` — połączone przez aplikację (numer + kwota), `manual` — przez użytkownika (także zatwierdzona propozycja). */
  source: 'auto' | 'manual'
}

/** Propozycja połączenia (do zatwierdzenia jednym kliknięciem). */
export interface BankSuggestionDto {
  invoiceId: string
  invoiceNumber: string | null
  sellerName: string | null
  issueDate: string | null
  grossPrice: number | null
  /** Kwota, która zostanie połączona (mniejsza z: nierozliczona część operacji, niezapłacona część faktury). */
  amount: number
  reason: BankMatchReason
}

export interface BankTransactionDto extends Omit<BankTxParsed, 'seq'> {
  id: string
  statementId: string
  seq: number
  links: BankLinkDto[]
  suggestions: BankSuggestionDto[]
  /** Reguła kontrahenta, którą można utworzyć / która istnieje dla tej operacji (klucz: rachunek, nazwa albo miejsce). */
  ruleKey: string | null
  hasRule: boolean
  costStatus: BankTxCostStatus
  costCategoryId: string | null
  costCategoryName: string | null
  /** Projekt kosztu bez faktury; bez projektu: `general` — koszty ogólne, inaczej nieprzypisana. */
  projectId: string | null
  general: boolean
  vatRate: number
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
  vatRate: z.union(BANK_VAT_RATES.map((r) => z.literal(r)) as [z.ZodLiteral<0>, z.ZodLiteral<8>, z.ZodLiteral<23>]).optional(),
})
export type BankTxPatch = z.input<typeof bankTxPatch>

/** Koszt bez faktury do „Kosztów per projekt”: kwota zapłacona i netto wg stawki VAT (dodatnie, grosze), miesiąc z daty operacji. */
export interface BankCostDto {
  id: string
  bookingDate: string
  amount: number
  vatRate: number
  net: number
  currency: string
  projectId: string | null
  projectCode: string | null
  projectName: string | null
  general: boolean
  costCategoryId: string | null
}

export const bankLinkInput = z.object({ invoiceId: z.uuid() })
/** Rozliczenia: komentarz do płatności i ręczne odhaczenie (np. zwrot od dostawcy bez korekty faktury). */
export const bankSettlementInput = z.object({ note: z.string().trim().max(1000).nullable().optional(), settled: z.boolean().optional() })
export type BankSettlementInput = z.infer<typeof bankSettlementInput>
export const bankMatchInput = z.object({ statementId: z.uuid().optional() })

export interface BankMatchResult {
  /** Połączone automatycznie (numer faktury + kwota). */
  linked: number
  /** Operacje z propozycjami do zatwierdzenia. */
  suggested: number
  /** Operacje oznaczone regułą kontrahenta jako koszt bez faktury. */
  ruled: number
}

/**
 * Reguła kontrahenta (decyzja W5): operacje „do ustalenia” z tym kontrahentem dostają „koszt bez faktury”
 * z kategorią, projektem / kosztami ogólnymi i stawką VAT — przy imporcie i od razu po utworzeniu reguły.
 */
export interface BankRuleDto {
  id: string
  /** Rachunek kontrahenta (26 cyfr) albo znormalizowana nazwa / miejsce zakupu. */
  key: string
  label: string
  costCategoryId: string | null
  costCategoryName: string | null
  projectId: string | null
  projectCode: string | null
  general: boolean
  vatRate: number
  createdByName: string | null
  createdAt: string
}
export const bankRuleInput = z.object({ transactionId: z.uuid() })
export interface BankRuleResult {
  rule: BankRuleDto
  /** Inne operacje „do ustalenia” tego kontrahenta oznaczone od razu. */
  applied: number
}

/** Klucz reguły: rachunek kontrahenta, a bez niego nazwa lub miejsce zakupu (wielkie litery, bez znaków diakrytycznych i interpunkcji). */
export function counterpartyKey(tx: { counterpartyAccount: string | null; counterpartyName: string | null; merchant: string | null }): string | null {
  if (tx.counterpartyAccount) return tx.counterpartyAccount
  const name = tx.counterpartyName ?? tx.merchant
  if (!name) return null
  const k = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/gi, 'L')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
  return k || null
}

/** Płatność faktury (z wyciągu) — w karcie faktury. */
export interface InvoicePaymentDto {
  transactionId: string
  statementId: string
  statementNumber: string
  bookingDate: string
  /** Część operacji rozliczona tą fakturą (grosze, dodatnia). */
  amount: number
  counterparty: string | null
  source: 'auto' | 'manual'
}

export type InvoicePaymentState = 'paid' | 'partial' | 'unpaid'
/**
 * Tolerancja zaokrągleń (grosze): bramki płatności (Przelewy24 / PayPro) i przeliczenie netto → brutto potrafią dać
 * kwotę różną o grosz (np. płatność 447,66 zł za fakturę 447,67 zł). Różnica do tej wartości = kwota zgodna.
 */
export const PAYMENT_TOLERANCE = 2
/** Stan zapłaty z połączonych płatności; faktura bez kwoty brutto z jakąkolwiek płatnością — zapłacona. */
export function paymentState(grossPrice: number | null, paidAmount: number): InvoicePaymentState {
  if (paidAmount <= 0) return 'unpaid'
  return grossPrice == null || paidAmount >= grossPrice - PAYMENT_TOLERANCE ? 'paid' : 'partial'
}

// ---------------- Raporty (B3) ----------------

/** Problem ciągłości wyciągów jednego rachunku (kolejne wyciągi wg okresu). */
export interface BankContinuityIssue {
  accountNumber: string
  /** `gap` — brakujące dni między wyciągami, `overlap` — okresy się nakładają, `balance` — saldo początkowe ≠ końcowe poprzedniego. */
  kind: 'gap' | 'overlap' | 'balance'
  prevNumber: string
  nextNumber: string
  prevTo: string
  nextFrom: string
  prevClosing: number
  nextOpening: number
}

/** Wydatek bez faktury: „do ustalenia” albo „jest faktura” bez połączenia. */
export interface BankReportTxDto {
  id: string
  statementId: string
  statementNumber: string
  bookingDate: string
  /** Kwota zapłacona (grosze, dodatnia). */
  amount: number
  currency: string
  counterparty: string | null
  /** Numer faktury z split payment albo tytuł przelewu. */
  reference: string | null
  cardHolder: string | null
  kind: BankTxKind
  costStatus: BankTxCostStatus
  /** Propozycje faktur do ręcznego potwierdzenia (kwota, numer, kontrahent). */
  suggestions: BankSuggestionDto[]
  /** Komentarz do płatności (Rozliczenia). */
  settlementNote: string | null
  /** Odhaczona ręcznie — kiedy i przez kogo; null = nie. */
  settledAt: string | null
  settledByName: string | null
}

export interface BankReportInvoiceDto {
  id: string
  number: string | null
  sellerName: string | null
  issueDate: string | null
  dueDate: string | null
  currency: string
  grossPrice: number | null
  paidAmount: number
  /** Do zapłaty (brutto − zapłacone); null — faktura bez kwoty. */
  openAmount: number | null
  /** Dni po terminie (> 0) albo null, gdy termin nie minął / brak terminu. */
  overdueDays: number | null
  /** Status płatności z inFakt (`paid`, `unpaid`, `partial_payment`, `payment_not_applicable`). */
  infaktPaymentStatus: string | null
  /** Zapłacona wg inFakt, choć bez (pełnej) płatności w wyciągach — np. z innego rachunku. */
  paidInInfakt: boolean
}

export interface BankReportDto {
  from: string
  to: string
  /** Okres pokryty zaimportowanymi wyciągami (null — brak wyciągów). */
  coverage: { from: string; to: string } | null
  continuity: BankContinuityIssue[]
  missing: BankReportTxDto[]
  unpaid: BankReportInvoiceDto[]
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** Ciągłość wyciągów: dla każdego rachunku kolejne wyciągi (wg początku okresu) muszą stykać się dniami i saldami. */
export function statementContinuity(
  statements: { accountNumber: string; number: string; periodFrom: string; periodTo: string; openingBalance: number; closingBalance: number }[],
): BankContinuityIssue[] {
  const out: BankContinuityIssue[] = []
  const byAccount = new Map<string, typeof statements>()
  for (const s of statements) byAccount.set(s.accountNumber, [...(byAccount.get(s.accountNumber) ?? []), s])
  for (const [accountNumber, list] of byAccount) {
    const sorted = [...list].sort((a, b) => a.periodFrom.localeCompare(b.periodFrom) || a.periodTo.localeCompare(b.periodTo))
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const next = sorted[i]!
      const base = { accountNumber, prevNumber: prev.number, nextNumber: next.number, prevTo: prev.periodTo, nextFrom: next.periodFrom, prevClosing: prev.closingBalance, nextOpening: next.openingBalance }
      const expected = nextDay(prev.periodTo)
      if (next.periodFrom > expected) out.push({ ...base, kind: 'gap' })
      else if (next.periodFrom < expected) out.push({ ...base, kind: 'overlap' })
      else if (next.openingBalance !== prev.closingBalance) out.push({ ...base, kind: 'balance' })
    }
  }
  return out
}
