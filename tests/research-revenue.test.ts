import { describe, expect, it } from 'vitest'
import type { ChannelAnalysis, YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { channelRevenue, estimateRevenue, nicheRevenue, videoRevenue } from '@/lib/research/revenue'
import { SOURCES_REGISTRY, connectedSources } from '@/lib/research/sources/registry'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'
import { formatAdjusted, nicheRpm } from '@/lib/research/monetization'

// SIMULATED inputs. The arithmetic and the guard rails are checked; no RPM here is a measurement of any real channel.
const NOW = Date.parse('2026-10-17T12:00:00Z')
let n = 0
const vid = (title: string, o: { views?: number; days?: number; dur?: number; lang?: string } = {}): YouTubeVideoResult => {
  const days = o.days ?? 20, views = o.views ?? 50000
  return { videoId: `r${++n}`, url: `https://www.youtube.com/watch?v=r${n}`, title, channelId: `c${n}`, channelTitle: 'C', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: o.lang ?? 'en', categoryId: null, description: '', tags: [],
    channelCountry: null, live: null, observed: { views, likes: 1, comments: 1, durationSeconds: o.dur ?? 600, channelSubscribers: 10000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult
}

describe('the estimator: income = views ÷ 1000 × RPM, with its formula, assumptions and confidence', () => {
  it('uses the niche range and shows the formula with the real numbers', () => {
    const e = estimateRevenue({ views: 100_000, niches: ['educacion'], format: 'long' })
    expect(e.status).toBe('estimado'); if (e.status !== 'estimado') return
    expect(e.range.mid).toBe(1022); expect(e.kind).toBe('ingresos publicitarios estimados'); expect(e.formula).toMatch(/100\.000 visualizaciones ÷ 1 000 × RPM/)
    expect(e.assumptions.join(' ')).toMatch(/Solo publicidad/); expect(e.assumptions.join(' ')).toMatch(/patrocinios/); expect(e.sources.length).toBeGreaterThan(0)
  })
  it('Shorts earn a fraction of long-form and say so', () => {
    const l = estimateRevenue({ views: 100_000, niches: ['educacion'], format: 'long' }), s = estimateRevenue({ views: 100_000, niches: ['educacion'], format: 'short' })
    if (l.status !== 'estimado' || s.status !== 'estimado') throw new Error('expected estimates')
    expect(s.range.mid).toBeLessThan(l.range.mid * 0.2); expect(s.assumptions.join(' ')).toMatch(/Short/)
  })
  it('a niche with no study is UNKNOWN, never a made-up number; a person can supply their own RPM', () => {
    const u = estimateRevenue({ views: 5000, niches: ['motor'], format: 'long' }); expect(u).toMatchObject({ status: 'desconocido' })
    const own = estimateRevenue({ views: 5000, niches: ['motor'], format: 'long', ownRpm: { low: 2, mid: 3, high: 4 } })
    expect(own.status).toBe('estimado'); if (own.status === 'estimado') { expect(own.range).toEqual({ low: 10, mid: 15, high: 20 }); expect(own.assumptions.join(' ')).toMatch(/dato tuyo, no verificado/) }
  })
  it('no public view count → unknown', () => { expect(estimateRevenue({ views: null, niches: ['finanzas'], format: 'long' }).status).toBe('desconocido') })
  it('applies NO per-country multiplier: the sector RPM is already anchored and the viewers\' country is not observable', () => {
    const at = (region: string | null) => estimateRevenue({ views: 100_000, niches: ['gaming'], format: 'long', region })
    const plain = at(null), us = at('US'), br = at('BR'), de = at('DE')
    if (plain.status !== 'estimado' || us.status !== 'estimado' || br.status !== 'estimado' || de.status !== 'estimado') throw new Error('expected estimates')
    expect(us.range).toEqual(plain.range); expect(br.range).toEqual(plain.range); expect(de.rpm).toEqual(plain.rpm); expect(us.confidence).toBe(plain.confidence)
    expect(us.assumptions.join(' ')).toMatch(/no se atribuyen ingresos de ningún país/)
  })
  it('is always labelled a hypothesis: verified is false and the text says it is not a verified earning', () => {
    const e = estimateRevenue({ views: 50_000, niches: ['finanzas'], format: 'long', region: 'US' })
    expect(e.status === 'estimado' && e.verified).toBe(false); expect(e.status === 'estimado' && e.assumptions.join(' ')).toMatch(/HIPÓTESIS.*no es una ganancia verificada/)
  })
  it('a niche whose RPM is borrowed from another niche keeps its «muy baja» confidence', () => {
    const e = estimateRevenue({ views: 10_000, niches: ['ia'], format: 'long' }); expect(e.status === 'estimado' && e.confidence).toBe('muy baja')
  })
  it('the range is ordered low ≤ mid ≤ high', () => {
    for (const nich of ['finanzas', 'tecnologia', 'gaming', 'musica', 'educacion']) { const e = estimateRevenue({ views: 123_456, niches: [nich], format: 'long', region: 'DE' }); if (e.status === 'estimado') { expect(e.range.low).toBeLessThanOrEqual(e.range.mid); expect(e.range.mid).toBeLessThanOrEqual(e.range.high) } }
  })
  it('a video is estimated from its own views, niche and format', () => {
    const e = videoRevenue(vid('Aprende historia medieval: documental completo', { views: 200_000 })); expect(e.status === 'estimado' && e.views).toBe(200_000)
    const short = videoRevenue(vid('Curiosidades de historia #shorts', { views: 200_000, dur: 30 })); expect(short.status === 'estimado' && short.format).toBe('short')
  })
})

describe('niche and channel estimates', () => {
  const analysis = () => {
    const mk = (k: number, d: number, v: number, t = 'finanzas guide') => Array.from({ length: k }, (_, i) => vid(`${t} ${i}`, { days: d + i, views: v + i * 100 }))
    const s: TopicSamples = { topic: 'finanzas guide', region: 'US', language: 'en', recentDays: 30, top: { videos: mk(20, 40, 80_000), approxTotal: 900 }, recent: { videos: mk(12, 8, 10_000), approxTotal: 90 }, fetchedAt: new Date(NOW).toISOString(), units: 204 }
    return analyzeTopic(s, NOW)
  }
  it('a typical and a strong video with ranges, monthly scenarios and the honest caveats', () => {
    const r = nicheRevenue({ ...analysis(), niches: ['finanzas'] }, NOW)
    expect(r.typical && r.typical.views).toBeGreaterThan(9000); expect(r.strong && r.strong.views).toBeGreaterThan(79_000)
    expect(r.monthly.map(m => m.videosPerMonth)).toEqual([4, 8, 12]); expect(r.notes.join(' ')).toMatch(/canal nuevo suele conseguir menos/)
  })
  it('too few videos → no typical video (never extrapolated from nothing)', () => {
    const a = analysis(); const r = nicheRevenue({ ...a, niches: ['finanzas'], sample: a.sample.slice(0, 2) }, NOW)
    expect(r.typical).toBeNull(); expect(r.strong).toBeNull(); expect(r.monthly).toEqual([])
  })
  it('a channel: lifetime from public total views, last 30 days from its recent uploads, no market adjustment from its declared country', () => {
    const c: ChannelAnalysis = { channel: { id: 'UC1', title: 'Canal', handle: '@c', url: 'https://youtube.com/@c', thumbnailUrl: null, country: 'US' }, observed: { subscribers: 50_000, totalViews: 4_000_000, videoCount: 120, fetchedAt: '' }, calculated: { sampleSize: 3, avgViews: 1, medianViews: 1, uploadsPerWeek: 1, outlierIds: [] },
      videos: [vid('Finanzas personales: invertir paso a paso', { days: 5, views: 30_000 }), vid('Finanzas: ahorrar dinero', { days: 20, views: 20_000 }), vid('Finanzas: viejo', { days: 200, views: 900_000 })] }
    const r = channelRevenue(c, NOW)
    expect(r.lifetime.status).toBe('estimado'); if (r.lifetime.status === 'estimado') { expect(r.lifetime.verified).toBe(false); expect(r.lifetime.views).toBe(4_000_000) }
    expect(r.last30 && r.last30.videos).toBe(2); expect(r.last30 && r.last30.views).toBe(50_000); expect(r.notes.join(' ')).toMatch(/no incluye lo que ganan hoy los vídeos antiguos/)
  })
})

describe('sources are extensible, honest and not speculative', () => {
  it('every source states what it cannot give, and pending ones say exactly what is needed', () => {
    for (const s of SOURCES_REGISTRY) { expect(s.cannot.length, s.id).toBeGreaterThan(0); expect(s.docs).toMatch(/^https:/); if (s.status === 'requiere_pago' || s.status === 'requiere_acceso_del_propietario') expect(s.needs.length, s.id).toBeGreaterThan(0) }
  })
  it('only free, immediately useful sources are connected; paid ones are not', () => {
    expect(connectedSources().map(s => s.id).sort()).toEqual(['rpm_studies', 'youtube_data_api']); expect(connectedSources().every(s => s.cost === 'gratis')).toBe(true)
    expect(SOURCES_REGISTRY.find(s => s.id === 'socialblade')!.status).toBe('requiere_pago')
  })
  it('the reference RPM table is the one the estimator uses', () => { expect(formatAdjusted(nicheRpm('educacion'), 'long')).toMatchObject({ status: 'estimado', mid: 10.22 }) })
})
