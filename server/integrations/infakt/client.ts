import { InfaktError, type InfaktAttachment, type InfaktClient, type InfaktCost } from './types.ts'

const BASE = 'https://api.infakt.pl/api/v3'
const PAGE = 100
/** Zabezpieczenie przed pętlą (10 000 dokumentów na jedną synchronizację). */
const MAX_PAGES = 100

export class HttpInfaktClient implements InfaktClient {
  readonly fake = false

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${BASE}${path}`, { headers: { 'X-inFakt-ApiKey': this.apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    } catch (e) {
      throw new InfaktError(0, e instanceof Error ? e.message : String(e))
    }
    if (!res.ok) throw new InfaktError(res.status, `inFakt HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    return (await res.json()) as T
  }

  async listCosts(issueDateFrom: string): Promise<InfaktCost[]> {
    const out: InfaktCost[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE), order: 'issue_date desc', 'q[issue_date_gteq]': issueDateFrom })
      const body = await this.get<{ entities?: InfaktCost[]; metainfo?: { total_count?: number } }>(`/documents/costs.json?${q}`)
      const batch = body.entities ?? []
      out.push(...batch)
      const total = body.metainfo?.total_count
      if (batch.length < PAGE || (total !== undefined && out.length >= total)) break
    }
    return out
  }

  async costAttachments(uuid: string): Promise<InfaktAttachment[]> {
    const body = await this.get<{ attachments?: InfaktAttachment[] | null }>(`/documents/costs/${encodeURIComponent(uuid)}.json`)
    return (body.attachments ?? []).map((a) => ({ file_name: a.file_name, file_url: a.file_url }))
  }
}
