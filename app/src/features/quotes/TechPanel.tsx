import { Badge, Button, Card, Group, NumberInput, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { layoutCheck, shellMassKg, suggestTechnology, type QuoteDto, type QuoteInfo } from '#shared'
import { formatNumber } from '../../lib/format'
import { quoteOps, useQuoteMutation } from './api'

type Layout = NonNullable<QuoteInfo['layout']>
const LAYOUT_KEYS = ['wallMm', 'serviceMm', 'frameMm', 'machineRoomMm', 'roofUnitMm'] as const
const mm = (n: number) => `${formatNumber(n).replace(/,00$/, '')} mm`

/** Krok 6 (W2) — tryb wyceny, dobór technologii chłodniczej, twarde wymogi SWZ, masa komory i clash detection. */
export function TechLayoutCard({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const m = useQuoteMutation(q.id)
  const ctx = q.bom?.context
  const [layout, setLayout] = useState<Layout>(q.info.layout ?? {})
  const serverLayout = JSON.stringify(q.info.layout ?? {})
  useEffect(() => setLayout(q.info.layout ?? {}), [serverLayout]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ctx) return null
  const tech = suggestTechnology(ctx.tMin)
  const check = layoutCheck(ctx.inner, { ...q.info, layout })
  const changed = JSON.stringify(layout) !== serverLayout
  const save = () => m.mutate(quoteOps.patch({ info: { ...q.info, layout }, version: q.version }))

  return (
    <Card withBorder data-testid="tech-layout">
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Title order={5}>{t('tech.title')}</Title>
        <Tooltip label={ctx.mode.reasons.join(', ') || t('quoteMode.standardHint')} multiline w={320}>
          <Badge variant="light" color={ctx.mode.custom ? 'grape' : 'gray'} data-testid="quote-mode">
            {t(ctx.mode.custom ? 'quoteMode.custom' : 'quoteMode.standard')}
          </Badge>
        </Tooltip>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            {t('tech.technology')}
          </Text>
          {tech ? (
            <Text size="sm" data-testid="tech-suggestion">
              {t('tech.suggest', { tmin: ctx.tMin?.toLocaleString('pl-PL'), tech: t(`tech.kind.${tech.primary}`) })}
              {tech.alternative ? ` ${t('tech.alternative', { tech: t(`tech.kind.${tech.alternative}`) })}` : ''}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              {t('tech.noTmin')}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {t('tech.flagsHint')}
          </Text>
          <Text size="sm" fw={500} mt="xs">
            {t('tech.requirements')}
          </Text>
          {ctx.requirements.length ? (
            <Table withRowBorders={false} verticalSpacing={2}>
              <Table.Tbody>
                {ctx.requirements.map((r) => (
                  <Table.Tr key={r.label}>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {r.label}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{r.value}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="xs" c="dimmed">
              {t('tech.noRequirements')}
            </Text>
          )}
          {ctx.inner && (
            <Text size="xs" c="dimmed" data-testid="shell-mass">
              {t('tech.shellMass', { kg: formatNumber(shellMassKg(ctx.inner, layout.wallMm ?? 150)).replace(/,00$/, '') })}
            </Text>
          )}
        </Stack>
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            {t('tech.layout')}
          </Text>
          {!ctx.inner && (
            <Text size="xs" c="orange">
              {t('tech.noInner')}
            </Text>
          )}
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
            {LAYOUT_KEYS.map((k) => (
              <NumberInput
                key={k}
                size="xs"
                label={t(`tech.${k}`)}
                min={0}
                thousandSeparator=" "
                suffix=" mm"
                disabled={!q.canEdit}
                value={layout[k] ?? ''}
                onChange={(v) => setLayout({ ...layout, [k]: v === '' ? null : Number(v) })}
              />
            ))}
          </SimpleGrid>
          {q.canEdit && (
            <Group justify="flex-end">
              <Button size="xs" disabled={!changed} loading={m.isPending} onClick={save}>
                {t('app.save')}
              </Button>
            </Group>
          )}
          {check && (
            <Table verticalSpacing={2} data-testid="layout-check">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th />
                  <Table.Th ta="right">{t('tech.outer')}</Table.Th>
                  <Table.Th ta="right">{t('tech.limit')}</Table.Th>
                  <Table.Th ta="right">{t('tech.free')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(['w', 'h', 'd'] as const).map((k) => (
                  <Table.Tr key={k}>
                    <Table.Td>
                      <Text size="xs">{t(`swz.dim.${k}`)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" c={check.over[k] ? 'red' : undefined} fw={check.over[k] ? 700 : undefined}>
                        {mm(check.outer[k])}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs">{check.limit ? mm(check.limit[k]) : '—'}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" c="dimmed">
                        {check.free ? mm(check.free[k]) : '—'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {check && !check.limit && (
            <Text size="xs" c="dimmed">
              {t('tech.noLimit')}
            </Text>
          )}
        </Stack>
      </SimpleGrid>
    </Card>
  )
}
