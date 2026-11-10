import { and, gte, inArray, isNull, lt } from 'drizzle-orm'
import { buildStaffCosts, invoiceCostDate, type StaffCostsResponse } from '#shared'
import type { Database } from '../../db/client.ts'
import { bankTransactions, employees } from '../../db/schema.ts'
import { addDays, workingDaysBetween } from '../../lib/dates.ts'
import { listInvoices } from '../invoices/service.ts'

/** Dni robocze w przedziale włącznie. */
const workingDays = (from: string, to: string) => workingDaysBetween(addDays(from, -1), to)

/**
 * Koszty pracownicze roku `year`: pracownicy z karty, wypłaty z wyciągów (zlecenia), faktury kosztowe (B2B).
 * Dane płatności pobierane od roku przed rokiem widoku / bieżącym — do średniej w prognozie.
 */
export async function staffCosts(db: Database, year: string, today: string): Promise<StaffCostsResponse> {
  const fromYear = Math.min(Number(year), Number(today.slice(0, 4))) - 1
  const from = `${fromYear}-01-01`
  const to = `${Number(year) + 1}-01-01`

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
    .where(and(gte(bankTransactions.bookingDate, from), lt(bankTransactions.bookingDate, to), lt(bankTransactions.amount, 0), inArray(bankTransactions.kind, ['salary', 'transfer', 'zus', 'tax'])))
  const invoices = (await listInvoices(db))
    .map((i) => ({ id: i.id, number: i.number, sellerName: i.sellerName, date: invoiceCostDate(i), net: i.netPrice, currency: i.currency }))
    .filter((i): i is typeof i & { net: number } => i.currency === 'PLN' && i.net != null && !!i.date && i.date >= from && i.date < to)

  return buildStaffCosts({
    year,
    today,
    employees: staff,
    bank: tx.map((t) => ({ ...t, amount: -t.amount })),
    invoices,
    workingDays,
  })
}
