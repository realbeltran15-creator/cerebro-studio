import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { assessVideo, expectedLanguages, queryProfile } from '@/lib/research/relevance'
import { nichesOf } from '@/lib/research/taxonomy'
import { videoRevenue } from '@/lib/research/revenue'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'

// SIMULATED fixtures modelled on the real audit of «first time buyer» (US): only 10 of 50 were accepted. They prove the rules, not YouTube's output.
const NOW = Date.parse('2026-10-18T12:00:00Z')
let n = 0
type O = { desc?: string; tags?: string[]; ch?: string; cat?: string; views?: number; days?: number; lang?: string }
const vid = (title: string, o: O = {}): YouTubeVideoResult => {
  const days = o.days ?? 15, views = o.views ?? 40000
  return { videoId: `h${++n}`, url: `https://www.youtube.com/watch?v=h${n}`, title, channelId: `c${n}`, channelTitle: o.ch ?? 'Canal', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: o.lang ?? 'en', categoryId: o.cat ?? null,
    description: o.desc ?? '', tags: o.tags ?? [], channelCountry: null, live: null, observed: { views, likes: 10, comments: 1, durationSeconds: 600, channelSubscribers: 20000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult
}
const T = 'first time buyer'
const judge = (t: string, region: string, o: O = {}) => assessVideo(vid(t, o), queryProfile(T), expectedLanguages(region, 'en'), { region })

const US_HOUSING = [
  'First Time Home Buyer Guide 2026: Everything You Need To Know', 'How to buy a house in 2026 (first-time homebuyer tips)', 'First-Time Home Buyer Mistakes To Avoid', 'Down payment assistance programs for first time buyers',
  'Is the housing market going to crash? First time buyers beware', 'Mortgage rates for first-time buyers this week', 'Real estate investing for beginners: first time buyer', 'Buying a house with bad credit | First Time Home Buyer',
  'First time buyer? Here is how much house you can afford', 'FHA vs conventional loan for first time home buyers', 'Home inspection checklist first time buyer', 'Closing costs explained for first time home buyers',
  'Buying a House for the First Time? Watch This', 'How To Buy A Home In 2026 | Step by Step', 'I bought my first home at 25 — here is what I wish I knew', 'Home Buying 101: Pre-Approval, Escrow And Appraisal',
  'Rent vs buy: should you buy a house in 2026?', 'Real Estate Agent Tells All: Buying vs Renting', 'Homebuyer tax credits: what first-time buyers can claim', 'The housing market in 2026: should first time buyers wait?',
]
const UK_HOUSING = ['First time buyer mortgage UK: step by step guide', 'First time buyer stamp duty explained UK', 'Help to Buy and the Lifetime ISA for first time buyers', 'Getting on the property ladder: deposit and mortgage tips', 'Shared ownership explained for first time buyers', 'Buying your first flat in London: conveyancing, solicitor and survey']
const RIVALS = ['Best first time buyer cars under $10,000', 'First time car buyer mistakes: what dealerships do not tell you', 'First time buyer watch: Rolex vs Omega', 'First time buyer dog: what to know before buying a puppy', 'My first time buyer experience: laptop', 'First time buyer guitar guide', 'First time buyer: which iPhone to get', 'First time buyer drone guide 2026', 'First time bitcoin buyer: how to start with crypto', 'First time buyer engagement ring guide']

describe('P1 — housing videos are recognised (US, UK and equivalents)', () => {
  it('US homebuyer vocabulary: homebuyer, housing market, real estate, down payment, mortgage, closing costs, FHA, escrow…', () => { for (const t of US_HOUSING) { const a = judge(t, 'US'); expect(a.relevant, `${t} → ${a.detail}`).toBe(true) } })
  it('UK equivalents: stamp duty, Help to Buy, property ladder, shared ownership, conveyancing…', () => { for (const t of UK_HOUSING) { const a = judge(t, 'GB'); expect(a.relevant, `${t} → ${a.detail}`).toBe(true) } })
  it('the acceptance quotes the housing words that confirmed it', () => { expect(judge('Closing costs explained for first time home buyers', 'US').detail).toMatch(/compra de vivienda: .*closing cost/) })
})

describe('P1 — cars, watches, phones, pets, crypto and other products stay out', () => {
  it('every rival product is rejected with a reason that names it, and none is merely «doubtful»', () => {
    for (const t of RIVALS) { const a = judge(t, 'US'); expect(a.relevant, t).toBe(false); expect(a.status, t).toBe('descartado'); expect(a.reason).toBe('nicho'); expect(a.detail).toMatch(/no de compra de vivienda/) }
  })
  it('a title with no housing word at all is only «doubtful»: it is not guessed in, and not called wrong', () => {
    const a = judge('First Time Buyer Tips (I Wish I Knew Sooner)', 'US'); expect(a.relevant).toBe(false); expect(a.status).toBe('dudoso'); expect(a.detail).toMatch(/nada .* confirma que trate de compra de vivienda/)
    expect(judge('First Time Buyer Tips (I Wish I Knew Sooner)', 'US', { desc: 'Everything about your first mortgage and down payment.' }).relevant).toBe(true)   // the description supplies the context
  })
  it('a housing title that also mentions a car loan or a pet is still housing', () => {
    expect(judge('First time home buyer: how a car loan changes your mortgage approval', 'US').relevant).toBe(true)
  })
})

describe('P1 — a house is never classified as an animal (or anything else) because of incidental words', () => {
  const desc = 'Pet rent, dog friendly neighborhoods, cat owners and horse property: what first time buyers should know about the house and the mortgage.'
  it('the video is accepted for its housing vocabulary, with no «trata de animales» reason', () => {
    const a = judge('First time home buyer: pet friendly houses and your mortgage', 'US', { desc, tags: ['dog', 'cat', 'pet', 'house'], cat: '15' })
    expect(a.relevant).toBe(true); expect(a.detail).not.toMatch(/animales/); expect(a.reason).toBeNull()
  })
  it('housing vocabulary is finance for the classifier, so the income estimate uses the right niche, not pets', () => {
    const v = vid('First time home buyer: real estate, down payment and closing costs', { desc, cat: '15' })
    expect(nichesOf(v)[0].niche).toBe('finanzas'); const e = videoRevenue(v, 'US'); expect(e.status === 'estimado' && e.niche).toBe('finanzas')
  })
})

describe('P1 — the audited sample: from 10 of 50 to the valid housing videos', () => {
  it('40 housing videos and 10 rivals: all housing accepted, every rival rejected', () => {
    const housing = [...US_HOUSING, ...US_HOUSING.map(t => `${t} (2026)`)]
    const s: TopicSamples = { topic: T, region: 'US', language: 'en', recentDays: 30, top: { videos: [...housing, ...RIVALS].map((t, i) => vid(t, { ch: `ch${i}`, days: 20 + i })), approxTotal: 9000 }, recent: { videos: US_HOUSING.slice(0, 12).map((t, i) => vid(`${t} update`, { ch: `rc${i}`, days: 2 + i })), approxTotal: 300 }, fetchedAt: new Date(NOW).toISOString(), units: 204 }
    const a = analyzeTopic(s, NOW)
    expect(a.sample.filter(v => v.inTop && v.status === 'aceptado').length).toBe(housing.length)
    expect(a.sample.filter(v => v.inTop && v.status === 'descartado' && v.reason === 'nicho').length).toBe(RIVALS.length)
    expect(a.quality.kept).toBeGreaterThanOrEqual(housing.length); expect(a.confidence).not.toBe('baja')
  })
})
