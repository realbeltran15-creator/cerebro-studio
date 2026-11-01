import { describe, expect, it } from 'vitest'
import { fetchMediaBlob, MediaFetchError } from '@/lib/editor/fetch-media'

const resp = (body: Uint8Array, init: ResponseInit = {}) => new Response(body as BodyInit, init)

describe('fetchMediaBlob', () => {
  it('devuelve el blob cuando r.ok', async () => {
    const b = await fetchMediaBlob('x', { fetchImpl: (async () => resp(new Uint8Array(10))) as typeof fetch })
    expect(b.size).toBe(10)
  })
  it('rechaza respuestas no ok con mensaje claro (no analiza el cuerpo de error)', async () => {
    await expect(fetchMediaBlob('x', { label: 'clip.mp4', fetchImpl: (async () => resp(new Uint8Array(1), { status: 403 })) as typeof fetch }))
      .rejects.toMatchObject({ kind: 'http', message: expect.stringContaining('403') })
  })
  it('rechaza por content-length y por exceso en streaming', async () => {
    await expect(fetchMediaBlob('x', { maxBytes: 5, fetchImpl: (async () => resp(new Uint8Array(3), { headers: { 'content-length': '99' } })) as typeof fetch }))
      .rejects.toMatchObject({ kind: 'too_large' })
    await expect(fetchMediaBlob('x', { maxBytes: 5, fetchImpl: (async () => resp(new Uint8Array(50))) as typeof fetch }))
      .rejects.toBeInstanceOf(MediaFetchError)
  })
  it('cancelación -> kind cancelled', async () => {
    const ac = new AbortController(); ac.abort()
    await expect(fetchMediaBlob('x', { signal: ac.signal, fetchImpl: (async () => { throw new DOMException('a', 'AbortError') }) as typeof fetch }))
      .rejects.toMatchObject({ kind: 'cancelled' })
  })
})
