import { describe, expect, it, vi } from 'vitest'
import { createPexelsClient, PexelsLedger, PexelsLimit, PexelsNotConfigured, pexelsKey } from '@/lib/stock/pexels'

const photo = { photos: [{ id: 1, url: 'https://www.pexels.com/photo/1/', width: 4000, height: 3000, photographer: 'Ana', photographer_url: 'https://www.pexels.com/@ana', src: { large2x: 'https://images.pexels.com/1.jpg' } }] }

describe('Pexels preparado (desactivado por defecto)', () => {
  it('sin clave no llama a la red', async () => {
    const f = vi.fn()
    await expect(createPexelsClient({ key: pexelsKey({}), fetchImpl: f as never }).search('photos', 'mar')).rejects.toBeInstanceOf(PexelsNotConfigured)
    expect(f).not.toHaveBeenCalled()
  })
  it('deduplica la misma consulta y devuelve atribución', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(photo), { status: 200 }))
    const c = createPexelsClient({ key: 'k', fetchImpl: f as never })
    const [a, b] = await Promise.all([c.search('photos', ' Mar  azul '), c.search('photos', 'mar azul')])
    expect(f).toHaveBeenCalledTimes(1); expect(a).toEqual(b)
    expect(a[0].attribution).toContain('Ana'); expect(a[0].attribution).toContain('Pexels')
  })
  it('se detiene localmente antes del límite por hora y no llama más', async () => {
    let t = 0
    const ledger = new PexelsLedger(() => t)
    const f = vi.fn(async () => new Response(JSON.stringify(photo), { status: 200 }))
    const c = createPexelsClient({ key: 'k', fetchImpl: f as never, ledger })
    for (let i = 0; i < 180; i++) await c.search('photos', `q${i}`)
    await expect(c.search('photos', 'otra')).rejects.toBeInstanceOf(PexelsLimit)
    expect(f).toHaveBeenCalledTimes(180)
    t += 3_600_001
    await expect(c.search('photos', 'otra')).resolves.toBeTruthy()
  })
  it('un 429 no se reintenta ni se elude', async () => {
    const f = vi.fn(async () => new Response('', { status: 429 }))
    const c = createPexelsClient({ key: 'k', fetchImpl: f as never })
    await expect(c.search('videos', 'x')).rejects.toBeInstanceOf(PexelsLimit)
    expect(f).toHaveBeenCalledTimes(1)
  })
})
