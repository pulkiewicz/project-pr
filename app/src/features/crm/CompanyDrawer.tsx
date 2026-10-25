import { ActionIcon, Anchor, Button, Divider, Drawer, Group, Loader, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { IconCloudDownload, IconPencil, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CompanyInput, ContactDto, ContactInput } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatPLNWhole } from '../../lib/format'
import { lookupNip, useCompany, useDeleteCompany, useDeleteContact, useSaveCompany, useSaveContact } from './api'
import { NoResponseBadge, StageBadge } from './stage'

const EMPTY: CompanyInput = { name: '' }

function ContactForm({ companyId, contact, onDone }: { companyId: string; contact: ContactDto | null; onDone: () => void }) {
  const { t } = useTranslation()
  const save = useSaveContact()
  const [f, setF] = useState<ContactInput>(contact ? { name: contact.name, position: contact.position, email: contact.email, phone: contact.phone } : { name: '' })
  const text = (k: keyof ContactInput, label: string) => (
    <TextInput label={label} size="xs" value={(f[k] as string | null | undefined) ?? ''} onChange={(e) => setF({ ...f, [k]: e.currentTarget.value || null })} />
  )
  return (
    <Stack gap={6} p="xs" bg="gray.0" style={{ borderRadius: 8 }}>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <TextInput label={t('crm.name')} size="xs" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
        {text('position', t('crm.position'))}
        {text('email', t('crm.email'))}
        {text('phone', t('crm.phone'))}
      </SimpleGrid>
      <Group justify="flex-end" gap="xs">
        <Button size="xs" variant="default" onClick={onDone}>
          {t('app.cancel')}
        </Button>
        <Button
          size="xs"
          disabled={!f.name.trim()}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { companyId, id: contact?.id, version: contact?.version, data: f },
              { onSuccess: onDone, onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }) },
            )
          }
        >
          {t('app.save')}
        </Button>
      </Group>
    </Stack>
  )
}

/** Karta firmy: dane (z pobraniem po NIP z białej listy VAT), kontakty, szanse. */
export function CompanyDrawer({ id, opened, onClose, onOpenOpportunity }: { id: string | null; opened: boolean; onClose: () => void; onOpenOpportunity: (id: string) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const detail = useCompany(opened ? id : null)
  const save = useSaveCompany()
  const del = useDeleteCompany()
  const delContact = useDeleteContact()
  const [f, setF] = useState<CompanyInput>(EMPTY)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [contactEdit, setContactEdit] = useState<ContactDto | 'new' | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(id)
  const c = currentId ? detail.data : undefined

  useEffect(() => {
    if (!opened) return
    setCurrentId(id)
    setContactEdit(null)
    if (!id) setF(EMPTY)
  }, [opened, id])

  useEffect(() => {
    if (c) setF({ name: c.name, nip: c.nip, regon: c.regon, address: c.address, website: c.website, industry: c.industry, notes: c.notes })
  }, [c?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const editable = currentId ? can('crm', 'edit') : can('crm', 'create')
  const text = (k: keyof CompanyInput, label: string) => (
    <TextInput label={label} disabled={!editable} value={(f[k] as string | null | undefined) ?? ''} onChange={(e) => setF({ ...f, [k]: e.currentTarget.value || null })} />
  )

  const fetchNip = async () => {
    if (!f.nip) return
    setLookupBusy(true)
    try {
      const r = await lookupNip(f.nip)
      setF((prev) => ({ ...prev, nip: r.nip, name: prev.name || r.name, regon: r.regon ?? prev.regon, address: r.address ?? prev.address }))
      notifications.show({ color: r.existingCompanyId && r.existingCompanyId !== currentId ? 'yellow' : 'green', message: r.existingCompanyId && r.existingCompanyId !== currentId ? t('crm.nipExisting') : `${t('crm.nipFound')}: ${r.name}` })
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(e) })
    } finally {
      setLookupBusy(false)
    }
  }

  const confirmDelete = (name: string, run: () => void) =>
    modals.openConfirmModal({
      title: t('crm.deleteConfirm', { name }),
      labels: { confirm: t('app.yes'), cancel: t('app.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: run,
    })

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="xl" title={c ? c.name : t('crm.addCompany')}>
      {currentId && !c ? (
        <Loader />
      ) : (
        <Stack gap="sm">
          <Group align="flex-end" gap="xs" wrap="nowrap">
            <TextInput label={t('crm.nip')} disabled={!editable} value={f.nip ?? ''} onChange={(e) => setF({ ...f, nip: e.currentTarget.value || null })} style={{ flex: 1 }} />
            {editable && (
              <Tooltip label={t('crm.nipLookup')}>
                <ActionIcon size="lg" variant="light" onClick={() => void fetchNip()} loading={lookupBusy} disabled={!f.nip} aria-label={t('crm.nipLookup')}>
                  <IconCloudDownload size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          <TextInput label={t('crm.name')} required disabled={!editable} value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {text('regon', t('crm.regon'))}
            {text('industry', t('crm.industry'))}
            {text('address', t('crm.address'))}
            {text('website', t('crm.website'))}
          </SimpleGrid>
          <Textarea label={t('crm.notes')} autosize minRows={2} disabled={!editable} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.currentTarget.value || null })} />
          <Group justify="space-between">
            {c && can('crm', 'delete') ? (
              <Button
                variant="subtle"
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() =>
                  confirmDelete(c.name, () =>
                    del.mutate(c.id, {
                      onSuccess: () => {
                        notifications.show({ color: 'green', message: t('crm.deleted') })
                        onClose()
                      },
                      onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                    }),
                  )
                }
              >
                {t('app.delete')}
              </Button>
            ) : (
              <span />
            )}
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                {t('app.close')}
              </Button>
              {editable && (
                <Button
                  loading={save.isPending}
                  disabled={!f.name.trim()}
                  onClick={() =>
                    save.mutate(
                      { id: currentId ?? undefined, version: c?.version, data: f },
                      {
                        onSuccess: (r) => {
                          notifications.show({ color: 'green', message: t('app.saved') })
                          if (!currentId) setCurrentId(r.id)
                        },
                        onError: (e) => notifications.show({ color: 'red', message: errorMessage(e) }),
                      },
                    )
                  }
                >
                  {t('app.save')}
                </Button>
              )}
            </Group>
          </Group>

          {c && (
            <>
              <Divider label={t('crm.contacts')} labelPosition="left" />
              {c.contacts.length === 0 && contactEdit !== 'new' && (
                <Text size="sm" c="dimmed">
                  {t('crm.noContacts')}
                </Text>
              )}
              {c.contacts.map((ct) =>
                contactEdit !== 'new' && contactEdit?.id === ct.id ? (
                  <ContactForm key={ct.id} companyId={c.id} contact={ct} onDone={() => setContactEdit(null)} />
                ) : (
                  <Group key={ct.id} justify="space-between" wrap="nowrap">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={500}>
                        {ct.name}
                        {ct.position && (
                          <Text span c="dimmed" size="sm">
                            {' '}
                            · {ct.position}
                          </Text>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[ct.email && <Anchor key="e" size="xs" href={`mailto:${ct.email}`}>{ct.email}</Anchor>, ct.phone].filter(Boolean).map((x, i) => (
                          <span key={i}>
                            {i > 0 && ' · '}
                            {x}
                          </span>
                        ))}
                      </Text>
                    </Stack>
                    {can('crm', 'edit') && (
                      <Group gap={2} wrap="nowrap">
                        <ActionIcon variant="subtle" size="sm" onClick={() => setContactEdit(ct)} aria-label={t('app.edit')}>
                          <IconPencil size={14} />
                        </ActionIcon>
                        {can('crm', 'delete') && (
                          <ActionIcon variant="subtle" color="red" size="sm" onClick={() => confirmDelete(ct.name, () => delContact.mutate(ct.id))} aria-label={t('app.delete')}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Group>
                    )}
                  </Group>
                ),
              )}
              {contactEdit === 'new' ? (
                <ContactForm companyId={c.id} contact={null} onDone={() => setContactEdit(null)} />
              ) : (
                can('crm', 'create') && (
                  <Button size="xs" variant="light" w="fit-content" onClick={() => setContactEdit('new')}>
                    {t('crm.addContact')}
                  </Button>
                )
              )}

              <Divider label={t('crm.opportunities')} labelPosition="left" />
              {c.opportunities.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t('crm.noOpportunities')}
                </Text>
              ) : (
                <Table highlightOnHover>
                  <Table.Tbody>
                    {c.opportunities.map((o) => (
                      <Table.Tr key={o.id} onClick={() => onOpenOpportunity(o.id)} style={{ cursor: 'pointer' }}>
                        <Table.Td w={80} fw={600}>
                          {o.code}
                        </Table.Td>
                        <Table.Td>{o.name}</Table.Td>
                        <Table.Td w={140}>
                          <Group gap={4} wrap="nowrap">
                            <StageBadge stage={o.stage} />
                            {o.noResponse && <NoResponseBadge />}
                          </Group>
                        </Table.Td>
                        <Table.Td w={110} ta="right">
                          {o.value != null ? formatPLNWhole(o.value) : ''}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </>
          )}
        </Stack>
      )}
    </Drawer>
  )
}
