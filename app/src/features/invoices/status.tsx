import { Badge } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { paymentState, type InvoiceDto, type InvoicePaymentState, type InvoiceStatus } from '#shared'

const COLOR: Record<InvoiceStatus, string> = { new: 'gray', pending: 'yellow', approved: 'green', rejected: 'red' }

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation()
  return (
    <Badge variant="light" color={COLOR[status]}>
      {t(`invoices.status.${status}`)}
    </Badge>
  )
}

const PAYMENT_COLOR: Record<InvoicePaymentState, string> = { paid: 'green', partial: 'yellow', unpaid: 'gray' }

/** Stan zapłaty z płatności połączonych z wyciągów (rekoncyliacja). */
export function PaymentBadge({ inv }: { inv: Pick<InvoiceDto, 'grossPrice' | 'paidAmount' | 'currency'> }) {
  const { t } = useTranslation()
  const state = paymentState(inv.grossPrice, inv.paidAmount)
  return (
    <Badge variant={state === 'unpaid' ? 'outline' : 'light'} color={PAYMENT_COLOR[state]} title={inv.paidAmount ? formatMoney(inv.paidAmount, inv.currency) : undefined}>
      {t(`invoices.pay.${state}`)}
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
