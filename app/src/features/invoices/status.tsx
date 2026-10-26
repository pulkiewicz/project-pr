import { Badge } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { InvoiceStatus } from '#shared'

const COLOR: Record<InvoiceStatus, string> = { new: 'gray', pending: 'yellow', approved: 'green', rejected: 'red' }

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation()
  return (
    <Badge variant="light" color={COLOR[status]}>
      {t(`invoices.status.${status}`)}
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
