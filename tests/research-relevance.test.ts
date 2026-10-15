import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { analyzeTopic, applyGrowth, EVIDENCE, type TopicSamples } from '@/lib/research/topic-analysis'
import { assessVideo, detectLanguage, expectedLanguages, isPromo, queryProfile, viralOutliers } from '@/lib/research/relevance'
import { inferFormat, nichesOf } from '@/lib/research/taxonomy'
import { THRESHOLDS, buildRecommendations } from '@/lib/research/recommendations'
import { EMPTY_FILTERS } from '@/lib/research/filters'

/** Real examples from the browser audit of 2026-10-15: what YouTube returned for the query is judged, not assumed. */
const NOW = Date.parse('2026-10-15T12:00:00Z')
let n = 0
type O = { title: string; lang?: string | null; days?: number; views?: number; subs?: number; dur?: number; cat?: string | null; ch?: string; chTitle?: string; tags?: string[]; desc?: string; country?: string | null; live?: YouTubeVideoResult['live'] }
const vid = (o: O): YouTubeVideoResult => {
  const days = o.days ?? 40, views = o.views ?? 50000
  return { videoId: `r${++n}`, url: `https://www.youtube.com/watch?v=r${n}`, title: o.title, channelId: o.ch ?? `c${n}`, channelTitle: o.chTitle ?? 'Canal', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: `https://i.ytimg.com/vi/r${n}/mqdefault.jpg`,
    declaredLanguage: o.lang === undefined ? null : o.lang, categoryId: o.cat === undefined ? null : o.cat, description: o.desc ?? '', tags: o.tags ?? [], channelCountry: o.country ?? null, live: o.live ?? null,
    observed: { views, likes: 100, comments: 10, durationSeconds: o.dur ?? 600, channelSubscribers: o.subs ?? 20000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / Math.max(days, 1)), viewsToSubscribers: (o.subs ?? 20000) ? views / (o.subs ?? 20000) : null, engagementRate: 1 } }
}
const many = (c: number, f: (i: number) => O) => Array.from({ length: c }, (_, i) => vid(f(i)))
const samples = (topic: string, region: string | null, language: string | null, top: YouTubeVideoResult[], recent: YouTubeVideoResult[], recentDays = 30): TopicSamples => ({ topic, region, language, recentDays, top: { videos: top, approxTotal: 1000 }, recent: { videos: recent, approxTotal: 100 }, fetchedAt: new Date(NOW).toISOString(), units: 204 })
const judge = (title: string, topic: string, region: string, language: string, o: Partial<O> = {}) => assessVideo(vid({ title, ...o }), queryProfile(topic), expectedLanguages(region, language))

describe('audit example 1: «ISA explained» must not return Indonesian religious content', () => {
  const T = 'ISA explained'
  it('the query keeps the topic (ISA) and drops the modifier (explained)', () => { expect(queryProfile(T).terms).toEqual(['isa']); expect(queryProfile(T).niches).toContain('finanzas') })
  it('an Indonesian video about Isa (Jesus) is rejected for a UK / English market, declared or not', () => {
    const declared = judge('Kisah Nabi Isa AS Yang Menakjubkan Dan Penuh Hikmah Untuk Kita Semua', T, 'GB', 'en', { lang: 'id' })
    const undeclared = judge('Kisah Nabi Isa AS yang dan untuk kita semua dari Al-Quran', T, 'GB', 'en')
    for (const a of [declared, undeclared]) { expect(a.relevant).toBe(false); expect(a.reason).toBe('idioma') }
  })
  it('an Arabic title is rejected by script, with no language declared', () => { expect(detectLanguage('قصة النبي عيسى عليه السلام كاملة').lang).toBe('ar'); expect(judge('قصة النبي عيسى عليه السلام كاملة', T, 'GB', 'en').relevant).toBe(false) })
  it('real ISA videos in English are kept', () => {
    for (const t of ['Stocks and Shares ISA Explained | UK Investing for Beginners', 'Cash ISA vs Stocks and Shares ISA: which is best in 2026?', 'What is an ISA? ISA allowance explained']) expect(judge(t, T, 'GB', 'en', { lang: 'en' }).relevant, t).toBe(true)
  })
  it('other uses of the name «Isa», even in English, stay out of the metrics (rejected or dubious, never counted)', () => {
    const party = judge('Isa and the garden party tonight with friends', T, 'GB', 'en'), dog = judge('My dog Isa goes to the groomer', T, 'GB', 'en', { cat: '15' })
    for (const a of [party, dog]) { expect(a.relevant).toBe(false); expect(['nicho', 'contexto']).toContain(a.reason) }   // not claimed wrong, but never counted
  })
  it('the analysis excludes the contamination and says so; the indices come only from the on-topic videos', () => {
    const good = many(15, i => ({ title: `Stocks and Shares ISA explained part ${i}`, lang: 'en', views: 20000, ch: `g${i}` }))
    const bad = many(10, i => ({ title: `Kisah Nabi Isa AS yang dan untuk kita semua ${i}`, lang: 'id', views: 90_000_000, ch: `b${i}`, subs: 5_000_000 }))
    const clean = analyzeTopic(samples(T, 'GB', 'en', good, many(8, i => ({ title: `ISA explained new rules ${i}`, lang: 'en', days: 5 + i, ch: `r${i}` }))), NOW)
    const dirty = analyzeTopic(samples(T, 'GB', 'en', [...bad, ...good], many(8, i => ({ title: `ISA explained new rules ${i}`, lang: 'en', days: 5 + i, ch: `r${i}` }))), NOW)
    expect(dirty.quality.excluded.idioma).toBe(10); expect(dirty.indices.demand).toBe(clean.indices.demand); expect(dirty.indices.competition).toBe(clean.indices.competition)
    expect(dirty.topVideos.every(v => v.declaredLanguage === 'en')).toBe(true)
    expect(dirty.sample.filter(v => v.status === 'descartado' && v.reason === 'idioma' && /Kisah/.test(v.title))).toHaveLength(10)
  })
})

describe('audit example 2: «first time buyer UK» must not include cars', () => {
  const T = 'first time buyer UK'
  it('the market word is a qualifier, not a required term, and the topic is finance/property', () => { expect(queryProfile(T).terms).toEqual(['first', 'time', 'buyer']); expect(queryProfile(T).niches).toContain('finanzas') })
  it('car videos are rejected by niche even when every query word appears', () => {
    for (const t of ['First time car buyer guide UK 2026', 'Best first time buyer cars under £5000', 'First time buyer? Don’t buy this car']) { const a = judge(t, T, 'GB', 'en', { lang: 'en', cat: '2' }); expect(a.relevant, t).toBe(false); expect(a.reason, t).toBe('nicho') }
  })
  it('real first-time-buyer property and mortgage videos are kept', () => {
    for (const t of ['First time buyer mortgage UK: step by step guide', 'First time buyer stamp duty explained UK', 'How to buy your first home in the UK: first time buyer tips']) expect(judge(t, T, 'GB', 'en', { lang: 'en' }).relevant, t).toBe(true)
  })
  it('an unrelated video that shares one word is dropped for topic coverage', () => { const a = judge('First day at the gym', T, 'GB', 'en', { lang: 'en' }); expect(a.relevant).toBe(false); expect(a.reason).toBe('tema') })
})

describe('country and language: regionCode does not prove the video belongs to the market', () => {
  it('a German-language video found through a UK search is excluded; a declared and a detected English video are kept', () => {
    expect(judge('So kaufst du dein erstes Haus: Tipps für Erstkäufer in Deutschland und was Sie wissen müssen', 'first time buyer', 'GB', 'en').reason).toBe('idioma')
    expect(judge('first time buyer tips', 'first time buyer', 'GB', 'en', { lang: 'en' }).relevant).toBe(true)
  })
  it('a multilingual market accepts its official languages; an unverifiable language is kept but counted as unverified', () => {
    expect(expectedLanguages('CH', 'de')).toEqual(['de', 'fr', 'it']); expect(expectedLanguages('GB', 'en')).toEqual(['en']); expect(expectedLanguages(null, null)).toEqual([])
    expect(judge('Hypothek Schweiz erklärt: was ist die Tragbarkeit und wie viel Eigenkapital brauchst du', 'hypothek', 'CH', 'de').language.verdict).toBe('coincide')
    expect(judge('Hypothek 2026', 'hypothek', 'CH', 'de').language.verdict).toBe('sin_verificar')
  })
  it('a confident reading of the text beats a wrong declaration', () => { const a = judge('Kisah Nabi Isa AS yang dan untuk kita semua dari Al-Quran', 'isa', 'GB', 'en', { lang: 'en' }); expect(a.language.language).toBe('id'); expect(a.language.source).toBe('detectado'); expect(a.relevant).toBe(false) })
  it('the analysis reports how many channels declare the market country, without using it to include or exclude', () => {
    const top = [...many(6, i => ({ title: `mortgage guide ${i}`, lang: 'en', country: 'GB', ch: `a${i}` })), ...many(6, i => ({ title: `mortgage guide b${i}`, lang: 'en', country: 'US', ch: `b${i}` })), ...many(3, i => ({ title: `mortgage guide c${i}`, lang: 'en', ch: `c${i}` }))]
    const a = analyzeTopic(samples('mortgage guide', 'GB', 'en', top, []), NOW)
    expect(a.quality.kept).toBe(15); expect(a.quality.channelInMarket).toBe(6); expect(a.quality.channelCountryKnown).toBe(12)
  })
})

describe('demand: ads, viral outliers and irrelevant results cannot distort the score', () => {
  const T = 'mortgage guide'
  const base = () => many(14, i => ({ title: `mortgage guide ${i}`, lang: 'en', views: 40000, days: 100, ch: `m${i}` }))
  it('promotions are recognised and kept out of demand', () => {
    expect(isPromo(vid({ title: 'Halifax Mortgages | Official Trailer' }))).toBe(true); expect(isPromo(vid({ title: 'Mortgage guide #ad' }))).toBe(true); expect(isPromo(vid({ title: 'How a mortgage works' }))).toBe(false)
    const ads = many(6, i => ({ title: `Mortgage guide sponsored by BankCo ${i}`, lang: 'en', views: 90_000_000, days: 100, ch: `ad${i}` }))
    const a = analyzeTopic(samples(T, 'GB', 'en', [...ads, ...base()], []), NOW), b = analyzeTopic(samples(T, 'GB', 'en', base(), []), NOW)
    expect(a.quality.promo).toBe(6); expect(a.indices.demand).toBe(b.indices.demand); expect(a.topVideos.some(v => /sponsored/i.test(v.title))).toBe(false)
  })
  it('viral outliers are detected and do not set the demand', () => {
    expect(viralOutliers([10, 12, 11, 9, 13, 10, 11, 12, 5000])).toEqual(new Set([8])); expect(viralOutliers([1, 2, 3])).toEqual(new Set())
    const withViral = [...base(), vid({ title: 'mortgage guide viral hit', lang: 'en', views: 400_000_000, days: 100 })]
    const a = analyzeTopic(samples(T, 'GB', 'en', withViral, []), NOW), b = analyzeTopic(samples(T, 'GB', 'en', base(), []), NOW)
    expect(a.quality.outliers).toBe(1); expect(a.indices.demand).toBe(b.indices.demand)
  })
  it('one video holding most of the views lowers the confidence instead of inflating the topic', () => {
    const lopsided = [vid({ title: 'mortgage guide giant', lang: 'en', views: 90_000_000, days: 100, subs: 9_000_000 }), ...many(14, i => ({ title: `mortgage guide ${i}`, lang: 'en', views: 20000, days: 100, ch: `x${i}` }))]
    const a = analyzeTopic(samples(T, 'GB', 'en', lopsided, many(10, i => ({ title: `mortgage guide new ${i}`, lang: 'en', days: 5 + i }))), NOW)
    expect(a.confidence).toBe('baja'); expect(a.confidenceNote).toMatch(/un solo vídeo reúne/)
  })
  it('when most results are off-topic the confidence is low and an «oportunidad» is withheld', () => {
    const noise = many(20, i => ({ title: `Kisah Nabi Isa AS yang dan untuk kita ${i}`, lang: 'id', views: 100000, ch: `n${i}` }))
    const a = analyzeTopic(samples('ISA explained', 'GB', 'en', [...noise, ...many(6, i => ({ title: `ISA explained ${i}`, lang: 'en', views: 300000, subs: 3000, days: 50 }))], many(4, i => ({ title: `ISA explained ${i}`, lang: 'en', days: 5 + i }))), NOW)
    expect(a.confidence).toBe('baja'); expect(a.verdict).not.toBe('oportunidad'); expect(a.confidenceNote).toMatch(/no eran del tema o del mercado/)
  })
})

describe('growth: comparable windows or «No calculable»', () => {
  const T = 'mortgage guide'
  // Views are proportional to age so that «views per day» is the number being compared.
  const recent = (vpd: number) => many(12, i => ({ title: `mortgage guide recent ${i}`, lang: 'en', views: vpd * (8 + i), days: 8 + i, ch: `r${i}` }))
  const top = many(15, i => ({ title: `mortgage guide ${i}`, lang: 'en', views: 60000, days: 200, ch: `t${i}` }))
  const prev = (vpd: number, count = 12) => ({ videos: many(count, i => ({ title: `mortgage guide previous ${i}`, lang: 'en', views: vpd * (38 + i), days: 38 + i, ch: `p${i}` })), approxTotal: 10 })
  it('one window is «No calculable»: no neutral 50, no percentage, and the opportunity ignores the missing term', () => {
    const a = analyzeTopic(samples(T, 'GB', 'en', top, recent(1000)), NOW)
    expect(a.growth.state).toBe('no_calculable'); expect(a.indices.growth).toBeNull(); expect(a.growthPct).toBeNull(); expect(a.growth.reason).toMatch(/Medir crecimiento/)
    expect(a.evidence.find(e => /^Crecimiento/.test(e.label))?.value).toBe('No calculable')
  })
  it('two adjacent windows of equal length give a measured, cautious label', () => {
    const a = analyzeTopic(samples(T, 'GB', 'en', top, recent(1000)), NOW)
    const up = applyGrowth(a, prev(300), NOW), flat = applyGrowth(a, prev(800), NOW), down = applyGrowth(a, prev(1600), NOW)
    expect(up.growth.state).toBe('calculable'); expect(up.growth.label).toBe('al alza (posible)'); expect(up.indices.growth).toBeGreaterThan(50); expect(up.growthPct).toBeGreaterThan(0)
    expect(flat.growth.label).toBe('estable o no concluyente'); expect(down.growth.label).toBe('a la baja'); expect(down.growthPct).toBeLessThan(0)
    expect(up.reasons.join(' ')).toMatch(/más tiempo para acumular vistas/)
  })
  it(`fewer than ${EVIDENCE.minCohort} relevant videos in either window stays «No calculable», and the previous window is judged by the same relevance rules`, () => {
    const a = analyzeTopic(samples(T, 'GB', 'en', top, recent(1000)), NOW)
    expect(applyGrowth(a, prev(300, 5), NOW).growth.state).toBe('no_calculable')
    const polluted = { videos: many(12, i => ({ title: `Kisah Nabi Isa yang dan untuk kita ${i}`, lang: 'id', views: 100, days: 38 + i })), approxTotal: 1 }
    const r = applyGrowth(a, polluted, NOW); expect(r.growth.state).toBe('no_calculable'); expect(r.growth.previous?.n).toBe(0)
  })
  it('a growth filter does not count a «No calculable» analysis as passing', async () => {
    const { analysisExclusions } = await import('@/lib/research/filters')
    const a = analyzeTopic(samples(T, 'GB', 'en', top, recent(1000)), NOW)
    expect(analysisExclusions(a, { ...EMPTY_FILTERS, analysis: { ...EMPTY_FILTERS.analysis, minGrowth: 60 } })).toContain('crecimiento (No calculable)')
  })
})

describe('formats: duration alone does not prove a Short', () => {
  const f = (o: Partial<O> & { title: string }) => inferFormat(vid(o))
  it('≤ 60 s with #shorts anywhere (title, tags, description) is a confirmed Short', () => {
    for (const o of [{ title: 'Quick tip #shorts', dur: 30 }, { title: 'Quick tip', tags: ['shorts'], dur: 30 }, { title: 'Quick tip', desc: 'Follow me #Shorts', dur: 30 }]) { const x = f(o); expect(x.format).toBe('short'); expect(x.confidence).toBe('alta') }
  })
  it('≤ 60 s with nothing else is only a probable Short, and says the API cannot confirm it', () => { const x = f({ title: 'Quick tip', dur: 40 }); expect(x.format).toBe('short'); expect(x.confidence).toBe('media'); expect(x.reason).toMatch(/probable Short/) })
  it('a 45 s music video, trailer or clip is NOT counted as a Short', () => {
    for (const o of [{ title: 'Artist - Song (Official Music Video)', dur: 45 }, { title: 'Quick tip', dur: 45, cat: '10' }, { title: 'Movie trailer teaser', dur: 50 }, { title: 'Best moments clip', dur: 40 }]) { const x = f(o); expect(x.format, o.title).toBe('brief'); expect(x.confidence).toBe('baja') }
  })
  it('61–180 s without #shorts is a short video, not a Short; with the tag it is a Short', () => { expect(f({ title: 'tip', dur: 120 }).format).toBe('brief'); expect(f({ title: 'tip #shorts', dur: 120 }).format).toBe('short') })
  it('only streams on air or scheduled are «directo»; an ended stream keeps its format by duration', () => {
    expect(f({ title: 'x', dur: 7200, live: 'live' }).format).toBe('live'); expect(f({ title: 'x', dur: 7200, live: 'was_live' }).format).toBe('long')
  })
  it('the analysis separates confirmed, probable and not-a-Short counts', () => {
    const vids = [vid({ title: 'mortgage #shorts', dur: 30 }), vid({ title: 'mortgage tip', dur: 30 }), vid({ title: 'mortgage best moments clip', dur: 30 }), ...many(12, i => ({ title: `mortgage guide ${i}`, dur: 700 }))]
    const a = analyzeTopic(samples('mortgage', 'GB', 'en', vids, []), NOW)
    expect(a.formatQuality).toEqual({ shortConfirmed: 1, shortProbable: 1, clipsNotShort: 1 })
  })
})

describe('recommendations: real thresholds, nothing from weak evidence', () => {
  const mk = (topic: string, over: Record<string, unknown>) => {
    const a = analyzeTopic(samples(topic, 'US', 'en', many(25, i => ({ title: `${topic} ${i}`, lang: 'en', views: 90000, subs: 5000, ch: `x${i}` })), many(12, i => ({ title: `${topic} new ${i}`, lang: 'en', days: 4 + i, ch: `y${i}` }))), NOW)
    return { ...a, ...over, indices: { ...a.indices, ...(over.indices as object | undefined) } } as typeof a
  }
  const recs = (analyses: ReturnType<typeof mk>[]) => buildRecommendations({ analyses, charts: {}, filters: EMPTY_FILTERS })
  const titles = (r: ReturnType<typeof recs>, id: string) => r.sections.find(s => s.id === id)!.items.map(i => (i.kind === 'niche' ? i.topic : ''))
  it('a low-confidence analysis is never recommended, even if it is the best of the list', () => {
    const r = recs([mk('weak topic', { confidence: 'baja', verdict: 'oportunidad', indices: { demand: 90, competition: 5, supply: 5, opportunity: 95 } })])
    for (const s of r.sections) if (!['international', 'small'].includes(s.id)) expect(s.items.filter(i => i.kind === 'niche' && i.source === 'analysis').length, s.id).toBe(0)
    expect(r.sections[0].empty).toMatch(/confianza baja/)
  })
  it('«menor competencia» needs competition ≤ the threshold, not just the lowest of the list', () => {
    const t = THRESHOLDS.lowcomp
    const r = recs([mk('crowded', { confidence: 'media', indices: { demand: 80, competition: t.competition + 10 } }), mk('open', { confidence: 'media', indices: { demand: 80, competition: t.competition - 10 } })])
    expect(titles(r, 'lowcomp')).toEqual(['open'])
  })
  it('«nichos desatendidos» need every threshold, including opportunity', () => {
    const t = THRESHOLDS.neglected
    const ok = { confidence: 'media', verdict: 'oportunidad', indices: { demand: t.demand + 5, competition: t.competition - 5, supply: t.supply - 5, opportunity: t.opportunity + 5 } }
    expect(titles(recs([mk('good', ok)]), 'neglected')).toEqual(['good'])
    for (const bad of [{ demand: t.demand - 1 }, { competition: t.competition + 1 }, { supply: t.supply + 1 }, { opportunity: t.opportunity - 1 }]) expect(titles(recs([mk('bad', { ...ok, indices: { ...ok.indices, ...bad } })]), 'neglected'), JSON.stringify(bad)).toEqual([])
  })
  it('«emergentes» need a measured growth or enough rising phrases; «No calculable» alone is not evidence', () => {
    const base = { confidence: 'media', indices: { demand: 70 } }
    expect(titles(recs([mk('none', { ...base, emerging: [] })]), 'emerging')).toEqual([])
    const terms = [1, 2, 3].map(i => ({ term: `new phrase ${i}`, videos: 4, views: 1000, share: 0.3 }))
    expect(titles(recs([mk('lexical', { ...base, emerging: terms })]), 'emerging')).toEqual(['lexical'])
    expect(titles(recs([mk('thin', { ...base, emerging: terms.slice(0, 2) })]), 'emerging')).toEqual([])
    const measured = { ...base, growth: { state: 'calculable', ratio: 3, label: 'al alza (posible)', reason: 'x', windowDays: 30, recent: { n: 10, medianVpd: 3 } }, indices: { demand: 70, growth: 75 } }
    expect(titles(recs([mk('measured', measured)]), 'emerging')).toEqual(['measured'])
  })
  it('«monetización» needs both demand and an estimated RPM at or above the threshold', () => {
    const lowRpm = recs([mk('arte y manualidades', { confidence: 'media', niches: ['animales'], indices: { demand: 80 } })])
    const hi = recs([mk('finanzas personales', { confidence: 'media', niches: ['finanzas'], indices: { demand: 80 } })])
    expect(titles(hi, 'money')).toEqual(['finanzas personales']); expect(titles(recs([mk('unknown rpm', { confidence: 'media', niches: ['motor'], indices: { demand: 80 } })]), 'money')).toEqual([]); void lowRpm
  })
})

describe('saving keeps the whole analysis, from any card, without duplicates', () => {
  const fakeDb = () => {
    const rows: Array<Record<string, unknown>> = []
    const q = (filters: Array<[string, unknown]> = []) => ({ eq: (k: string, v: unknown) => q([...filters, [k, v]]), limit: async () => ({ data: rows.filter(r => filters.every(([k, v]) => r[k] === v)).map(r => ({ id: r.source_id })), error: null }) })
    return { rows, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: () => ({ select: () => q(), insert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null } } }) }
  }
  const analysis = () => analyzeTopic(samples('mortgage guide', 'GB', 'en', many(15, i => ({ title: `mortgage guide ${i}`, lang: 'en', ch: `s${i}` })), many(10, i => ({ title: `mortgage guide new ${i}`, lang: 'en', days: 4 + i, ch: `n${i}` }))), NOW)
  it('stores indices, growth state, sample quality, format quality and the example videos with their thumbnails', async () => {
    const { saveAnalysis } = await import('@/lib/research/save'), db = fakeDb(), a = analysis()
    expect(await saveAnalysis(db as never, a)).toBe('saved')
    const row = db.rows[0] as { calculated_metrics: Record<string, unknown>; observed_metrics: { snapshot: { videos: Array<{ thumbnailUrl: string | null }> } } }
    expect(row.calculated_metrics).toMatchObject({ growth: { state: 'no_calculable' }, quality: { examined: 25 }, formatQuality: expect.any(Object), indices: { growth: null } })
    expect(row.observed_metrics.snapshot.videos.length).toBeGreaterThan(0); expect(row.observed_metrics.snapshot.videos[0].thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\//)
  })
  it('saving the same analysis again (from the Nichos card or from a recommendation) does not create a second record', async () => {
    const { saveAnalysis } = await import('@/lib/research/save'), db = fakeDb(), a = analysis()
    expect(await saveAnalysis(db as never, a)).toBe('saved'); expect(await saveAnalysis(db as never, a)).toBe('exists'); expect(db.rows).toHaveLength(1)
    const reco = buildRecommendations({ analyses: [{ ...a, confidence: 'media' }], charts: {}, filters: EMPTY_FILTERS }).sections.flatMap(s => s.items).find(i => i.kind === 'niche' && i.source === 'analysis')
    expect(reco && reco.kind === 'niche' && reco.analysis).toBeTruthy()
    if (reco && reco.kind === 'niche' && reco.analysis) expect(await saveAnalysis(db as never, reco.analysis)).toBe('exists')
  })
})

describe('relevance is not over-strict: inflections, acronyms and ordinary queries pass', () => {
  const ok = (q: string, t: string, region = 'ES', lang = 'es') => expect(judge(t, q, region, lang).relevant, `${q} :: ${t}`).toBe(true)
  it('plural / gender / ending variants and acronym long forms match', () => {
    ok('reformas baratas', 'Reforma de baño barata: antes y después con poco dinero'); ok('ia para negocios', 'Cómo usar la inteligencia artificial en tu negocio (IA para empresas)')
    ok('coches eléctricos', 'Los mejores coches eléctricos de 2026: comparativa'); ok('crímenes reales', 'Crimen real: el caso que conmocionó a España')
    ok('historical mysteries', 'Historical mystery: the mysteries we still ask about', 'US', 'en')
  })
  it('ordinary seed queries keep their natural videos', () => {
    ok('cómo invertir desde cero', 'Cómo invertir en bolsa desde cero: guía para principiantes 2026'); ok('lofi para dormir', 'Música lofi para dormir profundamente | 3 horas')
    ok('Aktien kaufen für Anfänger', 'Aktien kaufen für Anfänger – Schritt für Schritt erklärt', 'DE', 'de'); ok('cuidado de gatos', 'Cuidado de gatos: lo que todo dueño primerizo debe saber')
  })
})


describe('meaning disambiguation: ISA, HSA, ETF, Super and queries with several meanings', () => {
  const judgeQ = (q: string, title: string, o: Partial<O> = {}, region = 'GB', lang = 'en') => assessVideo(vid({ title, lang, ...o }), queryProfile(q), expectedLanguages(region, lang))
  const status = (q: string, title: string, o: Partial<O> = {}, region = 'GB', lang = 'en') => { const a = judgeQ(q, title, o, region, lang); return `${a.status}${a.reason ? `:${a.reason}` : ''}` }

  it('a query that is only an ambiguous term knows its intended meaning (money), and says so', () => {
    for (const t of ['isa', 'hsa', 'etf', 'super', 'ira', 'fire']) expect(queryProfile(`${t} explained`).ambiguity?.intended.id, t).toBe('finanzas')
    expect(queryProfile('super mario odyssey').ambiguity).toBeNull()   // the other words already say which «super» is meant
    expect(queryProfile('mortgage guide').ambiguity).toBeNull()
  })

  describe('ISA (UK) — the contamination found by the real validation', () => {
    const Q = 'ISA explained'
    it('accepts videos that confirm the savings-account meaning and quotes the words that confirmed it', () => {
      for (const t of ['Stocks and Shares ISA explained: how to invest £20,000 tax free', 'Cash ISA vs Lifetime ISA 2026 – which is best for savings?', 'What is an ISA? UK savings allowance explained']) expect(status(Q, t), t).toBe('aceptado')
      expect(judgeQ(Q, 'Stocks and Shares ISA explained: how to invest £20,000 tax free').detail).toMatch(/confirmado por: .*(stocks and shares|invest)/)
    })
    it('rejects religion, a military unit and video games, naming the meaning and the words seen', () => {
      const rel = judgeQ(Q, 'Who is Isa? The story of Jesus in the Quran explained'), mil = judgeQ(Q, 'ISA Intelligence Support Activity explained | US Army special forces unit'), game = judgeQ(Q, 'ISA gameplay walkthrough: Minecraft server explained')
      expect([rel.status, rel.reason]).toEqual(['descartado', 'sentido']); expect(rel.detail).toMatch(/religión.*jesus|religión.*quran/)
      expect([mil.status, mil.reason]).toEqual(['descartado', 'sentido']); expect(mil.detail).toMatch(/militar/)
      expect([game.status, game.reason]).toEqual(['descartado', 'sentido']); expect(game.detail).toMatch(/videojuegos/)
    })
    it('a video with no context either way is «dudoso» — out of the metrics, but NOT called wrong', () => {
      const a = judgeQ(Q, 'ISA explained', { chTitle: 'Canal' })
      expect(a.status).toBe('dudoso'); expect(a.reason).toBe('contexto'); expect(a.relevant).toBe(false); expect(a.detail).toMatch(/nada en el título, etiquetas, descripción o canal confirma/)
    })
    it('context can come from the description, the tags or the channel, so legitimate videos are not dropped for a short title', () => {
      expect(status(Q, 'ISAs explained simply', { desc: 'Tax-free savings and investing in the UK: how an ISA works' })).toBe('aceptado')
      expect(status(Q, 'ISAs explained simply', { tags: ['savings', 'investing', 'uk'] })).toBe('aceptado')
      expect(status(Q, 'ISAs explained simply', { chTitle: 'Meaningful Money' })).toBe('aceptado')
    })
    it('the more specific sense wins when both appear', () => {
      expect(status(Q, 'ISA explained: invest your savings tax free, not the Jesus story', {})).toBe('aceptado')   // 3 money cues vs 1 religion cue
      expect(status(Q, 'Isa Jesus Quran Bible church explained: savings')).toMatch(/^descartado:sentido/)
    })
    it('the analysis counts only the confirmed videos and keeps the rest inspectable with reasons', () => {
      const good = many(12, i => ({ title: `Stocks and Shares ISA explained part ${i}: invest tax free`, lang: 'en', views: 20000, ch: `g${i}` }))
      const religion = many(3, i => ({ title: `Who is Isa ${i}? Jesus in the Quran explained`, lang: 'en', views: 9_000_000, ch: `r${i}` }))
      const army = many(1, () => ({ title: 'ISA Intelligence Support Activity explained | Army special forces', lang: 'en', views: 4_000_000 }))
      const game = many(1, () => ({ title: 'ISA gameplay Minecraft server explained', lang: 'en', views: 3_000_000 }))
      const unknown = many(2, () => ({ title: 'ISA explained', lang: 'en', views: 100000 }))
      const a = analyzeTopic(samples('ISA explained', 'GB', 'en', [...religion, ...army, ...game, ...unknown, ...good], many(8, i => ({ title: `ISA explained: new savings allowance ${i}`, lang: 'en', days: 5 + i, ch: `n${i}` }))), NOW)
      expect(a.quality.excluded.sentido).toBe(5); expect(a.quality.uncertain).toBe(2); expect(a.quality.kept).toBe(12 + 8)
      expect(a.sample).toHaveLength(12 + 3 + 1 + 1 + 2 + 8)
      expect(a.sample.filter(v => v.status === 'descartado').every(v => v.reason === 'sentido' && v.detail.length > 10)).toBe(true)
      expect(a.sample.filter(v => v.status === 'dudoso').every(v => v.reason === 'contexto')).toBe(true)
      expect(a.topVideos.every(v => /Stocks and Shares/.test(v.title))).toBe(true)
      const onlyGood = analyzeTopic(samples('ISA explained', 'GB', 'en', good, many(8, i => ({ title: `ISA explained: new savings allowance ${i}`, lang: 'en', days: 5 + i, ch: `n${i}` }))), NOW)
      expect(a.indices.demand).toBe(onlyGood.indices.demand); expect(a.indices.competition).toBe(onlyGood.indices.competition)
    })
    it('when more than half of the results are dubious or wrong the confidence is low and no «oportunidad» is claimed', () => {
      const noise = many(14, i => ({ title: `Who is Isa ${i}? Jesus and the Quran explained`, lang: 'en', views: 800000, ch: `x${i}` }))
      const a = analyzeTopic(samples('ISA explained', 'GB', 'en', [...noise, ...many(6, i => ({ title: `Cash ISA explained savings ${i}`, lang: 'en', views: 200000, subs: 2000, days: 40 }))], many(5, i => ({ title: `Cash ISA explained savings new ${i}`, lang: 'en', days: 3 + i }))), NOW)
      expect(a.confidence).toBe('baja'); expect(a.verdict).not.toBe('oportunidad')
    })
  })

  describe('HSA, ETF, Super', () => {
    it('HSA (US): health savings account is accepted; school / concert uses are rejected; no context is dudoso', () => {
      const Q = 'HSA explained'
      expect(status(Q, 'HSA explained: health savings account tax advantages for 2026', {}, 'US')).toBe('aceptado')
      expect(status(Q, 'Should you invest your HSA? The triple tax advantage', {}, 'US')).toBe('aceptado')
      expect(status(Q, 'HSA school concert lyrics official video', {}, 'US')).toBe('descartado:sentido')
      expect(status(Q, 'HSA explained', {}, 'US')).toBe('dudoso:contexto')
    })
    it('ETF: exchange traded funds are accepted; a game video is rejected; a bare title is dudoso', () => {
      const Q = 'ETF explained'
      expect(status(Q, 'ETFs explained: index funds for beginners (Vanguard VWCE, S&P 500)')).toBe('aceptado')
      expect(status(Q, 'ETF gameplay on Roblox explained')).toBe('descartado:sentido')
      expect(status(Q, 'ETF explained')).toBe('dudoso:contexto')
    })
    it('Super (Australia): superannuation is accepted; Super Mario and superhero videos are rejected', () => {
      const Q = 'super explained'
      expect(status(Q, 'Superannuation explained: how super funds work in Australia', {}, 'AU')).toBe('aceptado')
      expect(status(Q, 'Industry super vs retail super: fees and returns in 2026', {}, 'AU')).toBe('aceptado')
      expect(status(Q, 'Super Mario Odyssey gameplay walkthrough explained', {}, 'AU')).toBe('descartado:sentido')
      expect(status(Q, 'Superhero movie trailer explained', {}, 'AU')).toBe('descartado:sentido')
      expect(status(Q, 'Super explained', {}, 'AU')).toBe('dudoso:contexto')
    })
    it('the same word with other words in the query is not forced into the money sense', () => {
      expect(status('super mario odyssey', 'Super Mario Odyssey full walkthrough gameplay', {}, 'US')).toBe('aceptado')
      expect(status('fire safety at home', 'Fire safety at home: extinguisher and escape plan', {}, 'US')).toBe('aceptado')
    })
  })

  describe('queries with several meanings that are NOT in the table (data-driven)', () => {
    const finance = (n: number) => many(n, i => ({ title: `Best savings account interest rates at the bank ${i}`, lang: 'en', views: 30000, ch: `f${i}` }))
    const games = (n: number) => many(n, i => ({ title: `Savings account bug in Roblox gameplay ${i}`, lang: 'en', views: 30000, ch: `g${i}` }))
    const neutral = (n: number) => many(n, i => ({ title: `My savings account story ${i}`, lang: 'en', views: 30000, ch: `n${i}` }))
    it('when the sample itself shows other meanings, every video must confirm the intended one; neutral ones become «dudosos»', () => {
      const a = analyzeTopic(samples('savings account', 'GB', 'en', [...finance(10), ...games(8), ...neutral(6)], many(6, i => ({ title: `Savings account interest rates new ${i}`, lang: 'en', days: 3 + i }))), NOW)
      expect(a.quality.ambiguousSample).toBe(true); expect(a.quality.uncertain).toBe(6)
      expect(a.sample.filter(v => /My savings account story/.test(v.title)).every(v => v.status === 'dudoso')).toBe(true)
      expect(a.sample.filter(v => /Roblox/.test(v.title)).every(v => v.status === 'descartado')).toBe(true)
    })
    it('when the sample is clean the same neutral videos are accepted: nothing is dropped without a verifiable reason', () => {
      const a = analyzeTopic(samples('savings account', 'GB', 'en', [...finance(10), ...neutral(6)], many(6, i => ({ title: `Savings account interest rates new ${i}`, lang: 'en', days: 3 + i }))), NOW)
      expect(a.quality.ambiguousSample).toBe(false); expect(a.quality.uncertain).toBe(0)
      expect(a.sample.filter(v => /My savings account story/.test(v.title)).every(v => v.status === 'aceptado')).toBe(true)
    })
  })

  describe('transparency: every video the search returned can be inspected', () => {
    it('lists ALL accepted, dubious and rejected videos (not five), with links and reasons, and exports them', async () => {
      const { sampleCsv } = await import('@/lib/research/export')
      const bad = many(30, i => ({ title: `Who is Isa ${i}? Jesus and the Quran explained`, lang: 'en', ch: `b${i}` }))
      const a = analyzeTopic(samples('ISA explained', 'GB', 'en', [...bad, ...many(10, i => ({ title: `Cash ISA explained savings ${i}`, lang: 'en', ch: `g${i}` }))], many(5, i => ({ title: `Cash ISA explained savings new ${i}`, lang: 'en', days: 3 + i }))), NOW)
      expect(a.sample.length).toBe(45); expect(a.sample.filter(v => v.status === 'descartado')).toHaveLength(30)
      expect(a.sample.every(v => /^https:\/\/www\.youtube\.com\/watch\?v=/.test(v.url) && v.title.length > 0)).toBe(true)
      const csv = sampleCsv(a).split('\n'); expect(csv).toHaveLength(46); expect(csv[0]).toMatch(/^estado,motivo,detalle,título,canal,enlace/)
      expect(csv.filter(l => l.startsWith('descartado,sentido')).length).toBe(30)
    })
  })
})

describe('local semantic evidence (TF-IDF similarity) resolves only what the word rules could not', () => {
  const ctx = (i: number) => ({ desc: `wrapper platform fees comparison provider flexible lifetime wrapper platform fees ${i}`, lang: 'en', views: 20000 })
  const good = (k: number) => many(k, i => ({ title: `Stocks and Shares ISA explained part ${i}: invest tax free`, ...ctx(i), ch: `g${i}` }))
  const recent = () => many(8, i => ({ title: `ISA explained: new savings allowance ${i}`, lang: 'en', days: 5 + i, ch: `n${i}` }))
  const run = (extra: YouTubeVideoResult[]) => analyzeTopic(samples('ISA explained', 'GB', 'en', [...good(12), ...extra], recent()), NOW)

  it('a doubtful video whose surrounding text matches the confirmed ones is accepted, and the decision quotes its similarity', () => {
    const a = run([vid({ title: 'ISA explained properly', ...ctx(99), ch: 'x1' })])
    const v = a.sample.find(x => x.title === 'ISA explained properly')!
    expect(v.status).toBe('aceptado'); expect(v.detail).toMatch(/por contexto: se parece \(\d+ %\)/)
  })
  it('a doubtful video with almost no text stays doubtful: no information, no verdict', () => {
    const a = run([vid({ title: 'ISA explained', lang: 'en' })])
    expect(a.sample.find(x => x.title === 'ISA explained' && x.inTop)!.status).toBe('dudoso')
  })
  it('without enough confirmed videos nothing is decided by similarity', () => {
    const a = analyzeTopic(samples('ISA explained', 'GB', 'en', [...good(2), vid({ title: 'ISA explained properly', ...ctx(99) })], []), NOW)
    expect(a.sample.find(x => x.title === 'ISA explained properly')!.status).toBe('dudoso')
  })
  it('a doubtful video that reads like the other-meaning videos is rejected as that meaning, with the similarity quoted', () => {
    const quran = (i: number) => ({ title: `Isa in the Quran Jesus explained part ${i}`, desc: `parable lessons narrated devotion parable lessons narrated devotion ${i}`, lang: 'en', ch: `q${i}` })
    const a = analyzeTopic(samples('ISA explained', 'GB', 'en', [...good(12), ...many(4, quran), vid({ title: 'ISA explained slowly', desc: 'parable lessons narrated devotion', lang: 'en', ch: 'y1' })], recent()), NOW)
    const v = a.sample.find(x => x.title === 'ISA explained slowly')!
    expect(v.status).toBe('descartado'); expect(v.reason).toBe('sentido'); expect(v.detail).toMatch(/por contexto/)
  })
})
