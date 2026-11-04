import { afterEach, describe, expect, it, vi } from 'vitest'

// Sin YOUTUBE_API_KEY, las rutas de investigación responden 503 con un mensaje comprensible y SIN datos sensibles (ni claves ni valores de entorno).
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }) }))

const OLD = process.env.YOUTUBE_API_KEY
afterEach(() => { if (OLD === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = OLD })

describe('investigación sin clave de YouTube', () => {
  for (const [name, load, url] of [
    ['categories', () => import('@/app/api/research/categories/route'), 'http://x/api/research/categories?region=ES'],
    ['trending', () => import('@/app/api/research/trending/route'), 'http://x/api/research/trending?region=ES'],
  ] as const) {
    it(`${name}: 503, configured:false, mensaje claro y sin secretos`, async () => {
      delete process.env.YOUTUBE_API_KEY
      process.env.SOME_SECRET_FOR_TEST = 'valor-secreto-no-debe-aparecer'
      const res = await (await load()).GET(new Request(url))
      const body = JSON.stringify(await res.json())
      expect(res.status).toBe(503)
      expect(body).toContain('"configured":false')
      expect(body).toMatch(/no está configurada/)
      expect(body).not.toMatch(/valor-secreto|AIza|key=|apikey|process\.env/i)
      delete process.env.SOME_SECRET_FOR_TEST
    })
  }
})
