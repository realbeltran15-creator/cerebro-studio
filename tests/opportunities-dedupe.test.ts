import { describe, expect, it } from 'vitest'
import { insertOpportunities, isUniqueViolation } from '@/lib/opportunities'

const dup = { code: '23505', message: 'duplicate key value' }
function fakeDb(existing: Set<string>, failOther = false) {
  const calls: unknown[] = []
  return { calls, from: () => ({ insert: async (rows: unknown) => {
    calls.push(rows)
    const list = Array.isArray(rows) ? rows : [rows]
    if (failOther) return { error: { code: '42501', message: 'permission denied' } }
    if (list.some((r: { source_id: string }) => existing.has(r.source_id))) return { error: dup }
    list.forEach((r: { source_id: string }) => existing.add(r.source_id))
    return { error: null }
  } }) }
}
const rows = ['a', 'b', 'c'].map(source_id => ({ source_id }))

describe('opportunity de-duplication under concurrency', () => {
  it('recognises the unique violation code only', () => {
    expect(isUniqueViolation(dup)).toBe(true)
    expect(isUniqueViolation({ code: '42501' })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
  it('inserts a clean batch in one call', async () => {
    const db = fakeDb(new Set())
    expect(await insertOpportunities(db as never, rows)).toEqual({ saved: 3, duplicates: 0 })
    expect(db.calls).toHaveLength(1)
  })
  it('falls back row by row when a concurrent save already holds one, counting it as a duplicate', async () => {
    const db = fakeDb(new Set(['b']))
    expect(await insertOpportunities(db as never, rows)).toEqual({ saved: 2, duplicates: 1 })
  })
  it('still fails on any other database error', async () => {
    await expect(insertOpportunities(fakeDb(new Set(), true) as never, rows)).rejects.toThrow('permission denied')
  })
  it('does nothing for an empty batch', async () => {
    expect(await insertOpportunities(fakeDb(new Set()) as never, [])).toEqual({ saved: 0, duplicates: 0 })
  })
})
