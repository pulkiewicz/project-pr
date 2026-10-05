import { Badge } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { HrfStatus } from '#shared'

export const STATUS_COLOR: Record<HrfStatus, string> = {
  not_started: 'gray',
  in_progress: 'navy',
  at_risk: 'yellow',
  delayed: 'red',
  ready_for_acceptance: 'violet',
  accepted: 'green',
}

export function StatusBadge({ status }: { status: HrfStatus }) {
  const { t } = useTranslation()
  return (
    <Badge color={STATUS_COLOR[status]} variant="light" size="sm">
      {t(`hrf.status.${status}`)}
    </Badge>
  )
}
