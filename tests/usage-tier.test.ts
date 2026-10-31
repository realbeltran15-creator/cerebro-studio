import { describe, expect, it } from 'vitest'
import { entryOf } from '@/lib/providers/usage'

const base = { id: 'a', asset_type: 'video', project_id: null, created_at: '2026-10-31T17:00:00Z', license_status: 'generated', provenance: null }

describe('usage tiers', () => {
  it('lists renders made in the browser as local, never as paid', () => {
    const e = entryOf({ ...base, source_provider: 'browser-render' } as never)
    expect(e.tier).toBe('local')
    expect(e.estimatedUsd).toBe(0)
  })
  it('still treats an unknown provider with no cost data as paid (conservative)', () => {
    expect(entryOf({ ...base, source_provider: 'fal' } as never).tier).toBe('paid')
  })
})