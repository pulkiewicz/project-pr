import { Alert, Stack, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { NavItem } from '../nav'

export function ModulePlaceholder({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  return (
    <Stack>
      <Title order={2}>{t(`nav.${item.module}`)}</Title>
      <Alert variant="light">{t('app.comingInStage', { stage: item.stage })}</Alert>
    </Stack>
  )
}

export function ForbiddenPage() {
  const { t } = useTranslation()
  return <Alert color="red">{t('errors.forbidden')}</Alert>
}

export function NotFoundPage() {
  const { t } = useTranslation()
  return <Alert color="gray">{t('errors.notFound')}</Alert>
}
