import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { openPending, sealPending, type PendingConnection } from '@/lib/oauth/pending'

beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64') })
const p = (over: Partial<PendingConnection> = {}): PendingConnection => ({ ownerId: 'u1', channelId: 'UCkrMO0K_VDw8BDXPFpuXQvw', channelName: 'Umbral del Hito', handle: null, scopes: [], scopeSet: 'publish', tokens: { access_token: 'a', refresh_token: 'r', expires_at: 1, scope: '', token_type: 'Bearer' }, createdAt: Date.now(), ...over })

describe('pending YouTube authorization cookie', () => {
  it('opens only for the same owner, untampered and within 15 minutes', () => {
    const c = sealPending(p())
    expect(openPending(c, 'u1')?.channelId).toBe('UCkrMO0K_VDw8BDXPFpuXQvw')
    expect(openPending(c, 'u2')).toBeNull()
    expect(openPending(c.slice(0, -2) + 'xx', 'u1')).toBeNull()
    expect(openPending(sealPending(p({ createdAt: Date.now() - 16 * 60_000 })), 'u1')).toBeNull()
    expect(openPending(sealPending(p({ channelId: 'not-a-channel' })), 'u1')).toBeNull()
    expect(openPending(undefined, 'u1')).toBeNull()
  })
  it('cannot be opened with another server key', () => {
    const c = sealPending(p())
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(openPending(c, 'u1')).toBeNull()
  })
})
