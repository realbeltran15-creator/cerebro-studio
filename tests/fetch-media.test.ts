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

describe('fetchMediaBlob: límite real durante el flujo', () => {
  const stream = (chunks: number, size: number, onPull?: (i: number) => void) => {
    let i = 0
    return new ReadableStream<Uint8Array>({ pull(c) { if (i >= chunks) { c.close(); return } onPull?.(i); c.enqueue(new Uint8Array(size)); i++ } })
  }
  it('sin Content-Length corta la descarga al superar el máximo y deja de leer', async () => {
    let pulls = 0
    const r = new Response(stream(1000, 100, () => { pulls++ }))
    await expect(fetchMediaBlob('x', { maxBytes: 1000, fetchImpl: (async () => r) as typeof fetch })).rejects.toMatchObject({ kind: 'too_large' })
    expect(pulls).toBeLessThan(30) // no leyó los 100 KB restantes
  })
  it('Content-Length falso (más pequeño que el cuerpo real) no evita el límite', async () => {
    const r = new Response(stream(50, 100), { headers: { 'content-length': '10' } })
    await expect(fetchMediaBlob('x', { maxBytes: 1000, fetchImpl: (async () => r) as typeof fetch })).rejects.toMatchObject({ kind: 'too_large' })
  })
  it('cancelación a mitad de flujo', async () => {
    const ac = new AbortController()
    const r = new Response(stream(100, 10, i => { if (i === 3) ac.abort() }))
    await expect(fetchMediaBlob('x', { signal: ac.signal, fetchImpl: (async () => r) as typeof fetch })).rejects.toMatchObject({ kind: 'cancelled' })
  })
  it('justo en el límite pasa', async () => {
    const b = await fetchMediaBlob('x', { maxBytes: 1000, fetchImpl: (async () => new Response(stream(10, 100))) as typeof fetch })
    expect(b.size).toBe(1000)
  })
})
