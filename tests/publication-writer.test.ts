import { afterEach, describe, expect, it } from 'vitest'
import { _resetServiceRoleClient, publicationWriter, serviceRoleClient } from '@/lib/supabase/admin'

describe('publication writer (service role after the RLS hardening)', () => {
  const env = { ...process.env }
  afterEach(() => { process.env = { ...env }; _resetServiceRoleClient() })
  it('falls back to the session client while SUPABASE_SERVICE_ROLE_KEY is not configured (pre-migration behaviour)', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const session = { from: () => null } as never
    expect(serviceRoleClient()).toBeNull()
    expect(publicationWriter(session)).toBe(session)
  })
  it('uses a separate service-role client when the key is configured', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    const session = { from: () => null } as never
    const w = publicationWriter(session)
    expect(w).not.toBe(session)
    expect(typeof w.from).toBe('function')
  })
})
