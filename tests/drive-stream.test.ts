import { describe, expect, it } from 'vitest'
import { openDriveSink } from '@/lib/ingest/drive-stream'

/** Fake of Drive's resumable endpoint for a file of unknown size: block ranges end in «/*» and the last one carries the total. */
function fakeDrive(opts: { failAt?: number; status500At?: number } = {}) {
  const store: number[] = []
  let held = 0, dropped = false, deleted = false, created: unknown = null
  const ranges: string[] = []
  const impl = (async (url: string, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>
    if (String(url).includes('uploadType=resumable')) { created = { body: JSON.parse(String(init.body)), headers: h }; return new Response('{}', { status: 200, headers: { Location: 'https://session.test/u1' } }) }
    if (init.method === 'DELETE') { deleted = true; return new Response(null, { status: 499 }) }
    const cr = h['Content-Range']; ranges.push(cr)
    if (cr === 'bytes */*') return new Response(null, { status: 308, headers: held ? { Range: `bytes=0-${held - 1}` } : {} })
    const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(cr)
    const q = /bytes \*\/(\d+)/.exec(cr)
    if (q) return Number(q[1]) === held ? new Response(JSON.stringify({ id: 'F1', name: 'v.mp4', size: String(held) }), { status: 200 }) : new Response(null, { status: 308 })
    const [a, b] = [Number(m![1]), Number(m![2])]
    const body = init.body as Uint8Array
    if (opts.failAt === a && !dropped) { dropped = true; for (let i = 0; i < 5; i++) store[a + i] = body[i]; held += 5; throw new TypeError('network') } // 5 bytes got through before the drop
    if (opts.status500At === a && !dropped) { dropped = true; return new Response(null, { status: 503 }) }
    expect(a).toBeLessThanOrEqual(held)
    expect(body.byteLength).toBe(b - a + 1)
    for (let i = Math.max(0, held - a); i < body.byteLength; i++) store[a + i] = body[i]
    held = b + 1
    if (m![3] !== '*') return new Response(JSON.stringify({ id: 'F1', name: 'v.mp4', size: m![3] }), { status: 200 })
    return new Response(null, { status: 308, headers: { Range: `bytes=0-${b}` } })
  }) as unknown as typeof fetch
  return { impl, ranges, held: () => held, store, deleted: () => deleted, created: () => created }
}
const BLOCK = 256 * 1024
const pattern = (n: number, from = 0) => Uint8Array.from({ length: n }, (_, i) => (from + i) % 251)
async function pour(w: WritableStream<{ type: 'write'; data: Uint8Array; position: number }>, total: number, piece: number) {
  const wr = w.getWriter()
  for (let p = 0; p < total; p += piece) await wr.write({ type: 'write', data: pattern(Math.min(piece, total - p), p), position: p })
  await wr.close()
}

describe('Drive upload while rendering', () => {
  it('opens the session first, in the chosen folder, with no size announced', async () => {
    const d = fakeDrive()
    await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', folderId: 'FOLDER', fetchImpl: d.impl })
    expect(d.created()).toMatchObject({ body: { name: 'v.mp4', parents: ['FOLDER'] } })
    expect(JSON.stringify(d.created())).not.toContain('Upload-Content-Length')
  })
  it('sends sequential output in 256 KiB-multiple blocks and closes with the real total; every byte arrives in order', async () => {
    const d = fakeDrive(); const prog: number[] = []
    const total = BLOCK * 5 + 1234
    const s = await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', fetchImpl: d.impl, block: BLOCK, onProgress: n => prog.push(n) })
    await pour(s.writable, total, 100_000)
    const r = await s.result
    expect(r).toMatchObject({ id: 'F1', size: total })
    expect(d.held()).toBe(total)
    expect(d.ranges.slice(0, -1).every(x => x.endsWith('/*'))).toBe(true)
    expect(d.ranges.at(-1)).toBe(`bytes ${BLOCK * 5}-${total - 1}/${total}`)
    expect(d.store.length).toBe(total)
    expect(Array.from(d.store.slice(0, 1000))).toEqual(Array.from(pattern(1000)))
    expect(Array.from(d.store.slice(total - 1000))).toEqual(Array.from(pattern(1000, total - 1000)))
    expect(prog.at(-1)).toBe(total)
    expect(s.stats().peakBufferedBytes).toBeLessThanOrEqual(BLOCK * 2 + 100_000)
  })
  it('closes with «bytes */total» when the file ends exactly on a block boundary', async () => {
    const d = fakeDrive()
    const s = await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', fetchImpl: d.impl, block: BLOCK })
    await pour(s.writable, BLOCK * 2, BLOCK)
    expect((await s.result).size).toBe(BLOCK * 2)
    expect(d.ranges.at(-1)).toBe(`bytes */${BLOCK * 2}`)
  })
  it('continues from the byte Drive holds after a dropped connection, without losing or repeating data', async () => {
    const d = fakeDrive({ failAt: BLOCK })
    const total = BLOCK * 3 + 77
    const s = await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', fetchImpl: d.impl, block: BLOCK, retryDelayMs: 1 })
    await pour(s.writable, total, 70_000)
    await s.result
    expect(s.stats().retries).toBe(1)
    expect(Array.from(d.store.slice(0, total))).toEqual(Array.from(pattern(total)))
  })
  it('retries a 503 and gives up with a clear message when Drive keeps refusing', async () => {
    const d = fakeDrive({ status500At: 0 })
    const s = await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', fetchImpl: d.impl, block: BLOCK, retryDelayMs: 1 })
    await pour(s.writable, BLOCK + 10, BLOCK)
    expect((await s.result).size).toBe(BLOCK + 10)
    const bad = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch
    await expect(openDriveSink({ name: 'v', mimeType: 'video/mp4', token: 'T', fetchImpl: bad })).rejects.toThrow(/permite guardar/)
  })
  it('refuses a seek (a write before the end) instead of corrupting the file, and cancels the session', async () => {
    const d = fakeDrive()
    const s = await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', fetchImpl: d.impl, block: BLOCK })
    const w = s.writable.getWriter()
    await w.write({ type: 'write', data: pattern(1000), position: 0 })
    await expect(w.write({ type: 'write', data: pattern(10), position: 0 })).rejects.toThrow(/en orden/)
    await w.abort('x').catch(() => undefined)
    await expect(s.result).rejects.toBeTruthy()
    expect(d.deleted()).toBe(true)
  })
  it('an aborted export cancels the unfinished upload and leaves nothing complete on Drive', async () => {
    const d = fakeDrive()
    const s = await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', fetchImpl: d.impl, block: BLOCK })
    const w = s.writable.getWriter()
    await w.write({ type: 'write', data: pattern(BLOCK + 5), position: 0 })
    await w.abort(new DOMException('Cancelado', 'AbortError'))
    await expect(s.result).rejects.toMatchObject({ name: 'AbortError' })
    expect(d.deleted()).toBe(true)
  })
  it('an empty export is an error, not an empty file on Drive', async () => {
    const s = await openDriveSink({ name: 'v.mp4', mimeType: 'video/mp4', token: 'T', fetchImpl: fakeDrive().impl })
    await expect(s.writable.getWriter().close()).rejects.toThrow(/ningún vídeo/)
  })
})
