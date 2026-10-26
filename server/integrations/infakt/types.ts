/** Dokument kosztowy z inFakt API v3 (`/documents/costs.json`); kwoty w groszach. */
export interface InfaktCost {
  uuid: string
  kind: string
  number: string | null
  seller_name: string | null
  description: string | null
  category: string | null
  issue_date: string | null
  due_date: string | null
  currency: string | null
  net_price: number | null
  gross_price: number | null
  tax_price: number | null
  created_at: string | null
  statuses?: { symbol: string; name: string; group: string }[]
}

export interface InfaktAttachment {
  file_name: string
  file_url: string
}

/** Operacje inFakt używane przez aplikację (klucz API z uprawnieniem `api:costs:read`). */
export interface InfaktClient {
  readonly fake: boolean
  /**
   * Wszystkie dokumenty kosztowe dodane do inFakt od `addedFrom` (yyyy-MM-dd); stronicowanie po stronie klienta.
   * Filtr po dacie dodania, nie wystawienia — pliki (`document_scan`) zwykle nie mają daty wystawienia.
   */
  listCosts(addedFrom: string): Promise<InfaktCost[]>
  costAttachments(uuid: string): Promise<InfaktAttachment[]>
}

export class InfaktError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
