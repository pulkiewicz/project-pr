import { createTheme, type MantineColorsTuple } from '@mantine/core'

// Granat Envcheck #1F3A5F jako odcień 7 (domyślny primaryShade dla jasnego motywu to 6 → ustawiamy 7).
const navy: MantineColorsTuple = [
  '#eef3f9',
  '#dbe3ee',
  '#b3c4dc',
  '#88a3c9',
  '#6487b9',
  '#4d75af',
  '#406cab',
  '#1F3A5F',
  '#183050',
  '#0f2540',
]

export const theme = createTheme({
  primaryColor: 'navy',
  primaryShade: 7,
  colors: { navy },
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'sm',
})

/** Kolory statusów (sekcja 11): zielony / żółty / czerwony / szary. */
export const STATUS_COLORS = { ok: 'green', warn: 'yellow', bad: 'red', neutral: 'gray' } as const
