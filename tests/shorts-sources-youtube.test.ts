import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/shorts/gemini', async () => {
  const actual = await vi.importActual<typeof import('../lib/shorts/gemini')>('../lib/shorts/gemini')
  return { ...actual, generateJson: vi.fn() }
})
import { generateJson } from '../lib/shorts/gemini'
import { verifySources } from '../lib/shorts/sources'
import { decryptTokens, encryptTokens, initPrivateUpload } from '../lib/shorts/youtube'
import { DEFAULT_CONFIG } from '../lib/shorts/types'

const PAGE_A = `<html><title>Pulpo</title><body>${'Texto de relleno. '.repeat(30)} Los pulpos tienen tres corazones: dos bombean sangre a las branquias y uno al cuerpo. ${'Más texto. '.repeat(20)}</body></html>`
const PAGE_B = `<html><title>Octopus</title><body>${'Filler text. '.repeat(30)} An octopus has three hearts, two for the gills and one for the body. ${'More text. '.repeat(20)}</body></html>`

function stubPages(pages: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = pages[String(url)]
    if (!body) return new Response('no', { status: 404 })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
  }))
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

describe('verificación de fuentes', () => {
  const A = 'https://es.wikipedia.org/wiki/Octopoda'
  const B = 'https://www.britannica.com/animal/octopus'

  it('acepta 2 fuentes independientes cuando la cita aparece literalmente en la página', async () => {
    stubPages({ [A]: PAGE_A, [B]: PAGE_B })
    vi.mocked(generateJson)
      .mockResolvedValueOnce({ supports: true, quote: 'Los pulpos tienen tres corazones: dos bombean sangre a las branquias' })
      .mockResolvedValueOnce({ supports: true, quote: 'An octopus has three hearts, two for the gills and one for the body.' })
    const r = await verifySources('Los pulpos tienen tres corazones', [A, B], DEFAULT_CONFIG)
    expect(r.sources.map(s => s.domain)).toEqual(['wikipedia.org', 'britannica.com'])
  })

  it('rechaza una cita inventada aunque el modelo diga que respalda el dato', async () => {
    stubPages({ [A]: PAGE_A, [B]: PAGE_B })
    vi.mocked(generateJson).mockResolvedValue({ supports: true, quote: 'Los pulpos tienen cuatro corazones y dos cerebros muy grandes' })
    const r = await verifySources('Los pulpos tienen tres corazones', [A, B], DEFAULT_CONFIG)
    expect(r.sources).toHaveLength(0)
    expect(r.checked.every(c => !c.ok)).toBe(true)
  })

  it('no cuenta dos páginas del mismo dominio como dos fuentes', async () => {
    const A2 = 'https://en.wikipedia.org/wiki/Octopus'
    stubPages({ [A]: PAGE_A, [A2]: PAGE_B })
    vi.mocked(generateJson).mockResolvedValue({ supports: true, quote: 'Los pulpos tienen tres corazones: dos bombean sangre a las branquias' })
    const r = await verifySources('x', [A, A2], DEFAULT_CONFIG)
    expect(r.sources).toHaveLength(1)
  })

  it('ignora dominios no fiables y destinos privados sin descargarlos', async () => {
    const f = vi.fn(async () => new Response(PAGE_A, { status: 200, headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', f)
    const r = await verifySources('x', ['https://blogcualquiera.com/a', 'http://169.254.169.254/latest/meta-data', 'http://localhost:3000/'], DEFAULT_CONFIG)
    expect(r.sources).toHaveLength(0)
    expect(f).not.toHaveBeenCalled()
    expect(generateJson).not.toHaveBeenCalled()
  })

  it('no sigue redirecciones hacia destinos privados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })))
    const r = await verifySources('x', [A], DEFAULT_CONFIG)
    expect(r.sources).toHaveLength(0)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})

describe('tokens de YouTube', () => {
  beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64') })
  it('usa el formato v1.iv.tag.datos del flujo OAuth existente y hace ida y vuelta', () => {
    const t = { access_token: 'a', refresh_token: 'r', expires_at: 1, scope: 's', token_type: 'Bearer' }
    const enc = encryptTokens(t)
    expect(enc.split('.')).toHaveLength(4)
    expect(enc.startsWith('v1.')).toBe(true)
    expect(decryptTokens(enc)).toEqual(t)
  })
  it('falla con un token manipulado', () => {
    const enc = encryptTokens({ access_token: 'a', expires_at: 1, scope: 's', token_type: 'Bearer' })
    const parts = enc.split('.'); parts[3] = Buffer.from('zzzz').toString('base64url')
    expect(() => decryptTokens(parts.join('.'))).toThrow()
  })
})

describe('subida a YouTube', () => {
  it('abre la subida como PRIVADA, con contenido sintético declarado y Origin para CORS', async () => {
    const f = vi.fn(async () => new Response(null, { status: 200, headers: { location: 'https://upload.example/session/1' } }))
    vi.stubGlobal('fetch', f)
    const url = await initPrivateUpload('tok', { title: 't', description: 'd', tags: ['a'] }, { size: 1000, type: 'video/mp4' }, 'https://app.example')
    expect(url).toBe('https://upload.example/session/1')
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.status.privacyStatus).toBe('private')
    expect(body.status.containsSyntheticMedia).toBe(true)
    expect((init.headers as Record<string, string>).origin).toBe('https://app.example')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })
})
