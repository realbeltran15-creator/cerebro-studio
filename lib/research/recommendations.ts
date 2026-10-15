import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { crossRegionTerms, neglectedNiches } from './discovery'
import { analysisExclusions, filterVideos, forTab, mergeRegions, type ResearchFilters, type SeenVideo } from './filters'
import { marketLabel, countryName } from './markets'
import { formatAdjusted, nicheRpm } from './monetization'
import { inferFormat, nichesOf, nicheLabel, type InferredFormat } from './taxonomy'
import { formatOpportunity, type TopicAnalysis, type Verdict } from './topic-analysis'

/**
 * Recommendations built ONLY from what Cerebro Studio already fetched (analyses and official charts). Every video, thumbnail and number
 * comes from the YouTube Data API response; nothing is invented. Each section says why it recommends what it does, and a video is shown
 * at most once across the whole page.
 */
export type RecoVideo = {
  videoId: string; url: string; title: string; channelTitle: string; thumbnailUrl: string | null; views: number | null; publishedAt: string; durationSeconds: number | null
  format: InferredFormat; language: string | null; market: string; subscribers: number | null; fetchedAt: string
}
export type NicheReco = { kind: 'niche'; key: string; topic: string; market: string; verdict: Verdict | null; indices: TopicAnalysis['indices'] | null; confidence: string | null; reason: string; rpmNote: string | null; updatedAt: string; videos: RecoVideo[]; source: 'analysis' | 'chart'
  /** True when the analysis has example videos but all of them are already shown in another recommendation. */
  examplesElsewhere: boolean
  /** The full analysis behind the card, so saving keeps every number, the evidence and the examples (undefined for chart-based cards). */
  analysis?: TopicAnalysis }
export type VideoReco = { kind: 'video'; key: string; video: RecoVideo; reason: string }
export type Reco = NicheReco | VideoReco
export type RecoSection = { id: string; title: string; blurb: string; items: Reco[]; empty: string }

const toVideo = (v: YouTubeVideoResult, market: string, language: string | null): RecoVideo => ({
  videoId: v.videoId, url: v.url, title: v.title, channelTitle: v.channelTitle, thumbnailUrl: v.thumbnailUrl, views: v.observed.views, publishedAt: v.publishedAt, durationSeconds: v.observed.durationSeconds,
  format: inferFormat(v), language: v.declaredLanguage ?? language, market, subscribers: v.observed.channelSubscribers, fetchedAt: v.observed.fetchedAt,
})

/**
 * What an analysis must show to be recommended in each section. A low-confidence analysis (thin or contaminated sample) is never
 * recommended; being the "best of a weak list" is not enough, so a section can be empty. The same numbers are printed in each blurb.
 */
export const THRESHOLDS = {
  demand: { demand: 40 },
  neglected: { demand: 50, competition: 55, supply: 60, opportunity: 55 },
  emerging: { demand: 35, growthIndex: 60, emergingTerms: 3, termVideos: 3 },
  money: { demand: 35, rpmMid: 4 },
  lowcomp: { demand: 35, competition: 40 },
  formats: { demand: 35 },
} as const

export type Pref = 'any' | 'short' | 'long' | 'small'
const isShort = (v: RecoVideo) => v.format.format === 'short'
const isLong = (v: RecoVideo) => ['brief', 'medium', 'long'].includes(v.format.format)

const isLive = (v: RecoVideo) => v.format.format === 'live'

/** Does the video belong in a section that asks for `pref`? Shorts/long sections are strict: a recommendation never shows a video of the wrong format. */
const fits = (r: RecoVideo, pref: Pref) => pref === 'short' ? isShort(r) : pref === 'long' ? isLong(r) : true

/** Up to `n` representative videos of an analysis: best views per day first, different channels first, never one already shown, never a live stream. */
function pickVideos(a: TopicAnalysis, used: Set<string>, n: number, pref: Pref): RecoVideo[] {
  const market = marketLabel(a.region, a.language)
  const pool = a.topVideos.filter(v => !used.has(v.videoId)).map(v => ({ v, r: toVideo(v, market, a.language) })).filter(x => !isLive(x.r) && fits(x.r, pref))
  pool.sort((x, y) => (y.v.calculated.viewsPerDay ?? 0) - (x.v.calculated.viewsPerDay ?? 0))
  const out: RecoVideo[] = [], channels = new Set<string>()
  for (const x of pool) { if (out.length >= n) break; if (channels.has(x.v.channelId)) continue; channels.add(x.v.channelId); out.push(x.r) }
  for (const x of pool) { if (out.length >= n) break; if (!out.some(o => o.videoId === x.v.videoId)) out.push(x.r) }
  for (const v of out) used.add(v.videoId)
  return out
}

const rpmMid = (a: TopicAnalysis) => a.niches.reduce((m, n) => { const r = formatAdjusted(nicheRpm(n), 'long'); return r.status === 'estimado' ? Math.max(m, r.mid) : m }, 0)
const rpmNote = (a: TopicAnalysis) => {
  const n = a.niches.find(x => nicheRpm(x).status === 'estimado'); if (!n) return null
  const r = formatAdjusted(nicheRpm(n), 'long')
  return r.status === 'estimado' ? `RPM ESTIMADO ${nicheLabel(n)}: $${r.low}–$${r.high} por 1000 visitas (confianza ${r.confidence})` : null
}

function nicheReco(a: TopicAnalysis, reason: string, used: Set<string>, videosPerNiche: number, pref: Pref): NicheReco {
  const videos = pickVideos(a, used, videosPerNiche, pref)
  return { kind: 'niche', key: `${a.topic}|${a.region}|${a.language}|${a.recentDays ?? 30}`, topic: a.topic, market: marketLabel(a.region, a.language), verdict: a.verdict, indices: a.indices, confidence: a.confidence, reason, rpmNote: rpmNote(a), updatedAt: a.fetchedAt, videos, source: 'analysis', examplesElsewhere: videos.length === 0 && a.topVideos.length > 0, analysis: a }
}

export function buildRecommendations(input: { analyses: TopicAnalysis[]; charts: Record<string, YouTubeVideoResult[]>; filters: ResearchFilters; perSection?: number; videosPerNiche?: number }): { sections: RecoSection[]; internationalTerms: Array<{ term: string; regions: string[] }>; updatedAt: string | null } {
  const per = input.perSection ?? 4, vpn = input.videosPerNiche ?? 3
  const f = forTab('discover', input.filters)
  const analyses = input.analyses.filter(a => analysisExclusions(a, f).length === 0)
  // Only analyses with enough relevant evidence may be recommended.
  const reliable = analyses.filter(a => a.confidence !== 'baja')
  const T = THRESHOLDS
  const used = new Set<string>()
  const built = new Map<string, RecoSection>()
  const add = (id: string, title: string, blurb: string, items: Reco[], empty: string) => { built.set(id, { id, title, blurb, items, empty }) }
  const top = (list: TopicAnalysis[], score: (a: TopicAnalysis) => number, reason: (a: TopicAnalysis) => string, pref: Pref = 'any') => [...list].sort((x, y) => score(y) - score(x)).slice(0, per).map(a => nicheReco(a, reason(a), used, vpn, pref))
  const none = analyses.length ? (reliable.length ? 'Ningún análisis cumple los umbrales de esta sección.' : 'Los análisis disponibles tienen confianza baja (muestra relevante insuficiente): no se recomienda nada con ellos.') : 'Aún no hay análisis: pulsa «Aplicar y buscar» en Nichos para obtenerlos.'

  // Charts (official most-popular lists), filtered by the applied filters.
  const wanted = f.countries.length ? f.countries : Object.keys(input.charts)
  const merged = mergeRegions(wanted.filter(r => input.charts[r]).map(r => ({ region: r, videos: input.charts[r] })))
  const chartVideos = filterVideos(merged, f)

  // Specific videos (international, small channels) claim their videos first; niche cards then show other examples. The page order stays the requested one.
  // 6. International trends: real videos present in several countries' lists.
  const intl: Reco[] = chartVideos.filter(v => v.regions.length >= 2 && !used.has(v.videoId) && v.live !== 'live' && v.live !== 'upcoming').sort((x, y) => y.regions.length - x.regions.length || (y.observed.views ?? 0) - (x.observed.views ?? 0)).slice(0, per).map(v => {
    used.add(v.videoId); return { kind: 'video' as const, key: `intl:${v.videoId}`, video: toVideo(v, v.regions.map(countryName).join(', '), v.declaredLanguage ?? null), reason: `Está a la vez en las listas oficiales de ${v.regions.map(countryName).join(', ')}.` }
  })
  const terms = crossRegionTerms(wanted.filter(r => input.charts[r]).map(r => ({ region: r, videos: input.charts[r] })))
  add('international', 'Tendencias internacionales', 'Vídeos y términos que aparecen en las listas de varios países a la vez. País = donde YouTube lo muestra, no dónde viven los espectadores.', intl, wanted.length < 2 ? 'Elige dos o más países y pulsa «Aplicar y cargar tendencias».' : 'Ningún vídeo coincide en varias listas con estos filtros.')

  // 7. Small channels that outperform their size.
  const pool = new Map<string, YouTubeVideoResult>()
  for (const v of chartVideos) pool.set(v.videoId, v)
  for (const a of analyses) for (const v of a.topVideos) if (!pool.has(v.videoId)) pool.set(v.videoId, v)
  const small: Reco[] = neglectedNiches([...pool.values()].filter(v => !used.has(v.videoId))).slice(0, per).map(v => {
    used.add(v.videoId); return { kind: 'video' as const, key: `small:${v.videoId}`, video: toVideo(v, (v as SeenVideo).regions?.map(countryName).join(', ') || 'análisis', v.declaredLanguage ?? null), reason: `${(v.observed.views ?? 0).toLocaleString('es-ES')} visualizaciones con ${(v.observed.channelSubscribers ?? 0).toLocaleString('es-ES')} suscriptores (${v.calculated.viewsToSubscribers}× más vistas que suscriptores). Por sí solo no prueba que el nicho esté desatendido.` }
  })
  add('small', 'Oportunidades para canales pequeños', 'Vídeos de canales de hasta 20.000 suscriptores que superan con creces su tamaño. Se excluyen directos, canales de discográficas (VEVO, «- Topic», Records…) y ratios de más de 500 vistas por suscriptor, donde el dato de suscriptores no describe la audiencia.', small, 'Sin vídeos que cumplan los umbrales con los datos cargados.')

  // 1. Highest demand: analyses first, then the official charts grouped by niche (free data).
  const demandItems: Reco[] = top(reliable.filter(a => a.indices.demand >= T.demand.demand), a => a.indices.demand, a => `Demanda ${a.indices.demand}/100: ${a.reasons[0] ?? ''}`)
  if (demandItems.length < per) {
    const byNiche = new Map<string, SeenVideo[]>()
    for (const v of chartVideos) for (const m of nichesOf(v)) byNiche.set(m.niche, [...(byNiche.get(m.niche) ?? []), v])
    const taken = new Set(demandItems.map(x => (x.kind === 'niche' ? x.topic : '')))
    for (const [niche, vs] of [...byNiche.entries()].sort((a, b) => b[1].reduce((t, v) => t + (v.observed.views ?? 0), 0) - a[1].reduce((t, v) => t + (v.observed.views ?? 0), 0))) {
      if (demandItems.length >= per) break
      if (taken.has(nicheLabel(niche))) continue
      const fresh = vs.filter(v => !used.has(v.videoId) && v.live !== 'live' && v.live !== 'upcoming').sort((x, y) => (y.observed.views ?? 0) - (x.observed.views ?? 0)).slice(0, vpn)
      if (!fresh.length) continue
      fresh.forEach(v => used.add(v.videoId))
      const total = vs.reduce((t, v) => t + (v.observed.views ?? 0), 0)
      demandItems.push({ kind: 'niche', key: `chart:${niche}`, topic: nicheLabel(niche), market: fresh[0].regions.map(countryName).join(', ') || 'lista oficial', verdict: null, indices: null, confidence: null, reason: `${vs.length} vídeo${vs.length === 1 ? '' : 's'} de este nicho en las listas oficiales de populares suman ${total.toLocaleString('es-ES')} visualizaciones (inferido por título y etiquetas; no es un análisis de oferta).`, rpmNote: null, updatedAt: fresh[0].observed.fetchedAt, videos: fresh.map(v => toVideo(v, (v as SeenVideo).regions.map(countryName).join(', '), v.declaredLanguage ?? null)), source: 'chart', examplesElsewhere: false })
    }
  }
  add('demand', 'Nichos con mayor demanda', `Temas relevantes con demanda ≥ ${T.demand.demand}/100 (vistas por día de los vídeos más vistos, sin anuncios ni virales atípicos).`, demandItems, none)

  // 2. Neglected: real demand with thin supply and competition.
  add('neglected', 'Nichos desatendidos', `Demanda ≥ ${T.neglected.demand}, competencia ≤ ${T.neglected.competition}, oferta ≤ ${T.neglected.supply} y oportunidad ≥ ${T.neglected.opportunity}, con confianza media. Poca oferta sin demanda no cuenta.`, top(reliable.filter(a => a.verdict === 'oportunidad' && a.indices.demand >= T.neglected.demand && a.indices.competition <= T.neglected.competition && a.indices.supply <= T.neglected.supply && a.indices.opportunity >= T.neglected.opportunity), a => a.indices.opportunity, a => a.reasons.slice(0, 2).join(' ')), none)
  // 3. Emerging.
  const risingTerms = (a: TopicAnalysis) => a.emerging.filter(t => t.videos >= T.emerging.termVideos)
  const isEmerging = (a: TopicAnalysis) => a.indices.demand >= T.emerging.demand && ((a.growth.state === 'calculable' && (a.indices.growth ?? 0) >= T.emerging.growthIndex) || risingTerms(a).length >= T.emerging.emergingTerms)
  add('emerging', 'Nichos emergentes', `Demanda ≥ ${T.emerging.demand} y, o bien crecimiento medido entre ventanas comparables (índice ≥ ${T.emerging.growthIndex}), o al menos ${T.emerging.emergingTerms} frases que aparecen en ${T.emerging.termVideos}+ vídeos recientes y no en el top del año. Sin una de las dos pruebas no se recomienda.`, top(reliable.filter(isEmerging), a => (a.indices.growth ?? 0) * 10 + risingTerms(a).length, a => a.growth.state === 'calculable' ? `Crecimiento ${a.growth.label} (×${a.growth.ratio?.toFixed(2)}): ${a.growth.reason}` : `Crecimiento No calculable; frases al alza: ${risingTerms(a).slice(0, 4).map(t => `${t.term} (${t.videos} vídeos)`).join(', ')}. Es una señal léxica, no una medida de crecimiento.`), none)
  // 4. Monetisation potential (ESTIMATED).
  add('money', 'Mayor potencial de monetización', `Demanda ≥ ${T.money.demand} y RPM de referencia ≥ $${T.money.rpmMid} por 1000 visitas (vídeo largo). El RPM es una ESTIMACIÓN de terceros, no el de ningún canal.`, top(reliable.filter(a => a.indices.demand >= T.money.demand && rpmMid(a) >= T.money.rpmMid), a => (a.niches.map(n => { const r = nicheRpm(n); return r.status === 'estimado' ? r.mid : 0 }).reduce((m, x) => Math.max(m, x), 0)) * 100 + a.indices.demand, a => `${rpmNote(a)}. Demanda ${a.indices.demand}/100.`), analyses.length ? 'Ningún análisis cae en un nicho con RPM de referencia dentro de los filtros.' : none)
  // 5. Lowest competition among niches that do have demand.
  add('lowcomp', 'Menor competencia', `Demanda ≥ ${T.lowcomp.demand} y competencia ≤ ${T.lowcomp.competition}: canales más pequeños y menos concentrados.`, top(reliable.filter(a => a.indices.demand >= T.lowcomp.demand && a.indices.competition <= T.lowcomp.competition), a => 100 - a.indices.competition, a => `Competencia ${a.indices.competition}/100 con demanda ${a.indices.demand}/100: ${a.reasons[2] ?? ''}`), none)

  // 8–9. Format gaps.
  const gap = (fmt: 'short' | 'long') => reliable.filter(a => formatOpportunity(a).recommended === fmt && a.indices.demand >= T.formats.demand)
  add('shorts', 'Oportunidades para Shorts', 'Temas con demanda en vídeos largos y poca presencia de Shorts (formato inferido por duración).', top(gap('short'), a => a.indices.opportunity, a => formatOpportunity(a).reason, 'short'), none)
  add('long', 'Oportunidades para vídeos largos', 'Temas donde los Shorts funcionan y casi no hay vídeos largos en la muestra.', top(gap('long'), a => a.indices.opportunity, a => formatOpportunity(a).reason, 'long'), none)

  const ORDER = ['demand', 'neglected', 'emerging', 'money', 'lowcomp', 'international', 'small', 'shorts', 'long']
  const sections = ORDER.map(id => built.get(id)!)
  const dates = [...analyses.map(a => a.fetchedAt), ...chartVideos.map(v => v.observed.fetchedAt)].sort()
  return { sections, internationalTerms: terms, updatedAt: dates.length ? dates[dates.length - 1] : null }
}
