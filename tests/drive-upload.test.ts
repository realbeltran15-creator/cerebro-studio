import { describe, expect, it } from 'vitest'
import { driveError, parseRange, uploadToDrive } from '@/lib/ingest/drive-upload'

/** A tiny fake of Drive's resumable endpoint: holds the bytes, answers 308 with Range until complete, and can drop one chunk. */
function fakeDrive(opts: { failChunkAt?: number } = {}) {
  let held = 0, failed = false, createdWith: unknown = null
  const calls: string[] = []
  const impl = (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>
    if (String(url).includes('uploadType=resumable')) { createdWith = JSON.parse(String(init.body)); return new Response('{}', { status: 200, headers: { Location: 'https://session.test/u1' } }) }
    const cr = h['Content-Range']; calls.push(cr)
    const q = /bytes \*\/(\d+)/.exec(cr)
    if (q) return new Response(null, { status: 308, headers: held ? { Range: `bytes=0-${held - 1}` } : {} })
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr)!
    const [a, b, t] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (opts.failChunkAt === a && !failed) { failed = true; throw new TypeError('network') }
    expect(a).toBe(held)
    held = b + 1
    return held >= t ? new Response(JSON.stringify({ id: 'F1', name: 'v.mp4', size: String(t) }), { status: 200 }) : new Response(null, { status: 308, headers: { Range: `bytes=0-${b}` } })
  }) as unknown as typeof fetch
  return { impl, calls, created: () => createdWith, held: () => held }
}

describe('Drive resumable upload', () => {
  it('sends the file in 256 KiB-multiple chunks into the chosen folder', async () => {
    const d = fakeDrive(); const prog: number[] = []
    const file = new Blob([new Uint8Array(1_000_000)])
    const r = await uploadToDrive(file, { name: 'v.mp4', mimeType: 'video/mp4', token: 't', folderId: 'FOLDER', chunk: 256 * 1024, fetchImpl: d.impl, onProgress: s => prog.push(s) })
    expect(r.id).toBe('F1'); expect(d.held()).toBe(1_000_000)
    expect(d.created()).toMatchObject({ name: 'v.mp4', parents: ['FOLDER'] })
    expect(d.calls.length).toBe(4); expect(prog.at(-1)).toBe(1_000_000)
  })
  it('continues from the byte Drive holds after a dropped connection', async () => {
    const d = fakeDrive({ failChunkAt: 262144 })
    const r = await uploadToDrive(new Blob([new Uint8Array(700_000)]), { name: 'v.mp4', mimeType: 'video/mp4', token: 't', chunk: 262144, fetchImpl: d.impl })
    expect(r.size).toBe(700_000); expect(d.calls.some(c => c.startsWith('bytes */'))).toBe(true)
  })
  it('can be cancelled and explains errors', async () => {
    const ac = new AbortController(); ac.abort()
    await expect(uploadToDrive(new Blob([new Uint8Array(10)]), { name: 'v', mimeType: 'video/mp4', token: 't', signal: ac.signal, fetchImpl: fakeDrive().impl })).rejects.toMatchObject({ name: 'AbortError' })
    expect(driveError(401)).toMatch(/vuelve a conectar/); expect(parseRange('bytes=0-99')).toBe(100); expect(parseRange(null)).toBeNull()
  })
})
