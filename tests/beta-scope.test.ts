import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { betaScopeOn, betaVerdict, BETA_API_ALLOWED, inBetaScope, isBetaApi, isBetaPage } from '../lib/beta-scope'
import { studioModules } from '../lib/module-status'
import { ROUTE_POLICY } from '../lib/security/route-policy'
import { betaConfigProblems, PAID_PROVIDER_VARS, PRIVILEGED_VARS, PRODUCTION_SUPABASE_REF } from '../lib/security/beta-config'

const ON = { NEXT_PUBLIC_CEREBRO_BETA: 'private' }
const root = path.resolve(__dirname, '..')
const walk = (d: string, out: string[] = []) => { for (const n of readdirSync(d)) { const f = path.join(d, n); statSync(f).isDirectory() ? walk(f, out) : out.push(f) } return out }

describe('beta scope: what stays open', () => {
  it('is off by default (Production behaves as before) and on only with the explicit value', () => {
    expect(betaScopeOn({})).toBe(false); expect(betaScopeOn({ NEXT_PUBLIC_CEREBRO_BETA: '1' })).toBe(false); expect(betaScopeOn(ON)).toBe(true)
    expect(betaVerdict('/youtube', {})).toBe('open'); expect(betaVerdict('/api/providers/render', {})).toBe('open')
  })
  it('keeps the audiovisual journey open', () => {
    for (const p of ['/', '/login', '/projects', '/projects/abc', '/scripts', '/create', '/library', '/audio', '/editor', '/editor/manual', '/storage', '/legal/privacy',
      '/editor/templates', '/editor/auto', '/editor/style', '/editor/styles', '/repurpose', '/thumbnails', '/workflows', '/calendar', '/usage'])
      expect(betaVerdict(p, ON), p).toBe('open')
  })
  it('closes everything that spends, publishes, automates or connects accounts', () => {
    for (const p of ['/studio', '/images', '/videos', '/voices', '/youtube', '/social', '/campaigns', '/automations', '/connectors', '/influencer',
      '/shorts', '/add', '/market-intelligence', '/radar', '/opportunities', '/analytics', '/queue'])
      expect(betaVerdict(p, ON), p).toBe('redirect-home')
  })
  it('does not let a look-alike prefix through', () => {
    expect(isBetaPage('/projectsX')).toBe(false); expect(isBetaPage('/editor/manualx')).toBe(false); expect(isBetaPage('/library-evil')).toBe(false)
  })
  it('API: only four read/own-file routes remain; any other /api answers closed', () => {
    for (const p of ['/api/assets/abc/signed-url', '/api/storage/usage', '/api/storage/upload-url', '/api/providers/status']) expect(betaVerdict(p, ON), p).toBe('open')
    for (const p of ['/api/providers/render', '/api/providers/voice', '/api/scripts/assist', '/api/transcribe', '/api/studio/generate', '/api/cron/automations', '/api/publish/youtube/x/publish',
      '/api/oauth/youtube/start', '/api/ios/token', '/api/render/ticket', '/api/queue', '/api/research/topic', '/api/assets/abc/signed-url/extra', '/api/assets//signed-url'])
      expect(betaVerdict(p, ON), p).toBe('api-closed')
  })
  it('every API route that stays open is one the route policy already marks as safe (never a blocked kind)', () => {
    const files = walk(path.join(root, 'app/api')).filter(f => /route\.ts$/.test(f)).map(f => path.relative(path.join(root, 'app/api'), path.dirname(f)).split(path.sep).join('/'))
    const open = files.filter(r => isBetaApi('/api/' + r.replace(/\[[^\]]+\]/g, 'x')))
    expect(open.length).toBe(BETA_API_ALLOWED.length) // each allowed pattern maps to exactly one real route
    for (const r of open) { const pol = ROUTE_POLICY[r] as { blocked?: string } | undefined; expect(pol, r).toBeDefined(); expect(pol!.blocked, r).toBeUndefined() }
  })
  it('navigation and home tiles show only in-scope modules when the scope is on', () => {
    const on = inBetaScope(studioModules, ON).map(m => m.href)
    expect(on).toEqual(expect.arrayContaining(['/', '/projects', '/scripts', '/create', '/library', '/audio', '/editor', '/editor/manual']))
    for (const bad of ['/youtube', '/social', '/campaigns', '/automations', '/connectors', '/studio', '/shorts', '/opportunities']) expect(on).not.toContain(bad)
    expect(inBetaScope(studioModules, {}).length).toBe(studioModules.length)
  })
  it('every page in the app is classified (new pages are closed by default until added to the scope)', () => {
    const pages = walk(path.join(root, 'app')).filter(f => /page\.tsx$/.test(f)).map(f => '/' + path.relative(path.join(root, 'app'), path.dirname(f)).split(path.sep).join('/')).map(p => p === '/.' ? '/' : p).filter(p => !/\[/.test(p))
    expect(pages.length).toBeGreaterThan(20)
    const open = pages.filter(p => isBetaPage(p)); const closed = pages.filter(p => !isBetaPage(p))
    expect(open.length).toBeGreaterThan(0); expect(closed.length).toBeGreaterThan(10)
    expect(closed).toEqual(expect.arrayContaining(['/youtube', '/campaigns', '/studio']))
  })
})

describe('beta configuration guard', () => {
  const GOOD = { NEXT_PUBLIC_CEREBRO_BETA: 'private', NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', VERCEL_ENV: 'preview' }
  it('accepts an independent project without paid or privileged keys', () => { expect(betaConfigProblems(GOOD)).toEqual([]) })
  it('accepts a local stack', () => { expect(betaConfigProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54380', VERCEL_ENV: undefined })).toEqual([]) })
  it('rejects the Production project by URL', () => {
    const p = betaConfigProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co` })
    expect(p.join(' ')).toMatch(/Production/)
  })
  it('rejects a legacy key issued by Production even when the URL is a custom domain', () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const key = `${b64({ alg: 'HS256' })}.${b64({ ref: PRODUCTION_SUPABASE_REF, role: 'anon' })}.sig`
    expect(betaConfigProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }).join(' ')).toMatch(/clave del proyecto de Production/)
  })
  it('rejects an unverifiable URL, a missing URL/key, VERCEL_ENV=production and a scope that is not on', () => {
    expect(betaConfigProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: 'https://db.mi-dominio.com' }).join(' ')).toMatch(/no se puede comprobar/)
    expect(betaConfigProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: '' }).join(' ')).toMatch(/falta/)
    expect(betaConfigProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ' ' }).join(' ')).toMatch(/falta/)
    expect(betaConfigProblems({ ...GOOD, VERCEL_ENV: 'production' }).join(' ')).toMatch(/Production/)
    expect(betaConfigProblems({ ...GOOD, NEXT_PUBLIC_CEREBRO_BETA: undefined }).join(' ')).toMatch(/alcance cerrado/)
  })
  it('rejects every paid-provider and privileged variable, naming it but never printing its value', () => {
    for (const k of [...PAID_PROVIDER_VARS, ...PRIVILEGED_VARS]) {
      const p = betaConfigProblems({ ...GOOD, [k]: 'SECRET-VALUE-123' })
      expect(p.some(x => x.startsWith(k)), k).toBe(true); expect(p.join('\n')).not.toContain('SECRET-VALUE-123')
    }
  })
  it('the lists cover every provider/privileged variable the code reads', () => {
    const vars = new Set<string>()
    for (const f of [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))].filter(f => /\.(ts|tsx)$/.test(f))) for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) vars.add(m[1])
    const known = new Set<string>([...PAID_PROVIDER_VARS, ...PRIVILEGED_VARS])
    const secretish = [...vars].filter(v => /(KEY|SECRET|TOKEN)/.test(v) && !v.startsWith('NEXT_PUBLIC_'))
    // Anything secret-looking that the code reads must be classified here or be one of these explicit free-source keys.
    const FREE_OR_SAFE = new Set(['PEXELS_API_KEY', 'PIXABAY_API_KEY', 'FREESOUND_API_KEY', 'YOUTUBE_API_KEY', 'GOOGLE_OAUTH_CLIENT_ID', 'INSTAGRAM_APP_ID', 'TIKTOK_CLIENT_KEY', 'CLOUDFLARE_ACCOUNT_ID'])
    expect(secretish.filter(v => !known.has(v) && !FREE_OR_SAFE.has(v))).toEqual([])
  })
})
