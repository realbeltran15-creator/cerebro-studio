import { describe, expect, it } from 'vitest'
import { verifyGeneratedBytes } from '@/lib/providers/verify-bytes'

const txt = (s: string) => new TextEncoder().encode(s)
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(1)])
const mp3 = () => Uint8Array.from([0x49, 0x44, 0x33, 4, 0, ...new Array(40).fill(7)])
const mp4 = () => Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, ...new Array(40).fill(0)])

describe('verifyGeneratedBytes', () => {
  it('acepta salidas válidas', () => {
    expect(verifyGeneratedBytes('image', png()).ok).toBe(true)
    expect(verifyGeneratedBytes('thumbnail', png()).ok).toBe(true)
    expect(verifyGeneratedBytes('voice', mp3()).ok).toBe(true)
    expect(verifyGeneratedBytes('video', mp4()).ok).toBe(true)
    expect(verifyGeneratedBytes('render', mp4()).ok).toBe(true)
  })
  it('rechaza vacío, JSON/HTML con 200 y tipos cruzados', () => {
    expect(verifyGeneratedBytes('image', new Uint8Array(0)).ok).toBe(false)
    expect(verifyGeneratedBytes('image', txt('{"error":"quota exceeded"}')).ok).toBe(false)
    expect(verifyGeneratedBytes('video', txt('<html><body>502</body></html>')).ok).toBe(false)
    expect(verifyGeneratedBytes('voice', txt('{"detail":{"status":"quota_exceeded"}}')).ok).toBe(false)
    expect(verifyGeneratedBytes('video', png()).ok).toBe(false)
    expect(verifyGeneratedBytes('voice', png()).ok).toBe(false)
  })
  it('audio sin cabecera reconocible (PCM) pasa mientras no sea texto', () => {
    expect(verifyGeneratedBytes('voice', Uint8Array.from({ length: 400 }, (_, i) => (i * 37) % 251)).ok).toBe(true)
  })
})
