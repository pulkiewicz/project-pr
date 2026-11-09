import { Alert, Select } from '@mantine/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useApprovers } from './api'

/** Wybór osoby, która ma zaakceptować fakturę (przy wysłaniu do akceptacji). Jedna osoba na liście — wybrana od razu. */
export function ApproverSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useTranslation()
  const q = useApprovers()
  const options = (q.data ?? []).map((a) => ({ value: a.id, label: a.name }))
  useEffect(() => {
    if (!value && options.length === 1) onChange(options[0]!.value)
  }, [value, options, onChange])
  if (q.data && !options.length) return <Alert color="yellow">{t('invoices.approverNone')}</Alert>
  return (
    <Select
      label={t('invoices.approver')}
      description={t('invoices.approverHint')}
      placeholder={t('invoices.approverPick')}
      required
      searchable
      data={options}
      value={value}
      onChange={onChange}
      disabled={q.isLoading}
    />
  )
}
