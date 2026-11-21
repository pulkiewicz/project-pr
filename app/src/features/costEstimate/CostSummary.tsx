import { Alert, Paper, Stack, Table, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CostEstimateResponse, CostTotals } from '#shared'
import { formatNumber } from '../../lib/format'

const num = (v: number) => formatNumber(v)
const pct = (v: number) => `${(v * 100).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Title order={5} mb="xs">
        {title}
      </Title>
      {children}
    </Paper>
  )
}

/** Odpowiednik zakładki „Podsumowanie” arkusza. */
export function CostSummary({ data }: { data: CostEstimateResponse }) {
  const { t } = useTranslation()
  const { summary, settings } = data
  const k = summary.contract

  const totalsHead = (first: string, shareLabel: string) => (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>{first}</Table.Th>
        <Table.Th ta="right">{t('costEstimate.col.estimate')}</Table.Th>
        <Table.Th ta="right">{shareLabel}</Table.Th>
        <Table.Th ta="right">{t('costEstimate.col.quote')}</Table.Th>
        <Table.Th ta="right">{t('costEstimate.col.actual')}</Table.Th>
        <Table.Th ta="right">{t('costEstimate.col.forecast')}</Table.Th>
      </Table.Tr>
    </Table.Thead>
  )
  const totalsRow = (key: string, label: ReactNode, x: CostTotals, share: number, bold = false) => (
    <Table.Tr key={key} fw={bold ? 700 : undefined}>
      <Table.Td>{label}</Table.Td>
      <Table.Td ta="right">{num(x.estimate)}</Table.Td>
      <Table.Td ta="right">{pct(share)}</Table.Td>
      <Table.Td ta="right">{num(x.quote)}</Table.Td>
      <Table.Td ta="right">{num(x.actual)}</Table.Td>
      <Table.Td ta="right">{num(x.forecast)}</Table.Td>
    </Table.Tr>
  )
  const line = (label: ReactNode, value: number, bold = false) => (
    <Table.Tr fw={bold ? 700 : undefined}>
      <Table.Td>{label}</Table.Td>
      <Table.Td ta="right">{num(value)}</Table.Td>
    </Table.Tr>
  )

  return (
    <Stack>
      <Section title={t('costEstimate.summary.byCategory')}>
        <Table.ScrollContainer minWidth={560}>
          <Table fz="sm" verticalSpacing={4}>
            {totalsHead(t('costEstimate.col.category'), t('costEstimate.col.share'))}
            <Table.Tbody>
              {summary.categories.map((c) => totalsRow(c.category, c.category, c, c.share))}
              {totalsRow('total', t('costEstimate.summary.totalEnvcheck'), summary.envcheck, 1, true)}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>
          <Section title={t('costEstimate.summary.byBudget')}>
            <Table.ScrollContainer minWidth={480}>
              <Table fz="sm" verticalSpacing={4}>
                {totalsHead(t('costEstimate.col.budget'), t('costEstimate.summary.shareTotal'))}
                <Table.Tbody>
                  {summary.budgets.map((b) => totalsRow(b.budget, t(`costEstimate.budget.${b.budget}`), b, b.share))}
                  {totalsRow('total', t('costEstimate.summary.total'), summary.total, 1, true)}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
          {k && (
            <Section title={t('costEstimate.summary.partner')}>
              <Table fz="sm" verticalSpacing={4}>
                <Table.Tbody>
                  {line(t('costEstimate.summary.partnerBudget'), k.partnerBudget)}
                  {k.partnerStages.map((s) => (
                    <Table.Tr key={s.name}>
                      <Table.Td pl="lg" c="dimmed">
                        {t('costEstimate.summary.stage', { name: s.name })}
                      </Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {num(s.amount)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {line(t('costEstimate.summary.partnerAssigned'), k.partnerAssigned)}
                  {line(t('costEstimate.summary.partnerDiff'), k.partnerDiff, true)}
                </Table.Tbody>
              </Table>
            </Section>
          )}

      {k ? (
        <Section title={t('costEstimate.summary.result')}>
          <Table.ScrollContainer minWidth={520}>
            <Table fz="sm" verticalSpacing={4} maw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('costEstimate.summary.position')}</Table.Th>
                  <Table.Th ta="right">{t('costEstimate.col.estimate')}</Table.Th>
                  <Table.Th ta="right">{t('costEstimate.summary.shareEnvcheck')}</Table.Th>
                  <Table.Th ta="right">{t('costEstimate.col.forecast')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[
                  [t('costEstimate.summary.contractValue'), k.contractValue],
                  [t('costEstimate.summary.partnerBudget'), k.partnerBudget],
                  [t('costEstimate.summary.partnerMargin'), k.partnerMargin],
                  [t('costEstimate.summary.guaranteeReserve'), k.guaranteeReserve],
                ].map(([label, v]) => (
                  <Table.Tr key={label as string}>
                    <Table.Td>{label}</Table.Td>
                    <Table.Td ta="right">{num(v as number)}</Table.Td>
                    <Table.Td />
                    <Table.Td />
                  </Table.Tr>
                ))}
                {(
                  [
                    ['amount', t('costEstimate.summary.envcheckAmount'), k.envcheckAmount, k.envcheckAmount],
                    ['cost', t('costEstimate.summary.envcheckCost'), k.envcheckCost, k.envcheckCostForecast],
                    ['result', t('costEstimate.summary.envcheckResult'), k.result, k.resultForecast],
                  ] as const
                ).map(([key, label, est, fc]) => (
                  <Table.Tr key={key} fw={key === 'cost' ? undefined : 700}>
                    <Table.Td>{label}</Table.Td>
                    <Table.Td ta="right" c={key === 'result' && est < 0 ? 'red.7' : undefined}>
                      {num(est)}
                    </Table.Td>
                    <Table.Td ta="right">{k.envcheckAmount ? pct(est / k.envcheckAmount) : '—'}</Table.Td>
                    <Table.Td ta="right" c={key === 'result' ? (fc < 0 ? 'red.7' : 'green.8') : undefined}>
                      {num(fc)}
                    </Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr>
                  <Table.Td>{t('costEstimate.summary.reserveShare')}</Table.Td>
                  <Table.Td ta="right">{pct(k.reserveShare)}</Table.Td>
                  <Table.Td />
                  <Table.Td />
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{t('costEstimate.summary.maxReserveReturn')}</Table.Td>
                  <Table.Td ta="right">{num(k.maxReserveReturn)}</Table.Td>
                  <Table.Td />
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {settings.contract?.source && (
            <Text size="xs" c="dimmed" mt="xs">
              {t('costEstimate.summary.sources')}: {settings.contract.source}
            </Text>
          )}
        </Section>
      ) : (
        <Alert variant="light">{t('costEstimate.summary.noContract')}</Alert>
      )}

      <Section title={t('costEstimate.summary.sources')}>
        <Text size="sm">{t('costEstimate.summary.eurRate', { rate: settings.eurRate.toLocaleString('pl-PL') })}{settings.eurRateNote ? ` — ${settings.eurRateNote}` : ''}</Text>
        {(settings.sources ?? '').split('\n').filter(Boolean).map((s) => (
          <Text key={s} size="sm" c="dimmed">
            {s}
          </Text>
        ))}
      </Section>
    </Stack>
  )
}
