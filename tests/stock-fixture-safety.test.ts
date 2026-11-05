import { afterEach, describe, expect, it, vi } from 'vitest'
import { stockFixtureOn, fixturePng } from '@/lib/providers/stock-fixture'
import { allowedDownload, searchStock, stockConfigured } from '@/lib/providers/stock'

afterEach(() => { vi.unstubAllEnvs() })

describe('datos de prueba del banco de materiales', () => {
  it('están apagados por defecto y nunca en la beta privada', () => {
    expect(stockFixtureOn({})).toBe(false)
    expect(stockFixtureOn({ CEREBRO_STOCK_FIXTURE: '1' })).toBe(true)
    expect(stockFixtureOn({ CEREBRO_STOCK_FIXTURE: '1', NEXT_PUBLIC_CEREBRO_BETA: 'private' })).toBe(false)
  })
  it('sin clave ni datos de prueba, Pexels no está configurado y no busca', async () => {
    vi.stubEnv('PEXELS_API_KEY', ''); vi.stubEnv('CEREBRO_STOCK_FIXTURE', '')
    expect(stockConfigured('pexels')).toBe(false)
    await expect(searchStock('pexels', 'image', 'mar')).rejects.toThrow(/no configurado/i)
  })
  it('con datos de prueba, los resultados se rotulan como sintéticos y no contactan la red', async () => {
    vi.stubEnv('PEXELS_API_KEY', ''); vi.stubEnv('CEREBRO_STOCK_FIXTURE', '1')
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    const items = await searchStock('pexels', 'image', 'mar')
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.synthetic && i.title.startsWith('[PRUEBA]') && i.license.includes('no es Pexels'))).toBe(true)
    expect(f).not.toHaveBeenCalled(); vi.unstubAllGlobals()
  })
  it('solo permite descargar el fichero de prueba desde el propio origen y con datos de prueba activos', () => {
    const o = 'http://127.0.0.1:3000'
    expect(allowedDownload('pexels', `${o}/api/stock/fixture/prueba-1.png`, o)).toBe(false)
    vi.stubEnv('CEREBRO_STOCK_FIXTURE', '1')
    expect(allowedDownload('pexels', `${o}/api/stock/fixture/prueba-1.png`, o)).toBe(true)
    expect(allowedDownload('pexels', 'http://evil.test/api/stock/fixture/prueba-1.png', o)).toBe(false)
    expect(allowedDownload('pexels', 'https://evil.test/x.png', o)).toBe(false)
  })
  it('el PNG de prueba es válido', () => {
    const b = fixturePng('prueba-1'); expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(b.readUInt32BE(16)).toBe(640)
  })
})
