import { Paper, TypographyStylesProvider } from '@mantine/core'
import { marked } from 'marked'
import { useMemo } from 'react'
import source from '../../help/zarzad.md?raw'

/**
 * Pomoc dla Zarządu (pracownicy, pojazdy, czas pracy, faktury i wyciągi) — treść w `app/src/help/zarzad.md`.
 * Plik jest częścią aplikacji (nie treścią od użytkowników), więc HTML z markdownu wstawiamy bezpośrednio.
 */
export function ManagementHelpPage() {
  const html = useMemo(() => marked.parse(source, { async: false, gfm: true }), [])
  return (
    <Paper withBorder p="lg" maw={980}>
      <TypographyStylesProvider>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </TypographyStylesProvider>
    </Paper>
  )
}
