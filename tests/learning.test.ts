import { describe, expect, it } from 'vitest'
import { learnFromVideos, type LearningVideo } from '@/lib/analytics/learning'

const v = (i: number, views: number | null, pct: number | null = null, dur: number | null = null): LearningVideo => ({ id: `v${i}`, title: `Vídeo ${i}`, projectId: i === 1 ? 'p1' : null, views, avgViewPercentage: pct, avgViewDurationSeconds: dur })

describe('learnFromVideos (calculated, descriptive)', () => {
  it('refuses to conclude from too few videos', () => {
    const r = learnFromVideos([v(1, 100), v(2, 200)])
    expect(r.enough).toBe(false)
    expect(r.outperformers).toEqual([])
    expect(r.notes[0]).toMatch(/al menos 5/)
  })
  it('finds videos at 2x the median or more, with their ratio and project link', () => {
    const r = learnFromVideos([v(1, 1000), v(2, 100), v(3, 120), v(4, 90), v(5, 110)])
    expect(r.medianViews).toBe(110)
    expect(r.outperformers).toEqual([{ id: 'v1', title: 'Vídeo 1', projectId: 'p1', views: 1000, ratio: 9.1 }])
  })
  it('ranks retention and compares views by inferred length only with enough videos per bucket', () => {
    const r = learnFromVideos([v(1, 500, 80, 40), v(2, 400, 70, 30), v(3, 100, 40, 120), v(4, 90, 35, 140), v(5, 120, 45, 300)])
    expect(r.retentionLeaders.map(x => x.id)).toEqual(['v1', 'v2', 'v5'])
    const short = r.lengthBuckets.find(b => b.label === 'Menos de 1 min')!
    expect(short.count).toBe(2)
    expect(r.lengthBuckets.every(b => b.count >= 2)).toBe(true)
  })
  it('ignores videos without views', () => {
    expect(learnFromVideos([v(1, null), v(2, null)]).sampleSize).toBe(0)
  })
})
