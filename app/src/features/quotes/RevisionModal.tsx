import { Button, Group, Modal, Radio, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { QuoteDto, QuoteRevisionMode } from '#shared'
import { errorMessage } from '../../lib/errors'
import { useQuoteAction } from './api'

/** Nowa rewizja: kopia bieżącej (pozycje, checklista, kalkulacje, dokumenty, terminy) albo pusta (ta sama szansa i folder Drive). */
export function RevisionModal({ quote, opened, onClose }: { quote: Pick<QuoteDto, 'id' | 'revision'>; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const action = useQuoteAction()
  const [mode, setMode] = useState<QuoteRevisionMode>('copy')
  useEffect(() => {
    if (opened) setMode('copy')
  }, [opened])

  return (
    <Modal opened={opened} onClose={onClose} title={t('quotes.newRevision')}>
      <Stack>
        <Radio.Group value={mode} onChange={(v) => setMode(v as QuoteRevisionMode)}>
          <Stack gap="sm">
            <Radio value="copy" label={t('quotes.revisionMode.copy', { revision: quote.revision ?? '' })} description={t('quotes.revisionMode.copyHint')} />
            <Radio value="empty" label={t('quotes.revisionMode.empty')} description={t('quotes.revisionMode.emptyHint')} />
          </Stack>
        </Radio.Group>
        <Text size="xs" c="dimmed">
          {t('quotes.revisionMode.note')}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button
            loading={action.isPending}
            onClick={() =>
              action.mutate(
                { id: quote.id, path: '/revision', json: { mode } },
                {
                  onSuccess: (r) => {
                    onClose()
                    navigate(`/wyceny/${r.id}${mode === 'empty' ? '?krok=2' : ''}`)
                  },
                  onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                },
              )
            }
          >
            {t('quotes.revisionMode.create')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
