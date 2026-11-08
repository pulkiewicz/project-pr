import { InfaktError, type InfaktAttachment, type InfaktClient, type InfaktCost, type InfaktSalesInvoice } from './types.ts'

const BASE = 'https://api.infakt.pl/api/v3'
const PAGE = 100
/** Zabezpieczenie przed pętlą (10 000 dokumentów na jedną synchronizację). */
const MAX_PAGES = 100
const PARALLEL = 5

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

  /** Strona listy `path` (koszty / faktury) z filtrem `filter` (np. `q[created_at_gteq]`). */
  private page<T>(path: string, order: string, filter: Record<string, string>, page: number) {
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE), order, ...filter })
    return this.get<{ entities?: T[]; metainfo?: { total_count?: number } }>(`${path}?${q}`)
  }

  /** Pierwsza strona podaje `total_count`; pozostałe pobierane równolegle (limit czasu funkcji Netlify ~10 s). */
  private async listAll<T extends { uuid: string }>(path: string, order: string, filter: Record<string, string>): Promise<T[]> {
    const first = await this.page<T>(path, order, filter, 0)
    const out = [...(first.entities ?? [])]
    const total = first.metainfo?.total_count
    if (total === undefined) {
      // Bez licznika: stronicowanie po kolei, aż do niepełnej strony.
      for (let page = 1, last = out.length; last === PAGE && page < MAX_PAGES; page++) {
        const batch = (await this.page<T>(path, order, filter, page)).entities ?? []
        out.push(...batch)
        last = batch.length
      }
      return out
    }
    const pages = Math.min(Math.ceil(total / PAGE), MAX_PAGES)
    for (let start = 1; start < pages; start += PARALLEL) {
      const chunk = Array.from({ length: Math.min(PARALLEL, pages - start) }, (_, i) => this.page<T>(path, order, filter, start + i))
      for (const body of await Promise.all(chunk)) out.push(...(body.entities ?? []))
    }
    // Dokument dodany w trakcie pobierania może przesunąć stronicowanie — bez duplikatów.
    return [...new Map(out.map((c) => [c.uuid, c])).values()]
  }

  listCosts(addedFrom: string): Promise<InfaktCost[]> {
    return this.listAll<InfaktCost>('/documents/costs.json', 'created_at desc', { 'q[created_at_gteq]': addedFrom })
  }

  listSalesInvoices(issuedFrom: string): Promise<InfaktSalesInvoice[]> {
    return this.listAll<InfaktSalesInvoice>('/invoices.json', 'invoice_date desc', { 'q[invoice_date_gteq]': issuedFrom })
  }

  async costAttachments(uuid: string): Promise<InfaktAttachment[]> {
    const body = await this.get<{ attachments?: InfaktAttachment[] | null }>(`/documents/costs/${encodeURIComponent(uuid)}.json`)
    return (body.attachments ?? []).map((a) => ({ file_name: a.file_name, file_url: a.file_url }))
  }

  /** Klucz API dołączany tylko dla hostów inFakt (link może też wskazywać podpisany adres magazynu plików). */
  async downloadAttachment(url: string): Promise<{ body: ArrayBuffer; type: string }> {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      throw new InfaktError(0, 'invalid attachment url')
    }
    if (u.protocol !== 'https:') throw new InfaktError(0, 'attachment url must be https')
    const infaktHost = u.hostname === 'infakt.pl' || u.hostname.endsWith('.infakt.pl')
    let res: Response
    try {
      res = await this.fetchFn(u, { headers: infaktHost ? { 'X-inFakt-ApiKey': this.apiKey } : {}, redirect: 'follow', signal: AbortSignal.timeout(15000) })
    } catch (e) {
      throw new InfaktError(0, e instanceof Error ? e.message : String(e))
    }
    if (!res.ok) throw new InfaktError(res.status, `inFakt file HTTP ${res.status}`)
    return { body: await res.arrayBuffer(), type: res.headers.get('content-type') ?? '' }
  }
}
