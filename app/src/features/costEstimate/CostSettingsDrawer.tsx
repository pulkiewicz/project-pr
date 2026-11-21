import { ActionIcon, Button, Divider, Drawer, Group, NumberInput, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CostContract, CostSettingsDto } from '#shared'
import { errorMessage } from '../../lib/errors'
import { useSaveCostSettings } from './api'

const EMPTY_CONTRACT: CostContract = { contractValue: 0, partnerBudget: 0, partnerStages: [], partnerMargin: 0, guaranteeReserve: 0, reserveShare: 0, source: null }
const money = { thousandSeparator: ' ', decimalSeparator: ',', decimalScale: 2, suffix: ' zł', hideControls: true } as const
const n = (v: string | number) => (v === '' ? 0 : Number(v))

export function CostSettingsDrawer({ opened, settings, onClose }: { opened: boolean; settings: CostSettingsDto; onClose: () => void }) {
  const { t } = useTranslation()
  const save = useSaveCostSettings()
  const [f, setF] = useState(settings)

  useEffect(() => {
    if (opened) setF(settings)
  }, [opened, settings])

  const c = f.contract
  const setC = (patch: Partial<CostContract>) => setF((x) => ({ ...x, contract: { ...(x.contract ?? EMPTY_CONTRACT), ...patch } }))

  const submit = () =>
    save.mutate(f, {
      onSuccess: () => {
        notifications.show({ color: 'green', message: t('app.saved') })
        onClose()
      },
      onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
    })

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="lg" title={<Text fw={600}>{t('costEstimate.settingsDrawer.title')}</Text>}>
      <Stack gap="sm">
        <Group grow align="flex-start">
          <NumberInput label={t('costEstimate.settingsDrawer.eurRate')} value={f.eurRate} onChange={(v) => setF({ ...f, eurRate: n(v) })} decimalSeparator="," decimalScale={4} min={0} hideControls maw={160} />
          <TextInput label={t('costEstimate.settingsDrawer.eurRateNote')} value={f.eurRateNote ?? ''} onChange={(e) => setF({ ...f, eurRateNote: e.currentTarget.value || null })} />
        </Group>
        <Textarea
          label={t('costEstimate.settingsDrawer.sources')}
          description={t('costEstimate.settingsDrawer.sourcesHint')}
          autosize
          minRows={3}
          value={f.sources ?? ''}
          onChange={(e) => setF({ ...f, sources: e.currentTarget.value || null })}
        />
        <Divider />
        <Switch label={t('costEstimate.settingsDrawer.contract')} checked={!!c} onChange={(e) => setF({ ...f, contract: e.currentTarget.checked ? (settings.contract ?? EMPTY_CONTRACT) : null })} />
        {c && (
          <Stack gap="sm">
            <NumberInput label={t('costEstimate.settingsDrawer.contractValue')} value={c.contractValue} onChange={(v) => setC({ contractValue: n(v) })} {...money} />
            <NumberInput label={t('costEstimate.settingsDrawer.partnerBudget')} value={c.partnerBudget} onChange={(v) => setC({ partnerBudget: n(v) })} {...money} />
            <Text size="sm" fw={500}>
              {t('costEstimate.settingsDrawer.partnerStages')}
            </Text>
            {c.partnerStages.map((s, i) => (
              <Group key={i} gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  style={{ flex: 1 }}
                  placeholder={t('costEstimate.settingsDrawer.stageName')}
                  value={s.name}
                  onChange={(e) => setC({ partnerStages: c.partnerStages.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)) })}
                />
                <NumberInput w={180} value={s.amount} onChange={(v) => setC({ partnerStages: c.partnerStages.map((x, j) => (j === i ? { ...x, amount: n(v) } : x)) })} {...money} />
                <ActionIcon variant="subtle" color="red" onClick={() => setC({ partnerStages: c.partnerStages.filter((_, j) => j !== i) })} aria-label="delete">
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Button variant="subtle" size="compact-sm" leftSection={<IconPlus size={14} />} w="fit-content" onClick={() => setC({ partnerStages: [...c.partnerStages, { name: '', amount: 0 }] })}>
              {t('costEstimate.settingsDrawer.addStage')}
            </Button>
            <NumberInput label={t('costEstimate.settingsDrawer.partnerMargin')} value={c.partnerMargin} onChange={(v) => setC({ partnerMargin: n(v) })} {...money} />
            <NumberInput label={t('costEstimate.settingsDrawer.guaranteeReserve')} value={c.guaranteeReserve} onChange={(v) => setC({ guaranteeReserve: n(v) })} {...money} />
            <NumberInput
              label={t('costEstimate.settingsDrawer.reserveShare')}
              value={Math.round(c.reserveShare * 10000) / 100}
              onChange={(v) => setC({ reserveShare: Math.min(100, Math.max(0, n(v))) / 100 })}
              decimalSeparator=","
              decimalScale={2}
              suffix=" %"
              hideControls
              maw={200}
            />
            <TextInput label={t('costEstimate.settingsDrawer.contractSource')} value={c.source ?? ''} onChange={(e) => setC({ source: e.currentTarget.value || null })} />
          </Stack>
        )}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={!(f.eurRate > 0) || !!c?.partnerStages.some((s) => !s.name.trim())}>
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  )
}
