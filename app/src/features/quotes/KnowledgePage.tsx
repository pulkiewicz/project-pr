import { Button, Card, Group, Loader, NumberInput, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { COMPLEXITIES, type QuoteSettings } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { useCreateQuote, useQuoteSettings, useQuotes, useSaveQuoteSettings } from './api'
import { QuoteEditor } from './QuoteEditor'
import { StandaloneCalc } from './CalcPanel'
import { CatalogTab } from './CatalogTab'
import { SpecListTab } from './SpecListTab'
import { AiSettingsCard, DriveSettingsCard } from './AiSettingsCards'

const pct = (v: number) => Math.round(v * 10000) / 100

function SettingsCard() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const q = useQuoteSettings()
  const save = useSaveQuoteSettings()
  const [s, setS] = useState<QuoteSettings | null>(null)
  useEffect(() => {
    if (q.data) setS(q.data)
  }, [q.data])
  if (!s) return <Loader size="sm" />
  const editable = can('quotesPricing', 'edit')
  return (
    <Card withBorder>
      <Title order={4} mb="xs">
        {t('knowledge.settings')}
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        {t('knowledge.formula')}
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {COMPLEXITIES.map((c) => (
          <NumberInput
            key={c}
            label={`${t('knowledge.reserveBase')} — ${t(`quotes.complexityName.${c}`)}`}
            suffix=" %"
            min={0}
            decimalSeparator=","
            disabled={!editable}
            value={pct(s.reserve[c])}
            onChange={(v) => setS({ ...s, reserve: { ...s.reserve, [c]: (Number(v) || 0) / 100 } })}
          />
        ))}
        <NumberInput label={t('knowledge.perExtraYear')} min={0} step={0.1} decimalSeparator="," disabled={!editable} value={s.reserve.perExtraYear} onChange={(v) => setS({ ...s, reserve: { ...s.reserve, perExtraYear: Number(v) || 0 } })} />
        <NumberInput label={t('knowledge.laborRate')} min={0} decimalSeparator="," disabled={!editable} value={s.laborRate ?? ''} onChange={(v) => setS({ ...s, laborRate: v === '' ? null : Number(v) })} />
        <NumberInput label={t('knowledge.priceMaxAge')} min={1} max={120} disabled={!editable} value={s.priceMaxAgeMonths} onChange={(v) => setS({ ...s, priceMaxAgeMonths: Number(v) || 12 })} />
      </SimpleGrid>
      {editable && (
        <Group justify="flex-end" mt="sm">
          <Button
            loading={save.isPending}
            disabled={JSON.stringify(s) === JSON.stringify(q.data)}
            onClick={() => save.mutate(s, { onSuccess: () => notifications.show({ color: 'green', message: t('app.saved') }), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })}
          >
            {t('app.save')}
          </Button>
        </Group>
      )}
    </Card>
  )
}

function Profiles() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const navigate = useNavigate()
  const profiles = useQuotes('profile')
  const create = useCreateQuote()
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('knowledge.title')}</Title>
        {can('quoteKnowledge', 'create') && (
          <Button
            leftSection={<IconPlus size={16} />}
            loading={create.isPending}
            onClick={() =>
              create.mutate({ kind: 'profile', name: t('quotes.newProfile') }, { onSuccess: (q) => navigate(`/baza-wiedzy/profile/${q.id}`), onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })
            }
          >
            {t('quotes.newProfile')}
          </Button>
        )}
      </Group>
      <Tabs defaultValue="profiles" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="profiles">{t('knowledge.tabs.profiles')}</Tabs.Tab>
          <Tabs.Tab value="catalog">{t('knowledge.tabs.catalog')}</Tabs.Tab>
          <Tabs.Tab value="spec">{t('knowledge.tabs.spec')}</Tabs.Tab>
          <Tabs.Tab value="calc">{t('knowledge.tabs.calc')}</Tabs.Tab>
          <Tabs.Tab value="settings">{t('knowledge.tabs.settings')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="profiles" pt="sm">
          <Stack>
            <Text size="sm" c="dimmed">
              {t('knowledge.profilesHint')}
            </Text>
            {profiles.isLoading ? (
              <Loader />
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
                {(profiles.data ?? []).map((p) => (
                  <Card key={p.id} withBorder component={Link} to={`/baza-wiedzy/profile/${p.id}`}>
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={600}>{p.name}</Text>
                      {p.cost != null && (
                        <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                          {new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(p.cost)} zł
                        </Text>
                      )}
                    </Group>
                    <Text size="sm" c="dimmed" lineClamp={3} mt={4}>
                      {p.description}
                    </Text>
                    <Text size="xs" c="dimmed" mt="xs">
                      {formatDateTime(p.updatedAt)}
                      {p.updatedByName ? ` · ${p.updatedByName}` : ''}
                    </Text>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="catalog" pt="sm">
          <CatalogTab />
        </Tabs.Panel>
        <Tabs.Panel value="spec" pt="sm">
          <SpecListTab />
        </Tabs.Panel>
        <Tabs.Panel value="calc" pt="sm">
          <StandaloneCalc />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="sm">
          <Stack>
            <SettingsCard />
            <AiSettingsCard />
            <DriveSettingsCard />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}

/** `/baza-wiedzy` — profile i ustawienia; `/baza-wiedzy/profile/{id}` — edytor profilu. */
export function KnowledgePage() {
  const { id } = useParams()
  return id ? <QuoteEditor key={id} id={id} /> : <Profiles />
}
