import { describe, expect, it } from 'vitest'
import { ensureAppFolder } from '@/lib/ingest/drive'

describe('ensureAppFolder', () => {
  it('reuses the folder when it exists and creates it when not', async () => {
    const calls: string[] = []
    const found = (async (u: string) => { calls.push(u); return new Response(JSON.stringify({ files: [{ id: 'F', name: 'Cerebro Studio' }] }), { status: 200 }) }) as unknown as typeof fetch
    expect(await ensureAppFolder('t', found)).toEqual({ folderId: 'F', folderName: 'Cerebro Studio' })
    expect(calls).toHaveLength(1)
    let n = 0
    const create = (async (_u: string, i?: RequestInit) => (n++ === 0 ? new Response('{"files":[]}', { status: 200 }) : (expect(i?.method).toBe('POST'), new Response('{"id":"N","name":"Cerebro Studio"}', { status: 200 })))) as unknown as typeof fetch
    expect((await ensureAppFolder('t', create)).folderId).toBe('N')
  })
  it('reports a Drive error', async () => {
    await expect(ensureAppFolder('t', (async () => new Response('', { status: 403 })) as unknown as typeof fetch)).rejects.toThrow(/403/)
  })
})
