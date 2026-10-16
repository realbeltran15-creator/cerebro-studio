import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { assessVideo, detectLanguage, expectedLanguages, isPromo, promoKind, queryProfile } from '@/lib/research/relevance'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'

// SIMULATED data modelled on the eight problems found by the real audit of commit 46fbf89. No YouTube call is made.
const NOW = Date.parse('2026-10-15T12:00:00Z')
let n = 0
type O = { title: string; lang?: string | null; days?: number; views?: number; subs?: number; cat?: string | null; ch?: string; tags?: string[]; desc?: string; dur?: number }
const vid = (o: O): YouTubeVideoResult => {
  const days = o.days ?? 10, views = o.views ?? 20000
  return { videoId: `a${++n}`, url: `https://www.youtube.com/watch?v=a${n}`, title: o.title, channelId: o.ch ?? `c${n}`, channelTitle: 'Canal', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: 'https://i.ytimg.com/x.jpg',
    declaredLanguage: o.lang === undefined ? null : o.lang, categoryId: o.cat ?? null, description: o.desc ?? '', tags: o.tags ?? [], channelCountry: null, live: null,
    observed: { views, likes: 10, comments: 1, durationSeconds: o.dur ?? 600, channelSubscribers: o.subs ?? 20000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / Math.max(days, 1)), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult
}
const judge = (title: string, topic: string, region: string, language: string, o: Partial<O> = {}) => assessVideo(vid({ title, ...o }), queryProfile(topic), expectedLanguages(region, language))
const many = (c: number, f: (i: number) => O) => Array.from({ length: c }, (_, i) => vid(f(i)))

describe('problem 5 — «first time buyer UK» no longer loses legitimate home-buying videos', () => {
  const T = 'first time buyer UK'
  it('synonyms and rewordings of the same idea are accepted', () => {
    for (const t of ['Buying your first home in the UK: complete guide', 'First-time homebuyer guide UK 2026', 'How to buy a house in the UK as a first time home buyer', 'Getting on the property ladder: deposit and mortgage tips', 'I bought my first flat at 24 | UK mortgage', 'First time buyer? Stamp duty changes explained', 'Help to Buy and the Lifetime ISA for first time buyers'])
      expect(judge(t, T, 'GB', 'en', { lang: 'en' }).relevant, t).toBe(true)
  })
  it('a description that carries the rewording is enough when the title is short', () => {
    expect(judge('Our house hunt, part 3', T, 'GB', 'en', { lang: 'en', desc: 'We are first time home buyers in Manchester and walk through the mortgage' }).relevant).toBe(false)   // partial: the title says nothing
    expect(judge('Mortgage in principle: what we learned', T, 'GB', 'en', { lang: 'en', tags: ['first time buyer', 'uk mortgage'] }).relevant).toBe(true)
  })
  it('the car, gym and unrelated videos are still rejected', () => {
    for (const t of ['Best first time buyer cars under £5000', 'First time car buyer guide UK 2026', 'First time buyer gym plan', 'My first car: buying tips UK', 'First day at the gym']) expect(judge(t, T, 'GB', 'en', { lang: 'en' }).relevant, t).toBe(false)
  })
})

describe('problem 6 — hashtags like #datoscuriosos and the false Portuguese reading', () => {
  const T = 'datos curiosos'
  it('a hashtag that glues the topic words counts as the topic', () => {
    expect(judge('Esto te va a sorprender #datoscuriosos #shorts', T, 'ES', 'es').relevant).toBe(true)
    expect(judge('Cosas increíbles del mundo #DatosCuriosos', T, 'ES', 'es', { lang: 'es' }).relevant).toBe(true)
  })
  it('Spanish is not read as Portuguese, even with few words, hashtags or a wrong declared language', () => {
    for (const t of ['Datos curiosos del espacio que no sabías', 'Esto te va a sorprender #datoscuriosos', 'Mira esto #datoscuriosos', 'La luna tiene un secreto, ¿lo sabías? #curiosidades', 'Cosas que no sabías del mundo']) {
      const d = detectLanguage(t); expect(d.lang === 'pt', t).toBe(false)
    }
    const a = judge('Mira esto #datoscuriosos', T, 'ES', 'es', { lang: 'pt' })
    expect(a.relevant).toBe(true); expect(a.language.language).toBe('es')
  })
  it('real Portuguese is still recognised and kept out of a Spanish market', () => {
    expect(detectLanguage('Fatos curiosos que você não sabia sobre o espaço').lang).toBe('pt')
    for (const t of ['Fatos curiosos que você não sabia #fatoscuriosos', 'O que é a lua? Curiosidades sobre o espaço, não perca']) { const a = judge(t, T, 'ES', 'es'); expect(a.relevant, t).toBe(false); expect(a.reason).toBe('idioma') }
  })
  it('the letters that exist in only one language decide close calls (ñ for Spanish, ã/õ for Portuguese)', () => {
    expect(detectLanguage('El niño y la montaña de España').lang).toBe('es'); expect(detectLanguage('A canção da região é bonita, não é').lang).toBe('pt')
  })
})

describe('problem 7 — ads and promotional videos stay out of demand, legitimate reviews do not', () => {
  it('clear ads, sponsored videos and tagged ads are identified with the reason', () => {
    expect(promoKind(vid({ title: 'iPhone 16 | Official Ad' }))?.kind).toBe('anuncio')
    expect(promoKind(vid({ title: 'Samsung Galaxy | Official TVC' }))?.kind).toBe('anuncio')
    expect(promoKind(vid({ title: 'Mi rutina de skincare #publi' }))?.kind).toBe('anuncio')
    expect(promoKind(vid({ title: 'Mortgage guide sponsored by BankCo' }))?.kind).toBe('patrocinado')
    expect(promoKind(vid({ title: 'Mi opinión sobre el Mac', desc: 'Este vídeo está patrocinado por NordVPN. Usa el código MAC.' }))?.kind).toBe('patrocinado')
    expect(promoKind(vid({ title: 'Review', tags: ['sponsored'] }))?.kind).toBe('anuncio')
  })
  it('honest reviews, affiliate links and «not sponsored» are not touched', () => {
    for (const o of [{ title: 'iPhone 16 review: should you buy it?' }, { title: 'Unboxing and first impressions of the Pixel 9' }, { title: 'Honest review of Notion (not sponsored)' }, { title: 'Reseña sincera del Kindle, sin patrocinio' },
      { title: 'Best budget laptops 2026', desc: 'Links to buy: amazon.com/... (affiliate links). Discount code SAVE10 at checkout.' }]) expect(isPromo(vid(o)), o.title).toBe(false)
  })
  it('promoted videos with millions of views do not move the demand, and reviews still count', () => {
    const base = () => many(14, i => ({ title: `mortgage guide ${i}`, lang: 'en', views: 40000, days: 100, ch: `m${i}` }))
    const ads = many(6, i => ({ title: `mortgage guide | Official Ad ${i}`, lang: 'en', views: 90_000_000, days: 100, ch: `ad${i}` }))
    const reviews = many(6, i => ({ title: `mortgage guide honest review ${i}`, lang: 'en', views: 40000, days: 100, ch: `rv${i}` }))
    const mk = (top: YouTubeVideoResult[]): TopicSamples => ({ topic: 'mortgage guide', region: 'GB', language: 'en', recentDays: 30, top: { videos: top, approxTotal: 100 }, recent: { videos: [], approxTotal: 0 }, fetchedAt: new Date(NOW).toISOString(), units: 204 })
    const withAds = analyzeTopic(mk([...ads, ...base()]), NOW), without = analyzeTopic(mk(base()), NOW), withReviews = analyzeTopic(mk([...reviews, ...base()]), NOW)
    expect(withAds.indices.demand).toBe(without.indices.demand); expect(withAds.quality.promo).toBe(6)
    expect(withReviews.quality.promo).toBe(0); expect(withReviews.sampleSizes.top).toBe(20)
    expect(withAds.sample.filter(v => v.promo).every(v => /Anuncio/.test(v.promoWhy ?? ''))).toBe(true)
  })
})

describe('problem 8 — supply uses one consistent window, and an old video cannot distort it', () => {
  const mk = (recent: YouTubeVideoResult[], topic = 'tema', days = 30): TopicSamples => ({ topic, region: 'US', language: 'en', recentDays: days, top: { videos: [], approxTotal: 0 }, recent: { videos: recent, approxTotal: 900 }, fetchedAt: new Date(NOW).toISOString(), units: 204 })
  const dense = (k: number, extra: O[] = []) => [...many(k, i => ({ title: `tema video ${i}`, lang: 'en', days: 1 + i * 0.1, ch: `d${i}` })), ...extra.map(vid)]
  it('a full sample is measured over its own span: 25 videos in ~3.5 days is a high rate, whatever survives the relevance filter', () => {
    const a = analyzeTopic(mk(dense(25)), NOW)
    const rate = Number(a.evidence.find(e => e.label.startsWith('Subidas por semana'))!.value)
    expect(rate).toBeGreaterThan(40)
  })
  it('one stray month-old result does not stretch the window and halve the rate', () => {
    const clean = analyzeTopic(mk(dense(24)), NOW), withOld = analyzeTopic(mk(dense(24, [{ title: 'tema video viejo', lang: 'en', days: 29, ch: 'old' }])), NOW)
    const r = (a: ReturnType<typeof analyzeTopic>) => Number(a.evidence.find(e => e.label.startsWith('Subidas por semana'))!.value)
    expect(r(withOld)).toBeGreaterThan(r(clean) * 0.9)
    expect(withOld.evidence.find(e => e.label.startsWith('Subidas por semana'))!.label).toMatch(/antiguo/)
  })
  it('off-topic results still define the window: filtering them out does not change the span', () => {
    const relevantOnly = dense(10), padded = [...dense(10), ...many(15, i => ({ title: `cooking pasta ${i}`, lang: 'en', days: 1 + i * 0.1, ch: `x${i}` }))]
    const a = analyzeTopic(mk(relevantOnly), NOW), b = analyzeTopic(mk(padded), NOW)
    const label = (x: ReturnType<typeof analyzeTopic>) => x.evidence.find(e => e.label.startsWith('Subidas por semana'))!.label
    expect(label(a)).toMatch(/ventana de 30 días/)       // not full: the declared window
    expect(label(b)).toMatch(/ventana de [234] días/)   // full raw sample: its real span
  })
})

describe('ISA keeps working: religious, military and video-game videos stay out', () => {
  const T = 'ISA explained'
  it('the three families of false positives are still rejected', () => {
    for (const t of ['Who is Isa? Jesus in the Quran explained', 'ISA Intelligence Support Activity explained | Army special forces', 'ISA gameplay Minecraft server explained']) {
      const a = judge(t, T, 'GB', 'en', { lang: 'en' }); expect(a.relevant, t).toBe(false); expect(a.reason).toBe('sentido')
    }
  })
  it('and real ISA videos are accepted', () => { expect(judge('Stocks and Shares ISA explained: tax free investing in the UK', T, 'GB', 'en', { lang: 'en' }).relevant).toBe(true) })
})
