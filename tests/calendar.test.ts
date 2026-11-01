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

import { plannedIso, dayKey as dk, monthGrid as mg } from '@/lib/calendar'
import { describe as dsc, expect as ex, it as t } from 'vitest'

dsc('fechas del calendario: validez y horario de verano', () => {
  t('rechaza días inexistentes y formatos raros', () => {
    for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '26-01-01', '', null, undefined, '2026-1-1', '2026-04-31']) ex(plannedIso(bad as string)).toBeNull()
    ex(plannedIso('2028-02-29')).not.toBeNull()
    ex(plannedIso('2027-02-29')).toBeNull()
  })
  t('el día guardado vuelve a ser el mismo día en el calendario, también en los días de cambio de hora', () => {
    for (const day of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26', '2026-12-31', '2027-01-01']) {
      const iso = plannedIso(day)!
      ex(dk(new Date(iso))).toBe(day)
    }
  })
  t('la cuadrícula de un mes tiene 42 días consecutivos sin repetir ni saltar ninguno (incluido octubre)', () => {
    for (const [y, m] of [[2026, 2], [2026, 9], [2026, 10], [2027, 0]]) {
      const g = mg(y, m); ex(new Set(g.map(c => c.key)).size).toBe(42)
      for (let i = 1; i < g.length; i++) ex(Date.parse(g[i].key) - Date.parse(g[i - 1].key)).toBe(86_400_000)
    }
  })
})
