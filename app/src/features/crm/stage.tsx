import { Badge, Button, Group, Modal, Stack, Textarea, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NO_RESPONSE_DAYS, type OpportunityDto, type OpportunityStage } from '#shared'
import { errorMessage } from '../../lib/errors'
import { useChangeStage } from './api'

export const STAGE_COLOR: Record<OpportunityStage, string> = {
  new: 'gray',
  quoting: 'blue',
  submitted: 'violet',
  won: 'green',
  lost: 'red',
  on_hold: 'yellow',
}

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  const { t } = useTranslation()
  return (
    <Badge variant="light" color={STAGE_COLOR[stage]} style={{ flexShrink: 0 }}>
      {t(`crm.stage.${stage}`)}
    </Badge>
  )
}

export function NoResponseBadge() {
  const { t } = useTranslation()
  return (
    <Tooltip label={t('crm.noResponseHint', { days: NO_RESPONSE_DAYS })}>
      <Badge size="xs" color="orange" variant="outline" style={{ flexShrink: 0 }}>
        {t('crm.noResponse')}
      </Badge>
    </Tooltip>
  )
}

/** Zmiana etapu z obowiązkowym powodem przy „Przegrane”; zwraca funkcję i okno do wyrenderowania. */
export function useStageChange(): [(o: Pick<OpportunityDto, 'id' | 'version' | 'stage'>, stage: OpportunityStage) => void, ReactNode] {
  const { t } = useTranslation()
  const mutation = useChangeStage()
  const [pending, setPending] = useState<{ id: string; version: number } | null>(null)
  const [reason, setReason] = useState('')

  const run = (v: { id: string; version: number; stage: OpportunityStage; lossReason?: string }) =>
    mutation.mutate(v, { onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })

  const change = (o: Pick<OpportunityDto, 'id' | 'version' | 'stage'>, stage: OpportunityStage) => {
    if (o.stage === stage) return
    if (stage === 'lost') {
      setReason('')
      setPending({ id: o.id, version: o.version })
    } else run({ id: o.id, version: o.version, stage })
  }

  const modal = (
    <Modal opened={!!pending} onClose={() => setPending(null)} title={t('crm.lossReasonPrompt')}>
      <Stack>
        <Textarea label={t('crm.lossReason')} required autosize minRows={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setPending(null)}>
            {t('app.cancel')}
          </Button>
          <Button
            color="red"
            disabled={!reason.trim()}
            onClick={() => {
              run({ ...pending!, stage: 'lost', lossReason: reason.trim() })
              setPending(null)
            }}
          >
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
  return [change, modal]
}
