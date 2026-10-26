import { describe, expect, it } from 'vitest'
import { HttpInfaktClient } from './client.ts'

const doc = (n: number) => ({ uuid: `u${n}`, kind: 'document_scan' })

/** Atrapa HTTP inFakt: `total` dokumentów, strony po `limit`. */
function fakeFetch(total: number | undefined, docs: number) {
  const calls: string[] = []
  const fn = (async (url: string, init: RequestInit) => {
    calls.push(url)
    expect((init.headers as Record<string, string>)['X-inFakt-ApiKey']).toBe('key')
    const q = new URL(url).searchParams
    const offset = Number(q.get('offset'))
    const limit = Number(q.get('limit'))
    const entities = Array.from({ length: Math.max(0, Math.min(limit, docs - offset)) }, (_, i) => doc(offset + i))
    return new Response(JSON.stringify({ entities, metainfo: total === undefined ? {} : { total_count: total } }), { status: 200 })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('HttpInfaktClient.listCosts', () => {
  it('filtruje po dacie dodania i pobiera wszystkie strony (równolegle po pierwszej)', async () => {
    const f = fakeFetch(250, 250)
    const list = await new HttpInfaktClient('key', f.fn).listCosts('2026-01-01')
    expect(list).toHaveLength(250)
    expect(f.calls).toHaveLength(3)
    expect(new URL(f.calls[0]!).searchParams.get('q[created_at_gteq]')).toBe('2026-01-01')
  })

  it('bez total_count — po kolei do niepełnej strony', async () => {
    const f = fakeFetch(undefined, 130)
    expect(await new HttpInfaktClient('key', f.fn).listCosts('2026-01-01')).toHaveLength(130)
    expect(f.calls).toHaveLength(2)
  })

  it('błąd HTTP → InfaktError ze statusem', async () => {
    const fn = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(new HttpInfaktClient('key', fn).listCosts('2026-01-01')).rejects.toMatchObject({ status: 401 })
  })
})
