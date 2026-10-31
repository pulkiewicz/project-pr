import { Alert, Tabs, Title } from '@mantine/core'
import { IconSum, IconTable, IconUsers } from '@tabler/icons-react'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { todayWarsaw } from '../../lib/format'
import { EmployeesTab } from './panel/EmployeesTab'
import { ReportTab } from './panel/ReportTab'
import { SummaryTab } from './panel/SummaryTab'

/** Zarząd → Czas pracy: panel ewidencji przeniesiony z workload-calendar (`/admin`). */
export function TimesheetsPage() {
  const { can } = useAuth()
  const canEdit = can('timesheets', 'edit')
  const currentMonth = todayWarsaw().slice(0, 7)
  const [tab, setTab] = useState<string | null>('podsumowanie')
  return (
    <div>
      <Title order={2} mb="md">
        Czas pracy
      </Title>
      {!canEdit && (
        <Alert color="blue" mb="md">
          Twoje konto ma dostęp tylko do przeglądania. Zestawienia i eksporty działają normalnie, ale nie możesz zmieniać danych pracowników.
        </Alert>
      )}
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="podsumowanie" leftSection={<IconSum size={16} />}>
            Podsumowanie
          </Tabs.Tab>
          <Tabs.Tab value="zestawienie" leftSection={<IconTable size={16} />}>
            Zestawienie miesięczne
          </Tabs.Tab>
          <Tabs.Tab value="pracownicy" leftSection={<IconUsers size={16} />}>
            Pracownicy
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="podsumowanie">
          <SummaryTab currentMonth={currentMonth} />
        </Tabs.Panel>
        <Tabs.Panel value="zestawienie">
          <ReportTab currentMonth={currentMonth} />
        </Tabs.Panel>
        <Tabs.Panel value="pracownicy">
          <EmployeesTab canEdit={canEdit} />
        </Tabs.Panel>
      </Tabs>
    </div>
  )
}
