import { Anchor, Button, Card, Fieldset, Group, NumberInput, SimpleGrid, Stack, Switch, Text, Title } from '@mantine/core'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PROFILE_SPEC_KEYS, volumeFromDims, type ProfileSpec, type QuoteDto } from '#shared'
import { formatNumber, formatPLN } from '../../lib/format'
import { quoteOps, useQuoteMutation } from './api'

type SpecKey = (typeof PROFILE_SPEC_KEYS)[number]
type Draft = Record<SpecKey, number | null>

const toDraft = (s: ProfileSpec): Draft => Object.fromEntries(PROFILE_SPEC_KEYS.map((k) => [k, s[k] ?? null])) as Draft
const rangeErr = (min: number | null, max: number | null) => min != null && max != null && min > max

/** Pola parametrów technicznych: wymiary wewnętrzne i zewnętrzne, objętość, zakresy temperatury i wilgotności, dynamika zmian. */
function SpecFields({ d, setD, editable }: { d: Draft; setD: (fn: (cur: Draft) => Draft) => void; editable: boolean }) {
  const { t } = useTranslation()
  const num = (key: SpecKey, label: string, extra: { suffix?: string; min?: number; max?: number; error?: string | null; description?: ReactNode } = {}) => (
    <NumberInput
      key={key}
      label={label}
      decimalSeparator=","
      thousandSeparator=" "
      allowNegative={extra.min == null || extra.min < 0}
      min={extra.min}
      max={extra.max}
      suffix={extra.suffix}
      disabled={!editable}
      value={d[key] ?? ''}
      error={extra.error}
      description={extra.description}
      onChange={(v) => setD((cur) => ({ ...cur, [key]: typeof v === 'number' ? v : v === '' ? null : cur[key] }))}
      data-testid={`spec-${key}`}
    />
  )
  const dims = (prefix: 'inner' | 'outer') => (
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      {num(`${prefix}Width`, t('profileSpec.width'), { suffix: ' mm', min: 0 })}
      {num(`${prefix}Height`, t('profileSpec.height'), { suffix: ' mm', min: 0 })}
      {num(`${prefix}Depth`, t('profileSpec.depth'), { suffix: ' mm', min: 0 })}
    </SimpleGrid>
  )
  const computed = volumeFromDims(d.innerWidth, d.innerHeight, d.innerDepth)
  return (
    <>
      <Fieldset legend={t('profileSpec.inner')}>{dims('inner')}</Fieldset>
      <Fieldset legend={t('profileSpec.outer')}>{dims('outer')}</Fieldset>
      <Fieldset legend={t('profileSpec.ranges')}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {num('volume', t('profileSpec.volume'), {
            suffix: ' l',
            min: 0,
            description:
              computed != null && computed !== d.volume ? (
                <>
                  {t('profileSpec.fromDims', { value: formatNumber(computed) })}{' '}
                  {editable && (
                    <Anchor component="button" type="button" size="xs" onClick={() => setD((cur) => ({ ...cur, volume: computed }))}>
                      {t('profileSpec.useComputed')}
                    </Anchor>
                  )}
                </>
              ) : undefined,
          })}
          {num('rate', t('profileSpec.rate'), { suffix: ' K/min', min: 0 })}
          {num('tempMin', t('profileSpec.tempMin'), { suffix: ' °C', min: -273 })}
          {num('tempMax', t('profileSpec.tempMax'), { suffix: ' °C', min: -273, error: rangeErr(d.tempMin, d.tempMax) ? t('validation.rangeMinMax') : null })}
          {num('humidityMin', t('profileSpec.humidityMin'), { suffix: ' %RH', min: 0, max: 100 })}
          {num('humidityMax', t('profileSpec.humidityMax'), { suffix: ' %RH', min: 0, max: 100, error: rangeErr(d.humidityMin, d.humidityMax) ? t('validation.rangeMinMax') : null })}
        </SimpleGrid>
      </Fieldset>
    </>
  )
}

const invalid = (d: Draft) => rangeErr(d.tempMin, d.tempMax) || rangeErr(d.humidityMin, d.humidityMax)

/** Profil: zakładka „Parametry”. */
export function ProfileSpecPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const [d, setD] = useState<Draft>(() => toDraft(q.profileSpec))
  useEffect(() => setD(toDraft(q.profileSpec)), [q.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(q.profileSpec))
  return (
    <Stack maw={900}>
      <Text size="sm" c="dimmed">
        {t('profileSpec.hint')}
      </Text>
      <SpecFields d={d} setD={setD} editable={q.canEdit} />
      {q.canEdit && (
        <Group justify="flex-end">
          <Button loading={mutation.isPending} disabled={!dirty || invalid(d)} onClick={() => mutation.mutate(quoteOps.patch({ profileSpec: d, version: q.version }))} data-testid="spec-save">
            {t('app.save')}
          </Button>
        </Group>
      )}
    </Stack>
  )
}

/**
 * Krok 8: wycena przygotowana poza kalkulatorem — cena netto wpisana ręcznie (zastępuje wyliczoną i jest wartością szansy w CRM)
 * oraz parametry techniczne urządzenia.
 */
export function ManualPriceCard({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const [d, setD] = useState<Draft>(() => toDraft(q.profileSpec))
  const [manual, setManual] = useState(q.manualNet != null)
  const [net, setNet] = useState<number | null>(q.manualNet)
  useEffect(() => {
    setD(toDraft(q.profileSpec))
    setManual(q.manualNet != null)
    setNet(q.manualNet)
  }, [q.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const editable = q.canEdit
  const priceEditable = editable && q.canEditPricing
  const nextNet = manual ? net : null
  const priceDirty = q.canSeePricing && nextNet !== q.manualNet
  const specDirty = JSON.stringify(d) !== JSON.stringify(toDraft(q.profileSpec))
  const vat = q.params.vatPct ?? 0.23
  return (
    <Card withBorder data-testid="manual-price">
      <Title order={5}>{t('manualPrice.title')}</Title>
      <Text size="sm" c="dimmed" mb="sm">
        {t('manualPrice.hint')}
      </Text>
      <Stack>
        {q.canSeePricing && (
          <Stack gap="xs">
            <Switch label={t('manualPrice.toggle')} disabled={!priceEditable} checked={manual} onChange={(e) => setManual(e.currentTarget.checked)} data-testid="manual-price-toggle" />
            {manual && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <NumberInput
                  label={t('manualPrice.net')}
                  suffix=" zł"
                  decimalSeparator=","
                  thousandSeparator=" "
                  decimalScale={2}
                  min={0}
                  allowNegative={false}
                  disabled={!priceEditable}
                  value={net ?? ''}
                  onChange={(v) => setNet(typeof v === 'number' ? v : null)}
                  error={net == null ? t('manualPrice.required') : null}
                  description={q.summary && q.summary.net > 0 ? t('manualPrice.fromCalc', { value: formatPLN(q.summary.net) }) : undefined}
                  data-testid="manual-price-net"
                />
                <Stack gap={2} justify="center">
                  <Text size="sm" c="dimmed">
                    {t('manualPrice.gross', { vat: Math.round(vat * 100) })}
                  </Text>
                  <Text fw={600}>{net != null ? formatPLN(Math.round(net * (1 + vat) * 100) / 100) : '—'}</Text>
                </Stack>
              </SimpleGrid>
            )}
          </Stack>
        )}
        <SpecFields d={d} setD={setD} editable={editable} />
        {editable && (
          <Group justify="flex-end">
            <Button
              loading={mutation.isPending}
              disabled={(!priceDirty && !specDirty) || invalid(d) || (manual && net == null)}
              onClick={() => mutation.mutate(quoteOps.patch({ ...(specDirty ? { profileSpec: d } : {}), ...(priceDirty ? { manualNet: nextNet } : {}), version: q.version }))}
              data-testid="manual-price-save"
            >
              {t('app.save')}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  )
}
