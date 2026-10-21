import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseSignedRequest } from '@/lib/oauth/meta-signed-request'

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sign = (payload: object, secret: string) => { const p = b64(JSON.stringify(payload)); return `${b64(createHmac('sha256', secret).update(p).digest())}.${p}` }

describe('Meta signed_request', () => {
  it('accepts only a valid HMAC-SHA256 signature from the app secret', () => {
    const ok = sign({ algorithm: 'HMAC-SHA256', user_id: '1789', issued_at: 1 }, 'secret')
    expect(parseSignedRequest(ok, 'secret')?.user_id).toBe('1789')
    expect(parseSignedRequest(ok, 'other')).toBeNull()
    expect(parseSignedRequest(sign({ algorithm: 'none', user_id: '1' }, 'secret'), 'secret')).toBeNull()
    expect(parseSignedRequest('garbage', 'secret')).toBeNull()
    expect(parseSignedRequest(ok, '')).toBeNull()
  })
})
