import { Alert, Button, Card, Group, MultiSelect, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InvoiceSettings } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useInvoiceSettings, useSaveInvoiceSettings } from './api'

/** Ustawienia modułu Faktury (Admin): osoby z dostępem i data, od której pobierać koszty z inFakt. */
export function InvoiceSettingsCard() {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const q = useInvoiceSettings()
  const save = useSaveInvoiceSettings()
  const [s, setS] = useState<InvoiceSettings | null>(null)
  useEffect(() => {
    if (q.data) setS(q.data.settings)
  }, [q.data])
  if (!s || !q.data) return null
  return (
    <Card withBorder maw={520}>
      <Stack>
        <Text fw={600}>{t('invoices.settings.title')}</Text>
        {!q.data.configured && <Alert color="yellow">{t('invoices.settings.keyMissing')}</Alert>}
        <MultiSelect
          label={t('invoices.settings.users')}
          description={t('invoices.settings.usersHint')}
          data={q.data.users.map((u) => ({ value: u.id, label: u.name }))}
          value={s.userIds}
          onChange={(userIds) => setS({ ...s, userIds })}
          searchable
        />
        <DateInput
          w={220}
          label={t('invoices.settings.syncFrom')}
          valueFormat="DD.MM.YYYY"
          value={new Date(`${s.syncFrom}T00:00:00`)}
          onChange={(d) => d && setS({ ...s, syncFrom: format(typeof d === 'string' ? new Date(d) : d, 'yyyy-MM-dd') })}
        />
        <Group justify="flex-end">
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate(s, {
                onSuccess: () => {
                  notifications.show({ color: 'green', message: t('app.saved') })
                  // Lista osób zmienia uprawnienia — także bieżącego Admina (menu z /me).
                  void refresh()
                },
                onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
              })
            }
          >
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}
