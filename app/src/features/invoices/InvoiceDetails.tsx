import { Alert, Badge, Button, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { format } from 'date-fns'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InvoiceDetailDto, InvoiceDetailsInput, InvoiceManualField } from '#shared'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useSaveDetails } from './api'
import { formatMoney } from './status'

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK']

function Field({ label, manual, children }: { label: string; manual?: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div>
      <Group gap={4}>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        {manual && (
          <Badge size="xs" variant="light" color="grape" title={t('invoices.manualHint')}>
            {t('invoices.manual')}
          </Badge>
        )}
      </Group>
      <Text size="sm">{children}</Text>
    </div>
  )
}

interface Form {
  number: string
  sellerName: string
  issueDate: string | null
  dueDate: string | null
  currency: string
  net: number | string
  tax: number | string
  gross: number | string
}

const toForm = (d: InvoiceDetailDto): Form => ({
  number: d.number ?? '',
  sellerName: d.sellerName ?? '',
  issueDate: d.issueDate,
  dueDate: d.dueDate,
  currency: d.currency,
  net: d.netPrice == null ? '' : d.netPrice / 100,
  tax: d.taxPrice == null ? '' : d.taxPrice / 100,
  gross: d.grossPrice == null ? '' : d.grossPrice / 100,
})
const cents = (v: number | string) => (v === '' ? null : Math.round(Number(v) * 100))
const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)

/**
 * Dane faktury z inFakt. Pliki kosztowe (faktury dodane jako skan/PDF) często mają puste pola —
 * można je uzupełnić ręcznie; takie pola są oznaczone, a synchronizacja ich nie nadpisuje.
 */
export function InvoiceDetails({ d, editable }: { d: InvoiceDetailDto; editable: boolean }) {
  const { t } = useTranslation()
  const save = useSaveDetails()
  const [form, setForm] = useState<Form | null>(null)
  const m = (k: InvoiceManualField) => d.manualFields.includes(k)
  const missing = d.netPrice == null || !d.number || !d.sellerName

  if (form) {
    const set = (p: Partial<Form>) => setForm({ ...form, ...p })
    // Brutto podpowiadane z netto + VAT, dopóki nie wpisano go ręcznie.
    const setAmount = (p: Partial<Form>) => {
      const next = { ...form, ...p }
      if (('net' in p || 'tax' in p) && next.net !== '' && next.tax !== '') next.gross = Math.round((Number(next.net) + Number(next.tax)) * 100) / 100
      setForm(next)
    }
    const submit = () => {
      const data: InvoiceDetailsInput = {
        number: form.number.trim() || null,
        sellerName: form.sellerName.trim() || null,
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        currency: form.currency,
        netPrice: cents(form.net),
        taxPrice: cents(form.tax),
        grossPrice: cents(form.gross),
        version: d.version,
      }
      save.mutate(
        { id: d.id, data },
        { onSuccess: () => (setForm(null), notifications.show({ color: 'green', message: t('app.saved') })), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
      )
    }
    const money = { decimalScale: 2, fixedDecimalScale: true, decimalSeparator: ',', thousandSeparator: ' ', hideControls: true }
    return (
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          {t('invoices.editHint')}
        </Text>
        <SimpleGrid cols={2} spacing="xs">
          <TextInput size="xs" label={t('invoices.number')} value={form.number} onChange={(e) => set({ number: e.currentTarget.value })} maxLength={200} />
          <TextInput size="xs" label={t('invoices.seller')} value={form.sellerName} onChange={(e) => set({ sellerName: e.currentTarget.value })} maxLength={300} />
          <DateInput size="xs" label={t('invoices.issueDate')} valueFormat="DD.MM.YYYY" clearable value={toDate(form.issueDate)} onChange={(v) => set({ issueDate: fromDate(v) })} />
          <DateInput size="xs" label={t('invoices.dueDate')} valueFormat="DD.MM.YYYY" clearable value={toDate(form.dueDate)} onChange={(v) => set({ dueDate: fromDate(v) })} />
        </SimpleGrid>
        <SimpleGrid cols={4} spacing="xs">
          <Select size="xs" label={t('invoices.currency')} data={CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES]} value={form.currency} onChange={(v) => v && set({ currency: v })} allowDeselect={false} />
          <NumberInput size="xs" label={t('invoices.net')} {...money} value={form.net} onChange={(v) => setAmount({ net: v })} />
          <NumberInput size="xs" label={t('invoices.vat')} {...money} value={form.tax} onChange={(v) => setAmount({ tax: v })} />
          <NumberInput size="xs" label={t('invoices.gross')} {...money} value={form.gross} onChange={(v) => set({ gross: v })} />
        </SimpleGrid>
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={() => setForm(null)}>
            {t('app.cancel')}
          </Button>
          <Button size="xs" loading={save.isPending} onClick={submit}>
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    )
  }

  return (
    <Stack gap="xs">
      <SimpleGrid cols={3} spacing="xs">
        <Field label={t('invoices.number')} manual={m('number')}>
          {d.number ?? '—'}
        </Field>
        <Field label={t('invoices.seller')} manual={m('sellerName')}>
          {d.sellerName ?? '—'}
        </Field>
        <Field label={t('invoices.addedAt')}>{formatDate(d.infaktCreatedAt)}</Field>
        <Field label={t('invoices.issueDate')} manual={m('issueDate')}>
          {formatDate(d.issueDate)}
        </Field>
        <Field label={t('invoices.dueDate')} manual={m('dueDate')}>
          {formatDate(d.dueDate)}
        </Field>
        <Field label={t('invoices.kindLabel')}>{t(`invoices.kind.${d.kind}`, { defaultValue: d.kind })}</Field>
        <Field label={t('invoices.net')} manual={m('netPrice') || m('currency')}>
          {formatMoney(d.netPrice, d.currency)}
        </Field>
        <Field label={t('invoices.vat')} manual={m('taxPrice')}>
          {formatMoney(d.taxPrice, d.currency)}
        </Field>
        <Field label={t('invoices.gross')} manual={m('grossPrice')}>
          {formatMoney(d.grossPrice, d.currency)}
        </Field>
        {d.description && <Field label={t('invoices.description')}>{d.description}</Field>}
      </SimpleGrid>
      {missing && <Alert color="yellow">{editable ? t('invoices.noAmount') : t('invoices.noAmountReadOnly')}</Alert>}
      {editable && (
        <Group justify="flex-end">
          <Button size="xs" variant={missing ? 'filled' : 'subtle'} onClick={() => setForm(toForm(d))}>
            {missing ? t('invoices.fillIn') : t('invoices.editData')}
          </Button>
        </Group>
      )}
    </Stack>
  )
}
