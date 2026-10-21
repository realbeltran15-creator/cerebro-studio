import { describe, expect, it } from 'vitest'
import { analysePatterns, usableVideos } from '@/lib/research/patterns'
import type { SampleVideo } from '@/lib/research/topic-analysis'
const NOW = '2026-10-21T00:00:00Z'
let n = 0
const v = (title: string, views: number, daysAgo: number, dur = 300, status: SampleVideo['status'] = 'aceptado'): SampleVideo => ({
  videoId: `v${n++}`, url: '', title, channelTitle: 'c', views, publishedAt: new Date(Date.parse(NOW) - daysAgo * 864e5).toISOString(), durationSeconds: dur,
  inTop: true, inRecent: false, status, reason: null, detail: '', language: 'es', languageVerdict: 'coincide', promo: false, outlier: false, format: 'long', live: null,
})

describe('research patterns', () => {
  it('uses only accepted videos with views and a date, at least one day old', () => {
    const vids = usableVideos([v('a', 100, 0.1), v('b', 100, 10), v('c', 100, 10, 300, 'descartado')], Date.parse(NOW))
    expect(vids.map(x => Math.round(x.vpd))).toEqual([100, 10])
  })
  it('compares titles with and without a feature and flags small groups', () => {
    const sample = [
      ...[1, 2, 3, 4, 5].map(i => v(`7 secretos del mar ${i}`, 10000, 10)),
      ...[1, 2, 3, 4, 5].map(() => v('historia del mar profundo', 1000, 10)),
      v('¿Quién construyó esto?', 500, 10),
    ]
    const p = analysePatterns({ sample, fetchedAt: NOW })
    const num = p.titles.find(t => t.id === 'number')!
    expect(num).toMatchObject({ count: 5, medianVpd: 1000, small: false })
    expect(num.lift).toBeGreaterThan(5)
    expect(p.titles.find(t => t.id === 'question')).toMatchObject({ count: 1, small: true, lift: null })
    expect(p.summary.join(' ')).toMatch(/Con un número/)
  })
  it('groups durations and weekdays and never divides by an empty group', () => {
    const p = analysePatterns({ sample: [v('a', 100, 3, 30), v('b', 100, 3, 900)], fetchedAt: NOW })
    expect(p.durations.map(d => d.count)).toEqual([1, 0, 0, 1, 0])
    expect(p.durations[1].medianVpd).toBeNull()
    expect(p.weekdays.reduce((s, d) => s + d.count, 0)).toBe(2)
    expect(p.summary[0]).toMatch(/Muestra pequeña/)
  })
})

