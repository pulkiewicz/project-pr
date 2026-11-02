import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client.ts'
import { costInvoices, permissions, users } from '../../db/schema.ts'
import type { Mailer } from '../../integrations/mail/types.ts'
import { invoiceSettings } from '../../auth/access.ts'
import { effective } from './service.ts'

/** Link w mailu: lista faktur z filtrem „do mojej akceptacji”. */
export const approvalLink = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/faktury?akceptacja`

interface Recipient {
  id: string
  email: string
}

/**
 * Akceptujący: aktywne osoby z listy `invoices.access`, których rola ma `invoices:approve`.
 * Bez listy włączonych powiadomień — nikt.
 */
export async function approvers(db: Database): Promise<Recipient[]> {
  const settings = await invoiceSettings(db)
  if (!settings.notifyApprovers || !settings.userIds.length) return []
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(permissions, and(eq(permissions.role, users.role), eq(permissions.module, 'invoices'), eq(permissions.action, 'approve'), eq(permissions.allowed, true)))
    .where(and(inArray(users.id, settings.userIds), eq(users.isActive, true), isNull(users.deletedAt)))
    .orderBy(asc(users.email))
}

type InvoiceRow = typeof costInvoices.$inferSelect

const money = (cents: number | null, currency: string) =>
  cents == null ? '—' : `${(cents / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

function line(row: InvoiceRow) {
  const e = effective(row)
  return `• ${e.number ?? 'bez numeru'} — ${e.sellerName ?? 'nieznany sprzedawca'} — netto ${money(e.netPrice, e.currency)}`
}

const few = (n: number) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
const plural = (n: number) => (n === 1 ? 'faktura kosztowa' : few(n) ? 'faktury kosztowe' : 'faktur kosztowych')
const waits = (n: number) => (few(n) ? 'czekają' : 'czeka')

function message(rows: InvoiceRow[], intro: string, baseUrl: string) {
  const link = approvalLink(baseUrl)
  const shown = rows.slice(0, 50)
  const more = rows.length - shown.length
  return [intro, '', ...shown.map(line), ...(more > 0 ? [`… i ${more} więcej`] : []), '', `Akceptacja: ${link}`, '', '— Envcheck Hub (wiadomość automatyczna)'].join('\n')
}

/** Zbiorcze powiadomienie po wysłaniu do akceptacji (jedno na wysłanie). Błąd poczty nie przerywa operacji. */
export async function notifySubmitted(db: Database, mailer: Mailer | null | undefined, opts: { invoiceIds: string[]; submitter: { id: string; name: string }; baseUrl: string }) {
  if (!mailer || !opts.invoiceIds.length) return
  try {
    const to = (await approvers(db)).filter((r) => r.id !== opts.submitter.id).map((r) => r.email)
    if (!to.length) return
    const rows = await db.select().from(costInvoices).where(and(inArray(costInvoices.id, opts.invoiceIds), eq(costInvoices.status, 'pending'))).orderBy(asc(costInvoices.number))
    if (!rows.length) return
    const n = rows.length
    await mailer.send({
      to,
      subject: `Do akceptacji: ${n} ${plural(n)}`,
      text: message(rows, `${opts.submitter.name} wysłał(a) do akceptacji ${n} ${plural(n)}:`, opts.baseUrl),
    })
  } catch (e) {
    console.error('[pmo] invoices: powiadomienie o akceptacji nie wysłane', e)
  }
}

/**
 * Poranne przypomnienie: każdy akceptujący dostaje listę faktur czekających na jego decyzję
 * (bez wysłanych przez siebie — zasada czterech oczu). Bez czekających — brak maila.
 */
export async function sendApprovalDigest(db: Database, mailer: Mailer, baseUrl: string) {
  const recipients = await approvers(db)
  if (!recipients.length) return { sent: 0 }
  const pending = await db.select().from(costInvoices).where(eq(costInvoices.status, 'pending')).orderBy(asc(costInvoices.submittedAt))
  let sent = 0
  for (const r of recipients) {
    const rows = pending.filter((i) => i.submittedBy !== r.id)
    if (!rows.length) continue
    const n = rows.length
    try {
      await mailer.send({ to: [r.email], subject: `Przypomnienie: ${n} ${plural(n)} ${waits(n)} na akceptację`, text: message(rows, `Na Twoją akceptację ${waits(n)} ${n} ${plural(n)}:`, baseUrl) })
      sent += 1
    } catch (e) {
      console.error('[pmo] invoices: przypomnienie nie wysłane', e)
    }
  }
  return { sent }
}
