import i18n from '../i18n'
import { ApiError } from './api'

/** Tekst błędu: tłumaczenie kodu; w przeciwnym razie status HTTP i kod (do zgłoszenia), nigdy anonimowy komunikat. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code) {
      const key = e.code.startsWith('validation.') ? e.code : `errors.${e.code}`
      if (i18n.exists(key)) {
        const issues = e.problem.issues as { path: string; message: string }[] | undefined
        const detail = e.code === 'validation_failed' && issues?.length ? `: ${issues.map((i) => i.path).join(', ')}` : ''
        return i18n.t(key) + detail
      }
    }
    return i18n.t('errors.unknown', { status: e.status, code: e.code ?? '' })
  }
  console.error(e)
  return i18n.t('errors.unknown', { status: 'JS', code: e instanceof Error ? e.message : String(e) })
}
