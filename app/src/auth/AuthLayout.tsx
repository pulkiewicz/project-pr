import { Center, Image, Paper, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BuildInfo } from '../layout/BuildInfo'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Center mih="100vh" bg="gray.0" p="md">
      <BuildInfo fixed />
      <Paper withBorder shadow="sm" w="100%" maw={440} style={{ overflow: 'hidden' }}>
        <Image src="/brand/envcheck-logo.png" alt="Envcheck — reliability delivered" w="100%" />
        <Stack gap="md" p="xl">
          <Text fw={600} c="navy.7" ta="center" size="sm" tt="uppercase" style={{ letterSpacing: 1 }}>
            {t('app.name')}
          </Text>
          <Title order={3} ta="center">
            {title}
          </Title>
          {children}
        </Stack>
      </Paper>
    </Center>
  )
}
