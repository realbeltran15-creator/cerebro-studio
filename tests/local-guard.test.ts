import { describe, expect, it } from 'vitest'
import { assertLocalOnly, LocalOnlyError } from '@/lib/queue/local-guard'

const ok = { env: { PATH: '/usr/bin', HOME: '/root' }, dbHost: '/tmp/pgsim.abc', dryRun: true }
const reasons = (i: Parameters<typeof assertLocalOnly>[0]) => { try { assertLocalOnly(i); return [] } catch (e) { expect(e).toBeInstanceOf(LocalOnlyError); return (e as LocalOnlyError).reasons } }

describe('bloqueo «solo local» del runner', () => {
  it('acepta socket local, entorno limpio y dry_run=true', () => {
    expect(() => assertLocalOnly(ok)).not.toThrow()
    expect(() => assertLocalOnly({ ...ok, dbHost: 'localhost' })).not.toThrow()
    expect(() => assertLocalOnly({ ...ok, dbHost: '127.0.0.1' })).not.toThrow()
  })
  it('rechaza variables de Production aunque se pasen a propósito (y no filtra sus valores)', () => {
    for (const name of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_ENV', 'VERCEL', 'CRON_SECRET', 'DATABASE_URL', 'POSTGRES_URL', 'PGHOST', 'YOUTUBE_API_KEY', 'GOOGLE_CLIENT_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY']) {
      const r = reasons({ ...ok, env: { ...ok.env, [name]: 'valor-secreto-123' } })
      expect(r.join(' '), name).toContain(name)
      expect(r.join(' '), name).not.toContain('valor-secreto-123')
    }
  })
  it('una variable vacía no cuenta; una con valor sí', () => {
    expect(reasons({ ...ok, env: { ...ok.env, SUPABASE_URL: '' } })).toEqual([])
    expect(reasons({ ...ok, env: { ...ok.env, SUPABASE_URL: 'https://x.supabase.co' } })).toHaveLength(1)
  })
  it('rechaza hosts remotos y dry_run distinto de true', () => {
    for (const host of ['db.psbvqdaksrfrkxbewrll.supabase.co', 'aws-0-eu.pooler.supabase.com', 'cerebro.vercel.app', '10.0.0.5', 'example.com', '/mnt/supabase-socket']) {
      expect(reasons({ ...ok, dbHost: host }).length, host).toBeGreaterThan(0)
    }
    expect(reasons({ ...ok, dryRun: false })).toEqual(['dry_run debe ser true'])
  })
  it('acumula todos los motivos', () => {
    expect(reasons({ env: { SUPABASE_URL: 'x' }, dbHost: 'x.supabase.co', dryRun: false }).length).toBeGreaterThanOrEqual(3)
  })
})
