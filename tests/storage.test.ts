import { afterEach, describe, expect, it, vi } from 'vitest'
import { presignUrl } from '@/lib/storage/s3-presign'
import { assertOwnPath, ownerOfPath, r2Configured, r2Url, signedReadUrl, storageDriver } from '@/lib/storage/server'

afterEach(() => vi.unstubAllEnvs())

describe('S3 SigV4 presigning', () => {
  it('matches the AWS documented example (GET examplebucket/test.txt)', () => {
    const url = presignUrl({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1', expiresSeconds: 86400, now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
    expect(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request')).toBe(true)
  })
  it('encodes key segments but keeps slashes', () => {
    const url = presignUrl({ method: 'PUT', host: 'h', path: '/b/u 1/ñ.mp4', accessKeyId: 'a', secretAccessKey: 's', region: 'auto', expiresSeconds: 60, now: new Date('2026-10-07T00:00:00Z') })
    expect(url.startsWith('https://h/b/u%201/%C3%B1.mp4?')).toBe(true)
  })
})

describe('storage driver', () => {
  it('uses Supabase until every R2 variable is set', () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acc'); vi.stubEnv('R2_ACCESS_KEY_ID', 'k'); vi.stubEnv('R2_SECRET_ACCESS_KEY', '')
    vi.stubEnv('R2_BUCKET', 'b')
    expect(r2Configured()).toBe(false); expect(storageDriver()).toBe('supabase')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 's')
    expect(storageDriver()).toBe('r2')
    expect(r2Url('GET', 'u/p/x.mp4').startsWith('https://acc.r2.cloudflarestorage.com/b/u/p/x.mp4?')).toBe(true)
  })
  it('reads the owner from both path styles', () => {
    expect(ownerOfPath('r2:user1/p/x.mp4')).toBe('user1')
    expect(ownerOfPath('user2/p/x.mp4')).toBe('user2')
  })
})

describe('ownership of stored paths (R2 credentials bypass RLS)', () => {
  it('accepts only the caller\'s own keys', () => {
    expect(assertOwnPath('r2:u1/p/renders/x.mp4', 'u1')).toBe('u1/p/renders/x.mp4')
    expect(assertOwnPath('u1/p/x.png', 'u1')).toBe('u1/p/x.png')
    for (const bad of ['r2:u2/p/x.mp4', 'u2/p/x.png', 'r2:u1/../u2/x', 'r2:u1//x', 'u1', 'r2:u1/p/./x', '']) expect(() => assertOwnPath(bad, 'u1'), bad).toThrow()
  })
  it('refuses to sign a read for another user\'s object even if an asset row points at it', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acc'); vi.stubEnv('R2_ACCESS_KEY_ID', 'k'); vi.stubEnv('R2_SECRET_ACCESS_KEY', 's'); vi.stubEnv('R2_BUCKET', 'b')
    await expect(signedReadUrl({} as never, 'attacker', 'r2:victim/p/renders/x.mp4')).rejects.toThrow()
    expect(await signedReadUrl({} as never, 'victim', 'r2:victim/p/renders/x.mp4')).toContain('X-Amz-Signature=')
  })
  it('binds a PUT to its content type', () => {
    const url = presignUrl({ method: 'PUT', host: 'h', path: '/b/k', accessKeyId: 'a', secretAccessKey: 's', region: 'auto', expiresSeconds: 900, contentType: 'video/mp4', now: new Date('2026-10-07T00:00:00Z') })
    expect(url).toContain('X-Amz-SignedHeaders=content-type%3Bhost')
    expect(url).toContain('X-Amz-Expires=900')
  })
})
