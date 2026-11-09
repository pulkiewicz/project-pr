import type { BankMatchReason } from '#shared'

/**
 * Dopasowanie operacji z wyciągu do faktur kosztowych (B2). Czysta funkcja — dane wczytuje `service.ts`.
 *
 * Kolejność reguł (patrz `BANK_MATCH_REASONS`): numer faktury w opisie, ten sam numer w kilku przelewach o sumie
 * równej brutto, kontrahent + kwota, sama kwota + data (±7 dni, ±30 dni). Automatycznie łączymy numer + kwotę oraz
 * kwotę przy różnicy dat do 7 dni — wyłącznie gdy dopasowanie jest jednoznaczne w obie strony (jedna faktura dla
 * operacji, jedna operacja dla faktury). Pozostałe — propozycje do ręcznego potwierdzenia.
 */
export interface MatchTx {
  id: string
  /** Nierozliczona część operacji (grosze, dodatnia). */
  open: number
  bookingDate: string
  valueDate: string | null
  /** Teksty, w których szukamy numeru faktury (numer z split payment, tytuł, opis). */
  texts: string[]
  /** Kontrahent albo miejsce zakupu. */
  counterparty: string | null
}

export interface MatchInvoice {
  id: string
  number: string | null
  sellerName: string | null
  /** Data wystawienia, a bez niej data dodania do inFakt. */
  date: string | null
  /** Niezapłacona część brutto (grosze); faktury bez kwoty nie biorą udziału w dopasowaniu po kwocie. */
  open: number | null
}

export interface Match {
  txId: string
  invoiceId: string
  amount: number
  reason: BankMatchReason
  auto: boolean
}

const MAX_SUGGESTIONS = 3
/** Sama kwota: do 7 dni różnicy dat — automatycznie (gdy jednoznacznie), do 30 dni — propozycja. */
const AUTO_DAYS = 7
const SUGGEST_DAYS = 30

type AmountCandidate = { inv: MatchInvoice; reason: BankMatchReason; distance: number; near: boolean }

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'L')
    .toUpperCase()

/** Numer faktury do porównań: wielkie litery i cyfry; za krótki albo bez cyfr — pomijany (np. „FV”). */
export function normNumber(n: string | null): string | null {
  if (!n) return null
  const k = plain(n).replace(/[^A-Z0-9]/g, '')
  return k.length >= 4 && /\d/.test(k) ? k : null
}

/** Słowa opisu (i pary sąsiednich — „FV 12/2026”) w postaci znormalizowanych numerów. */
function numberTokens(texts: string[]): Set<string> {
  const out = new Set<string>()
  for (const t of texts) {
    const words = plain(t)
      .split(/[\s:;,]+/)
      .map((w) => w.replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean)
    words.forEach((w, i) => {
      out.add(w)
      if (i + 1 < words.length) out.add(w + words[i + 1])
    })
  }
  return out
}

/** Formy prawne i słowa bez znaczenia przy porównaniu nazw firm. */
const STOP = new Set(['SP', 'SPOLKA', 'Z', 'O', 'OO', 'ZOO', 'SA', 'S', 'A', 'SJ', 'SK', 'JAWNA', 'AKCYJNA', 'KOMANDYTOWA', 'OGRANICZONA', 'ODPOWIEDZIALNOSCIA', 'POLSKA', 'PL', 'UL', 'WARSZAWA', 'THE', 'AND'])
const nameWords = (s: string | null) =>
  new Set(
    plain(s ?? '')
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)),
  )

/** Podobna nazwa: wspólne słowo (bez form prawnych), np. „KACZMAREK ELECTRIC SP. Z O.O” ↔ „Kaczmarek Electric Sp. z o.o.”. */
export function similarName(a: string | null, b: string | null): boolean {
  const wa = nameWords(a)
  for (const w of nameWords(b)) if (wa.has(w)) return true
  return false
}

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

export function findMatches(txs: MatchTx[], invoices: MatchInvoice[]): Match[] {
  const byNumber = new Map<string, MatchInvoice[]>()
  for (const inv of invoices) {
    const k = normNumber(inv.number)
    if (k) byNumber.set(k, [...(byNumber.get(k) ?? []), inv])
  }
  const open = invoices.filter((i) => i.open != null && i.open > 0)

  // 1–2. Numer faktury w opisie.
  const numberHits = new Map<string, MatchInvoice[]>()
  const txsByInvoice = new Map<string, MatchTx[]>()
  for (const tx of txs) {
    const tokens = numberTokens(tx.texts)
    const hits = [...new Set([...tokens].flatMap((t) => byNumber.get(t) ?? []))]
    if (!hits.length) continue
    numberHits.set(tx.id, hits)
    for (const inv of hits) txsByInvoice.set(inv.id, [...(txsByInvoice.get(inv.id) ?? []), tx])
  }

  const out: Match[] = []
  const amountCandidates = new Map<string, { tx: MatchTx; candidates: AmountCandidate[] }>()
  for (const tx of txs) {
    const hits = numberHits.get(tx.id)
    if (hits) {
      for (const inv of hits) {
        const same = txsByInvoice.get(inv.id)!
        const exact = inv.open != null && inv.open === tx.open
        const sum = same.length > 1 && inv.open != null && same.reduce((s, t) => s + t.open, 0) === inv.open
        const amount = inv.open != null && inv.open > 0 ? Math.min(tx.open, inv.open) : tx.open
        out.push({
          txId: tx.id,
          invoiceId: inv.id,
          amount: sum ? tx.open : amount,
          reason: sum ? 'number_sum' : 'number',
          // Jednoznacznie: jedna faktura z tym numerem w opisie i jedna operacja z numerem tej faktury.
          auto: exact && hits.length === 1 && same.length === 1,
        })
      }
      continue
    }

    // 3–5. Kwota równa niezapłaconej części brutto.
    const date = tx.valueDate ?? tx.bookingDate
    const candidates: AmountCandidate[] = []
    for (const inv of open) {
      if (inv.open !== tx.open || !inv.date) continue
      const d = days(inv.date, date) // < 0 — faktura przed operacją
      const near = Math.abs(d) <= AUTO_DAYS
      if (d >= -60 && d <= 30 && similarName(tx.counterparty, inv.sellerName)) candidates.push({ inv, reason: 'seller_amount', distance: Math.abs(d), near })
      else if (near) candidates.push({ inv, reason: 'amount_date', distance: Math.abs(d) + 100, near })
      else if (Math.abs(d) <= SUGGEST_DAYS) candidates.push({ inv, reason: 'amount_date_30', distance: Math.abs(d) + 200, near })
    }
    if (candidates.length) amountCandidates.set(tx.id, { tx, candidates: candidates.sort((a, b) => a.distance - b.distance) })
  }

  // Sama kwota, daty faktury i płatności różnią się najwyżej o 7 dni — łączymy automatycznie, gdy jednoznacznie w obie strony
  // (jedna taka faktura dla operacji i jedna taka operacja dla faktury; faktura bez numeru w opisie innej operacji).
  // Różnica do 30 dni albo kilka możliwości — propozycja do ręcznego potwierdzenia.
  const nearTxsByInvoice = new Map<string, number>()
  for (const { candidates } of amountCandidates.values())
    for (const c of candidates) if (c.near) nearTxsByInvoice.set(c.inv.id, (nearTxsByInvoice.get(c.inv.id) ?? 0) + 1)
  for (const { tx, candidates } of amountCandidates.values()) {
    const near = candidates.filter((c) => c.near)
    const sure = near.length === 1 && nearTxsByInvoice.get(near[0]!.inv.id) === 1 && !txsByInvoice.has(near[0]!.inv.id) ? near[0]! : null
    if (sure) {
      out.push({ txId: tx.id, invoiceId: sure.inv.id, amount: tx.open, reason: sure.reason, auto: true })
      continue
    }
    candidates.slice(0, MAX_SUGGESTIONS).forEach((c) => out.push({ txId: tx.id, invoiceId: c.inv.id, amount: tx.open, reason: c.reason, auto: false }))
  }
  return out
}
