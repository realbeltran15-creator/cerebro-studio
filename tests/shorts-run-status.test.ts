import { describe, expect, it } from 'vitest'
import { shortsRunKind } from '@/lib/shorts/run-status'

describe('shortsRunKind', () => {
  it('tells apart generated, skipped, error and running', () => {
    expect(shortsRunKind({ status: 'succeeded', summary: { outcome: { status: 'prepared' } } })).toBe('generated')
    expect(shortsRunKind({ status: 'succeeded', summary: { outcome: { status: 'skipped', reason: 'no_data' } } })).toBe('skipped')
    expect(shortsRunKind({ status: 'succeeded', summary: { outcome: { status: 'skipped', reason: 'generation_failed' } } })).toBe('error')
    expect(shortsRunKind({ status: 'succeeded', summary: { outcome: { status: 'skipped', reason: 'storage_failed' } } })).toBe('error')
    expect(shortsRunKind({ status: 'failed' })).toBe('error')
    expect(shortsRunKind({ status: 'running' })).toBe('running')
    expect(shortsRunKind({ status: 'succeeded', summary: {} })).toBe('error')
  })
})
