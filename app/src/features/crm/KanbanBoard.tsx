import { ActionIcon, Badge, Box, Card, Group, Menu, ScrollArea, Stack, Text } from '@mantine/core'
import { IconDots } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OPPORTUNITY_STAGES, type OpportunityDto, type OpportunityStage } from '#shared'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatPLNWhole } from '../../lib/format'
import { NoResponseBadge, STAGE_COLOR, useStageChange } from './stage'

const DRAG_TYPE = 'application/x-envcheck-opportunity'

function OpportunityCard({ o, canMove, onOpen, onMove }: { o: OpportunityDto; canMove: boolean; onOpen: () => void; onMove: (s: OpportunityStage) => void }) {
  const { t } = useTranslation()
  return (
    <Card
      withBorder
      padding="xs"
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, o.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      style={{ cursor: canMove ? 'grab' : 'pointer' }}
      data-testid={`kanban-card-${o.code}`}
    >
      <Group justify="space-between" wrap="nowrap" gap={4}>
        <Text size="xs" fw={700} c="dimmed">
          {o.code}
        </Text>
        <Group gap={4} wrap="nowrap">
          {o.noResponse && <NoResponseBadge />}
          {canMove && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" size="xs" onClick={(e) => e.stopPropagation()} aria-label={t('crm.moveTo')}>
                  <IconDots size={14} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                <Menu.Label>{t('crm.moveTo')}</Menu.Label>
                {OPPORTUNITY_STAGES.filter((s) => s !== o.stage).map((s) => (
                  <Menu.Item key={s} onClick={() => onMove(s)}>
                    {t(`crm.stage.${s}`)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>
      <Text size="sm" fw={500} lineClamp={2}>
        {o.name}
      </Text>
      {o.companyName && (
        <Text size="xs" c="dimmed" truncate>
          {o.companyName}
        </Text>
      )}
      <Group justify="space-between" mt={4} gap={4}>
        <Text size="xs" fw={500}>
          {o.value != null ? formatPLNWhole(o.value) : ''}
        </Text>
        {o.submissionDeadline && (
          <Text size="xs" c="dimmed">
            {formatDate(o.submissionDeadline)}
          </Text>
        )}
      </Group>
      {(o.ownerName || o.projectCode) && (
        <Group justify="space-between" gap={4}>
          <Text size="xs" c="dimmed" truncate>
            {o.ownerName ?? ''}
          </Text>
          {o.projectCode && (
            <Badge size="xs" variant="light" color="green">
              {o.projectCode}
            </Badge>
          )}
        </Group>
      )}
    </Card>
  )
}

export function KanbanBoard({ items, onOpen }: { items: OpportunityDto[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const [changeStage, lossModal] = useStageChange()
  const [over, setOver] = useState<OpportunityStage | null>(null)
  const canMove = can('crm', 'edit')
  const byId = new Map(items.map((o) => [o.id, o]))

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <Group align="flex-start" wrap="nowrap" gap="sm" pb="sm">
        {OPPORTUNITY_STAGES.map((stage) => {
          const col = items.filter((o) => o.stage === stage)
          const sum = col.reduce((s, o) => s + (o.value ?? 0), 0)
          return (
            <Box
              key={stage}
              w={250}
              miw={250}
              p={6}
              bg={over === stage ? `${STAGE_COLOR[stage]}.0` : 'gray.0'}
              style={{ borderRadius: 8, borderTop: `3px solid var(--mantine-color-${STAGE_COLOR[stage]}-5)` }}
              onDragOver={(e) => {
                if (!canMove || !e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                setOver(stage)
              }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                setOver(null)
                const o = byId.get(e.dataTransfer.getData(DRAG_TYPE))
                if (o) changeStage(o, stage)
              }}
              data-testid={`kanban-col-${stage}`}
            >
              <Group justify="space-between" mb={6} px={2}>
                <Text size="sm" fw={600}>
                  {t(`crm.stage.${stage}`)} <Text span c="dimmed" size="sm">({col.length})</Text>
                </Text>
                {sum > 0 && (
                  <Text size="xs" c="dimmed">
                    {formatPLNWhole(sum)}
                  </Text>
                )}
              </Group>
              <Stack gap={6} mih={60}>
                {col.map((o) => (
                  <OpportunityCard key={o.id} o={o} canMove={canMove} onOpen={() => onOpen(o.id)} onMove={(s) => changeStage(o, s)} />
                ))}
              </Stack>
            </Box>
          )
        })}
      </Group>
      {lossModal}
    </ScrollArea>
  )
}
