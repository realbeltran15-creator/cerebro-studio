import { describe, expect, it } from 'vitest'
import { analyzeTopic, type TopicAnalysis, type TopicSamples } from '@/lib/research/topic-analysis'
import { detectOpportunities } from '@/lib/research/opportunities'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

// SIMULATED samples (no YouTube call): they check the detectors' rules and guard rails, not what exists on YouTube.
const NOW = Date.parse('2026-10-13T12:00:00Z'); let n = 0
type O = { views?: number; subs?: number; days?: number; ch?: string; title?: string }
const vid = (topic: string, i: number, o: O = {}): YouTubeVideoResult => { const days = o.days ?? 20, views = o.views ?? 60_000, subs = o.subs ?? 8000; return { videoId: `o${++n}`, url: `https://www.youtube.com/watch?v=o${n}`, title: o.title ?? `${topic} guide ${i}`, channelId: o.ch ?? `ch${n}`, channelTitle: `Canal ${n}`, publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: 'https://i.ytimg.com/x.jpg', declaredLanguage: 'en', observed: { views, likes: 10, comments: 1, durationSeconds: 600, channelSubscribers: subs, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: views / subs, engagementRate: 1 } } as YouTubeVideoResult }
const build = (topic: string, f: { top: (i: number) => O; recent: (i: number) => O; nTop?: number; nRecent?: number; region?: string | null; language?: string | null }): TopicAnalysis => {
  const s: TopicSamples = { topic, region: f.region ?? 'US', language: f.language ?? 'en', top: { videos: Array.from({ length: f.nTop ?? 25 }, (_, i) => vid(topic, i, f.top(i))), approxTotal: 900 }, recent: { videos: Array.from({ length: f.nRecent ?? 14 }, (_, i) => vid(topic, 100 + i, f.recent(i))), approxTotal: 80 }, recentDays: 30, fetchedAt: new Date(NOW).toISOString(), units: 204 }
  return analyzeTopic(s, NOW)
}

describe('underserved niche detectors', () => {
  it('nothing in, nothing out: it never invents opportunities to fill a category', () => { expect(detectOpportunities([], NOW)).toEqual([]) })

  it('real demand with little new supply is reported with verifiable videos and an uncertainty', () => {
    const a = build('bonsai care', { top: i => ({ views: 90_000 + i * 500, ch: `c${i}`, days: 60 + i }), recent: i => ({ views: 12_000, days: 12 + i, ch: `r${i % 3}` }), nRecent: 10 })
    expect(a.confidence).not.toBe('baja'); expect(a.indices.supply).toBeLessThanOrEqual(40)
    const opps = detectOpportunities([a], NOW), o = opps.find(x => x.kind === 'demanda_poca_oferta')
    expect(o).toBeTruthy(); expect(o!.evidence.some(e => e.url && e.thumbnailUrl)).toBe(true); expect(o!.uncertainty.length).toBeGreaterThan(40); expect(o!.nextStep).toBeTruthy()
  })

  it('a saturated niche (lots of supply, huge channels) is never reported as an underserved opportunity', () => {
    const a = build('crypto news', { top: i => ({ views: 400_000, subs: 3_000_000, ch: `big${i % 4}` }), recent: i => ({ views: 90_000, subs: 2_000_000, ch: `rc${i}`, days: 1 + i }), nRecent: 25 })
    expect(detectOpportunities([a], NOW).filter(o => o.kind === 'demanda_poca_oferta')).toEqual([])
  })

  it('a thin or contaminated sample yields no opportunity at all (only the explicit «a verificar» warning for poor searches)', () => {
    const thin = build('tiny topic', { top: () => ({}), recent: () => ({}), nTop: 6, nRecent: 3 })
    expect(detectOpportunities([thin], NOW).filter(o => o.strength !== 'a_verificar')).toEqual([])
  })

  it('demand carried by one viral video is not sustained demand and is not reported', () => {
    const a = build('one hit', { top: i => ({ views: i === 0 ? 20_000_000 : 3000, ch: `c${i}` }), recent: i => ({ views: 800, ch: `r${i % 3}`, days: 10 + i }), nRecent: 6 })
    expect(detectOpportunities([a], NOW).filter(o => o.kind === 'demanda_poca_oferta')).toEqual([])
  })

  it('small channels that beat their own subscriber count are listed with those exact videos', () => {
    const a = build('woodworking tips', { top: i => ({ views: 30_000, subs: i % 2 ? 2000 : 900_000, ch: `c${i}`, days: 40 + i }), recent: i => ({ views: 3000, ch: `r${i}`, days: 3 + i }) })
    const o = detectOpportunities([a], NOW).find(x => x.kind === 'canales_pequenos')
    expect(o).toBeTruthy(); expect(o!.evidence.filter(e => e.videoId).length).toBeGreaterThan(0)
  })

  it('a language/country gap is only reported when the markets are comparable and the difference is large; always with the limits stated', () => {
    const us = build('index funds', { top: i => ({ views: 300_000, subs: 2_000_000, ch: `u${i % 3}` }), recent: i => ({ views: 70_000, ch: `ur${i}`, days: 1 + i }), nRecent: 25 })
    const gb = build('index funds', { region: 'GB', top: i => ({ views: 80_000 + i * 300, ch: `g${i}`, days: 50 + i }), recent: i => ({ views: 3000, ch: `gr${i % 3}`, days: 9 + i }), nRecent: 6 })
    const opps = detectOpportunities([us, gb], NOW), gap = opps.find(o => o.kind === 'pais')
    if (gap) { expect(gap.market).toMatch(/Reino Unido/); expect(gap.uncertainty).toMatch(/no prueba dónde viven/) }
    expect(opps.every(o => o.uncertainty && o.nextStep)).toBe(true)
  })

  it('a search that mostly returns unrelated videos is only flagged «a verificar»: no videos is not demand', () => {
    const mixed = Array.from({ length: 25 }, (_, i) => vid('zzqx', i, i < 4 ? { title: 'zzqx guide' } : { title: `cooking pasta ${i}` }))
    const s: TopicSamples = { topic: 'zzqx', region: 'US', language: 'en', top: { videos: mixed, approxTotal: 10 }, recent: { videos: mixed.slice(0, 10), approxTotal: 10 }, recentDays: 30, fetchedAt: new Date(NOW).toISOString(), units: 204 }
    const opps = detectOpportunities([analyzeTopic(s, NOW)], NOW)
    expect(opps.filter(o => o.strength !== 'a_verificar')).toEqual([])
  })
})

describe('recommendation brief answers the questions and never hides uncertainty', () => {
  it('a thin analysis says so and tells the user to widen the search first', async () => {
    const { recoBrief } = await import('@/lib/research/recommendations')
    const thin = build('tiny topic', { top: () => ({}), recent: () => ({}), nTop: 6, nRecent: 3 })
    const b = recoBrief(thin)
    expect(b.uncertainty).toMatch(/muestra relevante es pequeña/); expect(b.nextStep).toMatch(/Antes de nada/)
    for (const k of ['niche', 'market', 'demand', 'competition', 'why', 'uncertainty', 'channelType', 'formats', 'nextStep'] as const) expect(b[k], k).toBeTruthy()
  })
  it('a no-demand topic is never presented as an opportunity because supply is low', async () => {
    const { recoBrief } = await import('@/lib/research/recommendations')
    const a = build('nobody watches', { top: () => ({ views: 120, subs: 300 }), recent: () => ({ views: 20, days: 15 }), nRecent: 10 })
    expect(recoBrief(a).why).toMatch(/ausencia de vídeos no es una oportunidad|Señales mixtas/)
  })
})
