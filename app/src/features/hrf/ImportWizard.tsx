import { Alert, Badge, Button, Checkbox, FileInput, Group, Modal, MultiSelect, NumberInput, ScrollArea, Select, SimpleGrid, Stack, Stepper, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BASE_PARTIES, type ImportInspectResponse, type ImportMapping, type ImportPreviewResponse, type ImportProfileDto } from '#shared'
import { errorMessage } from '../../lib/errors'
import { useImportApi } from './api'

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
const FIELDS = ['code', 'name', 'weeks', 'party', 'notes'] as const
const REQUIRED = new Set(['code', 'name', 'weeks'])

const emptyMapping = (): ImportMapping => ({
  sheet: '',
  headerRow: 1,
  columns: { code: 'A', name: 'B', weeks: 'C' },
  partyValues: {},
  emptyParty: 'Konsorcjum',
  postAcceptanceStageCodes: [],
})

export function ImportWizard({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const imp = useImportApi()
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [inspect, setInspect] = useState<ImportInspectResponse | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping())
  const [profiles, setProfiles] = useState<ImportProfileDto[]>([])
  const [profileName, setProfileName] = useState('')
  const [partyValues, setPartyValues] = useState<string[]>([])
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (opened) imp.profiles().then(setProfiles, () => setProfiles([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])

  const reset = () => {
    setStep(0)
    setFile(null)
    setInspect(null)
    setMapping(emptyMapping())
    setPreview(null)
    setResult(null)
    setError(null)
  }
  const close = () => {
    reset()
    onClose()
  }

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(errorMessage(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const doInspect = () =>
    run(async () => {
      const r = await imp.inspect(file!)
      setInspect(r)
      const s = r.suggested
      const next = { ...emptyMapping(), ...(s ?? {}), sheet: s?.sheet ?? r.sheets[0]?.name ?? '', columns: { ...emptyMapping().columns, ...(s?.columns ?? {}) } }
      setMapping(next)
      setPartyValues(r.partyValuesFound[next.sheet] ?? [])
      setStep(1)
    })

  const refreshPartyValues = (m: ImportMapping) =>
    run(async () => {
      if (!m.columns.party) return setPartyValues([])
      const r = await imp.inspect(file!, m)
      setPartyValues(r.partyValuesFound[m.sheet] ?? [])
    })

  const doPreview = (m: ImportMapping = mapping) =>
    run(async () => {
      setPreview(await imp.preview(file!, m))
      setStep(2)
    })

  const doCommit = () =>
    run(async () => {
      setResult(await imp.commit(file!, mapping))
      if (profileName.trim()) await imp.saveProfile(profileName.trim(), mapping)
      notifications.show({ color: 'green', message: t('app.saved') })
      setStep(3)
    })

  const sheetRows = inspect?.sheets.find((s) => s.name === mapping.sheet)?.rows ?? []
  const stageCodes = preview?.tasks.filter((x) => !x.parentCode).map((x) => ({ value: x.code, label: `${x.code} ${x.name}` })) ?? []
  const missingPartyMapping = partyValues.some((v) => !mapping.partyValues[v])

  return (
    <Modal opened={opened} onClose={close} title={t('hrf.wizard.title')} size="80rem">
      <Stepper active={step} size="sm" mb="md">
        <Stepper.Step label={t('hrf.wizard.step1')} />
        <Stepper.Step label={t('hrf.wizard.step2')} />
        <Stepper.Step label={t('hrf.wizard.step3')} />
        <Stepper.Step label={t('hrf.wizard.step4')} />
      </Stepper>
      {error && (
        <Alert color="red" mb="sm">
          {error}
        </Alert>
      )}

      {step === 0 && (
        <Stack>
          <FileInput label={t('hrf.wizard.chooseFile')} accept=".xlsx" leftSection={<IconFileSpreadsheet size={16} />} value={file} onChange={setFile} />
          {profiles.length > 0 && (
            <Select
              label={t('hrf.wizard.profile')}
              clearable
              data={profiles.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => {
                const p = profiles.find((x) => x.id === id)
                if (p) {
                  setMapping(p.mapping)
                  setProfileName(p.name)
                }
              }}
            />
          )}
          <Group justify="flex-end">
            <Button disabled={!file} loading={busy} onClick={doInspect}>
              {t('hrf.wizard.next')}
            </Button>
          </Group>
        </Stack>
      )}

      {step === 1 && inspect && (
        <Stack>
          <Group grow>
            <Select label={t('hrf.wizard.sheet')} allowDeselect={false} data={inspect.sheets.map((s) => s.name)} value={mapping.sheet} onChange={(v) => v && setMapping({ ...mapping, sheet: v })} />
            <NumberInput label={t('hrf.wizard.headerRow')} min={1} value={mapping.headerRow} onChange={(v) => setMapping({ ...mapping, headerRow: Number(v) || 1 })} />
          </Group>
          <SimpleGrid cols={{ base: 2, md: 5 }}>
            {FIELDS.map((f) => (
              <Select
                key={f}
                label={t(`hrf.wizard.fields.${f}`)}
                required={REQUIRED.has(f)}
                clearable={!REQUIRED.has(f)}
                data={LETTERS}
                value={mapping.columns[f] ?? null}
                onChange={(v) => {
                  const m = { ...mapping, columns: { ...mapping.columns, [f]: v ?? undefined } }
                  setMapping(m)
                  if (f === 'party') void refreshPartyValues(m)
                }}
              />
            ))}
          </SimpleGrid>
          <ScrollArea h={200} type="auto">
            <Table withTableBorder withColumnBorders fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  {LETTERS.slice(0, Math.max(...sheetRows.map((r) => r.length), 1)).map((l) => (
                    <Table.Th key={l}>{l}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sheetRows.map((r, i) => (
                  <Table.Tr key={i} bg={i + 1 === mapping.headerRow ? 'navy.0' : undefined}>
                    <Table.Td>{i + 1}</Table.Td>
                    {r.map((c, j) => (
                      <Table.Td key={j} maw={220} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          {mapping.columns.party && (
            <Stack gap="xs">
              <Text fw={600} size="sm">
                {t('hrf.wizard.partyValues')}
              </Text>
              {partyValues.map((v) => (
                <Group key={v} gap="sm">
                  <Text size="sm" w={220}>
                    „{v}”
                  </Text>
                  <Select
                    w={220}
                    placeholder="—"
                    data={BASE_PARTIES.map((p) => ({ value: p, label: t(`parties.${p}`) }))}
                    value={mapping.partyValues[v]?.party ?? null}
                    onChange={(p) =>
                      setMapping({ ...mapping, partyValues: { ...mapping.partyValues, [v]: { party: p as never, acceptancePoint: mapping.partyValues[v]?.acceptancePoint ?? false } } })
                    }
                    aria-label={v}
                  />
                  <Checkbox
                    label={t('hrf.wizard.acceptancePoint')}
                    checked={mapping.partyValues[v]?.acceptancePoint ?? false}
                    disabled={!mapping.partyValues[v]}
                    onChange={(e) => setMapping({ ...mapping, partyValues: { ...mapping.partyValues, [v]: { ...mapping.partyValues[v]!, acceptancePoint: e.currentTarget.checked } } })}
                  />
                </Group>
              ))}
              <Select
                w={300}
                label={t('hrf.wizard.emptyParty')}
                allowDeselect={false}
                data={BASE_PARTIES.map((p) => ({ value: p, label: t(`parties.${p}`) }))}
                value={mapping.emptyParty}
                onChange={(p) => p && setMapping({ ...mapping, emptyParty: p as never })}
              />
            </Stack>
          )}
          <Group justify="space-between">
            <Button variant="default" onClick={() => setStep(0)}>
              {t('hrf.wizard.back')}
            </Button>
            <Button loading={busy} disabled={missingPartyMapping} onClick={() => doPreview()}>
              {t('hrf.wizard.preview')}
            </Button>
          </Group>
        </Stack>
      )}

      {step === 2 && preview && (
        <Stack>
          <Group gap="xs">
            <Badge color="green">{t('hrf.wizard.created')}: {preview.diff.created.length}</Badge>
            <Badge color="blue">{t('hrf.wizard.updated')}: {preview.diff.updated.length}</Badge>
            <Badge color="gray">{t('hrf.wizard.unchanged')}: {preview.diff.unchanged.length}</Badge>
            <Badge color="yellow">{t('hrf.wizard.missing')}: {preview.diff.missingInFile.length}</Badge>
            <Badge color="red">{t('hrf.wizard.errors')}: {preview.issues.filter((i) => i.severity === 'error').length}</Badge>
            <Badge color="orange">{t('hrf.wizard.warnings')}: {preview.issues.filter((i) => i.severity === 'warning').length}</Badge>
          </Group>
          <MultiSelect
            label={t('hrf.wizard.postAcceptance')}
            data={stageCodes}
            value={mapping.postAcceptanceStageCodes}
            onChange={(v) => {
              const m = { ...mapping, postAcceptanceStageCodes: v }
              setMapping(m)
              void doPreview(m)
            }}
          />
          {preview.issues.length > 0 && (
            <ScrollArea h={140} type="auto">
              <Stack gap={2}>
                {preview.issues.map((i, k) => (
                  <Text key={k} size="xs" c={i.severity === 'error' ? 'red' : 'orange.8'}>
                    {i.row ? `${t('hrf.wizard.row')} ${i.row}` : ''} {i.code ? `[${i.code}]` : ''} {i.message}
                  </Text>
                ))}
              </Stack>
            </ScrollArea>
          )}
          <ScrollArea h={280} type="auto">
            <Table striped fz="xs" stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('hrf.code')}</Table.Th>
                  <Table.Th>{t('hrf.name')}</Table.Th>
                  <Table.Th>{t('hrf.party')}</Table.Th>
                  <Table.Th>{t('hrf.offset')}</Table.Th>
                  <Table.Th>{t('hrf.duration')}</Table.Th>
                  <Table.Th>{t('hrf.acceptance')}</Table.Th>
                  <Table.Th>§ 3 ust. 8</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {preview.tasks.map((x) => (
                  <Table.Tr key={x.code} fw={x.parentCode ? undefined : 600}>
                    <Table.Td>{x.code}</Table.Td>
                    <Table.Td>{x.name}</Table.Td>
                    <Table.Td>{t(`parties.${x.party}`)}</Table.Td>
                    <Table.Td>{x.startOffsetDays}</Table.Td>
                    <Table.Td>{x.durationDays}</Table.Td>
                    <Table.Td>{x.isAcceptancePoint ? '◆' : ''}</Table.Td>
                    <Table.Td>{x.postAcceptanceAllowed ? '✓' : ''}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <TextInput label={t('hrf.wizard.profileSave')} placeholder={t('hrf.wizard.profileName')} value={profileName} onChange={(e) => setProfileName(e.currentTarget.value)} />
          <Group justify="space-between">
            <Button variant="default" onClick={() => setStep(1)}>
              {t('hrf.wizard.back')}
            </Button>
            <Group>
              <Button variant="light" loading={busy} onClick={() => doPreview()}>
                {t('app.refresh')}
              </Button>
              <Button loading={busy} disabled={!preview.canCommit} onClick={doCommit}>
                {t('hrf.wizard.commit')}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}

      {step === 3 && result && (
        <Stack>
          <Alert color="green">{t('hrf.wizard.done', result)}</Alert>
          <Group justify="flex-end">
            <Button onClick={close}>{t('app.close')}</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
