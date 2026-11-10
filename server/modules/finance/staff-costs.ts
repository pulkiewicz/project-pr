import { and, gte, inArray, isNull, lt } from 'drizzle-orm'
import { FORECAST_LOOKBACK_MONTHS, addMonths, buildStaffCosts, invoiceCostDate, type StaffCostsResponse } from '#shared'
import type { Database } from '../../db/client.ts'
import { bankTransactions, employees } from '../../db/schema.ts'
import { addDays, workingDaysBetween } from '../../lib/dates.ts'
import { listInvoices } from '../invoices/service.ts'

/** Dni robocze w przedziale włącznie. */
const workingDays = (from: string, to: string) => workingDaysBetween(addDays(from, -1), to)

/**
 * Koszty pracownicze okresu `count` miesięcy od `from` (yyyy-MM): pracownicy z karty, wypłaty z wyciągów (zlecenia),
 * faktury kosztowe (B2B). Płatności pobierane także sprzed okresu / bieżącego miesiąca — do średniej w prognozie.
 */
export async function staffCosts(db: Database, from: string, count: number, today: string): Promise<StaffCostsResponse> {
  const lookback = addMonths(today.slice(0, 7), -(FORECAST_LOOKBACK_MONTHS + 1))
  const start = `${from < lookback ? addMonths(from, -1) : lookback}-01`
  const end = `${addMonths(from, count)}-01`

  const staff = await db.select().from(employees).where(isNull(employees.deletedAt))
  const tx = await db
    .select({
      id: bankTransactions.id,
      bookingDate: bankTransactions.bookingDate,
      amount: bankTransactions.amount,
      kind: bankTransactions.kind,
      counterpartyName: bankTransactions.counterpartyName,
      title: bankTransactions.title,
      description: bankTransactions.description,
    })
    .from(bankTransactions)
    .where(and(gte(bankTransactions.bookingDate, start), lt(bankTransactions.bookingDate, end), lt(bankTransactions.amount, 0), inArray(bankTransactions.kind, ['salary', 'transfer', 'zus', 'tax'])))
  const invoices = (await listInvoices(db))
    .map((i) => ({ id: i.id, number: i.number, sellerName: i.sellerName, date: invoiceCostDate(i), net: i.netPrice, currency: i.currency }))
    .filter((i): i is typeof i & { net: number } => i.currency === 'PLN' && i.net != null && !!i.date && i.date >= start && i.date < end)

  return buildStaffCosts({
    from,
    count,
    today,
    employees: staff,
    bank: tx.map((t) => ({ ...t, amount: -t.amount })),
    invoices,
    workingDays,
  })
}
