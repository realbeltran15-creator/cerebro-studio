import { describe, expect, it } from 'vitest'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'
import { COUNTRY_INFO, GEOLOCATION_LIMITS, compareMarkets, countryInfo } from '@/lib/research/markets-info'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

// SIMULATED samples (no YouTube call): they check the comparability rules, not real market data.
const NOW = Date.parse('2026-10-13T12:00:00Z'); let n = 0
const vid = (title: string, o: { views?: number; subs?: number; days?: number; lang?: string } = {}): YouTubeVideoResult => { const days = o.days ?? 10, views = o.views ?? 4000, subs = o.subs ?? 8000; return { videoId: `m${++n}`, url: '', title, channelId: `ch${n}`, channelTitle: 'C', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: o.lang ?? 'en', observed: { views, likes: 10, comments: 1, durationSeconds: 600, channelSubscribers: subs, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: views / subs, engagementRate: 1 } } as YouTubeVideoResult }
const analysis = (topic: string, region: string, language: string, count: number, days = 30) => {
  const mk = (k: number, d: number) => Array.from({ length: k }, (_, i) => vid(`${topic} guide ${i}`, { days: d + i, lang: language, views: 3000 + i * 100 }))
  const s: TopicSamples = { topic, region, language, top: { videos: mk(count, 20), approxTotal: 1000 }, recent: { videos: mk(Math.min(count, 18), 4), approxTotal: 100 }, recentDays: days, fetchedAt: new Date(NOW).toISOString(), units: 204 }
  return analyzeTopic(s, NOW)
}

describe('market notes', () => {
  it('covers the six markets with languages and local terminology, and says the notes are editorial', () => {
    expect(COUNTRY_INFO.map(c => c.code).sort()).toEqual(['AU', 'CA', 'CH', 'DE', 'GB', 'US'])
    expect(countryInfo('GB')!.terminology.flatMap(t => t.terms)).toContain('ISA'); expect(countryInfo('CH')!.languages).toEqual(['de', 'fr', 'it']); expect(countryInfo('CA')!.languages).toContain('fr')
    expect(GEOLOCATION_LIMITS.join(' ')).toMatch(/regionCode/)
  })
})

describe('comparing markets', () => {
  const col = (label: string, region: string, language: string, topic: string, count = 25, days = 30) => ({ key: label, label, region, language, analysis: analysis(topic, region, language, count, days) })
  it('one market alone cannot be compared', () => { expect(compareMarkets([col('US', 'US', 'en', 'index funds')])).toBeNull() })
  it('same topic, language and window with enough videos: comparable', () => {
    const c = compareMarkets([col('Estados Unidos', 'US', 'en', 'index funds'), col('Reino Unido', 'GB', 'en', 'index funds')])!
    expect(c.pairs[0].level).toBe('comparable'); expect(c.notes.join(' ')).toMatch(/regionCode/)
  })
  it('different languages are only partly comparable (different words are searched)', () => {
    const c = compareMarkets([col('Alemania', 'DE', 'de', 'index funds'), col('Reino Unido', 'GB', 'en', 'index funds')])!
    expect(c.pairs[0].level).toBe('parcial'); expect(c.pairs[0].reasons.join(' ')).toMatch(/Idiomas distintos/)
  })
  it('different windows are not comparable', () => {
    const c = compareMarkets([col('A', 'US', 'en', 'index funds', 25, 30), col('B', 'GB', 'en', 'index funds', 25, 90)])!
    expect(c.pairs[0].level).toBe('no_comparable')
  })
  it('a tiny sample is never compared and no cross-country conclusion is drawn', () => {
    const c = compareMarkets([col('A', 'AU', 'en', 'index funds', 4), col('B', 'CA', 'en', 'index funds', 4)])!
    expect(c.pairs[0].level).toBe('no_comparable'); expect(c.findings.join(' ')).toMatch(/no se saca ninguna conclusión/)
  })
})
