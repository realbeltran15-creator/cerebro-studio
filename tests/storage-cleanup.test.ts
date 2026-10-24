// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanupDelete, cleanupReport } from '@/lib/storage/cleanup'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString()
let objects: Array<{ key: string; size: number; at: string }> = []
let uploads: Array<{ key: string; id: string; at: string }> = []
const log: string[] = []
let server: http.Server

const db = (assets: string[]) => ({
  from: () => {
    const q = { select: () => q, eq: () => q, like: () => q, range: async (a: number, b: number) => ({ data: assets.slice(a, b + 1).map(storage_path => ({ storage_path })), error: null }) }
    return q
  },
}) as never

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    log.push(`${req.method} ${u.pathname}?${[...u.searchParams.keys()].filter(k => !k.startsWith('X-Amz')).join('&')}`)
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix')!, tok = Number(u.searchParams.get('continuation-token') ?? 0)
      const all = objects.filter(o => o.key.startsWith(prefix)), page = all.slice(tok, tok + 2)
      res.end(`<ListBucketResult>${page.map(o => `<Contents><Key>${o.key}</Key><LastModified>${o.at}</LastModified><Size>${o.size}</Size></Contents>`).join('')}<IsTruncated>${tok + 2 < all.length}</IsTruncated>${tok + 2 < all.length ? `<NextContinuationToken>${tok + 2}</NextContinuationToken>` : ''}</ListBucketResult>`); return
    }
    if (req.method === 'GET' && u.searchParams.has('uploads')) {
      res.end(`<ListMultipartUploadsResult>${uploads.map(x => `<Upload><Key>${x.key}</Key><UploadId>${x.id}</UploadId><Initiated>${x.at}</Initiated></Upload>`).join('')}<IsTruncated>false</IsTruncated></ListMultipartUploadsResult>`); return
    }
    if (req.method === 'DELETE') {
      const id = u.searchParams.get('uploadId')
      if (id) uploads = uploads.filter(x => x.id !== id)
      else { const key = decodeURIComponent(u.pathname.split('/').slice(2).join('/')); objects = objects.filter(o => o.key !== key) }
      res.statusCode = 204; res.end(); return
    }
    res.statusCode = 400; res.end()
  })
  await new Promise<void>(r => server.listen(0, r))
  Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'bkt', R2_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
})
afterAll(() => { server.close() })
beforeEach(() => {
  log.length = 0
  objects = [
    { key: 'u1/p/kept.mp4', size: 100, at: ago(500) },          // referenced by a Library row
    { key: 'u1/p/lost.mp4', size: 700, at: ago(48) },           // nothing refers to it, old enough
    { key: 'u1/p/fresh.mp4', size: 50, at: ago(2) },            // nothing refers to it yet, but it is only 2 h old
    { key: 'u1/versions/p/v1.json', size: 9, at: ago(900) },    // recovery point
    { key: 'u1/p/lost2.mp4', size: 300, at: ago(100) },
    { key: 'u2/p/other.mp4', size: 5, at: ago(900) },           // somebody else's
  ]
  uploads = [{ key: 'u1/p/big.mp4', id: 'old-upload-1', at: ago(24 * 10) }, { key: 'u1/p/now.mp4', id: 'new-upload-2', at: ago(3) }]
})

describe('R2 clean-up', () => {
  it('reports only unreferenced files older than a day and uploads abandoned for a week; never recovery points or other people\'s files', async () => {
    const r = await cleanupReport(db(['r2:u1/p/kept.mp4']), 'u1', NOW)
    expect(r.orphans.map(o => o.key).sort()).toEqual(['u1/p/lost.mp4', 'u1/p/lost2.mp4'])
    expect(r.orphanBytes).toBe(1000)
    expect(r.staleUploads.map(u => u.uploadId)).toEqual(['old-upload-1'])
    expect(r.objects).toBe(5); expect(r.referenced).toBe(1)
    expect(log.some(l => l.startsWith('DELETE'))).toBe(false)   // a report changes nothing
  })
  it('lists by pages', async () => {
    await cleanupReport(db([]), 'u1', NOW)
    expect(log.filter(l => l.includes('list-type')).length).toBeGreaterThan(1)
  })
  it('deletes only what a fresh report lists: a referenced, recent or recovery-point key sent by the browser is skipped', async () => {
    const r = await cleanupDelete(db(['r2:u1/p/kept.mp4']), 'u1', { keys: ['u1/p/lost.mp4', 'u1/p/kept.mp4', 'u1/p/fresh.mp4', 'u1/versions/p/v1.json', 'u2/p/other.mp4'], uploads: [{ key: 'u1/p/big.mp4', uploadId: 'old-upload-1' }, { key: 'u1/p/now.mp4', uploadId: 'new-upload-2' }] }, NOW)
    expect(r).toMatchObject({ deleted: 1, freedBytes: 700, aborted: 1 })
    expect(r.skipped.sort()).toEqual(['u1/p/fresh.mp4', 'u1/p/kept.mp4', 'u1/p/now.mp4', 'u1/versions/p/v1.json', 'u2/p/other.mp4'].sort())
    expect(objects.map(o => o.key).sort()).toEqual(['u1/p/fresh.mp4', 'u1/p/kept.mp4', 'u1/p/lost2.mp4', 'u1/versions/p/v1.json', 'u2/p/other.mp4'])
    expect(uploads.map(u => u.id)).toEqual(['new-upload-2'])
  })
  it('does nothing when the Library cannot be read (it would look like everything is unreferenced)', async () => {
    const broken = { from: () => { const q = { select: () => q, eq: () => q, like: () => q, range: async () => ({ data: null, error: { message: 'down' } }) }; return q } } as never
    await expect(cleanupDelete(broken, 'u1', { keys: ['u1/p/lost.mp4'] }, NOW)).rejects.toThrow(/no se limpia nada/)
    expect(objects.some(o => o.key === 'u1/p/lost.mp4')).toBe(true)
  })
})
