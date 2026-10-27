import { describe, expect, it } from 'vitest'
import { refreshingSourceOptions, type RefreshStats } from '@/lib/editor/refreshing-source'

const data = new Uint8Array(1000).map((_, i) => i % 251)
const rangeFetch = (valid: () => string) => (async (u: string, i?: RequestInit) => {
  if (!String(u).includes(valid())) return new Response('', { status: 403 })
  const m = /bytes=(\d+)-(\d+)/.exec(String((i?.headers as Record<string, string>).Range))!
  const a = Number(m[1]), b = Number(m[2])
  return new Response(data.slice(a, b + 1), { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${data.length}` } })
}) as unknown as typeof fetch

describe('refreshingSourceOptions', () => {
  it('reads ranges and reports the size', async () => {
    const o = refreshingSourceOptions('a', async () => 'https://x/v1', undefined, rangeFetch(() => 'v1'))
    expect(await o.getSize()).toBe(1000)
    expect([...(await o.read(10, 14)) as Uint8Array]).toEqual([10, 11, 12, 13])
  })
  it('asks for a fresh URL when the signed one expires mid-export', async () => {
    let live = 'v1'
    const asked: boolean[] = []
    const stats: RefreshStats = { refreshes: 0, retries: 0, lastError: null }
    const o = refreshingSourceOptions('a', async (_id, refresh) => { asked.push(!!refresh); if (refresh) live = 'v2'; return 'https://x/' + live }, stats, (async (u: string, i?: RequestInit) => rangeFetch(() => live)(u, i)) as unknown as typeof fetch)
    expect(await o.getSize()).toBe(1000)
    // The first link dies (resolver was cached with v1, server now only accepts v2).
    live = 'v2-pending'
    const ok = o.read(0, 4) // 403 on v1 -> refresh -> v2 accepted
    live = 'v2'
    expect([...(await ok) as Uint8Array]).toEqual([0, 1, 2, 3])
    expect(stats.refreshes).toBeGreaterThanOrEqual(1)
    expect(asked).toContain(true)
  })
  it('retries a network drop and finally gives a clear error', async () => {
    let n = 0
    const flaky = (async () => { n++; throw new TypeError('network') }) as unknown as typeof fetch
    const o = refreshingSourceOptions('a', async () => 'https://x/v1', undefined, flaky, 2)
    await expect(o.read(0, 4)).rejects.toThrow(/tras 2 intentos/)
    expect(n).toBe(2)
  })
  it('gets the size from Content-Length when Content-Range is hidden by CORS', async () => {
    const f = (async (_u: string, i?: RequestInit) => {
      const r = (i?.headers as Record<string, string> | undefined)?.Range
      return r ? new Response(data.slice(0, 1), { status: 206 }) : new Response(data, { status: 200, headers: { 'content-length': String(data.length) } })
    }) as unknown as typeof fetch
    const o = refreshingSourceOptions('a', async () => 'https://x/v1', undefined, f)
    expect(await o.getSize()).toBe(1000)
  })
})
