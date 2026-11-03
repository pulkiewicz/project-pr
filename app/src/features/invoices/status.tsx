import { Badge, Box, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { invoiceAssigned, invoiceDueState, invoicePaymentState, paymentState, type InvoiceDto, type InvoiceDueState, type InvoicePaymentState, type InvoiceStatus } from '#shared'
import { formatDate, todayWarsaw } from '../../lib/format'

/** Status do wyświetlenia: „do przypisania” z decyzją o przypisaniu to „przypisana — do wysłania” (status w bazie nadal `new`). */
export type InvoiceDisplayStatus = InvoiceStatus | 'assigned'
export const DISPLAY_STATUSES: readonly InvoiceDisplayStatus[] = ['new', 'assigned', 'pending', 'approved', 'rejected']
export const displayStatus = (i: Pick<InvoiceDto, 'status' | 'allocations' | 'general'>): InvoiceDisplayStatus => (i.status === 'new' && invoiceAssigned(i) ? 'assigned' : i.status)

const COLOR: Record<InvoiceDisplayStatus, string> = { new: 'gray', assigned: 'blue', pending: 'yellow', approved: 'green', rejected: 'red' }

export function InvoiceStatusBadge({ inv }: { inv: Pick<InvoiceDto, 'status' | 'allocations' | 'general'> }) {
  const { t } = useTranslation()
  const status = displayStatus(inv)
  return (
    <Badge variant="light" color={COLOR[status]}>
      {t(`invoices.status.${status}`)}
    </Badge>
  )
}

const DUE_COLOR: Record<InvoiceDueState, string> = { paid: 'var(--mantine-color-green-6)', due: 'var(--mantine-color-yellow-5)', overdue: 'var(--mantine-color-red-6)' }

/** Zapłata na liście jako kropka: zielona — zapłacona, żółta — do zapłaty, czerwona — po terminie. Szczegóły w podpowiedzi. */
export function PaymentDot({ inv }: { inv: PayInv & Pick<InvoiceDto, 'dueDate'> }) {
  const { t } = useTranslation()
  const state = invoiceDueState(inv, todayWarsaw())
  const partial = state !== 'paid' && paymentState(inv.grossPrice, inv.paidAmount) === 'partial'
  const label = [
    t(`invoices.pay.${state}`),
    paySource(inv, t),
    partial ? `${t('invoices.pay.partial')}: ${formatMoney(inv.paidAmount, inv.currency)}` : null,
    inv.dueDate && state !== 'paid' ? t('invoices.pay.dueDate', { date: formatDate(inv.dueDate) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Tooltip label={label}>
      <Box component="span" role="img" aria-label={label} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: DUE_COLOR[state] }} />
    </Tooltip>
  )
}

const PAYMENT_COLOR: Record<InvoicePaymentState, string> = { paid: 'green', partial: 'yellow', unpaid: 'gray' }

type PayInv = Pick<InvoiceDto, 'grossPrice' | 'paidAmount' | 'currency' | 'paymentStatus'>

/** Skąd wiadomo o zapłacie: wyciągi (połączone płatności) albo status w inFakt; null — niezapłacona. */
function paySource(inv: PayInv, t: (k: string) => string) {
  if (invoicePaymentState(inv) === 'unpaid') return null
  const fromInfakt = paymentState(inv.grossPrice, inv.paidAmount) !== 'paid' && !!inv.paymentStatus && inv.paymentStatus !== 'unpaid'
  return t(fromInfakt ? 'invoices.pay.sourceInfakt' : 'invoices.pay.sourceBank')
}

/** Stan zapłaty: status z inFakt albo płatności połączone z wyciągów (korzystniejszy). */
export function PaymentBadge({ inv }: { inv: PayInv }) {
  const { t } = useTranslation()
  const state = invoicePaymentState(inv)
  return (
    <Badge variant={state === 'unpaid' ? 'outline' : 'light'} color={PAYMENT_COLOR[state]} title={inv.paidAmount ? formatMoney(inv.paidAmount, inv.currency) : undefined}>
      {t(`invoices.pay.${state}`)}
      {paySource(inv, t) ? ` · ${paySource(inv, t)}` : ''}
    </Badge>
  )
}

/** Kwota z groszy w walucie faktury. */
export function formatMoney(cents: number | null | undefined, currency = 'PLN') {
  if (cents == null) return '—'
  try {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}
