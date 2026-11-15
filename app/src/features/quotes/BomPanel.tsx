import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Chip, Group, Menu, Modal, NumberInput, Select, Stack, Switch, Table, TagsInput, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconDots, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BOM_CHECKLIST_OPS, DEFAULT_SECTIONS, normalizeText, type BomCondition, type BomIssue, type BomRuleDto, type BomRuleInput, type QuoteDto } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { formatDateTime } from '../../lib/format'
import { quoteOps, useBomRuleMutation, useBomRules, useQuoteMutation, useSpecLists } from './api'

/** Sekcja wyceny o danej nazwie (pierwsze urządzenie wliczone do ceny), do „Dodaj pozycję”. */
function sectionIdFor(q: QuoteDto, name: string | null): string | null {
  const devices = [...q.devices].sort((a, b) => Number(b.included && !b.isOption) - Number(a.included && !a.isOption))
  const all = devices.flatMap((d) => d.sections)
  return (name ? all.find((s) => normalizeText(s.name) === normalizeText(name)) : null)?.id ?? all[0]?.id ?? null
}

/** Krok 7 — kompletność kosztorysu: flagi architektury i alerty reguł zależności (W3). */
export function BomCheckCard({ q, onAddLine }: { q: QuoteDto; onAddLine: (sectionId: string, name: string) => void }) {
  const { t } = useTranslation()
  const m = useQuoteMutation(q.id)
  const bom = q.bom
  if (!bom) return null
  const flags = [...new Set([...bom.availableFlags, ...bom.flags])]
  const open = bom.issues.filter((i) => !i.ack)
  const acked = bom.issues.filter((i) => i.ack)

  const ack = (issue: BomIssue, preset?: string) => {
    if (preset) return m.mutate(quoteOps.bomAck(issue.key, preset))
    let reason = ''
    modals.openConfirmModal({
      title: t('bom.ackTitle', { title: issue.title }),
      children: <Textarea label={t('bom.ackReason')} placeholder={t('bom.ackPlaceholder')} required autosize minRows={2} onChange={(e) => (reason = e.currentTarget.value)} data-autofocus />,
      labels: { confirm: t('bom.ack'), cancel: t('app.cancel') },
      onConfirm: () => reason.trim().length >= 3 && m.mutate(quoteOps.bomAck(issue.key, reason.trim())),
    })
  }

  return (
    <Card withBorder padding="sm" data-testid="bom-check" style={open.length ? { borderColor: 'var(--mantine-color-orange-5)' } : undefined}>
      <Group justify="space-between" mb={6} wrap="wrap">
        <Group gap="xs">
          <Title order={5}>{t('bom.title')}</Title>
          {open.length ? (
            <Badge color="orange" variant="light" leftSection={<IconAlertTriangle size={12} />}>
              {t('bom.open', { count: open.length })}
            </Badge>
          ) : (
            <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>
              {t('bom.complete')}
            </Badge>
          )}
        </Group>
      </Group>
      {flags.length > 0 && (
        <Stack gap={4} mb="sm">
          <Text size="xs" c="dimmed">
            {t('bom.flagsHint')}
          </Text>
          <Chip.Group multiple value={bom.flags} onChange={(v) => q.canEdit && m.mutate(quoteOps.bomFlags(v))}>
            <Group gap={6}>
              {flags.map((f) => (
                <Chip key={f} value={f} size="xs" disabled={!q.canEdit}>
                  {f}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </Stack>
      )}
      <Stack gap="xs">
        {open.map((i) => (
          <Alert key={i.key} color="orange" variant="light" p="xs" title={i.title} data-testid="bom-issue">
            <Stack gap={4}>
              {i.description && <Text size="sm">{i.description}</Text>}
              {i.triggers.length > 0 && (
                <Text size="xs" c="dimmed">
                  {t('bom.because')}: {i.triggers.join('; ')}
                </Text>
              )}
              {i.kind === 'rule' && (
                <Text size="xs" c="dimmed">
                  {t('bom.expected', { section: i.section ?? t('bom.anySection'), keywords: i.keywords.join(', ') })}
                </Text>
              )}
              {i.lines.length > 0 && (
                <Text size="xs" c="dimmed">
                  {i.lines.slice(0, 10).join(' · ')}
                  {i.lines.length > 10 ? ` (+${i.lines.length - 10})` : ''}
                </Text>
              )}
              {q.canEdit && (
                <Group gap={6} mt={2}>
                  {i.suggestion && (
                    <Button
                      size="compact-xs"
                      leftSection={<IconPlus size={12} />}
                      onClick={() => {
                        const s = sectionIdFor(q, i.suggestion!.section)
                        if (s) onAddLine(s, i.suggestion!.name)
                      }}
                    >
                      {t('bom.addLine', { name: i.suggestion.name })}
                    </Button>
                  )}
                  {i.exceptionLabel && (
                    <Button size="compact-xs" variant="light" color="gray" onClick={() => ack(i, i.exceptionLabel!)}>
                      {i.exceptionLabel}
                    </Button>
                  )}
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={() => ack(i)}>
                    {t('bom.ackAction')}
                  </Button>
                </Group>
              )}
            </Stack>
          </Alert>
        ))}
        {acked.map((i) => (
          <Group key={i.key} justify="space-between" wrap="nowrap" gap="xs" data-testid="bom-acked">
            <Text size="sm" c="dimmed">
              <IconCheck size={13} style={{ verticalAlign: -2 }} /> {i.title} — <i>{i.ack!.reason}</i>{' '}
              <Text span size="xs">
                ({i.ack!.byName ?? ''}, {formatDateTime(i.ack!.at)})
              </Text>
            </Text>
            {q.canEdit && (
              <Tooltip label={t('bom.unack')}>
                <ActionIcon variant="subtle" size="sm" color="gray" aria-label={t('bom.unack')} onClick={() => m.mutate(quoteOps.bomUnack(i.key))}>
                  <IconArrowBackUp size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        ))}
        {!bom.issues.length && (
          <Text size="sm" c="dimmed">
            {t('bom.allGood')}
          </Text>
        )}
      </Stack>
    </Card>
  )
}

// ---------------- Baza wiedzy: reguły ----------------

const EMPTY_RULE: BomRuleInput = { name: '', description: null, active: true, when: [{ kind: 'flag', flag: '' }], require: { section: null, keywords: [], positiveCost: true }, suggestion: null, exceptionLabel: null }

function conditionLabel(c: BomCondition, specLabel: (k: string) => string, t: (k: string) => string) {
  if (c.kind === 'always') return t('bom.cond.always')
  if (c.kind === 'flag') return `${t('bom.cond.flag')}: ${c.flag}`
  return `${specLabel(c.key)} ${t(`bom.op.${c.op}`)}${c.value != null && c.value !== '' ? ` ${c.value}` : ''}`
}

function RuleModal({ rule, opened, onClose }: { rule: BomRuleDto | null; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const m = useBomRuleMutation()
  const spec = useSpecLists()
  const [f, setF] = useState<BomRuleInput>(EMPTY_RULE)
  useEffect(() => {
    if (!opened) return
    if (rule) {
      const { name, description, active, when, require, suggestion, exceptionLabel } = rule
      setF({ name, description, active, when, require, suggestion, exceptionLabel })
    } else setF(EMPTY_RULE)
  }, [opened, rule])
  const items = spec.data?.[0]?.items ?? []
  const keyOptions = items.map((i) => ({ value: i.key, label: `${i.group} · ${i.label}` }))
  const setCond = (idx: number, c: BomCondition) => setF((p) => ({ ...p, when: p.when.map((x, i) => (i === idx ? c : x)) }))
  const valid = f.name.trim() && f.require.keywords.length > 0 && f.when.every((c) => c.kind === 'always' || (c.kind === 'flag' ? c.flag.trim() : c.key))
  const save = () => {
    const json = { ...f, suggestion: f.suggestion?.name?.trim() ? f.suggestion : null, exceptionLabel: f.exceptionLabel?.trim() || null, description: f.description?.trim() || null }
    m.mutate(rule ? { method: 'PATCH', id: rule.id, json } : { method: 'POST', json }, { onSuccess: onClose })
  }
  return (
    <Modal opened={opened} onClose={onClose} title={rule ? t('bom.editRule') : t('bom.newRule')} size="xl">
      <Stack>
        <TextInput label={t('bom.ruleName')} required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} data-autofocus />
        <Textarea label={t('bom.ruleDescription')} autosize minRows={1} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {t('bom.when')}
          </Text>
          {f.when.map((c, idx) => (
            <Group key={idx} gap="xs" align="flex-end" wrap="nowrap">
              <Select
                w={150}
                data={(['flag', 'checklist', 'always'] as const).map((k) => ({ value: k, label: t(`bom.cond.${k}`) }))}
                value={c.kind}
                allowDeselect={false}
                onChange={(k) => setCond(idx, k === 'flag' ? { kind: 'flag', flag: '' } : k === 'checklist' ? { kind: 'checklist', key: '', op: 'filled' } : { kind: 'always' })}
              />
              {c.kind === 'flag' && <TextInput style={{ flex: 1 }} placeholder={t('bom.flagPlaceholder')} value={c.flag} onChange={(e) => setCond(idx, { ...c, flag: e.currentTarget.value })} />}
              {c.kind === 'checklist' && (
                <>
                  <Select style={{ flex: 2 }} searchable data={keyOptions} value={c.key || null} onChange={(k) => setCond(idx, { ...c, key: k ?? '' })} placeholder={t('bom.pickItem')} />
                  <Select w={130} data={BOM_CHECKLIST_OPS.map((o) => ({ value: o, label: t(`bom.op.${o}`) }))} value={c.op} allowDeselect={false} onChange={(o) => setCond(idx, { ...c, op: o as typeof c.op })} />
                  {['eq', 'contains'].includes(c.op) && <TextInput w={160} value={String(c.value ?? '')} onChange={(e) => setCond(idx, { ...c, value: e.currentTarget.value })} />}
                  {['gte', 'lte'].includes(c.op) && <NumberInput w={110} decimalSeparator="," value={typeof c.value === 'number' ? c.value : ''} onChange={(v) => setCond(idx, { ...c, value: v === '' ? null : Number(v) })} />}
                </>
              )}
              <ActionIcon variant="subtle" color="red" disabled={f.when.length <= 1} aria-label={t('app.delete')} onClick={() => setF({ ...f, when: f.when.filter((_, i) => i !== idx) })}>
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Button size="compact-sm" variant="subtle" w="fit-content" leftSection={<IconPlus size={14} />} disabled={f.when.length >= 10} onClick={() => setF({ ...f, when: [...f.when, { kind: 'flag', flag: '' }] })}>
            {t('bom.addCondition')}
          </Button>
        </Stack>
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            {t('bom.then')}
          </Text>
          <Group grow align="flex-start">
            <Select
              label={t('bom.section')}
              clearable
              placeholder={t('bom.anySection')}
              data={[...DEFAULT_SECTIONS]}
              value={f.require.section ?? null}
              onChange={(s) => setF({ ...f, require: { ...f.require, section: s } })}
            />
            <TagsInput label={t('bom.keywords')} description={t('bom.keywordsHint')} value={f.require.keywords} onChange={(k) => setF({ ...f, require: { ...f.require, keywords: k } })} />
          </Group>
          <Checkbox label={t('bom.positiveCost')} checked={f.require.positiveCost ?? true} onChange={(e) => setF({ ...f, require: { ...f.require, positiveCost: e.currentTarget.checked } })} />
        </Stack>
        <Group grow align="flex-start">
          <TextInput label={t('bom.suggestion')} value={f.suggestion?.name ?? ''} onChange={(e) => setF({ ...f, suggestion: { name: e.currentTarget.value, section: f.suggestion?.section ?? null } })} />
          <TextInput label={t('bom.exception')} description={t('bom.exceptionHint')} value={f.exceptionLabel ?? ''} onChange={(e) => setF({ ...f, exceptionLabel: e.currentTarget.value })} />
        </Group>
        <Group justify="space-between">
          <Switch label={t('bom.active')} checked={f.active ?? true} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} />
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t('app.cancel')}
            </Button>
            <Button disabled={!valid} loading={m.isPending} onClick={save}>
              {t('app.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Baza wiedzy — reguły kompletności kosztorysu (W3). */
export function BomRulesTab() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const rules = useBomRules()
  const spec = useSpecLists()
  const m = useBomRuleMutation()
  const [edit, setEdit] = useState<{ rule: BomRuleDto | null } | null>(null)
  const editable = can('quoteKnowledge', 'edit')
  const specLabel = useMemo(() => {
    const map = new Map((spec.data?.[0]?.items ?? []).map((i) => [i.key, i.label]))
    return (k: string) => map.get(k) ?? k
  }, [spec.data])
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" c="dimmed" maw={760}>
          {t('bom.rulesHint')}
        </Text>
        {editable && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEdit({ rule: null })}>
            {t('bom.newRule')}
          </Button>
        )}
      </Group>
      <Table verticalSpacing={6} highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('bom.ruleName')}</Table.Th>
            <Table.Th>{t('bom.when')}</Table.Th>
            <Table.Th>{t('bom.then')}</Table.Th>
            <Table.Th w={40} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(rules.data ?? []).map((r) => (
            <Table.Tr key={r.id} style={{ opacity: r.active ? 1 : 0.5, cursor: editable ? 'pointer' : undefined }} onClick={() => editable && setEdit({ rule: r })} data-testid="bom-rule">
              <Table.Td>
                <Text size="sm" fw={500}>
                  {r.name}
                </Text>
                {!r.active && (
                  <Badge size="xs" color="gray">
                    {t('bom.inactive')}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="xs">{r.when.map((c) => conditionLabel(c, specLabel, t)).join(` ${t('bom.or')} `)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">
                  {r.require.section ?? t('bom.anySection')}: {r.require.keywords.join(', ')}
                  {r.exceptionLabel ? ` · ${t('bom.exception')}: ${r.exceptionLabel}` : ''}
                </Text>
              </Table.Td>
              <Table.Td onClick={(e) => e.stopPropagation()}>
                {editable && (
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" size="sm" aria-label="menu">
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => m.mutate({ method: 'PATCH', id: r.id, json: { active: !r.active } })}>{r.active ? t('bom.deactivate') : t('bom.activate')}</Menu.Item>
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() =>
                          modals.openConfirmModal({
                            title: t('bom.deleteConfirm', { name: r.name }),
                            labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
                            confirmProps: { color: 'red' },
                            onConfirm: () => m.mutate({ method: 'DELETE', id: r.id }),
                          })
                        }
                      >
                        {t('app.delete')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <RuleModal rule={edit?.rule ?? null} opened={!!edit} onClose={() => setEdit(null)} />
    </Stack>
  )
}
