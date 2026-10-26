import { Alert, Button, Code, Stack } from '@mantine/core'
import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

function Fallback({ error }: { error: Error }) {
  const { t } = useTranslation()
  return (
    <Alert color="red" title={t('app.errorTitle')} maw={640}>
      <Stack gap="sm">
        {t('app.errorHint')}
        <Code block>{error.message}</Code>
        <Button w="fit-content" onClick={() => window.location.reload()}>
          {t('app.refresh')}
        </Button>
      </Stack>
    </Alert>
  )
}

/** Błąd renderowania strony pokazuje komunikat zamiast białego ekranu; `resetKey` (adres) czyści błąd przy nawigacji. */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  override state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  override render() {
    return this.state.error ? <Fallback error={this.state.error} /> : this.props.children
  }
}
