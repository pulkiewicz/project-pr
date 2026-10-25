import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CALC_MODES,
  DENSITY,
  EMPTY_CALC,
  OF022_EXAMPLE,
  SPECIFIC_HEAT,
  computeCalc,
  surfaceAreaM2,
  type CalcInput,
  type CalcMode,
  type ChecklistDto,
  type MaterialKey,
  type QuoteCalcDto,
  type QuoteDto,
} from '#shared'
import { formatNumber } from '../../lib/format'
import { quoteOps, useCalcMutation, useCalcs, useChecklist, useComponents, useQuoteMutation } from './api'

const fmtW = (w: number) => `${formatNumber(w).replace(/,00$/, '')} W`
const fmtKw = (kw: number) => `${formatNumber(kw)} kW`
const num = (v: string | number, fallback = 0) => (v === '' ? fallback : Number(v))
const AMBIENT_C = 20

/** Dane z checklisty (krok 3) do kalkulatora: wymiary, ΔT z zakresu temperatur, masa próbki, tempo, masa obudowy wew. */
export function fillFromChecklist(input: CalcInput, c: ChecklistDto | undefined): { next: CalcInput; fields: string[] } {
  const val = (key: string) => c?.items.find((i) => i.key === key)?.value ?? null
  const fields: string[] = []
  let next = { ...input, transmission: { ...input.transmission }, masses: [...input.masses] }
  const dims = val('inner_dims_rec') ?? val('inner_dims')
  if (dims && 'w' in dims && dims.w && dims.h && dims.d) {
    next.transmission.dimsMm = { w: dims.w, h: dims.h, d: dims.d }
    // Obudowa wewnętrzna: blacha nierdzewna 1,5 mm na całej powierzchni wnętrza (szacunek do korekty).
    const shellKg = Math.round(surfaceAreaM2(dims) * 0.0015 * DENSITY.stainless)
    next.masses = next.masses.map((m) => (/obudowa/i.test(m.name) ? { ...m, massKg: shellKg } : m))
    fields.push('wymiary', 'masa obudowy')
  }
  const range = val('temp_range')
  if (range && 'min' in range && (range.min != null || range.max != null)) {
    next.transmission.deltaT = Math.max(Math.abs((range.min ?? AMBIENT_C) - AMBIENT_C), Math.abs((range.max ?? AMBIENT_C) - AMBIENT_C))
    if (range.min != null && range.min < AMBIENT_C) next = { ...next, mode: 'cooling' }
    fields.push('ΔT')
  }
  const rate = val('rate')
  if (rate && 'n' in rate) {
    next.rateKpm = rate.n
    fields.push('tempo')
  }
  const sample = val('sample_mass')
  if (sample && 'n' in sample) {
    next.masses = next.masses.map((m) => (/wsad|próbk/i.test(m.name) ? { ...m, massKg: sample.n } : m))
    fields.push('masa próbki')
  }
  return { next, fields }
}

/** Edytor danych kalkulacji z wynikiem na żywo (bez zapisu — zapis robi rodzic). */
export function CalcEditor({ value, onChange, disabled, checklist }: { value: CalcInput; onChange: (v: CalcInput) => void; disabled?: boolean; checklist?: ChecklistDto }) {
  const { t } = useTranslation()
  const result = useMemo(() => computeCalc(value), [value])
  const set = (patch: Partial<CalcInput>) => onChange({ ...value, ...patch })
  const tr = value.transmission
  const area = tr.areaM2 ?? (tr.dimsMm ? surfaceAreaM2(tr.dimsMm) : null)
  const materials = (Object.keys(SPECIFIC_HEAT) as MaterialKey[]).map((m) => ({ value: m, label: t(`calc.materialName.${m}`) }))

  return (
    <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
      <Stack style={{ gridColumn: 'span 2' }}>
        <Group align="flex-end" wrap="wrap">
          <SegmentedControl disabled={disabled} data={CALC_MODES.map((m) => ({ value: m, label: t(`calc.modeName.${m}`) }))} value={value.mode} onChange={(v) => set({ mode: v as CalcMode })} />
          <NumberInput label={t('calc.rate')} w={150} min={0} decimalSeparator="," disabled={disabled} value={value.rateKpm} onChange={(v) => set({ rateKpm: num(v) })} />
          {checklist && !disabled && (
            <Button
              variant="light"
              onClick={() => {
                const { next, fields } = fillFromChecklist(value, checklist)
                if (!fields.length) notifications.show({ color: 'yellow', message: t('calc.fromChecklistNone') })
                else {
                  onChange(next)
                  notifications.show({ color: 'green', message: t('calc.fromChecklistDone', { fields: fields.join(', ') }) })
                }
              }}
            >
              {t('calc.fromChecklist')}
            </Button>
          )}
        </Group>

        <Card withBorder padding="xs">
          <Text fw={600} mb={4}>
            {t('calc.masses')}
          </Text>
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing={2}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('calc.name')}</Table.Th>
                  <Table.Th>{t('calc.material')}</Table.Th>
                  <Table.Th w={90}>{t('calc.specificHeat')}</Table.Th>
                  <Table.Th w={90}>{t('calc.massKg')}</Table.Th>
                  <Table.Th w={80}>{t('calc.rateRow')}</Table.Th>
                  <Table.Th w={90} ta="right">
                    {t('calc.watts')}
                  </Table.Th>
                  <Table.Th w={30} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {value.masses.map((m, i) => {
                  const upd = (p: Partial<typeof m>) => set({ masses: value.masses.map((x, j) => (j === i ? { ...x, ...p } : x)) })
                  return (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <TextInput size="xs" disabled={disabled} value={m.name} onChange={(e) => upd({ name: e.currentTarget.value })} />
                      </Table.Td>
                      <Table.Td>
                        <Select size="xs" disabled={disabled} clearable data={materials} value={m.material} onChange={(v) => upd({ material: v as MaterialKey | null })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" min={0} disabled={disabled} placeholder={m.material ? String(SPECIFIC_HEAT[m.material]) : ''} value={m.specificHeat ?? ''} onChange={(v) => upd({ specificHeat: v === '' ? null : Number(v) })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" min={0} decimalSeparator="," disabled={disabled} value={m.massKg} onChange={(v) => upd({ massKg: num(v) })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" min={0} decimalSeparator="," disabled={disabled} placeholder={String(value.rateKpm)} value={m.rateKpm ?? ''} onChange={(v) => upd({ rateKpm: v === '' ? null : Number(v) })} />
                      </Table.Td>
                      <Table.Td ta="right">{fmtW(result.masses[i]?.watts ?? 0)}</Table.Td>
                      <Table.Td>
                        {!disabled && (
                          <ActionIcon size="sm" variant="subtle" color="red" onClick={() => set({ masses: value.masses.filter((_, j) => j !== i) })} aria-label={t('app.delete')}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {!disabled && (
            <Button size="compact-xs" variant="subtle" w="fit-content" leftSection={<IconPlus size={12} />} onClick={() => set({ masses: [...value.masses, { name: '', material: 'stainless', specificHeat: null, massKg: 0, rateKpm: null }] })}>
              {t('calc.addRow')}
            </Button>
          )}
        </Card>

        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Card withBorder padding="xs">
            <Text fw={600} mb={4}>
              {t('calc.loads')}
            </Text>
            <Stack gap={4}>
              {value.loads.map((l, i) => {
                const upd = (p: Partial<typeof l>) => set({ loads: value.loads.map((x, j) => (j === i ? { ...x, ...p } : x)) })
                return (
                  <Group key={i} gap={4} wrap="nowrap">
                    <TextInput size="xs" style={{ flex: 1 }} disabled={disabled} value={l.name} onChange={(e) => upd({ name: e.currentTarget.value })} />
                    <NumberInput size="xs" w={110} min={0} suffix=" W" disabled={disabled} value={l.watts} onChange={(v) => upd({ watts: num(v) })} />
                    {!disabled && (
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => set({ loads: value.loads.filter((_, j) => j !== i) })} aria-label={t('app.delete')}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Group>
                )
              })}
              {!disabled && (
                <Button size="compact-xs" variant="subtle" w="fit-content" leftSection={<IconPlus size={12} />} onClick={() => set({ loads: [...value.loads, { name: '', watts: 0 }] })}>
                  {t('calc.addRow')}
                </Button>
              )}
            </Stack>
          </Card>
          <Card withBorder padding="xs">
            <Text fw={600} mb={4}>
              {t('calc.transmission')}
            </Text>
            <SimpleGrid cols={2} spacing="xs">
              <NumberInput size="xs" label={t('calc.uValue')} min={0} decimalSeparator="," disabled={disabled} value={tr.uValue ?? ''} onChange={(v) => set({ transmission: { ...tr, uValue: v === '' ? null : Number(v) } })} />
              <NumberInput
                size="xs"
                label={t('calc.area')}
                min={0}
                decimalSeparator=","
                disabled={disabled}
                placeholder={tr.dimsMm ? t('calc.areaAuto', { area: area }) : ''}
                value={tr.areaM2 ?? ''}
                onChange={(v) => set({ transmission: { ...tr, areaM2: v === '' ? null : Number(v) } })}
              />
              <NumberInput size="xs" label={t('calc.deltaT')} description={t('calc.ambient')} min={0} disabled={disabled} value={tr.deltaT ?? ''} onChange={(v) => set({ transmission: { ...tr, deltaT: v === '' ? null : Number(v) } })} />
              <NumberInput size="xs" label={t('calc.override')} min={0} disabled={disabled} value={tr.overrideW ?? ''} onChange={(v) => set({ transmission: { ...tr, overrideW: v === '' ? null : Number(v) } })} />
            </SimpleGrid>
            {tr.dimsMm && (
              <Text size="xs" c="dimmed" mt={4}>
                {t('calc.dims')}: {tr.dimsMm.w} × {tr.dimsMm.h} × {tr.dimsMm.d} · {t('calc.areaAuto', { area })}
              </Text>
            )}
          </Card>
        </SimpleGrid>
        <Textarea label={t('calc.notes')} autosize minRows={1} disabled={disabled} value={value.notes ?? ''} onChange={(e) => set({ notes: e.currentTarget.value || null })} />
      </Stack>

      <Card withBorder data-testid="calc-result">
        <Title order={5} mb="xs">
          {t('calc.result')}
        </Title>
        <Table>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>{t('calc.massesW')}</Table.Td>
              <Table.Td ta="right">{fmtW(result.massesW)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>{t('calc.loadsW')}</Table.Td>
              <Table.Td ta="right">{fmtW(result.loadsW)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>{t('calc.transmissionW')}</Table.Td>
              <Table.Td ta="right">{fmtW(result.transmissionW)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>
                <b>{t('calc.total')}</b>
              </Table.Td>
              <Table.Td ta="right">
                <b>
                  {fmtW(result.totalW)} ({fmtKw(result.totalKw)})
                </b>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
        <NumberInput mt="sm" label={t('calc.safetyFactor')} description={t('calc.safetyHint')} min={1} step={0.05} decimalScale={2} decimalSeparator="," disabled={disabled} value={value.safetyFactor} onChange={(v) => set({ safetyFactor: Math.max(1, num(v, 1)) })} />
        <Group justify="space-between" mt="sm">
          <Text fw={600}>{t('calc.required')}</Text>
          <Badge size="lg">{fmtKw(result.requiredKw)}</Badge>
        </Group>
      </Card>
    </SimpleGrid>
  )
}

/** Dobór sprężarki z katalogu: wydajność ≥ wymagana; wstawia pozycję do sekcji „Układ chłodzenia” urządzenia kalkulacji. */
function CompressorPicker({ q, calc }: { q: QuoteDto; calc: QuoteCalcDto }) {
  const { t } = useTranslation()
  const components = useComponents()
  const mutation = useQuoteMutation(q.id)
  const needW = calc.result.requiredKw * 1000
  const options = (components.data ?? []).filter((c) => c.category === 'compressor' && (c.capacityW ?? 0) >= needW).sort((a, b) => (a.capacityW ?? 0) - (b.capacityW ?? 0))
  const [pick, setPick] = useState<string | null>(null)
  const device = q.devices.find((d) => d.id === calc.deviceId) ?? q.devices[0]
  const section = device?.sections.find((s) => /chłodz/i.test(s.name)) ?? device?.sections[0]
  if (!q.canEdit || !section) return null
  const chosen = options.find((o) => o.id === pick)
  return (
    <Card withBorder padding="xs">
      <Text fw={600} mb={4}>
        {t('calc.pickCompressor')}
      </Text>
      {!options.length ? (
        <Text size="sm" c="dimmed">
          {t('calc.noCompressors', { kw: formatNumber(calc.result.requiredKw) })}
        </Text>
      ) : (
        <Group align="flex-end">
          <Select
            style={{ flex: 1 }}
            data={options.map((o) => ({ value: o.id, label: `${o.name} · ${fmtW(o.capacityW ?? 0)} @ ${o.evapTempC ?? '?'} °C${o.refrigerant ? ` · ${o.refrigerant}` : ''}${o.price != null ? ` · ${formatNumber(o.price)} zł` : ''}` }))}
            value={pick}
            onChange={setPick}
          />
          <Button
            disabled={!chosen}
            loading={mutation.isPending}
            onClick={() =>
              chosen &&
              mutation.mutate(
                quoteOps.addLine(section.id, {
                  name: chosen.name,
                  group: null,
                  quantity: 1,
                  unit: chosen.unit ?? 'szt.',
                  unitCost: q.canEditCosts ? chosen.price : undefined,
                  componentId: chosen.id,
                  source: 'calculator',
                  approved: false,
                  justification: t('calc.justification', { kw: formatNumber(calc.result.requiredKw), calc: calc.name, name: chosen.name, cap: chosen.capacityW, temp: chosen.evapTempC ?? '?' }),
                }),
                { onSuccess: () => notifications.show({ color: 'green', message: t('calc.inserted', { name: chosen.name }) }) },
              )
            }
          >
            {t('calc.insertLine')}
          </Button>
        </Group>
      )}
    </Card>
  )
}

function SavedCalc({ q, calc, checklist }: { q: QuoteDto; calc: QuoteCalcDto; checklist?: ChecklistDto }) {
  const { t } = useTranslation()
  const m = useCalcMutation(q.id)
  const [input, setInput] = useState(calc.input)
  const [name, setName] = useState(calc.name)
  const [deviceId, setDeviceId] = useState<string | null>(calc.deviceId)
  useEffect(() => {
    setInput(calc.input)
    setName(calc.name)
    setDeviceId(calc.deviceId)
  }, [calc.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(input) !== JSON.stringify(calc.input) || name !== calc.name || deviceId !== calc.deviceId
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Group gap="xs">
          <TextInput disabled={!q.canEdit} value={name} onChange={(e) => setName(e.currentTarget.value)} aria-label={t('calc.name')} />
          {q.devices.length > 1 && (
            <Select w={220} clearable disabled={!q.canEdit} placeholder={t('calc.device')} data={q.devices.map((d) => ({ value: d.id, label: d.name }))} value={deviceId} onChange={setDeviceId} />
          )}
        </Group>
        {q.canEdit && (
          <Group gap="xs">
            <Button disabled={!dirty || !name.trim()} loading={m.isPending} onClick={() => m.mutate({ method: 'PUT', calcId: calc.id, json: { name, deviceId, input } })}>
              {t('app.save')}
            </Button>
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              aria-label={t('app.delete')}
              onClick={() =>
                modals.openConfirmModal({
                  title: t('calc.deleteConfirm', { name: calc.name }),
                  labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
                  confirmProps: { color: 'red' },
                  onConfirm: () => m.mutate({ method: 'DELETE', calcId: calc.id }),
                })
              }
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Group>
        )}
      </Group>
      <Stack>
        <CalcEditor value={input} onChange={setInput} disabled={!q.canEdit} checklist={checklist} />
        {!dirty && <CompressorPicker q={q} calc={calc} />}
      </Stack>
    </Card>
  )
}

/** Zakładka „Kalkulator mocy” wyceny: kalkulacje zapisane w wycenie (per urządzenie). */
export function CalcPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const calcs = useCalcs(q.id)
  const checklist = useChecklist(q.id, q.kind === 'quote')
  const m = useCalcMutation(q.id)
  if (calcs.isLoading) return <Loader />
  const add = (input: CalcInput, name: string) => m.mutate({ method: 'POST', json: { name, deviceId: q.devices[0]?.id ?? null, input } })
  return (
    <Stack>
      {q.canEdit && (
        <Group>
          <Button leftSection={<IconPlus size={16} />} loading={m.isPending} onClick={() => add(fillFromChecklist(EMPTY_CALC, checklist.data).next, q.devices[0]?.name ?? t('calc.new'))}>
            {t('calc.new')}
          </Button>
          <Button variant="light" onClick={() => add(OF022_EXAMPLE, t('calc.example'))}>
            {t('calc.example')}
          </Button>
        </Group>
      )}
      {!calcs.data?.length && <Alert variant="light">{t('calc.empty')}</Alert>}
      {calcs.data?.map((k) => (
        <SavedCalc key={k.id} q={q} calc={k} checklist={checklist.data} />
      ))}
    </Stack>
  )
}

/** Kalkulator bez zapisu (Baza wiedzy) — start od przykładu OF022. */
export function StandaloneCalc() {
  const [input, setInput] = useState<CalcInput>(OF022_EXAMPLE)
  return <CalcEditor value={input} onChange={setInput} />
}
