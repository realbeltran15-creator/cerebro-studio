import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { assessVideo, expectedLanguages, queryProfile } from '@/lib/research/relevance'
import { GEO_LEVEL_LABEL, contentCues, geoOf, summarizeGeo } from '@/lib/research/geo'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'

// SIMULATED fixtures modelled on the audit of «first time buyer» for the United Kingdom (results were mostly US and Canadian).
// They prove the rules; they say nothing about what YouTube returns today.
const NOW = Date.parse('2026-10-16T12:00:00Z')
let n = 0
type O = { country?: string | null; desc?: string; tags?: string[]; ch?: string; views?: number; days?: number }
const vid = (title: string, o: O = {}): YouTubeVideoResult => {
  const days = o.days ?? 10, views = o.views ?? 30000
  return { videoId: `g${++n}`, url: `https://www.youtube.com/watch?v=g${n}`, title, channelId: `c${n}`, channelTitle: o.ch ?? 'Canal', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: 'en', categoryId: null,
    description: o.desc ?? '', tags: o.tags ?? [], channelCountry: o.country === undefined ? null : o.country, live: null, observed: { views, likes: 10, comments: 1, durationSeconds: 600, channelSubscribers: 20000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult
}
const T = 'first time buyer'
const judge = (title: string, region: string | null, o: O = {}) => assessVideo(vid(title, o), queryProfile(T), expectedLanguages(region, 'en'), { region })

describe('four different «countries»: requested, channel, content, audience', () => {
  it('content cues are read from the video text only, per country', () => {
    expect(contentCues(vid('First time home buyer FHA loan and down payment assistance'))[0].country).toBe('US')
    expect(contentCues(vid('First time buyer: stamp duty and Help to Buy explained'))[0].country).toBe('GB')
    expect(contentCues(vid('Buying your first home in Canada with the FHSA and RRSP'))[0].country).toBe('CA')
    expect(contentCues(vid('First time buyer mortgage tips'))).toEqual([])
  })
  it('the channel country alone never decides anything about the video', () => {
    const g = geoOf(vid('First time buyer mortgage tips', { country: 'US' }), 'GB')
    expect(g.verdict).toBe('sin_pistas'); expect(g.channelCountry).toBe('US'); expect(g.contentCountry).toBeNull()
  })
  it('content about another country is «otro_pais»; a video that mentions the requested country too stays in the market', () => {
    expect(geoOf(vid('FHA loan first time buyer guide'), 'GB').verdict).toBe('otro_pais')
    expect(geoOf(vid('First time buyer: UK stamp duty vs US FHA loans compared'), 'GB').verdict).toBe('en_mercado')
  })
})

describe('videos about another country are set aside, but a foreign channel is not enough to exclude', () => {
  it('US and Canadian content is doubtful for a UK search and says why', () => {
    for (const t of ['First time home buyer: FHA loan, closing costs and down payment assistance', 'First time home buyer in Canada: FHSA, RRSP and the Home Buyers Plan']) {
      const a = judge(t, 'GB'); expect(a.relevant, t).toBe(false); expect(a.status).toBe('dudoso'); expect(a.detail).toMatch(/habla de/)
    }
  })
  it('UK content and neutral content are accepted', () => {
    expect(judge('First time buyer guide: stamp duty, Help to Buy and the Lifetime ISA', 'GB').relevant).toBe(true)
    expect(judge('First time buyer tips: how to save a deposit', 'GB', { country: 'US' }).relevant).toBe(true)   // channel declared in the US: still counted, only the confidence reflects it
  })
  it('without a requested country nothing is set aside', () => { expect(judge('First time home buyer: FHA loan and closing costs', null).relevant).toBe(true) })
})

describe('geographic confidence: oriented to a market, never «verified local demand»', () => {
  const kept = (items: Array<[string, string | null]>) => items.map(([t, c]) => vid(t, { country: c }))
  it('mostly US/Canadian channels for a UK search: contradictory, and it says it cannot be presented as British demand', () => {
    const g = summarizeGeo(kept([...Array(8).fill(['First time buyer tips', 'US']), ...Array(4).fill(['First time buyer advice', 'CA']), ['First time buyer: stamp duty explained', 'GB']] as Array<[string, string]>), 'GB')
    expect(g.level).toBe('contradictoria'); expect(g.statement).toMatch(/NO se pueden presentar como demanda/); expect(g.statement).toMatch(/Estados|EE\. UU\./)
  })
  it('few geographic clues: low confidence, described as oriented research', () => {
    const g = summarizeGeo(kept([...Array(8).fill(['First time buyer tips', null]), ['First time buyer: stamp duty', null], ['Help to Buy explained', 'GB'], ['Mortgage tips', 'US']] as Array<[string, string | null]>), 'GB')
    expect(['baja', 'insuficiente']).toContain(g.level); expect(g.statement).toMatch(/orientada/)
  })
  it('clues that support the market give at most MEDIUM confidence: the audience is never observable', () => {
    const g = summarizeGeo(kept([...Array(10).fill(['First time buyer: stamp duty and Help to Buy', 'GB'])] as Array<[string, string]>), 'GB')
    expect(g.level).toBe('media'); expect(g.statement).toMatch(/no es demanda local verificada/)
    for (const lvl of Object.values(GEO_LEVEL_LABEL)) expect(lvl).not.toMatch(/alta|verificad/i)
  })
  it('no country requested: no geographic claim', () => { expect(summarizeGeo(kept([['x', 'US']]), null).level).toBe('insuficiente') })
  it('the limits are always spelled out', () => { expect(summarizeGeo([], 'GB').limits.join(' ')).toMatch(/no demuestra dónde viven los espectadores/) })
})

describe('the analysis of the audit case', () => {
  const samples = (): TopicSamples => {
    const us = Array.from({ length: 10 }, (_, i) => vid(`First time buyer tips ${i}`, { country: 'US', ch: `us${i}` }))
    const ca = Array.from({ length: 6 }, (_, i) => vid(`First time buyer advice ${i}`, { country: 'CA', ch: `ca${i}` }))
    const usCue = Array.from({ length: 4 }, (_, i) => vid(`First time buyer: FHA loan and closing costs ${i}`, { ch: `f${i}` }))
    const gb = Array.from({ length: 3 }, (_, i) => vid(`First time buyer: stamp duty and Help to Buy ${i}`, { country: 'GB', ch: `gb${i}` }))
    return { topic: T, region: 'GB', language: 'en', recentDays: 30, top: { videos: [...us, ...ca, ...usCue, ...gb], approxTotal: 900 }, recent: { videos: [...us.slice(0, 5), ...ca.slice(0, 3)].map(v => ({ ...v, videoId: `${v.videoId}r` })), approxTotal: 90 }, fetchedAt: new Date(NOW).toISOString(), units: 204 }
  }
  it('the cue-bearing foreign videos are set aside, the geography is flagged, and nothing is called British demand', () => {
    const a = analyzeTopic(samples(), NOW)
    expect(a.geo!.level).toBe('contradictoria'); expect(a.geo!.setAside).toBe(4)
    expect(a.sample.filter(v => v.status === 'dudoso' && /habla de/.test(v.detail))).toHaveLength(4)
    expect(a.reasons.join(' ')).toMatch(/Mercado:/); expect(a.reasons.join(' ')).not.toMatch(/demanda (local|británica) verificada/i)
    expect(a.confidence).toBe('baja'); expect(a.verdict).not.toBe('oportunidad')
    expect(a.evidence.find(e => e.label.startsWith('Confianza geográfica'))!.value).toMatch(/contradictorias|Pistas geográficas contradictorias/)
  })
  it('the same sample without a requested country makes no geographic claim and sets nothing aside', () => {
    const a = analyzeTopic({ ...samples(), region: null }, NOW)
    expect(a.geo!.level).toBe('insuficiente'); expect(a.geo!.setAside).toBe(0); expect(a.evidence.find(e => e.label.startsWith('Confianza geográfica'))).toBeUndefined()
  })
})

describe('geography reaches comparisons and opportunities', () => {
  const build = (region: string, country: string, topic = 'index funds') => {
    const mk = (k: number, d: number) => Array.from({ length: k }, (_, i) => vid(`${topic} guide ${i}`, { country, ch: `${region}${d}${i}`, days: d + i }))
    return analyzeTopic({ topic, region, language: 'en', recentDays: 30, top: { videos: mk(22, 20), approxTotal: 900 }, recent: { videos: mk(14, 3), approxTotal: 90 }, fetchedAt: new Date(NOW).toISOString(), units: 204 }, NOW)
  }
  it('a market whose results come from another country is not comparable with another market', async () => {
    const { compareMarkets } = await import('@/lib/research/markets-info')
    const gb = build('GB', 'US'), us = build('US', 'US')
    expect(gb.geo!.level).toBe('contradictoria')
    const c = compareMarkets([{ key: 'GB', label: 'Reino Unido', region: 'GB', language: 'en', analysis: gb }, { key: 'US', label: 'Estados Unidos', region: 'US', language: 'en', analysis: us }])!
    expect(c.pairs[0].level).toBe('no_comparable'); expect(c.pairs[0].reasons.join(' ')).toMatch(/otros países/)
  })
  it('a cross-country opportunity is not reported when one side is mostly from another country', async () => {
    const { detectOpportunities } = await import('@/lib/research/opportunities')
    expect(detectOpportunities([build('GB', 'US'), build('US', 'US')], NOW).filter(o => o.kind === 'pais' || o.kind === 'idioma')).toEqual([])
  })
  it('opportunities from a weak-geography analysis are weaker and carry the geographic caveat', async () => {
    const { detectOpportunities } = await import('@/lib/research/opportunities')
    const a = build('GB', 'US'), opps = detectOpportunities([a], NOW)
    for (const o of opps) { expect(o.strength).not.toBe('fuerte'); expect(o.uncertainty).toMatch(/Geografía:/) }
  })
  it('the CSV export carries the geographic confidence', async () => {
    const { analysesCsv } = await import('@/lib/research/export')
    expect(analysesCsv([build('GB', 'US')])).toMatch(/confianza_geografica/); expect(analysesCsv([build('GB', 'US')])).toMatch(/Pistas geográficas contradictorias/)
  })
})
