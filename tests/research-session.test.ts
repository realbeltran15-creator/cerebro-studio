import { describe, expect, it, vi } from 'vitest'
import { SessionExpiredError, sessionFetch, sessionLoss } from '@/lib/research/session'
import { unansweredMessage } from '@/lib/research/net-error'

const fake = (o: Partial<{ type: string; status: number; redirected: boolean; url: string; html: boolean }>) => ({ type: 'basic', status: 200, redirected: false, url: 'https://app.vercel.app/api/x', ...o, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (o.html ? 'text/html; charset=utf-8' : 'application/json') : null) } }) as never

describe('Vercel / app session loss is detected, not shown as «Failed to fetch»', () => {
  it('a redirect that the browser cannot follow (opaqueredirect) means the Vercel sign-in expired', () => { expect(sessionLoss(fake({ type: 'opaqueredirect', status: 0 }))).toBe('vercel') })
  it('a followed redirect that ended on another origin is the same', () => { expect(sessionLoss(fake({ redirected: true, url: 'https://vercel.com/login?next=…' }), 'https://app.vercel.app')).toBe('vercel') })
  it('a 401 web page is Vercel\'s protection; a 401 JSON is the app\'s own sign-in', () => {
    expect(sessionLoss(fake({ status: 401, html: true }))).toBe('vercel'); expect(sessionLoss(fake({ status: 401 }))).toBe('app')
  })
  it('ordinary answers (200, 409, 429, 502, 503) are not session losses', () => { for (const status of [200, 409, 422, 429, 502, 503]) expect(sessionLoss(fake({ status }))).toBeNull() })
  it('sessionFetch never follows redirects, throws a clear error and calls the network exactly once (no automatic retry)', async () => {
    const f = vi.fn(async () => fake({ type: 'opaqueredirect', status: 0 }))
    await expect(sessionFetch('/api/research/topic?q=x', {}, f as never)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(f).toHaveBeenCalledTimes(1); expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual')
  })
  it('the message says the request never reached the app, that nothing was counted, and how to recover', async () => {
    const e = await sessionFetch('/x', {}, (async () => fake({ type: 'opaqueredirect', status: 0 })) as never).catch(x => x as SessionExpiredError) as SessionExpiredError
    expect(e.message).toMatch(/nunca llegó a la aplicación/); expect(e.message).toMatch(/No se ha consultado YouTube ni se ha contado consumo/); expect(e.message).toMatch(/iniciar sesión/); expect(e.message).toMatch(/No se reintentará automáticamente/)
  })
  it('a normal answer is returned untouched', async () => { const ok = fake({ status: 200 }); expect(await sessionFetch('/x', {}, (async () => ok) as never)).toBe(ok) })
  it('requests with no answer at all say the spend cannot be checked', () => { expect(unansweredMessage('102 unidades · 1 búsqueda')).toMatch(/No se puede comprobar si llegó a gastar cuota \(102 unidades · 1 búsqueda\)/) })
})
