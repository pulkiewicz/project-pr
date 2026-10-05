import { Button, Checkbox, Divider, Drawer, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PURCHASE_PARTIES, PURCHASE_STATUSES, type PurchaseItemDto, type PurchaseItemInput, type PurchaseStatus } from '#shared'
import { useMe } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useHrfTasks } from '../hrf/api'
import { useSavePurchase } from './api'
import { LinkedDocuments } from '../documents/LinkedDocuments'

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`) : null)
const fromDate = (d: Date | string | null) => (d ? format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') : null)

export function PurchaseDrawer({ item, opened, defaultBuffer, onClose }: { item: PurchaseItemDto | null; opened: boolean; defaultBuffer: number; onClose: () => void }) {
  const { t } = useTranslation()
  const me = useMe()
  const hrf = useHrfTasks()
  const save = useSavePurchase()
  const [f, setF] = useState<PurchaseItemInput>({ name: '', party: 'Envcheck', status: 'to_inquire', isCritical: false, requiresAvization: false })

  useEffect(() => {
    if (!opened) return
    if (item) {
      const { id: _i, hrfTaskCode: _c, hrfTaskName: _n, hrfTaskCritical: _k, needDate: _d, orderByDate: _o, alerts: _a, version: _v, canEdit: _e, ...rest } = item
      setF(rest)
    } else setF({ name: '', party: me.user.party === 'Arsanit' ? 'Arsanit' : 'Envcheck', status: 'to_inquire', isCritical: false, requiresAvization: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, item])

  const editable = !item || item.canEdit
  const set = <K extends keyof PurchaseItemInput>(k: K, v: PurchaseItemInput[K]) => setF({ ...f, [k]: v })
  const text = (k: keyof PurchaseItemInput, label: string) => (
    <TextInput label={label} disabled={!editable} value={(f[k] as string | null | undefined) ?? ''} onChange={(e) => set(k, (e.currentTarget.value || null) as never)} />
  )
  const dateField = (k: keyof PurchaseItemInput, label: string) => (
    <DateInput label={label} valueFormat="DD.MM.YYYY" clearable disabled={!editable} value={toDate(f[k] as string | null)} onChange={(v) => set(k, fromDate(v) as never)} />
  )
  const parents = new Set(hrf.data?.tasks.map((x) => x.parentId))
  const tasks = hrf.data?.tasks.filter((x) => !parents.has(x.id)).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` })) ?? []

  const submit = () =>
    save.mutate(
      { id: item?.id, version: item?.version, data: f },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('app.saved') })
          onClose()
        },
        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
      },
    )

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="xl" title={item ? t('purchases.edit') : t('purchases.add')}>
      <Stack gap="sm">
        <TextInput label={t('purchases.name')} required disabled={!editable} value={f.name} onChange={(e) => set('name', e.currentTarget.value)} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {text('category', t('purchases.category'))}
          {text('manufacturer', t('purchases.manufacturer'))}
          {text('partNo', t('purchases.partNo'))}
          <NumberInput label={t('purchases.quantity')} disabled={!editable} min={0} decimalSeparator="," value={f.quantity ?? ''} onChange={(v) => set('quantity', v === '' ? null : Number(v))} />
          {text('unit', t('purchases.unit'))}
          <Select label={t('purchases.party')} allowDeselect={false} disabled={!editable} data={PURCHASE_PARTIES.map((p) => ({ value: p, label: t(`parties.${p}`) }))} value={f.party} onChange={(v) => v && set('party', v as PurchaseItemInput['party'])} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {text('supplierName', t('purchases.supplierName'))}
          {text('supplierContact', t('purchases.supplierContact'))}
        </SimpleGrid>
        <Divider label={t('purchases.needDate')} labelPosition="left" />
        <Select label={t('purchases.hrfTask')} searchable clearable disabled={!editable} data={tasks} value={f.hrfTaskId ?? null} onChange={(v) => set('hrfTaskId', v)} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label={t('purchases.bufferDays')} placeholder={t('purchases.bufferDefault', { count: defaultBuffer })} disabled={!editable} min={0} value={f.bufferDays ?? ''} onChange={(v) => set('bufferDays', v === '' ? null : Number(v))} />
          <NumberInput label={t('purchases.leadTime')} disabled={!editable} min={0} decimalScale={1} decimalSeparator="," value={f.leadTimeWeeks ?? ''} onChange={(v) => set('leadTimeWeeks', v === '' ? null : Number(v))} />
        </SimpleGrid>
        {item && (
          <Text size="sm">
            {t('purchases.needDate')}: <b>{formatDate(item.needDate)}</b> · {t('purchases.orderBy')}: <b>{formatDate(item.orderByDate)}</b>
          </Text>
        )}
        <Divider label={t('purchases.statusLabel')} labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label={t('purchases.statusLabel')} allowDeselect={false} disabled={!editable} data={PURCHASE_STATUSES.map((s) => ({ value: s, label: t(`purchases.status.${s}`) }))} value={f.status} onChange={(v) => v && set('status', v as PurchaseStatus)} />
          {dateField('inquiryDate', t('purchases.inquiryDate'))}
          {dateField('orderDatePlanned', t('purchases.orderDatePlanned'))}
          {dateField('orderDateActual', t('purchases.orderDateActual'))}
          {text('orderRef', t('purchases.orderRef'))}
          {dateField('confirmedDeliveryDate', t('purchases.confirmedDelivery'))}
          {dateField('actualDeliveryDate', t('purchases.actualDelivery'))}
          {text('deliveryLocation', t('purchases.deliveryLocation'))}
        </SimpleGrid>
        <Group>
          <Checkbox label={t('purchases.isCritical')} disabled={!editable} checked={f.isCritical} onChange={(e) => set('isCritical', e.currentTarget.checked)} />
          <Checkbox label={t('purchases.requiresAvization')} disabled={!editable} checked={f.requiresAvization} onChange={(e) => set('requiresAvization', e.currentTarget.checked)} />
        </Group>
        <Textarea label={t('purchases.notes')} autosize minRows={2} disabled={!editable} value={f.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value || null)} />
        <Text size="xs" c="dimmed">
          {t('purchases.noPrices')}
        </Text>
        {item && (
          <>
            <Divider label={t('documents.linkedDocs')} labelPosition="left" />
            <LinkedDocuments targetType="purchase_item" targetId={item.id} defaultFolderPath="/09_Zakupy_i_dostawy" />
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          {editable && (
            <Button onClick={submit} loading={save.isPending} disabled={!f.name.trim()}>
              {t('app.save')}
            </Button>
          )}
        </Group>
      </Stack>
    </Drawer>
  )
}
