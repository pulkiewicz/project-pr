import { Alert, Button, Card, Group, Modal, Select, Stack, Text, Textarea } from '@mantine/core'
import { IconAlertTriangle, IconArrowBackUp } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatProfileSpec, type QuoteDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { formatDateTime } from '../../lib/format'
import { quoteOps, useQuoteMutation, useQuotes } from './api'

/** Odrzucenie wyceny: przyczyna wymagana; szansa w lejku przechodzi do „Porzucona wycena”. */
export function RejectQuoteModal({ q, opened, onClose }: { q: QuoteDto; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const m = useQuoteMutation(q.id)
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (opened) setReason('')
  }, [opened])
  const ok = reason.trim().length >= 3
  return (
    <Modal opened={opened} onClose={onClose} title={t('quotes.reject.title')}>
      <Stack>
        <Textarea
          label={t('quotes.reject.reason')}
          placeholder={t('quotes.reject.reasonPlaceholder')}
          required
          autosize
          minRows={3}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          data-autofocus
        />
        {q.opportunityId && (
          <Text size="sm" c="dimmed">
            {t('quotes.reject.pipelineNote')}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button color="red" disabled={!ok} loading={m.isPending} onClick={() => m.mutate(quoteOps.reject(reason.trim(), q.version), { onSuccess: onClose })}>
            {t('quotes.reject.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Baner odrzuconej wyceny: przyczyna, kto i kiedy, przywrócenie do roboczej. */
export function RejectedBanner({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const m = useQuoteMutation(q.id)
  if (q.status !== 'rejected') return null
  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title={t('quotes.reject.banner')}>
      <Stack gap="xs">
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {q.rejectReason}
        </Text>
        <Group justify="space-between" wrap="wrap">
          <Text size="xs" c="dimmed">
            {q.rejectedAt ? t('quotes.reject.by', { name: q.rejectedByName ?? '', date: formatDateTime(q.rejectedAt) }) : ''}
          </Text>
          {can('quotes', 'edit') && (
            <Button size="xs" variant="default" leftSection={<IconArrowBackUp size={14} />} loading={m.isPending} onClick={() => m.mutate(quoteOps.reopen(q.version))}>
              {t('quotes.reject.reopen')}
            </Button>
          )}
        </Group>
      </Stack>
    </Alert>
  )
}

/** Krok 7: bieżący profil wyceny i jego zmiana (zastępuje urządzenia, sekcje, pozycje i parametry). */
export function ProfileSwitcher({ q }: { q: QuoteDto }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  const profiles = useQuotes('profile')
  const m = useQuoteMutation(q.id)
  const lines = q.devices.reduce((n, d) => n + d.sections.reduce((k, s) => k + s.lines.length, 0), 0)
  const profileLabel = q.basedOnLabel?.startsWith('Profil: ') ? q.basedOnLabel.slice(8) : null
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="wrap">
        <Group gap={6}>
          <Text size="sm" c="dimmed">
            {t('quotes.profile.current')}
          </Text>
          <Text size="sm" fw={500}>
            {profileLabel ?? q.basedOnLabel ?? t('quotes.profile.none')}
          </Text>
        </Group>
        {q.canEdit && can('quoteKnowledge', 'view') && (
          <Button
            size="xs"
            variant="light"
            onClick={() => {
              setProfileId(null)
              setOpen(true)
            }}
          >
            {t('quotes.profile.change')}
          </Button>
        )}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={t('quotes.profile.change')}>
        <Stack>
          <Select
            label={t('quotes.profile.pick')}
            searchable
            data={(profiles.data ?? []).filter((p) => p.id !== q.basedOnId).map((p) => ({ value: p.id, label: p.name ?? '' }))}
            value={profileId}
            onChange={setProfileId}
            description={formatProfileSpec(profiles.data?.find((p) => p.id === profileId)?.profileSpec) || undefined}
            placeholder={profiles.isLoading ? t('app.loading') : undefined}
            data-autofocus
          />
          <Alert color="orange" variant="light">
            {t('quotes.profile.warning', { count: lines })}
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              {t('app.cancel')}
            </Button>
            <Button color="orange" disabled={!profileId} loading={m.isPending} onClick={() => profileId && m.mutate(quoteOps.applyProfile(profileId, q.version), { onSuccess: () => setOpen(false) })}>
              {t('quotes.profile.apply')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  )
}
