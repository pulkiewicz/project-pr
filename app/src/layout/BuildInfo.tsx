import { Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '../lib/format'

/** Data i commit buildu — do weryfikacji, którą wersję widzi użytkownik. */
export function BuildInfo({ fixed = false }: { fixed?: boolean }) {
  const { t } = useTranslation()
  const commit = __BUILD_COMMIT__ ? ` · ${__BUILD_COMMIT__}` : ''
  const text = t('app.build', { date: formatDateTime(__BUILD_TIME__), commit })
  return (
    <Tooltip label={__BUILD_TIME__}>
      <Text
        size="xs"
        c="dimmed"
        data-testid="build-info"
        style={{ whiteSpace: 'nowrap', ...(fixed ? { position: 'fixed', top: 8, right: 12, zIndex: 10 } : {}) }}
      >
        {text}
      </Text>
    </Tooltip>
  )
}
