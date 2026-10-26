import { InfaktError, type InfaktAttachment, type InfaktClient, type InfaktCost } from './types.ts'

/** Plik kosztowy z kwotami odczytanymi przez inFakt (jak w Envcheck: faktury jako pliki, księgowanie poza inFakt). */
const cost = (n: number, over: Partial<InfaktCost> = {}): InfaktCost => ({
  uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind: 'document_scan',
  number: `FV/${n}/10/2026`,
  seller_name: ['Danfoss Sp. z o.o.', 'Bitzer Polska', 'Wurth Polska', 'Orlen S.A.'][n % 4]!,
  description: null,
  category: null,
  // Pliki zwykle nie mają daty wystawienia — tylko datę dodania.
  issue_date: null,
  due_date: `2026-11-${String((n % 25) + 1).padStart(2, '0')}`,
  currency: 'PLN',
  net_price: 100000 * n + 1234,
  gross_price: Math.round((100000 * n + 1234) * 1.23),
  tax_price: Math.round((100000 * n + 1234) * 0.23),
  created_at: `2026-10-${String((n % 25) + 1).padStart(2, '0')}T10:00:00.000+02:00`,
  statuses: [{ symbol: 'cost_not_accounted', name: 'Nie zaksięgowano', group: 'cost_accounting' }],
  ...over,
})

/**
 * Atrapa inFakt (testy i lokalny dev bez klucza): pliki kosztowe (jeden bez odczytanych danych), zaksięgowany koszt
 * i składka ZUS, która ma zostać pominięta.
 */
export class FakeInfaktClient implements InfaktClient {
  readonly fake = true
  costs: InfaktCost[] = [
    cost(1),
    cost(2),
    cost(3, { net_price: null, gross_price: null, tax_price: null, number: null, seller_name: null, due_date: null }),
    cost(4, { currency: 'EUR' }),
    cost(5, { kind: 'health_fee_evidence', seller_name: null, description: 'Składka zdrowotna' }),
    cost(6, { kind: 'cost', issue_date: '2026-10-06', category: 'Zakup towarów' }),
    cost(7, { created_at: '2025-12-30T10:00:00.000+01:00' }),
    // Jak w prawdziwym inFakt: puste napisy zamiast null, kwota jako tekst.
    cost(8, { number: '', seller_name: ' ', due_date: '', issue_date: '', currency: '', net_price: '12345' as unknown as number, gross_price: null, tax_price: null }),
  ]
  calls: string[] = []
  fail = false

  async listCosts(addedFrom: string) {
    this.calls.push(`list:${addedFrom}`)
    if (this.fail) throw new InfaktError(503, 'infakt down')
    return this.costs.filter((c) => !c.created_at || c.created_at.slice(0, 10) >= addedFrom).map((c) => structuredClone(c))
  }

  async costAttachments(uuid: string): Promise<InfaktAttachment[]> {
    return [{ file_name: `${uuid.slice(-4)}.pdf`, file_url: `https://app.infakt.pl/app/twoja-faktura/${uuid}` }]
  }
}
