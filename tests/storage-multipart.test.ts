// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: (globalThis as { __ASSETS?: unknown[] }).__ASSETS ?? [] }) }) }) }),
  }),
}))

type Upload = { key: string; parts: Map<number, { etag: string; size: number }>; completed: boolean; aborted: boolean }
const uploads = new Map<string, Upload>()
const log: string[] = []
let server: http.Server

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    const chunks: Buffer[] = []
    req.on('data', d => chunks.push(d))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const key = decodeURIComponent(u.pathname.split('/').slice(2).join('/'))
      log.push(`${req.method} ${u.pathname}?${[...u.searchParams.keys()].filter(k => !k.startsWith('X-Amz')).join('&')}`)
      expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
      if (req.method === 'POST' && u.searchParams.has('uploads')) { const id = `upload-${uploads.size + 1}-abcdefgh`; uploads.set(id, { key, parts: new Map(), completed: false, aborted: false }); res.end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`); return }
      const up = uploads.get(u.searchParams.get('uploadId') ?? '')
      if (!up || up.aborted) { res.statusCode = 404; res.end('<Error><Code>NoSuchUpload</Code></Error>'); return }
      if (req.method === 'PUT') {
        // The signed content-length must match what is sent.
        expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host')
        const n = Number(u.searchParams.get('partNumber')); up.parts.set(n, { etag: `"etag-${n}"`, size: body.length }); res.setHeader('ETag', `"etag-${n}"`); res.end(); return
      }
      if (req.method === 'GET') {
        const marker = Number(u.searchParams.get('part-number-marker') ?? 0)
        const all = [...up.parts].sort((a, b) => a[0] - b[0]).filter(([n]) => n > marker)
        const page = all.slice(0, 2)
        res.end(`<ListPartsResult>${page.map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><ETag>${p.etag.replace(/"/g, '&quot;')}</ETag><Size>${p.size}</Size></Part>`).join('')}<IsTruncated>${all.length > 2}</IsTruncated><NextPartNumberMarker>${page.at(-1)?.[0] ?? 0}</NextPartNumberMarker></ListPartsResult>`); return
      }
      if (req.method === 'POST') {
        const ok = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]+)<\/ETag>/g)].every(m => up.parts.get(Number(m[1]))?.etag === m[2].replace(/&quot;/g, '"'))
        if (!ok) { res.end('<Error><Code>InvalidPart</Code></Error>'); return }
        up.completed = true; res.end('<CompleteMultipartUploadResult><Key>k</Key></CompleteMultipartUploadResult>'); return
      }
      if (req.method === 'DELETE') { up.aborted = true; res.statusCode = 204; res.end(); return }
      res.statusCode = 400; res.end()
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'bkt', R2_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
})
afterAll(() => { server.close(); for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT']) delete process.env[k] })
beforeEach(() => { uploads.clear(); log.length = 0; (globalThis as { __ASSETS?: unknown[] }).__ASSETS = [] })

const call = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/storage/multipart/route')
  const r = await POST(new Request('http://x/api/storage/multipart', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, json: await r.json() as Record<string, any> }
}
const path = 'r2:u1/library/uploads/big-file-0001.mp4'

describe('resumable R2 uploads (multipart)', () => {
  it('creates an upload, signs each part with its exact size, lists what arrived (with paging) and completes', async () => {
    const c = await call({ action: 'create', storagePath: path, contentType: 'video/mp4', size: 100 * 1024 * 1024 })
    expect(c.status).toBe(200); expect(c.json.parts).toBe(4); expect(c.json.partBytes).toBe(32 * 1024 * 1024)
    const id = c.json.uploadId as string
    for (let n = 1; n <= 3; n++) {
      const u = await call({ action: 'part-url', storagePath: path, uploadId: id, partNumber: n, bytes: 10 })
      const r = await fetch(u.json.url, { method: 'PUT', body: Buffer.alloc(10) })
      expect(r.status).toBe(200); expect(r.headers.get('etag')).toBe(`"etag-${n}"`)
    }
    const st = await call({ action: 'status', storagePath: path, uploadId: id })
    expect(st.json.done.map((p: { partNumber: number }) => p.partNumber)).toEqual([1, 2, 3])   // two list pages
    expect(st.json.done[0]).toMatchObject({ etag: '"etag-1"', size: 10 })
    const fin = await call({ action: 'complete', storagePath: path, uploadId: id, parts: st.json.done })
    expect(fin.status).toBe(200); expect(uploads.get(id)!.completed).toBe(true)
  })

  it('a part URL is bound to the size it was signed for (a bigger body is not what R2 will accept)', async () => {
    const c = await call({ action: 'create', storagePath: path, contentType: 'video/mp4', size: 70 * 1024 * 1024 })
    const u = await call({ action: 'part-url', storagePath: path, uploadId: c.json.uploadId, partNumber: 1, bytes: 1234 })
    const url = new URL(u.json.url as string)
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host')
    const other = await call({ action: 'part-url', storagePath: path, uploadId: c.json.uploadId, partNumber: 1, bytes: 1235 })
    expect(new URL(other.json.url as string).searchParams.get('X-Amz-Signature')).not.toBe(url.searchParams.get('X-Amz-Signature'))
  })

  it('reports an upload that no longer exists, and aborts one', async () => {
    const gone = await call({ action: 'status', storagePath: path, uploadId: 'does-not-exist-123' })
    expect(gone.status).toBe(404)
    const c = await call({ action: 'create', storagePath: path, contentType: 'video/mp4', size: 70 * 1024 * 1024 })
    const a = await call({ action: 'abort', storagePath: path, uploadId: c.json.uploadId })
    expect(a.status).toBe(200); expect(uploads.get(c.json.uploadId)!.aborted).toBe(true)
  })

  it('refuses someone else\'s folder, Supabase paths, a wrong size and a full account', async () => {
    expect((await call({ action: 'create', storagePath: 'r2:other/library/uploads/x.mp4', contentType: 'video/mp4', size: 70e6 })).status).toBe(403)
    expect((await call({ action: 'create', storagePath: 'u1/library/uploads/x.mp4', contentType: 'video/mp4', size: 70e6 })).status).toBe(400)
    expect((await call({ action: 'create', storagePath: path, contentType: 'video/mp4', size: 0 })).status).toBe(400)
    expect((await call({ action: 'create', storagePath: 'r2:u1/../x/uploads/x.mp4', contentType: 'video/mp4', size: 70e6 })).status).toBe(403)
    ;(globalThis as { __ASSETS?: unknown[] }).__ASSETS = [{ bytes: 9.5 * 1024 ** 3 }]
    const full = await call({ action: 'create', storagePath: path, contentType: 'video/mp4', size: 100 * 1024 * 1024 })
    expect(full.status).toBe(413); expect(full.json.error).toMatch(/Espacio en la nube lleno/)
    expect(uploads.size).toBe(0)   // nothing was started on R2
  })

  it('does not complete with a wrong part and says so', async () => {
    const c = await call({ action: 'create', storagePath: path, contentType: 'video/mp4', size: 70 * 1024 * 1024 })
    const bad = await call({ action: 'complete', storagePath: path, uploadId: c.json.uploadId, parts: [{ partNumber: 1, etag: '"nope"' }] })
    expect(bad.status).toBe(502); expect(bad.json.error).toMatch(/InvalidPart/)
  })
})
