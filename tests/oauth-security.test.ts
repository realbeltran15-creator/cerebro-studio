import { afterEach, describe, expect, it } from 'vitest'
import { oauthOrigin } from '@/lib/oauth/origin'
import { SOCIAL_SCOPE_SETS, socialAuthUrl } from '@/lib/oauth/social'
import { authUrl, redirectUri, SCOPES } from '@/lib/oauth/google'

const keep = { ...process.env }
afterEach(() => { process.env = { ...keep } })

describe('OAuth origin pinning', () => {
  it('uses the request origin unless a safe pinned origin is configured', () => {
    expect(oauthOrigin('http://localhost:3000', {})).toBe('http://localhost:3000')
    expect(oauthOrigin('https://evil.example', { CEREBRO_OAUTH_ORIGIN: 'https://app.example.com/ruta' })).toBe('https://app.example.com')
    expect(oauthOrigin('http://x', { CEREBRO_OAUTH_ORIGIN: 'http://app.example.com' })).toBe('http://x')
    expect(oauthOrigin('http://x', { CEREBRO_OAUTH_ORIGIN: 'http://localhost:3000' })).toBe('http://localhost:3000')
    expect(oauthOrigin('http://x', { CEREBRO_OAUTH_ORIGIN: 'no es una url' })).toBe('http://x')
  })
  it('redirect URIs ignore a forged request origin when pinned', () => {
    process.env.CEREBRO_OAUTH_ORIGIN = 'https://app.example.com'
    expect(redirectUri('https://evil.example')).toBe('https://app.example.com/api/oauth/youtube/callback')
  })
})

describe('least-privilege scopes', () => {
  it('Instagram and TikTok read sets never include publishing', () => {
    expect(SOCIAL_SCOPE_SETS.instagram.read).toEqual(['instagram_business_basic'])
    expect(SOCIAL_SCOPE_SETS.tiktok.read).toEqual(['user.info.basic'])
    expect(SOCIAL_SCOPE_SETS.instagram.publish).toContain('instagram_business_content_publish')
    process.env.INSTAGRAM_APP_ID = 'id-prueba'
    const read = new URL(socialAuthUrl('instagram', 'https://a.example', 'st', 'read')).searchParams
    expect(read.get('scope')).toBe('instagram_business_basic'); expect(read.get('state')).toBe('st')
    expect(new URL(socialAuthUrl('instagram', 'https://a.example', 'st', 'publish')).searchParams.get('scope')).toContain('content_publish')
  })
  it('YouTube read set has no upload scope; publish adds only upload', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'
    const ro = new URL(authUrl('https://a.example', 'st', 'analytics')).searchParams
    expect(ro.get('scope')).not.toMatch(/youtube\.upload/); expect(ro.get('state')).toBe('st'); expect(ro.get('access_type')).toBe('offline')
    expect(new URL(authUrl('https://a.example', 'st', 'publish')).searchParams.get('scope')).toContain(SCOPES.publish[0])
  })
})
