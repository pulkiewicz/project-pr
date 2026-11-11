import { Anchor, Button, Fieldset, Group, NumberInput, SimpleGrid, Stack, Text } from '@mantine/core'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PROFILE_SPEC_KEYS, volumeFromDims, type ProfileSpec, type QuoteDto } from '#shared'
import { formatNumber } from '../../lib/format'
import { quoteOps, useQuoteMutation } from './api'

type SpecKey = (typeof PROFILE_SPEC_KEYS)[number]
type Draft = Record<SpecKey, number | null>

const toDraft = (s: ProfileSpec): Draft => Object.fromEntries(PROFILE_SPEC_KEYS.map((k) => [k, s[k] ?? null])) as Draft

/** Profil: parametry techniczne — wymiary wewnętrzne i zewnętrzne, objętość, zakresy temperatury i wilgotności, dynamika zmian. */
export function ProfileSpecPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const [d, setD] = useState<Draft>(() => toDraft(q.profileSpec))
  useEffect(() => setD(toDraft(q.profileSpec)), [q.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const editable = q.canEdit

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
  const tempErr = d.tempMin != null && d.tempMax != null && d.tempMin > d.tempMax ? t('validation.rangeMinMax') : null
  const humErr = d.humidityMin != null && d.humidityMax != null && d.humidityMin > d.humidityMax ? t('validation.rangeMinMax') : null
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(q.profileSpec))

  return (
    <Stack maw={900}>
      <Text size="sm" c="dimmed">
        {t('profileSpec.hint')}
      </Text>
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
                    <Anchor component="button" type="button" size="xs" onClick={() => setD({ ...d, volume: computed })}>
                      {t('profileSpec.useComputed')}
                    </Anchor>
                  )}
                </>
              ) : undefined,
          })}
          {num('rate', t('profileSpec.rate'), { suffix: ' K/min', min: 0 })}
          {num('tempMin', t('profileSpec.tempMin'), { suffix: ' °C', min: -273 })}
          {num('tempMax', t('profileSpec.tempMax'), { suffix: ' °C', min: -273, error: tempErr })}
          {num('humidityMin', t('profileSpec.humidityMin'), { suffix: ' %RH', min: 0, max: 100 })}
          {num('humidityMax', t('profileSpec.humidityMax'), { suffix: ' %RH', min: 0, max: 100, error: humErr })}
        </SimpleGrid>
      </Fieldset>
      {editable && (
        <Group justify="flex-end">
          <Button loading={mutation.isPending} disabled={!dirty || !!tempErr || !!humErr} onClick={() => mutation.mutate(quoteOps.patch({ profileSpec: d, version: q.version }))} data-testid="spec-save">
            {t('app.save')}
          </Button>
        </Group>
      )}
    </Stack>
  )
}
