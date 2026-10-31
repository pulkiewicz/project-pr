import { Alert, Button, Card, Code, CopyButton, FileButton, Group, List, MultiSelect, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TIMESHEET_EXPORT_FORMAT, type TimesheetImportInput, type TimesheetImportResult } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useImportTimesheets, useSaveTimesheetSettings, useTimesheetSettings } from './api'
import { TIMESHEET_EXPORT_SNIPPET } from './exportSnippet'

/** Ustawienia (Admin): kto widzi panel Czas pracy (podgląd / edycja). */
export function TimesheetSettingsCard() {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const q = useTimesheetSettings()
  const save = useSaveTimesheetSettings()
  const [viewerIds, setViewerIds] = useState<string[] | null>(null)
  const [editorIds, setEditorIds] = useState<string[] | null>(null)
  useEffect(() => {
    if (q.data) {
      setViewerIds(q.data.settings.viewerIds)
      setEditorIds(q.data.settings.editorIds)
    }
  }, [q.data])
  if (!viewerIds || !editorIds || !q.data) return null
  const options = q.data.users.map((u) => ({ value: u.id, label: u.name }))
  return (
    <Card withBorder maw={520}>
      <Stack>
        <Text fw={600}>{t('timesheets.settings.title')}</Text>
        <MultiSelect label={t('timesheets.settings.editors')} description={t('timesheets.settings.editorsHint')} data={options} value={editorIds} onChange={setEditorIds} searchable />
        <MultiSelect
          label={t('timesheets.settings.viewers')}
          description={t('timesheets.settings.viewersHint')}
          data={options.filter((o) => !editorIds.includes(o.value))}
          value={viewerIds.filter((id) => !editorIds.includes(id))}
          onChange={setViewerIds}
          searchable
        />
        <Group justify="flex-end">
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { viewerIds, editorIds },
                {
                  onSuccess: () => {
                    notifications.show({ color: 'green', message: t('app.saved') })
                    void refresh()
                  },
                  onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                },
              )
            }
          >
            {t('app.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}

/** Import historii ze starej aplikacji (workload-calendar) — powtarzalny, bez duplikatów. */
export function TimesheetImportCard() {
  const { t } = useTranslation()
  const run = useImportTimesheets()
  const [result, setResult] = useState<TimesheetImportResult | null>(null)

  const onFile = async (file: File | null) => {
    if (!file) return
    let data: TimesheetImportInput
    try {
      data = JSON.parse(await file.text()) as TimesheetImportInput
      if (data.format !== TIMESHEET_EXPORT_FORMAT) throw new Error('format')
    } catch {
      notifications.show({ color: 'red', message: t('timesheets.import.badFile') })
      return
    }
    run.mutate(data, { onSuccess: setResult, onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) })
  }

  return (
    <Card withBorder maw={720}>
      <Stack>
        <Text fw={600}>{t('timesheets.import.title')}</Text>
        <List type="ordered" size="sm" spacing={4}>
          <List.Item>{t('timesheets.import.step1')}</List.Item>
          <List.Item>{t('timesheets.import.step2')}</List.Item>
          <List.Item>{t('timesheets.import.step3')}</List.Item>
        </List>
        <Group>
          <CopyButton value={TIMESHEET_EXPORT_SNIPPET}>
            {({ copied, copy }) => (
              <Button variant="light" onClick={copy}>
                {copied ? t('timesheets.import.copied') : t('timesheets.import.copy')}
              </Button>
            )}
          </CopyButton>
          <FileButton onChange={(f) => void onFile(f)} accept="application/json,.json">
            {(props) => (
              <Button {...props} loading={run.isPending}>
                {t('timesheets.import.upload')}
              </Button>
            )}
          </FileButton>
        </Group>
        <Text size="xs" c="dimmed">
          {t('timesheets.import.hint')}
        </Text>
        {result && (
          <Alert color={result.rejected.length ? 'yellow' : 'green'}>
            <Text size="sm">{t('timesheets.import.result', { ...result, rejected: result.rejected.length })}</Text>
            {result.rejected.length > 0 && (
              <Stack gap={2} mt="xs">
                <Text size="sm">{t('timesheets.import.rejected', { count: result.rejected.length })}</Text>
                {result.rejected.slice(0, 20).map((r) => (
                  <Code key={`${r.employeeId}-${r.date}`}>
                    {r.employeeId} {r.date}: {r.error}
                  </Code>
                ))}
              </Stack>
            )}
          </Alert>
        )}
      </Stack>
    </Card>
  )
}
