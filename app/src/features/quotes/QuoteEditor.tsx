import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconArrowDown, IconArrowUp, IconCheck, IconDots, IconDownload, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import {
  COMPLEXITIES,
  CONFIDENCES,
  LINE_SOURCES,
  type Complexity,
  type Confidence,
  type LineInput,
  type LineSource,
  type QuoteDeviceDto,
  type QuoteDto,
  type QuoteInfo,
  type QuoteLineDto,
  type QuoteParamsView,
  type QuoteSectionDto,
} from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import i18n from '../../i18n'
import { downloadFile } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatNumber, formatPLN } from '../../lib/format'
import { quoteOps, useDeleteQuote, useQuote, useQuoteAction, useQuoteMutation, useQuoteSettings } from './api'

const STATUS_COLOR = { draft: 'gray', approved: 'green', sent: 'blue', imported: 'violet' } as const
const SOURCE_COLOR: Record<LineSource, string> = { manual: 'gray', profile: 'blue', previous: 'cyan', calculator: 'teal', ai: 'grape', import: 'violet' }
const pct = (v: number | null | undefined) => (v == null ? '' : Math.round(v * 10000) / 100)
const fromPct = (v: string | number) => (v === '' ? null : Number(v) / 100)
const money = (v: number | null | undefined) => (v == null ? '—' : formatPLN(v))

export function quoteLabel(q: Pick<QuoteDto, 'kind' | 'name' | 'opportunityCode' | 'revision'>) {
  return q.kind === 'profile' ? (q.name ?? '') : `${q.opportunityCode ?? ''} rew. ${q.revision ?? ''}`
}

const EMPTY_LINE: LineInput = { name: '', quantity: 1, source: 'manual', approved: false }

function LineModal({ q, line, sectionId, onClose }: { q: QuoteDto; line: QuoteLineDto | null; sectionId: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const settings = useQuoteSettings()
  const mutation = useQuoteMutation(q.id)
  const [f, setF] = useState<LineInput & { sectionId?: string }>(EMPTY_LINE)
  useEffect(() => {
    if (!sectionId) return
    if (line) {
      const { name, group, quantity, unit, unitCost, laborHours, laborRate, justification, source, confidence, approved } = line
      setF({ name, group, quantity, unit, unitCost: q.canSeeCosts ? unitCost : undefined, laborHours, laborRate: q.canSeeCosts ? laborRate : undefined, justification, source, confidence, approved, sectionId })
    } else setF({ ...EMPTY_LINE, laborRate: q.canEditCosts ? (settings.data?.laborRate ?? null) : undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, line?.id])

  const sections = q.devices.flatMap((d) => d.sections.map((s) => ({ value: s.id, label: q.devices.length > 1 ? `${d.name} · ${s.name}` : s.name })))
  const editable = q.canEdit
  const price = editable && q.canEditCosts
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }))
  const cost = (f.quantity ?? 1) * (f.unitCost ?? 0) + (f.laborHours ?? 0) * (f.laborRate ?? 0)

  const save = () => {
    const { sectionId: target, ...data } = f
    // Bez uprawnienia do kosztów nie wysyłamy pól kosztowych (API odrzuciłoby zmianę).
    const payload = q.canEditCosts ? data : { ...data, unitCost: undefined, laborRate: undefined }
    mutation.mutate(line ? quoteOps.patchLine(line.id, { ...payload, ...(target && target !== sectionId ? { sectionId: target } : {}) }) : quoteOps.addLine(sectionId!, payload), {
      onSuccess: onClose,
    })
  }

  return (
    <Modal opened={!!sectionId} onClose={onClose} title={t('quotes.editLine')} size="lg">
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={t('quotes.lineName')} required disabled={!editable} value={f.name} onChange={(e) => set('name', e.currentTarget.value)} data-autofocus />
          <TextInput label={t('quotes.group')} disabled={!editable} value={f.group ?? ''} onChange={(e) => set('group', e.currentTarget.value || null)} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 2, sm: 3 }}>
          <NumberInput label={t('quotes.quantity')} min={0} decimalSeparator="," disabled={!editable} value={f.quantity ?? 1} onChange={(v) => set('quantity', v === '' ? 0 : Number(v))} />
          <TextInput label={t('quotes.unit')} disabled={!editable} value={f.unit ?? ''} onChange={(e) => set('unit', e.currentTarget.value || null)} />
          <NumberInput
            label={t('quotes.unitCost')}
            min={0}
            thousandSeparator=" "
            decimalSeparator=","
            disabled={!price}
            placeholder={q.canSeeCosts ? undefined : '•••'}
            value={f.unitCost ?? ''}
            onChange={(v) => set('unitCost', v === '' ? null : Number(v))}
          />
          <NumberInput label={t('quotes.laborHours')} min={0} decimalSeparator="," disabled={!editable} value={f.laborHours ?? ''} onChange={(v) => set('laborHours', v === '' ? null : Number(v))} />
          <NumberInput
            label={t('quotes.laborRate')}
            min={0}
            decimalSeparator=","
            disabled={!price}
            placeholder={q.canSeeCosts ? undefined : '•••'}
            value={f.laborRate ?? ''}
            onChange={(v) => set('laborRate', v === '' ? null : Number(v))}
          />
          {q.canSeeCosts && (
            <Stack gap={2} justify="flex-end">
              <Text size="sm" c="dimmed">
                {t('quotes.lineCost')}
              </Text>
              <Text fw={600}>{formatPLN(cost)}</Text>
            </Stack>
          )}
        </SimpleGrid>
        <Textarea label={t('quotes.justification')} autosize minRows={3} disabled={!editable} value={f.justification ?? ''} onChange={(e) => set('justification', e.currentTarget.value || null)} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label={t('quotes.source')} allowDeselect={false} disabled={!editable} data={LINE_SOURCES.map((s) => ({ value: s, label: t(`quotes.sourceName.${s}`) }))} value={f.source} onChange={(v) => v && set('source', v as LineSource)} />
          <Select label={t('quotes.confidence')} clearable disabled={!editable} data={CONFIDENCES.map((s) => ({ value: s, label: t(`quotes.confidenceName.${s}`) }))} value={f.confidence ?? null} onChange={(v) => set('confidence', v as Confidence | null)} />
          {line && <Select label={t('quotes.moveToSection')} allowDeselect={false} disabled={!editable} data={sections} value={f.sectionId ?? sectionId} onChange={(v) => v && set('sectionId', v)} />}
        </SimpleGrid>
        <Checkbox label={t('quotes.approved')} disabled={!editable} checked={!!f.approved} onChange={(e) => set('approved', e.currentTarget.checked)} />
        <Group justify="space-between">
          {line && editable ? (
            <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => mutation.mutate(quoteOps.deleteLine(line.id), { onSuccess: onClose })}>
              {t('quotes.deleteLine')}
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t('app.cancel')}
            </Button>
            {editable && (
              <Button onClick={save} loading={mutation.isPending} disabled={!f.name.trim()}>
                {t('app.save')}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

function promptName(title: string, label: string, initial: string, onOk: (v: string) => void) {
  let value = initial
  modals.openConfirmModal({
    title,
    children: <TextInput label={label} defaultValue={initial} onChange={(e) => (value = e.currentTarget.value)} data-autofocus />,
    labels: { confirm: i18n.t('app.save'), cancel: i18n.t('app.cancel') },
    onConfirm: () => value.trim() && onOk(value.trim()),
  })
}

function SectionTable({ q, device, section, index, count, onLine }: { q: QuoteDto; device: QuoteDeviceDto; section: QuoteSectionDto; index: number; count: number; onLine: (l: QuoteLineDto | null, sectionId: string) => void }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const done = section.lines.filter((l) => l.approved).length
  const move = (dir: -1 | 1) => {
    const other = device.sections[index + dir]
    if (!other) return
    mutation.mutate(quoteOps.patchSection(section.id, { sortOrder: other.sortOrder }))
    mutation.mutate(quoteOps.patchSection(other.id, { sortOrder: section.sortOrder }))
  }
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Text fw={600}>{section.name}</Text>
          {section.lines.length > 0 && (
            <Text size="xs" c="dimmed">
              {t('quotes.approvedCount', { done, all: section.lines.length })}
            </Text>
          )}
        </Group>
        <Group gap={4} wrap="nowrap">
          {q.canSeeCosts && <Text fw={600}>{money(section.cost)}</Text>}
          {q.canEdit && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" size="sm" aria-label={t('quotes.section')}>
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPlus size={14} />} onClick={() => onLine(null, section.id)}>
                  {t('quotes.addLine')}
                </Menu.Item>
                <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => promptName(t('quotes.renameSection'), t('quotes.sectionName'), section.name, (name) => mutation.mutate(quoteOps.patchSection(section.id, { name })))}>
                  {t('quotes.renameSection')}
                </Menu.Item>
                <Menu.Item leftSection={<IconArrowUp size={14} />} disabled={index === 0} onClick={() => move(-1)}>
                  {t('quotes.moveUp')}
                </Menu.Item>
                <Menu.Item leftSection={<IconArrowDown size={14} />} disabled={index === count - 1} onClick={() => move(1)}>
                  {t('quotes.moveDown')}
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={() =>
                    modals.openConfirmModal({
                      title: `${t('quotes.deleteSection')}: ${section.name}?`,
                      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
                      confirmProps: { color: 'red' },
                      onConfirm: () => mutation.mutate(quoteOps.deleteSection(section.id)),
                    })
                  }
                >
                  {t('quotes.deleteSection')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>
      {section.lines.length > 0 && (
        <Table.ScrollContainer minWidth={640}>
          <Table highlightOnHover verticalSpacing={4} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('quotes.lineName')}</Table.Th>
                <Table.Th w={90} ta="right">
                  {t('quotes.quantity')}
                </Table.Th>
                {q.canSeeCosts && (
                  <Table.Th w={120} ta="right">
                    {t('quotes.lineCost')}
                  </Table.Th>
                )}
                <Table.Th>{t('quotes.justification')}</Table.Th>
                <Table.Th w={110}>{t('quotes.source')}</Table.Th>
                <Table.Th w={30} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {section.lines.map((l) => (
                <Table.Tr key={l.id} onClick={() => onLine(l, section.id)} style={{ cursor: 'pointer' }} data-testid="quote-line">
                  <Table.Td>
                    {l.group && (
                      <Text span size="xs" c="dimmed">
                        {l.group} ·{' '}
                      </Text>
                    )}
                    {l.name}
                  </Table.Td>
                  <Table.Td ta="right">
                    {formatNumber(l.quantity).replace(/,00$/, '')} {l.unit ?? ''}
                  </Table.Td>
                  {q.canSeeCosts && <Table.Td ta="right">{money(l.cost)}</Table.Td>}
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {l.justification ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={SOURCE_COLOR[l.source]}>
                      {t(`quotes.sourceName.${l.source}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{l.approved && <IconCheck size={16} color="var(--mantine-color-green-6)" />}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {q.canEdit && (
        <Button size="compact-xs" variant="subtle" w="fit-content" leftSection={<IconPlus size={12} />} onClick={() => onLine(null, section.id)}>
          {t('quotes.addLine')}
        </Button>
      )}
    </Stack>
  )
}

function DeviceCard({ q, device, onLine }: { q: QuoteDto; device: QuoteDeviceDto; onLine: (l: QuoteLineDto | null, sectionId: string) => void }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Title order={4}>{device.name}</Title>
          {device.quantity > 1 && <Badge variant="outline">× {device.quantity}</Badge>}
          {device.isOption && <Badge color="orange" variant="light">{t('quotes.option')}</Badge>}
          {!device.included && <Badge color="gray" variant="light">{t('quotes.notIncluded')}</Badge>}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {q.canSeeCosts && <Text fw={700}>{money(device.cost)}</Text>}
          {q.canEdit && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label={t('quotes.device')}>
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => promptName(t('quotes.addSection'), t('quotes.sectionName'), '', (name) => mutation.mutate(quoteOps.addSection(device.id, name)))}>{t('quotes.addSection')}</Menu.Item>
                <Menu.Item onClick={() => promptName(t('quotes.deviceName'), t('quotes.deviceName'), device.name, (name) => mutation.mutate(quoteOps.patchDevice(device.id, { name })))}>{t('quotes.deviceName')}</Menu.Item>
                <Menu.Item onClick={() => promptName(t('quotes.quantity'), t('quotes.quantity'), String(device.quantity), (v) => Number(v) >= 1 && mutation.mutate(quoteOps.patchDevice(device.id, { quantity: Math.round(Number(v)) })))}>
                  {t('quotes.quantity')}
                </Menu.Item>
                <Menu.Item onClick={() => mutation.mutate(quoteOps.patchDevice(device.id, { isOption: !device.isOption }))}>
                  {device.isOption ? '✓ ' : ''}
                  {t('quotes.isOption')}
                </Menu.Item>
                <Menu.Item onClick={() => mutation.mutate(quoteOps.patchDevice(device.id, { included: !device.included }))}>
                  {device.included ? '✓ ' : ''}
                  {t('quotes.included')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconTrash size={14} />} disabled={q.devices.length <= 1} onClick={() => mutation.mutate(quoteOps.deleteDevice(device.id))}>
                  {t('quotes.deleteDevice')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>
      <Stack gap="md">
        {device.sections.map((s, i) => (
          <SectionTable key={s.id} q={q} device={device} section={s} index={i} count={device.sections.length} onLine={onLine} />
        ))}
      </Stack>
    </Card>
  )
}

function SummaryPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const [p, setP] = useState<QuoteParamsView>(q.params)
  useEffect(() => setP(q.params), [q.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = q.summary
  const editable = q.canEdit
  const price = editable && q.canEditPricing
  const changed = JSON.stringify(p) !== JSON.stringify(q.params)
  const row = (label: string, value: string, bold = false) => (
    <Table.Tr>
      <Table.Td>{bold ? <b>{label}</b> : label}</Table.Td>
      <Table.Td ta="right">{bold ? <b>{value}</b> : value}</Table.Td>
    </Table.Tr>
  )
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      <Card withBorder>
        <Title order={5} mb="sm">
          {t('quotes.params')}
        </Title>
        <SimpleGrid cols={2}>
          {q.canSeePricing && (
            <NumberInput label={t('quotes.marginMultiplier')} min={1} step={0.1} decimalScale={2} decimalSeparator="," disabled={!price} value={p.marginMultiplier ?? ''} onChange={(v) => setP({ ...p, marginMultiplier: Number(v) || 1 })} />
          )}
          <Select
            label={t('quotes.complexity')}
            allowDeselect={false}
            disabled={!editable}
            data={COMPLEXITIES.map((c) => ({ value: c, label: t(`quotes.complexityName.${c}`) }))}
            value={p.complexity}
            onChange={(v) => v && setP({ ...p, complexity: v as Complexity })}
          />
          <NumberInput label={t('quotes.warrantyMonths')} min={0} max={240} disabled={!editable} value={p.warrantyMonths} onChange={(v) => setP({ ...p, warrantyMonths: Number(v) || 0 })} />
          {/* Marża, rezerwa, ryzyko i VAT — tylko z uprawnieniem „Wyceny — marża i cena” (API zwraca je jako null). */}
          {q.canSeePricing && (
            <>
              <NumberInput
                label={t('quotes.reserveOverride')}
                description={t('quotes.reserveOverrideHint')}
                min={0}
                decimalSeparator=","
                suffix=" %"
                disabled={!price}
                value={pct(p.reservePctOverride)}
                onChange={(v) => setP({ ...p, reservePctOverride: fromPct(v) })}
              />
              <NumberInput label={t('quotes.riskPct')} min={0} decimalSeparator="," suffix=" %" disabled={!price} value={pct(p.riskPct)} onChange={(v) => setP({ ...p, riskPct: fromPct(v) ?? 0 })} />
              <NumberInput label={t('quotes.vatPct')} min={0} max={100} suffix=" %" disabled={!price} value={pct(p.vatPct)} onChange={(v) => setP({ ...p, vatPct: fromPct(v) ?? 0 })} />
            </>
          )}
        </SimpleGrid>
        {editable && (
          <Group justify="flex-end" mt="sm">
            <Button
              disabled={!changed}
              loading={mutation.isPending}
              onClick={() => {
                const { marginMultiplier, reservePctOverride, riskPct, vatPct, ...rest } = p
                // Bez uprawnienia do ceny wysyłamy tylko złożoność i gwarancję.
                const params = q.canEditPricing ? { ...rest, marginMultiplier: marginMultiplier ?? undefined, reservePctOverride, riskPct: riskPct ?? undefined, vatPct: vatPct ?? undefined } : rest
                mutation.mutate(quoteOps.patch({ params, version: q.version }))
              }}
            >
              {t('app.save')}
            </Button>
          </Group>
        )}
      </Card>
      {!q.costSummary ? (
        <Alert variant="light">{t('quotes.costsHidden')}</Alert>
      ) : (
        <Card withBorder>
          <Title order={5}>{t('quotes.costBreakdown')}</Title>
          <Table>
            <Table.Tbody>
              {q.costSummary.sections.map((x) => row(x.name, formatPLN(x.cost)))}
              {row(t('quotes.sum'), formatPLN(q.costSummary.cost), true)}
            </Table.Tbody>
          </Table>
          {q.costSummary.devices.length > 1 && !s && (
            <Table mt="sm">
              <Table.Tbody>{q.costSummary.devices.map((d) => row(`${d.name}${d.isOption || !d.included ? ` (${t('quotes.option')})` : ''}`, formatPLN(d.cost)))}</Table.Tbody>
            </Table>
          )}
          {!s ? (
            <Alert variant="light" color="gray" mt="md">
              {t('quotes.pricingHidden')}
            </Alert>
          ) : (
            <>
              <Title order={5} mt="md">
                {t('quotes.priceCalc')}
              </Title>
              <Table data-testid="quote-summary">
                <Table.Tbody>
                  {row(t('quotes.cost'), formatPLN(s.cost))}
                  {row(`${t('quotes.marginValue')} (× ${formatNumber(q.params.marginMultiplier ?? 0).replace(/,00$/, '')})`, formatPLN(s.marginValue))}
                  {row(`${t('quotes.reserveValue')} (${pct(s.reservePct)} %)`, formatPLN(s.reserveValue))}
                  {s.riskValue > 0 && row(`${t('quotes.riskValue')} (${pct(q.params.riskPct)} %)`, formatPLN(s.riskValue))}
                  {row(t('quotes.netTotal'), formatPLN(s.net), true)}
                  {row(t('quotes.grossTotal'), formatPLN(s.gross), true)}
                  {q.info.budget != null && row(t('quotes.budgetDiff'), formatPLN(q.info.budget - s.gross))}
                </Table.Tbody>
              </Table>
              {s.devices.length > 1 && (
                <>
                  <Title order={5} mt="md">
                    {t('quotes.devicesPrices')}
                  </Title>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('quotes.device')}</Table.Th>
                        <Table.Th ta="right">{t('quotes.net')}</Table.Th>
                        <Table.Th ta="right">{t('quotes.gross')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {s.devices.map((d) => (
                        <Table.Tr key={d.id}>
                          <Table.Td>
                            {d.name}
                            {d.quantity > 1 ? ` × ${d.quantity}` : ''} {(d.isOption || !d.included) && <Badge size="xs" color="orange" variant="light">{t('quotes.option')}</Badge>}
                          </Table.Td>
                          <Table.Td ta="right">{formatPLN(d.price.net)}</Table.Td>
                          <Table.Td ta="right">{formatPLN(d.price.gross)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}
            </>
          )}
        </Card>
      )}
    </SimpleGrid>
  )
}

function InfoPanel({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const mutation = useQuoteMutation(q.id)
  const [info, setInfo] = useState<QuoteInfo>(q.info)
  const [meta, setMeta] = useState({ name: q.name, description: q.description, notes: q.notes })
  useEffect(() => {
    setInfo(q.info)
    setMeta({ name: q.name, description: q.description, notes: q.notes })
  }, [q.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const editable = q.canEdit
  const text = (k: Exclude<keyof QuoteInfo, 'budget'>, label: string) => (
    <Textarea label={label} autosize minRows={1} disabled={!editable} value={info[k] ?? ''} onChange={(e) => setInfo({ ...info, [k]: e.currentTarget.value || null })} />
  )
  return (
    <Stack maw={900}>
      {q.kind === 'profile' && (
        <>
          <TextInput label={t('quotes.profileName')} disabled={!editable} value={meta.name ?? ''} onChange={(e) => setMeta({ ...meta, name: e.currentTarget.value })} />
          <Textarea label={t('quotes.description')} autosize minRows={2} disabled={!editable} value={meta.description ?? ''} onChange={(e) => setMeta({ ...meta, description: e.currentTarget.value || null })} />
        </>
      )}
      {q.kind === 'quote' && (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label={t('quotes.budget')} min={0} thousandSeparator=" " decimalSeparator="," disabled={!editable} value={info.budget ?? ''} onChange={(v) => setInfo({ ...info, budget: v === '' ? null : Number(v) })} />
          {text('deliveryTerm', t('quotes.deliveryTerm'))}
          {text('deliveryPlace', t('quotes.deliveryPlace'))}
          {text('participationConditions', t('quotes.participationConditions'))}
        </SimpleGrid>
      )}
      {q.kind === 'quote' && text('evaluationCriteria', t('quotes.evaluationCriteria'))}
      <Textarea label={t('quotes.notes')} autosize minRows={3} disabled={!editable} value={meta.notes ?? ''} onChange={(e) => setMeta({ ...meta, notes: e.currentTarget.value || null })} />
      {editable && (
        <Group justify="flex-end">
          <Button loading={mutation.isPending} onClick={() => mutation.mutate(quoteOps.patch({ ...(q.kind === 'quote' ? { info } : { name: meta.name, description: meta.description }), notes: meta.notes, version: q.version }))}>
            {t('app.save')}
          </Button>
        </Group>
      )}
    </Stack>
  )
}

/** Kroki przepływu wyceny (plan §3); kroki z kolejnych etapów oznaczone etapem wdrożenia. */
const STEP_STAGE: Record<number, string | null> = { 1: null, 2: 'R4', 3: 'R3', 4: null, 5: null, 6: 'R4', 7: null, 8: 'R5' }

export function QuoteEditor({ id }: { id: string }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const navigate = useNavigate()
  const query = useQuote(id)
  const mutation = useQuoteMutation(id)
  const action = useQuoteAction()
  const del = useDeleteQuote()
  const [tab, setTab] = useState<string | null>('items')
  const [lineEdit, setLineEdit] = useState<{ line: QuoteLineDto | null; sectionId: string } | null>(null)

  if (query.isLoading) return <Loader />
  if (query.error) return <Alert color="red">{errorMessage(query.error)}</Alert>
  const q = query.data!
  const isProfile = q.kind === 'profile'
  const backTo = isProfile ? '/baza-wiedzy' : '/wyceny'
  const fail = (e: unknown) => notifications.show({ color: 'red', message: errorMessage(e) })

  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={2}>
          <Anchor component={Link} to={backTo} size="sm">
            ← {isProfile ? t('knowledge.title') : t('quotes.title')}
          </Anchor>
          <Group gap="xs">
            <Title order={2}>{quoteLabel(q)}</Title>
            <Badge color={STATUS_COLOR[q.status]} variant="light">
              {t(`quotes.status.${q.status}`)}
            </Badge>
          </Group>
          {!isProfile && (
            <Text size="sm" c="dimmed">
              {q.opportunityName}
              {q.companyName ? ` · ${q.companyName}` : ''} ·{' '}
              <Anchor component={Link} to={`/crm?szansa=${q.opportunityId}`} size="sm">
                {t('quotes.openOpportunity')}
              </Anchor>
            </Text>
          )}
          {q.basedOnLabel && (
            <Text size="xs" c="dimmed">
              {t('quotes.basedOn')}: {q.basedOnLabel}
            </Text>
          )}
          {q.approvedAt && (
            <Text size="xs" c="dimmed">
              {t('quotes.approvedBy', { name: q.approvedByName ?? '', date: formatDateTime(q.approvedAt) })}
            </Text>
          )}
        </Stack>
        <Group gap="xs">
          {!isProfile && can('quotes', 'approve') && q.status === 'draft' && (
            <Button color="green" onClick={() => mutation.mutate(quoteOps.status('approved', q.version))}>
              {t('quotes.approve')}
            </Button>
          )}
          {!isProfile && can('quotes', 'approve') && q.status === 'approved' && (
            <>
              <Button variant="default" onClick={() => mutation.mutate(quoteOps.status('draft', q.version))}>
                {t('quotes.backToDraft')}
              </Button>
              <Button onClick={() => mutation.mutate(quoteOps.status('sent', q.version))}>{t('quotes.markSent')}</Button>
            </>
          )}
          {q.canSeePricing && (
            <Tooltip label={t('quotes.exportXlsx')}>
              <ActionIcon variant="light" size="lg" aria-label={t('quotes.exportXlsx')} onClick={() => downloadFile(`/quotes/${q.id}/export.xlsx`, `${quoteLabel(q)}.xlsx`).catch(fail)}>
                <IconDownload size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="light" size="lg" aria-label="menu">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {!isProfile && can('quotes', 'create') && (
                <Menu.Item onClick={() => action.mutate({ id: q.id, path: '/revision' }, { onSuccess: (r) => navigate(`/wyceny/${r.id}`), onError: fail })}>{t('quotes.newRevision')}</Menu.Item>
              )}
              {can('quoteKnowledge', 'create') && (
                <Menu.Item
                  onClick={() =>
                    promptName(t('quotes.saveAsProfile'), t('quotes.profileName'), isProfile ? `${q.name} (kopia)` : (q.opportunityName ?? ''), (name) =>
                      action.mutate({ id: q.id, path: '/save-as-profile', json: { name } }, { onSuccess: (r) => navigate(`/baza-wiedzy/profile/${r.id}`), onError: fail }),
                    )
                  }
                >
                  {t('quotes.saveAsProfile')}
                </Menu.Item>
              )}
              {q.canEdit && (
                <Menu.Item onClick={() => promptName(t('quotes.addDevice'), t('quotes.deviceName'), '', (name) => mutation.mutate(quoteOps.addDevice({ name })))}>{t('quotes.addDevice')}</Menu.Item>
              )}
              {can(isProfile ? 'quoteKnowledge' : 'quotes', 'delete') && !['sent', 'imported'].includes(q.status) && (
                <Menu.Item
                  color="red"
                  onClick={() =>
                    modals.openConfirmModal({
                      title: t('quotes.deleteConfirm', { label: quoteLabel(q) }),
                      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
                      confirmProps: { color: 'red' },
                      onConfirm: () => del.mutate(q.id, { onSuccess: () => navigate(backTo), onError: fail }),
                    })
                  }
                >
                  {t('quotes.delete')}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {!isProfile && (
        <Group gap={6} wrap="wrap" data-testid="quote-steps">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
            const later = STEP_STAGE[n]
            const current = (n === 5 && tab === 'items') || (n === 7 && tab === 'summary')
            const target = n === 5 ? 'items' : n === 7 ? 'summary' : null
            return (
              <Tooltip key={n} label={t('quotes.stepLater', { stage: later })} disabled={!later}>
                <Badge
                  size="lg"
                  radius="sm"
                  variant={current ? 'filled' : later ? 'outline' : 'light'}
                  color={later ? 'gray' : n === 1 || n === 4 ? 'green' : 'navy'}
                  leftSection={n === 1 || n === 4 ? <IconCheck size={12} /> : `${n}.`}
                  style={{ cursor: target ? 'pointer' : 'default', opacity: later ? 0.6 : 1, textTransform: 'none' }}
                  onClick={() => target && setTab(target)}
                >
                  {t(`quotes.steps.${n}`)}
                </Badge>
              </Tooltip>
            )
          })}
        </Group>
      )}

      {!q.canEdit && q.status !== 'draft' && <Alert variant="light">{t('quotes.locked', { status: t(`quotes.status.${q.status}`).toLowerCase() })}</Alert>}
      {!q.canSeeCosts && <Alert variant="light" color="gray">{t('quotes.costsHidden')}</Alert>}

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="items">{t('quotes.tabs.items')}</Tabs.Tab>
          <Tabs.Tab value="summary">
            {t('quotes.tabs.summary')}
            {(q.summary || q.costSummary) && (
              <Text span c="dimmed" size="sm">
                {' '}
                · {q.summary ? `${formatPLN(q.summary.net)} ${t('quotes.net').toLowerCase()}` : `${formatPLN(q.costSummary!.cost)} ${t('quotes.cost').toLowerCase()}`}
              </Text>
            )}
          </Tabs.Tab>
          <Tabs.Tab value="info">{t('quotes.tabs.info')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="items" pt="sm">
          <Stack>
            {q.devices.map((d) => (
              <DeviceCard key={d.id} q={q} device={d} onLine={(line, sectionId) => setLineEdit({ line, sectionId })} />
            ))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="summary" pt="sm">
          <SummaryPanel q={q} />
        </Tabs.Panel>
        <Tabs.Panel value="info" pt="sm">
          <InfoPanel q={q} />
        </Tabs.Panel>
      </Tabs>
      <LineModal q={q} line={lineEdit?.line ?? null} sectionId={lineEdit?.sectionId ?? null} onClose={() => setLineEdit(null)} />
    </Stack>
  )
}
