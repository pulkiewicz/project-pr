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

/** Faktura sprzedażowa z inFakt API v3 (`/invoices.json`); kwoty w groszach. */
export interface InfaktSalesInvoice {
  uuid: string
  kind: string | null
  number: string | null
  status: string | null
  invoice_date: string | null
  sale_date: string | null
  payment_date: string | null
  currency: string | null
  net_price: number | null
  gross_price: number | null
  tax_price: number | null
  paid_price: number | null
  client_company_name: string | null
  client_first_name: string | null
  client_last_name: string | null
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
  /** Faktury sprzedażowe wystawione od `issuedFrom` (yyyy-MM-dd); wymaga uprawnienia klucza `api:invoices:read`. */
  listSalesInvoices(issuedFrom: string): Promise<InfaktSalesInvoice[]>
  costAttachments(uuid: string): Promise<InfaktAttachment[]>
  /** Treść pliku z `file_url` (do podglądu w aplikacji). */
  downloadAttachment(url: string): Promise<{ body: ArrayBuffer; type: string }>
}

export class InfaktError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
