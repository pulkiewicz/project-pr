import { normalizeNip, type NipLookupResult } from '#shared'
import { HttpProblem } from '../../lib/problem.ts'

/** Wykaz podatników VAT („biała lista”) Ministerstwa Finansów — publiczne API bez klucza. */
const WL_API = 'https://wl-api.mf.gov.pl/api/search/nip'

interface WlSubject {
  name?: string
  nip?: string
  regon?: string | null
  statusVat?: string | null
  workingAddress?: string | null
  residenceAddress?: string | null
}

/** Dane firmy po NIP; null = brak w wykazie. Błąd usługi → 502 (formularz działa dalej ręcznie). */
export async function lookupNip(fetchFn: typeof fetch, rawNip: string, today: string): Promise<NipLookupResult | null> {
  const nip = normalizeNip(rawNip)
  if (!nip) throw new HttpProblem(422, 'validation.nip')
  let res: Response
  try {
    res = await fetchFn(`${WL_API}/${nip}?date=${today}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
  } catch (e) {
    throw new HttpProblem(502, 'nip_lookup_failed', e instanceof Error ? e.message.slice(0, 200) : undefined)
  }
  if (res.status === 400 || res.status === 404) return null
  if (!res.ok) throw new HttpProblem(502, 'nip_lookup_failed', `HTTP ${res.status}`)
  const body = (await res.json()) as { result?: { subject?: WlSubject | null } }
  const s = body.result?.subject
  if (!s?.name) return null
  return {
    nip,
    name: s.name,
    regon: s.regon ?? null,
    address: s.workingAddress ?? s.residenceAddress ?? null,
    vatStatus: s.statusVat ?? null,
  }
}
