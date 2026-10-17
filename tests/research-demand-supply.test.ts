import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'
import { METHOD, demandReliability, opportunityOf, shownOpportunity } from '@/lib/research/statistics'

// SIMULATED samples. They prove how the engine treats isolated hits and videos without traction; they are not YouTube's output.
const NOW = Date.parse('2026-10-18T12:00:00Z')
let n = 0
type V = { title?: string; views: number; days: number; ch: string; subs?: number; dur?: number; tags?: string[] }
const vid = (o: V): YouTubeVideoResult => {
  const id = `d${++n}`, dur = o.dur ?? 600
  return { videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: o.title ?? 'AI tools for beginners tutorial', channelId: o.ch, channelTitle: o.ch, publishedAt: new Date(NOW - o.days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: 'en', categoryId: null,
    description: 'Best AI tools for beginners', tags: o.tags ?? [], channelCountry: null, live: null,
    observed: { views: o.views, likes: 10, comments: 1, durationSeconds: dur, channelSubscribers: o.subs ?? 30000, fetchedAt: '' }, calculated: { viewsPerDay: o.views / Math.max(o.days, 1), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult
}
const samples = (top: YouTubeVideoResult[], recent: YouTubeVideoResult[]): TopicSamples => ({ topic: 'AI tools for beginners', region: 'US', language: 'en', recentDays: 30, top: { videos: top, approxTotal: 100000 }, recent: { videos: recent, approxTotal: 5000 }, fetchedAt: new Date(NOW).toISOString(), units: 204 })
const range = (k: number) => Array.from({ length: k }, (_, i) => i)
const healthyTop = (k = 25) => range(k).map(i => vid({ views: 80_000 + i * 3000, days: 60 + i * 5, ch: `t${i % 15}` }))
const healthyRecent = (k = 25) => range(k).map(i => vid({ views: 3000 + i * 100, days: 4 + i, ch: `r${i}` }))

describe('demand: an isolated viral Short does not read as demand for the topic', () => {
  const viralShort = vid({ title: 'AI tools in 30 seconds #shorts', views: 9_000_000, days: 40, ch: 'viral', dur: 30, tags: ['shorts'] })
  const withViral = () => analyzeTopic(samples([viralShort, ...healthyTop(24)], healthyRecent()), NOW)
  const clean = () => analyzeTopic(samples(healthyTop(25), healthyRecent()), NOW)

  it('flags the concentration and lowers the confidence: no «oportunidad» and no score in the opportunity band', () => {
    const a = withViral(), r = a.stats!.demandReliability!
    expect(r.level).not.toBe('media'); expect(r.reasons.join(' ')).toMatch(/un solo vídeo reúne el \d+ %/)
    expect(a.confidence).toBe('baja'); expect(a.verdict).not.toBe('oportunidad'); expect(a.indices.opportunity).toBeLessThanOrEqual(METHOD.lowConfidenceOpportunityCap)
    expect(a.reasons.join(' ')).toMatch(/Demanda poco representativa/); expect(a.confidenceNote).toMatch(/no es representativa/)
  })
  it('the demand shown is the raw score shrunk by the reliability factor, and both are printed', () => {
    const a = withViral(), r = a.stats!.demandReliability!
    expect(a.indices.demand).toBe(Math.round(r.raw * r.factor)); expect(r.factor).toBeLessThan(1)
    expect(a.evidence.find(e => e.label.startsWith('Representatividad de la demanda'))!.label).toContain(`sin ajustar ${r.raw}/100, ajustado ${a.indices.demand}/100`)
  })
  it('the viral video does not move the median: the same topic with and without it has about the same raw demand', () => {
    expect(Math.abs(withViral().stats!.demandReliability!.raw - clean().stats!.demandReliability!.raw)).toBeLessThanOrEqual(6)
  })
  it('a demand carried by Shorts is flagged as not long-form demand', () => {
    const shorts = range(20).map(i => vid({ title: `AI tool trick ${i} #shorts`, views: 400_000, days: 30, ch: `s${i % 10}`, dur: 25, tags: ['shorts'] }))
    const a = analyzeTopic(samples([...shorts, ...healthyTop(5).map(v => ({ ...v, observed: { ...v.observed, views: 20_000 } }))], healthyRecent()), NOW)
    expect(a.stats!.demandReliability!.reasons.join(' ')).toMatch(/Shorts/); expect(a.stats!.demandReliability!.figures.shortsViewShare).toBeGreaterThan(0.5)
  })
  it('a small sample is «insuficiente» and halves the score', () => {
    const r = demandReliability({ raw: 80, views: [90_000, 80_000, 70_000, 60_000, 50_000], channelIds: ['a', 'b', 'c', 'd', 'e'], shortViews: 0, outliers: 0 })
    expect(r.level).toBe('insuficiente'); expect(r.factor).toBe(0.5); expect(r.reasons[0]).toMatch(/solo 5 vídeos/)
  })
  it('a representative sample is «media» with no penalty — and never «alta»', () => {
    const a = clean(), r = a.stats!.demandReliability!
    expect(r.level).toBe('media'); expect(r.factor).toBe(1); expect(a.indices.demand).toBe(r.raw); expect(['media', 'baja']).toContain(a.confidence)
    expect(a.evidence.find(e => e.label.startsWith('Representatividad'))!.value).toMatch(/nunca alta/)
  })
})

describe('supply: published volume is not competitive supply', () => {
  const noTraction = () => range(30).map(i => vid({ views: 1 + (i % 28), days: 5 + (i % 20), ch: `n${i}`, subs: 40 }))
  const withTraction = () => range(30).map(i => vid({ views: 2000 + i * 100, days: 5 + (i % 20), ch: `w${i}`, subs: 4000 }))

  it('30 videos with 1–28 views and 30 with traction publish the same volume but not the same competitive supply', () => {
    const a = analyzeTopic(samples(healthyTop(), noTraction()), NOW), b = analyzeTopic(samples(healthyTop(), withTraction()), NOW)
    const x = a.stats!.supplyBreakdown!, y = b.stats!.supplyBreakdown!
    expect(x.published).toBe(y.published); expect(x.publishedPerWeek).toBe(y.publishedPerWeek)
    expect(x.withTraction).toBe(0); expect(x.withoutTraction).toBeGreaterThan(20); expect(y.withTraction).toBe(y.published)
    expect(a.indices.supply).toBeLessThan(b.indices.supply); expect(a.indices.supply).toBeLessThan(25)
  })
  it('the evidence and the explanation print both numbers and the threshold', () => {
    const a = analyzeTopic(samples(healthyTop(), noTraction()), NOW)
    expect(a.evidence.find(e => e.label.startsWith('Oferta competitiva'))!.label).toContain(`≥ ${METHOD.traction.tractionViews} visualizaciones`)
    expect(a.reasons.find(r => r.startsWith('Oferta'))!).toMatch(/se publican, pero solo 0 por semana/)
  })
  it('a fresh video that has not reached the threshold is «too new», not «without traction»', () => {
    const fresh = range(10).map(i => vid({ views: 20, days: 1, ch: `f${i}` })), old = range(10).map(i => vid({ views: 20, days: 15, ch: `o${i}` }))
    const s = analyzeTopic(samples(healthyTop(), [...fresh, ...old]), NOW).stats!.supplyBreakdown!
    expect(s.tooNew).toBe(10); expect(s.withoutTraction).toBe(10); expect(s.withTraction).toBe(0)
  })
})

describe('coherence: scores, evidence and final classification never contradict each other', () => {
  const cases: Array<[string, YouTubeVideoResult[], YouTubeVideoResult[]]> = [
    ['balanced', healthyTop(), healthyRecent()],
    ['viral short', [vid({ views: 9_000_000, days: 40, ch: 'v', dur: 25, tags: ['shorts'] }), ...healthyTop(24)], healthyRecent()],
    ['tiny sample', healthyTop(6), healthyRecent(4)],
    ['three channels', range(25).map(i => vid({ views: 90_000, days: 50 + i, ch: `c${i % 3}` })), healthyRecent()],
    ['no traction', healthyTop(), range(25).map(i => vid({ views: 5, days: 10 + i % 10, ch: `z${i}` }))],
  ]
  it.each(cases)('%s', (_name, top, recent) => {
    const a = analyzeTopic(samples(top, recent), NOW), r = a.stats!.demandReliability!
    expect(a.indices.demand).toBe(Math.round(r.raw * r.factor))
    if (a.verdict === 'oportunidad') { expect(a.confidence).not.toBe('baja'); expect(r.level).toBe('media'); expect(a.indices.demand).toBeGreaterThanOrEqual(METHOD.demand.opportunityFrom) }
    if (a.confidence === 'baja') expect(a.indices.opportunity).toBeLessThanOrEqual(METHOD.lowConfidenceOpportunityCap)
    if (r.level !== 'media') { expect(a.confidence).toBe('baja'); expect(a.reasons.join(' ')).toMatch(/Demanda poco representativa/) }
    expect(a.indices.opportunity).toBe(shownOpportunity(opportunityOf(a.indices.demand, a.indices.competition, a.indices.supply, a.indices.growth), a.confidence))
    expect(a.confidence).not.toBe('alta')
  })
})
