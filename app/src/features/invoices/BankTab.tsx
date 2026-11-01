import { ActionIcon, Alert, Badge, Button, FileButton, Group, List, Loader, Modal, MultiSelect, Select, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconCircleCheck, IconSearch, IconTrash, IconUpload } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BANK_TX_COST_STATUSES, BANK_TX_KINDS, type BankImportPreview, type BankTransactionDto, type BankTxCostStatus, type BankTxKind, type BankTxPatch } from '#shared'
import { useAuth, useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime } from '../../lib/format'
import { useCostCategories } from './api'
import { previewBankStatement, useBankStatement, useBankStatements, useDeleteBankStatement, useImportBankStatement, useUpdateBankTx } from './bankApi'
import { formatMoney } from './status'

const KIND_COLOR: Record<BankTxKind, string> = {
  transfer: 'blue',
  card: 'violet',
  vat_transfer: 'gray',
  tax: 'orange',
  zus: 'orange',
  salary: 'teal',
  bank_fee: 'gray',
  income: 'green',
}

/** „11102010680000130205076320” → „11 1020 1068 0000 1302 0507 6320”. */
const formatAccount = (nrb: string) => (nrb.length === 26 ? `${nrb.slice(0, 2)} ${nrb.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ')}` : nrb)
const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('pl')

export function KindBadge({ kind }: { kind: BankTxKind }) {
  const { t } = useTranslation()
  return (
    <Badge variant="light" color={KIND_COLOR[kind]} size="sm">
      {t(`bank.kind.${kind}`)}
    </Badge>
  )
}

/** Podgląd przed importem: rachunek, okres, kontrola sald, operacje wg rodzaju, duplikaty. */
function ImportModal({ file, preview, onClose }: { file: File; preview: BankImportPreview; onClose: () => void }) {
  const { t } = useTranslation()
  const commit = useImportBankStatement()
  const s = preview.statement
  const errors = preview.issues.filter((i) => i.severity === 'error')
  const warnings = preview.issues.filter((i) => i.severity === 'warning')
  return (
    <Modal opened onClose={onClose} title={t('bank.previewTitle', { number: s.number })} size="lg">
      <Stack>
        <Table fz="sm" withRowBorders={false}>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td c="dimmed">{t('bank.account')}</Table.Td>
              <Table.Td>
                {s.bank} · {formatAccount(s.accountNumber)}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">{t('bank.period')}</Table.Td>
              <Table.Td>
                {formatDate(s.periodFrom)} – {formatDate(s.periodTo)}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td c="dimmed">{t('bank.balances')}</Table.Td>
              <Table.Td>
                {formatMoney(s.openingBalance, s.currency)} → {formatMoney(s.closingBalance, s.currency)}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
        {errors.length ? (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} title={t('bank.errorsTitle')}>
            <List size="sm">
              {errors.map((i, n) => (
                <List.Item key={n}>{t(`bank.issue.${i.code}`, { detail: i.detail ?? '' })}</List.Item>
              ))}
            </List>
          </Alert>
        ) : (
          <Alert color="green" icon={<IconCircleCheck size={18} />}>
            {t('bank.checksOk', { count: preview.transactions.length })}
          </Alert>
        )}
        {warnings.map((i, n) => (
          <Alert key={n} color="yellow">
            {t(`bank.issue.${i.code}`, { detail: i.detail ?? '' })}
          </Alert>
        ))}
        <Group gap={6}>
          {BANK_TX_KINDS.filter((k) => preview.kinds[k]).map((k) => (
            <Badge key={k} variant="light" color={KIND_COLOR[k]}>
              {t(`bank.kind.${k}`)}: {preview.kinds[k]}
            </Badge>
          ))}
        </Group>
        {preview.duplicates > 0 && <Text size="sm">{t('bank.duplicates', { count: preview.duplicates })}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            disabled={!preview.canCommit}
            loading={commit.isPending}
            onClick={() =>
              commit.mutate(file, {
                onSuccess: (r) => (notifications.show({ color: 'green', message: t('bank.imported', { created: r.created, duplicates: r.duplicates }) }), onClose()),
                onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
              })
            }
          >
            {t('bank.import')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Opis operacji: kontrahent / miejsce, tytuł lub numer faktury; pełny opis w podpowiedzi. */
function TxDescription({ tx }: { tx: BankTransactionDto }) {
  const who = tx.counterpartyName ?? tx.merchant ?? ''
  const what = tx.invoiceRef ?? tx.title ?? (tx.cardHolder ? tx.cardHolder : '')
  return (
    <Stack gap={0} title={tx.description}>
      <Text size="sm" lineClamp={1}>
        {who || tx.description || '—'}
      </Text>
      {what && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {what}
        </Text>
      )}
    </Stack>
  )
}

const GENERAL = 'general'

/** Rozliczenie, kategoria i projekt operacji — edycja w wierszu (uprawnienie „Edycja” w Fakturach). */
function TxCostCells({ tx }: { tx: BankTransactionDto }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const me = useMe()
  const categories = useCostCategories().data ?? []
  const update = useUpdateBankTx()
  const editable = can('invoices', 'edit') && !update.isPending
  const save = (patch: BankTxPatch) => update.mutate({ id: tx.id, patch }, { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })
  const categoryData = categories.filter((k) => k.active || k.id === tx.costCategoryId).map((k) => ({ value: k.id, label: k.name }))
  const isCost = tx.costStatus === 'no_invoice'
  return (
    <>
      <Table.Td>
        <Select
          size="xs"
          allowDeselect={false}
          disabled={!editable}
          aria-label={t('bank.costStatusLabel')}
          data={BANK_TX_COST_STATUSES.map((v) => ({ value: v, label: t(`bank.costStatus.${v}`) }))}
          value={tx.costStatus}
          onChange={(v) => v && v !== tx.costStatus && save({ costStatus: v as BankTxCostStatus })}
          styles={{ input: { color: tx.costStatus === 'pending' ? 'var(--mantine-color-orange-8)' : undefined } }}
        />
      </Table.Td>
      <Table.Td>
        <Select
          size="xs"
          clearable
          searchable
          disabled={!editable}
          placeholder={t('invoices.categoryPick')}
          aria-label={t('invoices.category')}
          data={categoryData}
          value={tx.costCategoryId}
          onChange={(v) => v !== tx.costCategoryId && save({ costCategoryId: v })}
        />
      </Table.Td>
      <Table.Td>
        <Select
          size="xs"
          clearable
          searchable
          disabled={!editable || !isCost}
          title={isCost ? undefined : t('bank.projectOnlyNoInvoice')}
          placeholder={isCost ? t('invoices.unassigned') : '—'}
          aria-label={t('invoices.project')}
          data={[{ value: GENERAL, label: t('invoices.general') }, ...me.projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          value={isCost ? (tx.projectId ?? (tx.general ? GENERAL : null)) : null}
          onChange={(v) => save(v === GENERAL ? { projectId: null, general: true } : { projectId: v, general: false })}
        />
      </Table.Td>
    </>
  )
}

function Transactions({ id }: { id: string }) {
  const { t } = useTranslation()
  const q = useBankStatement(id)
  const [search, setSearch] = useState('')
  // Domyślnie bez przeksięgowań VAT i opłat — zostają wydatki i wpływy.
  const [kinds, setKinds] = useState<string[]>(BANK_TX_KINDS.filter((k) => k !== 'vat_transfer' && k !== 'bank_fee'))
  const [onlyPending, setOnlyPending] = useState(false)
  const rows = useMemo(() => {
    const s = norm(search)
    return (q.data?.transactions ?? []).filter((tx) => kinds.includes(tx.kind) && (!onlyPending || tx.costStatus === 'pending') && (!s || norm(tx.description).includes(s) || norm(tx.type).includes(s) || String(tx.amount / 100).includes(s)))
  }, [q.data, search, kinds, onlyPending])
  if (q.isLoading) return <Loader />
  if (q.error) return <Alert color="red">{errorMessage(q.error)}</Alert>
  const st = q.data!
  return (
    <Stack>
      <Group gap="sm" align="flex-end">
        <TextInput w={260} leftSection={<IconSearch size={16} />} placeholder={t('bank.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} aria-label={t('bank.search')} />
        <MultiSelect w={480} placeholder={t('bank.kindLabel')} data={BANK_TX_KINDS.map((k) => ({ value: k, label: t(`bank.kind.${k}`) }))} value={kinds} onChange={setKinds} clearable />
        <Switch label={t('bank.onlyPending')} checked={onlyPending} onChange={(e) => setOnlyPending(e.currentTarget.checked)} />
        <Text size="sm" c="dimmed">
          {t('bank.shown', { shown: rows.length, total: st.transactions.length })}
        </Text>
      </Group>
      <Table striped highlightOnHover withTableBorder fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}>#</Table.Th>
            <Table.Th w={100}>{t('bank.date')}</Table.Th>
            <Table.Th w={200}>{t('bank.type')}</Table.Th>
            <Table.Th>{t('bank.description')}</Table.Th>
            <Table.Th w={130}>{t('bank.kindLabel')}</Table.Th>
            <Table.Th w={130} ta="right">
              {t('bank.amount')}
            </Table.Th>
            <Table.Th w={150}>{t('bank.costStatusLabel')}</Table.Th>
            <Table.Th w={170}>{t('invoices.category')}</Table.Th>
            <Table.Th w={190}>{t('invoices.project')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((tx) => (
            <Table.Tr key={tx.id}>
              <Table.Td c="dimmed">{tx.seq}</Table.Td>
              <Table.Td>{formatDate(tx.bookingDate)}</Table.Td>
              <Table.Td>
                <Text size="xs">{tx.type}</Text>
              </Table.Td>
              <Table.Td>
                <TxDescription tx={tx} />
              </Table.Td>
              <Table.Td>
                <KindBadge kind={tx.kind} />
              </Table.Td>
              <Table.Td ta="right" fw={600} c={tx.amount > 0 ? 'green' : undefined} style={{ whiteSpace: 'nowrap' }}>
                {formatMoney(tx.amount, st.currency)}
              </Table.Td>
              <TxCostCells tx={tx} />
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

/** Zakładka „Wyciągi bankowe”: import PDF z PKO BP, lista wyciągów, operacje wybranego wyciągu. */
export function BankTab() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useBankStatements()
  const del = useDeleteBankStatement()
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState<{ file: File; preview: BankImportPreview } | null>(null)
  const [reading, setReading] = useState(false)

  const pick = (file: File | null) => {
    if (!file) return
    setReading(true)
    previewBankStatement(file)
      .then((preview) => setPending({ file, preview }))
      .catch((e) => notifications.show({ color: 'red', message: errorMessage(e) }))
      .finally(() => setReading(false))
  }

  const remove = (id: string, number: string) =>
    modals.openConfirmModal({
      title: t('bank.deleteTitle', { number }),
      children: <Text size="sm">{t('bank.deleteBody')}</Text>,
      labels: { confirm: t('app.delete'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () =>
        del.mutate(id, {
          onSuccess: () => selected === id && setSelected(null),
          onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
        }),
    })

  const statements = q.data ?? []
  const current = selected ?? statements[0]?.id ?? null
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t('bank.hint')}
        </Text>
        {can('invoices', 'create') && (
          <FileButton onChange={pick} accept="application/pdf,.pdf">
            {(props) => (
              <Button {...props} leftSection={<IconUpload size={16} />} loading={reading}>
                {t('bank.importPdf')}
              </Button>
            )}
          </FileButton>
        )}
      </Group>
      {q.error && <Alert color="red">{errorMessage(q.error)}</Alert>}
      {q.isLoading ? (
        <Loader />
      ) : !statements.length ? (
        <Text c="dimmed">{t('bank.empty')}</Text>
      ) : (
        <>
          <Table withTableBorder highlightOnHover fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('bank.number')}</Table.Th>
                <Table.Th>{t('bank.period')}</Table.Th>
                <Table.Th>{t('bank.account')}</Table.Th>
                <Table.Th ta="right">{t('bank.opening')}</Table.Th>
                <Table.Th ta="right">{t('bank.closing')}</Table.Th>
                <Table.Th ta="right">{t('bank.transactions')}</Table.Th>
                <Table.Th>{t('bank.importedBy')}</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {statements.map((s) => (
                <Table.Tr key={s.id} onClick={() => setSelected(s.id)} style={{ cursor: 'pointer' }} bg={s.id === current ? 'var(--mantine-primary-color-light)' : undefined}>
                  <Table.Td fw={600}>{s.number}</Table.Td>
                  <Table.Td>
                    {formatDate(s.periodFrom)} – {formatDate(s.periodTo)}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {s.bank} · {formatAccount(s.accountNumber)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatMoney(s.openingBalance, s.currency)}</Table.Td>
                  <Table.Td ta="right">{formatMoney(s.closingBalance, s.currency)}</Table.Td>
                  <Table.Td ta="right">{s.transactionCount}</Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {s.importedByName ?? '—'} · {formatDateTime(s.importedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    {can('invoices', 'delete') && (
                      <Tooltip label={t('app.delete')}>
                        <ActionIcon variant="subtle" color="red" onClick={() => remove(s.id, s.number)} aria-label={t('app.delete')}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {current && <Transactions id={current} />}
        </>
      )}
      {pending && <ImportModal file={pending.file} preview={pending.preview} onClose={() => setPending(null)} />}
    </Stack>
  )
}
