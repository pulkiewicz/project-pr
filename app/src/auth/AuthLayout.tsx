import { Center, Image, Paper, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Center mih="100vh" bg="gray.0" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={420}>
        <Stack gap="md">
          <Stack gap={4} align="center">
            <Image src="/logo-envcheck.svg" w={48} h={48} alt="Envcheck" />
            <Text fw={600} c="navy.7">
              {t('app.name')}
            </Text>
          </Stack>
          <Title order={3} ta="center">
            {title}
          </Title>
          {children}
        </Stack>
      </Paper>
    </Center>
  )
}
