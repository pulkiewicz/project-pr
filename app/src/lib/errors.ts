import i18n from '../i18n'
import { ApiError } from './api'

/** Tekst błędu do powiadomienia: klucz `errors.<code>` lub komunikat ogólny. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.code) {
    const key = e.code.startsWith('validation.') ? e.code : `errors.${e.code}`
    if (i18n.exists(key)) return i18n.t(key)
  }
  return i18n.t('auth.genericError')
}
