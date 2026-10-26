import { InfaktError, type InfaktAttachment, type InfaktClient, type InfaktCost } from './types.ts'

const cost = (n: number, over: Partial<InfaktCost> = {}): InfaktCost => ({
  uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind: 'cost',
  number: `FV/${n}/10/2026`,
  seller_name: ['Danfoss Sp. z o.o.', 'Bitzer Polska', 'Wurth Polska', 'Orlen S.A.'][n % 4]!,
  description: null,
  category: 'Zakup towarów',
  issue_date: `2026-10-${String((n % 25) + 1).padStart(2, '0')}`,
  due_date: `2026-11-${String((n % 25) + 1).padStart(2, '0')}`,
  currency: 'PLN',
  net_price: 100000 * n + 1234,
  gross_price: Math.round((100000 * n + 1234) * 1.23),
  tax_price: Math.round((100000 * n + 1234) * 0.23),
  created_at: '2026-10-20T10:00:00.000+02:00',
  statuses: [{ symbol: n % 2 ? 'paid' : 'unpaid', name: n % 2 ? 'Zapłacono' : 'Nie zapłacono', group: 'payment' }],
  ...over,
})

/** Atrapa inFakt (testy i lokalny dev bez klucza): kilka kosztów + składka ZUS, która ma zostać pominięta. */
export class FakeInfaktClient implements InfaktClient {
  readonly fake = true
  costs: InfaktCost[] = [
    cost(1),
    cost(2),
    cost(3, { kind: 'document_scan', net_price: null, gross_price: null, tax_price: null, number: null, seller_name: null, description: 'skan.pdf' }),
    cost(4, { currency: 'EUR' }),
    cost(5, { kind: 'health_fee_evidence', seller_name: null, description: 'Składka zdrowotna' }),
  ]
  calls: string[] = []
  fail = false

  async listCosts(issueDateFrom: string) {
    this.calls.push(`list:${issueDateFrom}`)
    if (this.fail) throw new InfaktError(503, 'infakt down')
    return this.costs.filter((c) => !c.issue_date || c.issue_date >= issueDateFrom).map((c) => structuredClone(c))
  }

  async costAttachments(uuid: string): Promise<InfaktAttachment[]> {
    return [{ file_name: `${uuid.slice(-4)}.pdf`, file_url: `https://app.infakt.pl/app/twoja-faktura/${uuid}` }]
  }
}
