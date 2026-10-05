import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import pl from './pl.json'

void i18n.use(initReactI18next).init({
  resources: { pl: { translation: pl } },
  lng: 'pl',
  fallbackLng: 'pl',
  interpolation: { escapeValue: false },
})

export default i18n
