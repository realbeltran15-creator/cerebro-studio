import { describe, expect, it } from 'vitest'
import { headerMatches, sniffMedia } from '@/lib/ingest/sniff'

const b = (...x: Array<number | string>) => Uint8Array.from(x.flatMap(v => (typeof v === 'string' ? [...v].map(c => c.charCodeAt(0)) : [v])))
const pad = (a: Uint8Array) => { const o = new Uint8Array(32); o.set(a); return o }

describe('sniffMedia', () => {
  it('reconoce cabeceras reales', () => {
    expect(sniffMedia(pad(b(0xff, 0xd8, 0xff, 0xe0)))).toBe('image')
    expect(sniffMedia(pad(b(0x89, 'PNG')))).toBe('image')
    expect(sniffMedia(pad(b('RIFF', 0, 0, 0, 0, 'WEBP')))).toBe('image')
    expect(sniffMedia(pad(b('RIFF', 0, 0, 0, 0, 'WAVE')))).toBe('audio')
    expect(sniffMedia(pad(b(0, 0, 0, 0x20, 'ftyp', 'isom')))).toBe('video')
    expect(sniffMedia(pad(b(0, 0, 0, 0x20, 'ftyp', 'M4A ')))).toBe('audio')
    expect(sniffMedia(pad(b(0, 0, 0, 8, 'wide')))).toBe('video')
    expect(sniffMedia(pad(b(0, 0, 0, 8, 'moov')))).toBe('video')
    expect(sniffMedia(pad(b('ID3', 4)))).toBe('audio')
    expect(sniffMedia(pad(b('OggS')))).toBe('audio')
    expect(sniffMedia(pad(b(0x1a, 0x45, 0xdf, 0xa3)))).toBe('video')
  })
  it('rechaza ejecutables, PDF, texto y archivos vacíos aunque declaren ser vídeo', () => {
    for (const h of [b('MZ', 0x90, 0), b('%PDF-1.7'), b('hola mundo'), new Uint8Array(0), new Uint8Array(2)]) {
      expect(sniffMedia(pad(h))).toBeNull()
      expect(headerMatches(pad(h), 'video')).toBe(false)
    }
  })
  it('detecta tipo declarado distinto del real (un JPEG declarado como vídeo)', () => {
    expect(headerMatches(pad(b(0xff, 0xd8, 0xff)), 'video')).toBe(false)
    expect(headerMatches(pad(b(0xff, 0xd8, 0xff)), 'image')).toBe(true)
    expect(headerMatches(pad(b(0x1a, 0x45, 0xdf, 0xa3)), 'audio')).toBe(true) // audio WebM
  })
})
