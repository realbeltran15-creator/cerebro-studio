import { describe, expect, it } from 'vitest'
import { compactForCloud, HISTORY_MAX, mergeAnalyses } from '@/lib/research/history'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'

const a = (topic: string, fetchedAt: string, extra: Partial<TopicAnalysis> = {}) => ({ topic, fetchedAt, quality: {}, growth: {}, topVideos: Array.from({ length: 9 }, (_, i) => ({ videoId: `v${i}` })), sample: Array.from({ length: 60 }, (_, i) => ({ videoId: `s${i}`, title: 'x'.repeat(200) })), ...extra }) as unknown as TopicAnalysis

describe('cloud copy of paid research analyses', () => {
  it('merges local and remote keeping the most recent per key', () => {
    const m = mergeAnalyses({ k1: a('local', '2026-10-18T10:00:00Z'), k2: a('only-local', '2026-10-01T00:00:00Z') }, { k1: a('remote', '2026-10-17T10:00:00Z'), k3: a('only-remote', '2026-10-02T00:00:00Z') })
    expect(m.k1.topic).toBe('local'); expect(Object.keys(m).sort()).toEqual(['k1', 'k2', 'k3'])
    expect(mergeAnalyses({ k1: a('old', '2026-10-01T00:00:00Z') }, { k1: a('new', '2026-10-05T00:00:00Z') }).k1.topic).toBe('new')
  })
  it('keeps the newest analyses and shrinks detail, never the numbers, to fit the size limit', () => {
    const many = Object.fromEntries(Array.from({ length: HISTORY_MAX + 5 }, (_, i) => [`k${i}`, a(`t${i}`, new Date(Date.UTC(2026, 9, 1) + i * 3600e3).toISOString())]))
    const c = compactForCloud(many)
    expect(Object.keys(c)).toHaveLength(HISTORY_MAX)
    expect(c.k0).toBeUndefined(); expect(c[`k${HISTORY_MAX + 4}`]).toBeDefined()
    const tight = compactForCloud(many, 60_000)
    expect(Object.values(tight).every(x => x.sample.length === 0)).toBe(true)
    expect(Object.values(tight).every(x => x.quality && x.growth)).toBe(true)
  })
})
