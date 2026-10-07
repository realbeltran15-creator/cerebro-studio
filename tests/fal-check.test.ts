import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkFalConnection } from '@/lib/providers/fal-queue'

const reply = (status: number) => vi.fn().mockResolvedValue(new Response('{}', { status }))

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('checkFalConnection', () => {
  it('reports a missing key without calling fal', async () => {
    vi.stubEnv('FAL_KEY', '')
    const f = reply(422); vi.stubGlobal('fetch', f)
    expect((await checkFalConnection()).state).toBe('not_configured')
    expect(f).not.toHaveBeenCalled()
  })
  it.each([[422, 'ok'], [401, 'invalid_key'], [403, 'no_access'], [500, 'unexpected'], [200, 'unexpected']])('maps %i to %s', async (status, state) => {
    vi.stubEnv('FAL_KEY', 'test-placeholder')
    vi.stubGlobal('fetch', reply(status))
    const out = await checkFalConnection()
    expect(out.state).toBe(state)
    expect(JSON.stringify(out)).not.toContain('test-placeholder')
  })
  it('sends an empty body once, with no retry', async () => {
    vi.stubEnv('FAL_KEY', 'test-placeholder')
    const f = reply(422); vi.stubGlobal('fetch', f)
    await checkFalConnection()
    expect(f).toHaveBeenCalledTimes(1)
    expect((f.mock.calls[0][1] as RequestInit).body).toBe('{}')
  })
  it('reports an unreachable host', async () => {
    vi.stubEnv('FAL_KEY', 'test-placeholder')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')))
    expect((await checkFalConnection()).state).toBe('unreachable')
  })
})
