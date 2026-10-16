import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { assessVideo, expectedLanguages, queryProfile } from '@/lib/research/relevance'
import { financeCues } from '@/lib/research/lexicon'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'

// SIMULATED fixtures modelled on the audit of «ETF Sparplan erklärt» (DE, de). No YouTube call is made: these prove the rules, not what YouTube returns.
const NOW = Date.parse('2026-10-16T12:00:00Z')
let n = 0
type O = { lang?: string | null; desc?: string; tags?: string[]; ch?: string; views?: number; days?: number; cat?: string }
const vid = (title: string, o: O = {}): YouTubeVideoResult => {
  const days = o.days ?? 10, views = o.views ?? 20000
  return { videoId: `m${++n}`, url: `https://www.youtube.com/watch?v=m${n}`, title, channelId: `c${n}`, channelTitle: o.ch ?? 'Kanal', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: o.lang === undefined ? 'de' : o.lang, categoryId: o.cat ?? null,
    description: o.desc ?? '', tags: o.tags ?? [], channelCountry: null, live: null, observed: { views, likes: 10, comments: 1, durationSeconds: 600, channelSubscribers: 20000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult
}
const judge = (t: string, topic: string, region: string, language: string, o: O = {}) => assessVideo(vid(t, { lang: language, ...o }), queryProfile(topic), expectedLanguages(region, language))
const T = 'ETF Sparplan erklärt'

describe('German finance videos are recognised in German (not only through English terms)', () => {
  const real = [
    'ETF Sparplan für Anfänger: So startest du 2026', 'Welcher ETF ist der beste? MSCI World vs. FTSE All-World', 'Vermögensaufbau mit ETFs: Das Weltportfolio einfach erklärt',
    'Sparplan einrichten bei Trade Republic – Schritt für Schritt', 'Aktien oder ETF? Das solltest du wissen', 'ETF-Sparpläne: Steuern, Kosten und Rendite', 'Indexfonds Dividendenstrategie Depot',
    'Die besten Rentenfonds und ETFs für die Altersvorsorge', 'Wie viel Geld brauche ich für die Rente? ETF Rechner', 'ETF Sparplan Tutorial Excel', 'ETF vs. Zertifikat: Was ist günstiger?',
    'Thesaurierend oder ausschüttend? ETF-Sparplan richtig wählen', 'Zinseszins mit dem ETF-Sparplan: 25 Jahre Vermögensaufbau', 'Dein erstes Depot eröffnen und den ETF-Sparplan starten',
  ]
  it('compounds, inflections, umlauts and local terminology are accepted', () => { for (const t of real) { const a = judge(t, T, 'DE', 'de'); expect(a.relevant, `${t} → ${a.detail}`).toBe(true) } })
  it('works with ß, ue/oe transliterations and plurals', () => {
    for (const t of ['Maßnahmen für den ETF Sparplan in der Rezession', 'ETF Sparplaene und Vermoegensaufbau fuer Anfaenger', 'Mehrere ETF-Sparpläne gleichzeitig: sinnvoll?']) expect(judge(t, T, 'DE', 'de').relevant, t).toBe(true)
  })
  it('the evidence quoted for acceptance is in German', () => { const a = judge('Vermögensaufbau mit ETFs: Das Weltportfolio einfach erklärt', T, 'DE', 'de'); expect(a.detail).toMatch(/vermogen|weltportfolio/) })
  it('the same vocabulary written in other languages is recognised too', () => {
    expect(judge('Cómo invertir en ETF: fondos indexados y plan de ahorro para principiantes', 'ETF plan de ahorro', 'ES', 'es').relevant).toBe(true)
    expect(judge('ETF et plan d’épargne : investir en bourse pour débutants', 'ETF plan épargne', 'FR', 'fr').relevant).toBe(true)
    expect(judge('ETF e piano di accumulo: come investire in borsa', 'ETF piano di accumulo', 'IT', 'it').relevant).toBe(true)
    expect(judge('Beleggen met ETF’s: vermogen opbouwen voor beginners', 'ETF beleggen', 'NL', 'nl').relevant).toBe(true)
  })
})

describe('German videos that are NOT about the topic stay out', () => {
  it('games, cooking, music and sport', () => {
    for (const t of ['Fortnite Season 5 Gameplay deutsch', 'Mein Kochrezept: Sparsame Pasta für die ganze Familie', 'Bayern gegen Dortmund: Die Highlights', 'Minecraft Server Tour mit ETF Clan', 'Konzert Mitschnitt: ETF Official Video Album'])
      expect(judge(t, T, 'DE', 'de').relevant, t).toBe(false)
  })
  it('a lone word that merely resembles the topic is not enough', () => {
    expect(judge('Sparen beim Einkaufen: 10 Tipps für den Supermarkt', T, 'DE', 'de').relevant).toBe(false)
    expect(judge('Der Depot-Tag im Baumarkt', T, 'DE', 'de').relevant).toBe(false)
  })
  it('ambiguous cases are doubtful or rejected, never counted: the acronym with no money context', () => {
    const a = judge('ETF erklärt', T, 'DE', 'de'); expect(a.relevant).toBe(false); expect(['dudoso', 'descartado']).toContain(a.status)
  })
  it('an English video is still out of a German market', () => { const a = judge('ETF savings plan explained for beginners', T, 'DE', 'de', { lang: 'en' }); expect(a.relevant).toBe(false); expect(a.reason).toBe('idioma') })
})

describe('the German work does not bring false positives back in English', () => {
  const Q = 'ETF savings plan'
  it('German-only words do not confirm anything in an English video', () => {
    expect(financeCues(' home depot haul and bank holiday kosten ', ['en'])).toEqual([])
    expect(financeCues(' home depot haul ', ['de'])).toContain('depot')
  })
  it('English ETF videos are still accepted, and English look-alikes are still rejected', () => {
    expect(judge('Best ETF savings plan for beginners: invest monthly and build wealth', Q, 'GB', 'en').relevant).toBe(true)
    expect(judge('Vanguard ETF savings plan explained: index funds for the long term', Q, 'US', 'en').relevant).toBe(true)
    for (const t of ['Home Depot haul: tools and garden ETF mod for Minecraft server', 'ETF official video lyrics album', 'Savings plan for my cat’s birthday party']) expect(judge(t, Q, 'GB', 'en').relevant, t).toBe(false)
  })
  it('the previous English regressions still hold (ISA with religious, military and game videos)', () => {
    for (const t of ['Who is Isa? Jesus in the Quran explained', 'ISA Intelligence Support Activity explained | Army special forces', 'ISA gameplay Minecraft server explained']) expect(judge(t, 'ISA explained', 'GB', 'en').relevant, t).toBe(false)
    expect(judge('Stocks and Shares ISA explained: tax free investing', 'ISA explained', 'GB', 'en').relevant).toBe(true)
  })
})

describe('the audit sample: 25 German results, most of them valid', () => {
  it('the analysis keeps the valid German videos and says why the rest was left out', () => {
    const good = ['ETF Sparplan für Anfänger', 'Welcher ETF ist der beste? MSCI World', 'Vermögensaufbau mit ETFs', 'Sparplan einrichten bei Trade Republic', 'Aktien oder ETF?', 'ETF-Sparpläne: Steuern und Rendite', 'Indexfonds Dividendenstrategie', 'Rentenfonds und ETFs für die Altersvorsorge', 'ETF Rechner für die Rente', 'ETF Sparplan Tutorial Excel', 'ETF vs. Zertifikat', 'Thesaurierend oder ausschüttend? ETF-Sparplan', 'Zinseszins mit dem ETF-Sparplan', 'Dein erstes Depot und der ETF-Sparplan', 'ETF Sparplan Strategie 2026', 'Weltportfolio mit zwei ETFs', 'MSCI World Sparplan: lohnt sich das?', 'ETF-Sparplan kündigen oder pausieren?', 'Die Kosten deines ETF-Sparplans', 'ETF Sparplan vs. Einmalanlage', 'Sparplan Rendite berechnen']
    const bad = ['Fortnite Season 5 Gameplay', 'Pasta Rezept sparsam', 'Bayern Highlights', 'Minecraft Server ETF Clan']
    const s: TopicSamples = { topic: T, region: 'DE', language: 'de', recentDays: 30, top: { videos: [...good, ...bad].map((t, i) => vid(t, { ch: `ch${i}`, days: 20 + i })), approxTotal: 1000 }, recent: { videos: good.slice(0, 12).map((t, i) => vid(`${t} neu`, { ch: `rc${i}`, days: 1 + i })), approxTotal: 90 }, fetchedAt: new Date(NOW).toISOString(), units: 204 }
    const a = analyzeTopic(s, NOW)
    expect(a.sample.filter(v => v.inTop && v.status === 'aceptado').length).toBe(good.length)
    expect(a.sample.filter(v => v.inTop && v.status !== 'aceptado').length).toBe(bad.length)
    expect(a.quality.excluded.tema + a.quality.excluded.nicho + a.quality.excluded.sentido + a.quality.uncertain).toBe(bad.length)
    expect(a.confidence).not.toBe('baja')
  })
})
