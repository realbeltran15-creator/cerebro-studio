import { describe, expect, it } from 'vitest'
import { dropboxArg, openDropboxSink } from '@/lib/ingest/dropbox-stream'

function fakeDropbox(opts: { dropAt?: number } = {}) {
  const store: number[] = []
  let dropped = false, committed: { path: string } | null = null
  const impl = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>
    const arg = JSON.parse(h['Dropbox-API-Arg'])
    if (url.endsWith('/start')) return new Response(JSON.stringify({ session_id: 'S1' }), { status: 200 })
    const body = init.body as Uint8Array
    const off = arg.cursor.offset as number
    if (off !== store.length) return new Response(JSON.stringify({ error: { '.tag': 'incorrect_offset', correct_offset: store.length } }), { status: 409 })
    for (const b of body) store.push(b)
    if (opts.dropAt === off && !dropped) { dropped = true; throw new TypeError('network') } // arrived, answer lost
    if (url.endsWith('/finish')) { committed = arg.commit; return new Response(JSON.stringify({ id: 'id:1', name: 'v.mp4', size: store.length, path_display: arg.commit.path }), { status: 200 }) }
    return new Response('null', { status: 200 })
  }) as unknown as typeof fetch
  return { impl, store, committed: () => committed }
}
const feed = async (w: WritableStream<{ type: 'write'; data: Uint8Array; position: number }>, n: number, step: number) => {
  const wr = w.getWriter(); let pos = 0
  while (pos < n) { const len = Math.min(step, n - pos); await wr.write({ type: 'write', data: new Uint8Array(len).map((_, i) => (pos + i) % 251), position: pos }); pos += len }
  await wr.close()
}

describe('openDropboxSink', () => {
  it('sends the whole file in blocks and commits it', async () => {
    const d = fakeDropbox()
    const s = await openDropboxSink({ path: '/v.mp4', token: 't', fetchImpl: d.impl, block: 1024, retryDelayMs: 0 })
    await feed(s.writable, 5000, 700)
    const r = await s.result
    expect(r.size).toBe(5000); expect(d.store.length).toBe(5000); expect(d.store[4999]).toBe(4999 % 251)
    expect(s.stats().peakBufferedBytes).toBeLessThan(4096); expect(d.committed()?.path).toBe('/v.mp4')
  })
  it('recovers when an answer is lost after the block arrived', async () => {
    const d = fakeDropbox({ dropAt: 1024 })
    const s = await openDropboxSink({ path: '/v.mp4', token: 't', fetchImpl: d.impl, block: 1024, retryDelayMs: 0 })
    await feed(s.writable, 4000, 500)
    expect((await s.result).size).toBe(4000); expect(d.store.length).toBe(4000)
  })
  it('refuses an out-of-order write and an empty video', async () => {
    const d = fakeDropbox()
    const s = await openDropboxSink({ path: '/v.mp4', token: 't', fetchImpl: d.impl, block: 1024 })
    await expect(s.writable.getWriter().write({ type: 'write', data: new Uint8Array(4), position: 10 })).rejects.toThrow(/en orden/)
    const e = await openDropboxSink({ path: '/v.mp4', token: 't', fetchImpl: d.impl })
    await expect(e.writable.getWriter().close()).rejects.toThrow(/ningún vídeo/)
  })
  it('escapes non-ASCII in the header argument', () => { expect(dropboxArg({ p: '/Otoño.mp4' })).not.toMatch(/[^\x00-\x7f]/) })
})
