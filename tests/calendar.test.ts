import { describe, expect, it } from 'vitest'
import { canPlan, dayKey, formatAdvice, groupByDay, jobDate, monthGrid, multiPlatformDrafts, type CalendarJob } from '@/lib/calendar'

const job = (o: Partial<CalendarJob>): CalendarJob => ({ id: 'j', project_id: 'p', platform: 'youtube', status: 'draft', scheduled_for: null, created_at: '2026-10-01T00:00:00Z', payload: {}, result: null, ...o })

describe('editorial calendar', () => {
  it('places a job on its truest date: published > YouTube publishAt > planned', () => {
    expect(jobDate(job({ status: 'published', result: { publishedAt: '2026-10-20T23:05:43Z' }, scheduled_for: '2026-10-01T12:00:00Z' }))?.kind).toBe('published')
    expect(jobDate(job({ payload: { publishAt: '2026-11-02T10:00:00Z' }, scheduled_for: '2026-10-01T12:00:00Z' }))?.kind).toBe('scheduled')
    expect(jobDate(job({ platform: 'tiktok', payload: { publishAt: '2026-11-02T10:00:00Z' }, scheduled_for: '2026-10-05T12:00:00Z' }))?.kind).toBe('planned')
    expect(jobDate(job({ status: 'cancelled', scheduled_for: '2026-10-05T12:00:00Z' }))).toBeNull()
  })
  it('groups by local day and keeps undated, non-cancelled jobs apart', () => {
    const at = new Date(2026, 9, 5, 12)
    const { byDay, undated } = groupByDay([job({ id: 'a', scheduled_for: at.toISOString() }), job({ id: 'b' }), job({ id: 'c', status: 'cancelled' })])
    expect(byDay.get(dayKey(at))?.map(j => j.id)).toEqual(['a'])
    expect(undated.map(j => j.id)).toEqual(['b'])
  })
  it('builds a Monday-first 6-week grid', () => {
    const g = monthGrid(2026, 9) // October 2026 starts on a Thursday
    expect(g).toHaveLength(42)
    expect(g[3]).toMatchObject({ day: 1, inMonth: true })
    expect(g[0].inMonth).toBe(false)
  })
  it('only drafts can be planned from the browser', () => {
    expect(canPlan({ status: 'draft' })).toBe(true); expect(canPlan({ status: 'approved' })).toBe(false)
  })
  it('creates one conservative draft per platform', () => {
    let n = 0
    const rows = multiPlatformDrafts({ videoAssetId: 'v', title: 'Título', text: 'Texto', platforms: ['youtube', 'instagram', 'tiktok'], plannedFor: null }, 'u', 'p', () => `k${n++}`)
    expect(rows.map(r => r.platform)).toEqual(['youtube', 'instagram', 'tiktok'])
    expect(rows[0].payload).toMatchObject({ privacyStatus: 'private', containsSyntheticMedia: true, title: 'Título' })
    expect(rows[2].payload).not.toHaveProperty('privacyLevel')
    expect(rows[2].payload).toMatchObject({ disableComment: true, disableDuet: true, disableStitch: true, isAigc: true })
    expect(new Set(rows.map(r => r.idempotency_key)).size).toBe(3)
    expect(rows.every(r => r.status === 'draft')).toBe(true)
  })
  it('advises a vertical version for Instagram/TikTok', () => {
    expect(formatAdvice('16:9', 'tiktok')).toMatch(/vertical/)
    expect(formatAdvice('9:16', 'instagram')).toBeNull()
    expect(formatAdvice('16:9', 'youtube')).toBeNull()
  })
})
