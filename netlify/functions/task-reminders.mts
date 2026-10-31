import type { Config } from '@netlify/functions'
import { isReminderHour, sendTaskReminders } from '../../server/modules/reminders/service.ts'
import { env } from '../../server/lib/env.ts'
import { runtimeDeps } from '../../server/runtime.ts'

/** Codzienne przypomnienia e-mail o przypisanych zadaniach HRF (dni robocze, 7:00 w Warszawie). */
export default async () => {
  const now = new Date()
  // Harmonogram w UTC: 5:00 (czas letni) i 6:00 (zimowy) — wysyłka tylko w uruchomieniu, które wypada o 7:00 lokalnie.
  if (!isReminderHour(now)) return
  const deps = runtimeDeps()
  // URL — główny adres strony ustawiany przez Netlify; APP_URL pozwala go nadpisać (np. własna domena).
  const appUrl = env('APP_URL') ?? env('URL') ?? 'https://project-pitr.netlify.app'
  const result = await sendTaskReminders(deps, now, appUrl)
  console.log(`[pmo] task reminders: ${JSON.stringify(result)}`)
}

export const config: Config = { schedule: '0 5,6 * * 1-5' }
