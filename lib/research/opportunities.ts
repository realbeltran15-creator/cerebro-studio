import { compareMarkets, countryInfo } from './markets-info'
import { marketLabel } from './markets'
import type { TopicAnalysis } from './topic-analysis'

/**
 * Detects underserved niches in analyses that are ALREADY in the cache (no new YouTube calls). Each detector states the evidence that fired
 * it, with real videos to inspect, and says what would make it wrong. Absence of videos is never treated as demand: every detector needs
 * observed views, and weak signals are reported as «a verificar», not as opportunities.
 */
export type OppKind = 'demanda_poca_oferta' | 'canales_pequenos' | 'contenido_envejecido' | 'tema_emergente' | 'idioma' | 'pais' | 'preguntas' | 'busqueda_floja'
export type OppStrength = 'fuerte' | 'moderada' | 'indicio' | 'a_verificar'
export type OppEvidence = { label: string; value: string; videoId?: string; url?: string; thumbnailUrl?: string | null }
export type Opportunity = {
  id: string; kind: OppKind; strength: OppStrength
  topic: string; market: string
  /** What is claimed, in one sentence. */
  claim: string
  demand: number; competition: number; supply: number
  evidence: OppEvidence[]
  /** What could make the claim wrong. Never empty. */
  uncertainty: string
  channelType: string
  formats: string[]
  nextStep: string
}

const MIN_RELEVANT = 20
const label = (a: TopicAnalysis) => marketLabel(a.region, a.language)
const relevantCount = (a: TopicAnalysis) => a.sampleSizes.top + a.sampleSizes.recent
const solid = (a: TopicAnalysis) => a.confidence !== 'baja' && relevantCount(a) >= MIN_RELEVANT
const days = (iso: string, now: number) => Math.max((now - Date.parse(iso)) / 86400000, 0)

const videoEvidence = (a: TopicAnalysis, pick: (v: TopicAnalysis['topVideos'][number]) => boolean, limit = 3): OppEvidence[] =>
  a.topVideos.filter(pick).slice(0, limit).map(v => ({ label: `${v.channelTitle}${typeof v.observed.channelSubscribers === 'number' ? ` · ${v.observed.channelSubscribers.toLocaleString('es-ES')} suscriptores` : ''}`, value: `${(v.observed.views ?? 0).toLocaleString('es-ES')} vistas · ${v.title.slice(0, 90)}`, videoId: v.videoId, url: v.url, thumbnailUrl: v.thumbnailUrl }))

const formatsOf = (a: TopicAnalysis) => {
  const { short, long } = a.byFormat, out: string[] = []
  if (long.count >= short.count) out.push('Vídeo largo'); if (short.count > 0 && (short.medianViewsPerDay ?? 0) >= (long.medianViewsPerDay ?? 0) * 0.7) out.push(a.formatQuality.shortConfirmed ? 'Shorts (confirmados con #shorts)' : 'Shorts (probables, por duración)')
  return out.length ? out : ['Vídeo largo']
}

const channelTypeOf = (a: TopicAnalysis) => {
  const s = a.stats
  if (s && s.smallWins.share !== null && s.smallWins.share >= 0.4) return 'Canal nuevo o pequeño y especializado: en este tema los canales pequeños ya consiguen más vistas que suscriptores.'
  if (a.indices.competition > 55) return 'Canal con una propuesta muy diferenciada: los canales grandes ya ocupan el tema.'
  return 'Canal temático de tamaño medio o nuevo con constancia de publicación.'
}

type Base = Pick<Opportunity, 'topic' | 'market' | 'demand' | 'competition' | 'supply' | 'channelType' | 'formats'>
const baseOf = (a: TopicAnalysis): Base => ({ topic: a.topic, market: label(a), demand: a.indices.demand, competition: a.indices.competition, supply: a.indices.supply, channelType: channelTypeOf(a), formats: formatsOf(a) })
const idOf = (kind: string, a: TopicAnalysis, extra = '') => `${kind}|${a.topic.toLowerCase()}|${a.region ?? ''}|${a.language ?? ''}${extra}`

export function detectOpportunities(analyses: TopicAnalysis[], now = Date.now()): Opportunity[] {
  const out: Opportunity[] = []
  for (const a of analyses) {
    const s = a.stats
    if (solid(a)) {
      // 1. Real demand with little supply.
      if (a.indices.demand >= 50 && a.indices.supply <= 40 && a.indices.competition <= 60 && (!s || s.demandProfile.kind !== 'puntual')) {
        out.push({ ...baseOf(a), id: idOf('demanda_poca_oferta', a), kind: 'demanda_poca_oferta', strength: a.confidence === 'alta' && s?.sensitivity.stable ? 'fuerte' : 'moderada',
          claim: `Los vídeos sobre «${a.topic}» ganan vistas de forma ${s?.demandProfile.kind === 'sostenida' ? 'sostenida' : 'apreciable'} mientras se publica poco (${a.indices.supply}/100 de oferta).`,
          evidence: [{ label: 'Demanda / oferta / competencia', value: `${a.indices.demand} / ${a.indices.supply} / ${a.indices.competition} (de 100)` }, ...(s ? [{ label: 'Tipo de demanda', value: s.demandProfile.note }, { label: 'Sensibilidad', value: s.sensitivity.note }] : []), ...videoEvidence(a, () => true)],
          uncertainty: 'Es una muestra de 25 vídeos por consulta. Poca oferta en YouTube puede significar también que el público no busca el tema en forma de vídeo: comprueba las vistas de los ejemplos antes de apostar.',
          nextStep: 'Abre los vídeos de ejemplo, anota qué preguntas dejan sin responder y prueba 3 vídeos antes de comprometer el canal.' })
      }
      // 2. Small channels doing well.
      if (s && s.smallWins.share !== null && s.smallWins.small >= 4 && s.smallWins.share >= 0.4 && a.indices.demand >= 35) {
        out.push({ ...baseOf(a), id: idOf('canales_pequenos', a), kind: 'canales_pequenos', strength: s.smallWins.small >= 6 ? 'moderada' : 'indicio',
          claim: `En «${a.topic}» ${s.smallWins.wins} de ${s.smallWins.small} vídeos de canales pequeños (< 20 000 suscriptores) superan los suscriptores de su canal.`,
          evidence: [{ label: 'Canales pequeños con éxito', value: `${s.smallWins.wins} de ${s.smallWins.small}` }, ...videoEvidence(a, v => typeof v.observed.channelSubscribers === 'number' && v.observed.channelSubscribers < 20_000 && (v.observed.views ?? 0) >= v.observed.channelSubscribers)],
          uncertainty: 'Que un vídeo supere los suscriptores del canal puede deberse al algoritmo o a un tema puntual; no garantiza que un canal nuevo repita el resultado.',
          nextStep: 'Mira qué tienen en común esos canales pequeños (formato, ángulo, título) y replica el patrón con tu propia propuesta, no la copia.' })
      }
      // 3. Old results: what people watch most is old and little new appears.
      const oldTop = a.topVideos.filter(v => days(v.publishedAt, now) > 240)
      if (a.indices.demand >= 45 && a.topVideos.length >= 5 && oldTop.length / a.topVideos.length >= 0.6 && a.indices.supply <= 50) {
        out.push({ ...baseOf(a), id: idOf('contenido_envejecido', a), kind: 'contenido_envejecido', strength: 'moderada',
          claim: `Lo más visto de «${a.topic}» tiene más de 8 meses (${oldTop.length} de ${a.topVideos.length} ejemplos) y se publica poco nuevo: hay espacio para una versión actualizada.`,
          evidence: [{ label: 'Oferta nueva', value: `${a.indices.supply}/100` }, ...videoEvidence(a, v => days(v.publishedAt, now) > 240)],
          uncertainty: 'Los vídeos antiguos pueden seguir funcionando precisamente porque el tema no cambia; actualizar no siempre aporta valor.',
          nextStep: 'Comprueba en los comentarios de los vídeos antiguos si hay datos desfasados o preguntas sin responder.' })
      }
      // 4. Emerging: only with measured growth.
      if (a.growth.state === 'calculable' && a.growth.label === 'al alza (posible)') {
        out.push({ ...baseOf(a), id: idOf('tema_emergente', a), kind: 'tema_emergente', strength: 'indicio',
          claim: `«${a.topic}» muestra vistas diarias mayores en la ventana reciente que en la anterior (${a.growth.ratio !== null && a.growth.ratio !== undefined ? `×${a.growth.ratio.toFixed(1)}` : 'más'}).`,
          evidence: [{ label: 'Comparación de ventanas', value: a.growth.reason }, ...videoEvidence(a, () => true, 2)],
          uncertainty: 'Dos ventanas de una muestra pequeña pueden diferir por azar. Se muestra como posible, no como tendencia confirmada.',
          nextStep: 'Repite la medición en una semana: si se mantiene, es una señal firme.' })
      }
    }
    // 5. Questions people put in titles (demand for answers; whether they are answered is NOT known).
    if (solid(a) && a.questions.length >= 3 && a.indices.demand >= 35) {
      out.push({ ...baseOf(a), id: idOf('preguntas', a), kind: 'preguntas', strength: 'a_verificar',
        claim: `Los títulos de «${a.topic}» contienen ${a.questions.length} preguntas con vistas: el público las busca. Si están bien respondidas no se puede saber con estos datos.`,
        evidence: a.questions.slice(0, 4).map(q => ({ label: 'Pregunta en un título', value: `${q.text.slice(0, 100)} · ${(q.views ?? 0).toLocaleString('es-ES')} vistas`, videoId: q.videoId, url: `https://www.youtube.com/watch?v=${q.videoId}` })),
        uncertainty: 'Una pregunta con vistas demuestra interés, no una necesidad sin cubrir: puede estar muy bien respondida.',
        nextStep: 'Lee los comentarios de esos vídeos para ver si la gente sigue preguntando.' })
    }
    // 6. A search with mostly poor matches: weak signal, never an opportunity by itself.
    if (a.quality.examined >= 15 && a.quality.kept / a.quality.examined < 0.4 && a.quality.kept >= 3) {
      out.push({ ...baseOf(a), id: idOf('busqueda_floja', a), kind: 'busqueda_floja', strength: 'a_verificar',
        claim: `La búsqueda «${a.topic}» devuelve sobre todo resultados que no tratan del tema (${a.quality.kept} de ${a.quality.examined} sirven).`,
        evidence: [{ label: 'Resultados útiles', value: `${a.quality.kept} de ${a.quality.examined}` }],
        uncertainty: 'Que YouTube no encuentre vídeos precisos puede ser un hueco real o simplemente que nadie lo busca así. Que no haya vídeos NO prueba que haya demanda.',
        nextStep: 'Busca el tema con otras palabras o en otro idioma antes de considerarlo; no inviertas por esta señal sola.' })
    }
  }
  // 7. Language and country gaps: same topic, comparable markets, a clear difference.
  const byTopic = new Map<string, TopicAnalysis[]>()
  for (const a of analyses) if (solid(a)) byTopic.set(a.topic.trim().toLowerCase(), [...(byTopic.get(a.topic.trim().toLowerCase()) ?? []), a])
  for (const group of byTopic.values()) {
    if (group.length < 2) continue
    const cols = group.map(a => ({ key: label(a), label: label(a), region: a.region, language: a.language, analysis: a }))
    const cmp = compareMarkets(cols); if (!cmp) continue
    const best = [...group].sort((x, y) => y.indices.opportunity - x.indices.opportunity)[0], worst = [...group].sort((x, y) => x.indices.opportunity - y.indices.opportunity)[0]
    if (best === worst || best.indices.opportunity - worst.indices.opportunity < 15 || best.indices.demand < 45) continue
    const sameLang = best.language === worst.language
    const pair = cmp.pairs.find(p => (p.a === label(best) && p.b === label(worst)) || (p.b === label(best) && p.a === label(worst)))
    if (!pair || pair.level === 'no_comparable') continue
    const info = countryInfo(best.region)
    out.push({ ...baseOf(best), id: idOf(sameLang ? 'pais' : 'idioma', best, `|vs|${worst.region ?? ''}|${worst.language ?? ''}`), kind: sameLang ? 'pais' : 'idioma', strength: pair.level === 'comparable' ? 'moderada' : 'indicio',
      claim: `«${best.topic}» puntúa ${best.indices.opportunity}/100 en ${label(best)} frente a ${worst.indices.opportunity}/100 en ${label(worst)}${sameLang ? '' : ': el hueco está en el idioma, no solo en el tema'}.`,
      evidence: [{ label: 'Comparación', value: pair.reasons.join(' ') }, { label: `${label(best)}: demanda / oferta / competencia`, value: `${best.indices.demand} / ${best.indices.supply} / ${best.indices.competition}` }, { label: `${label(worst)}: demanda / oferta / competencia`, value: `${worst.indices.demand} / ${worst.indices.supply} / ${worst.indices.competition}` }, ...videoEvidence(best, () => true, 2), ...(info ? [{ label: 'Vocabulario local a usar (nota editorial)', value: info.terminology.map(t => t.terms.join(', ')).join(' · ') }] : [])],
      uncertainty: 'Son muestras distintas de 25 vídeos, no audiencias: el país de la búsqueda no prueba dónde viven los espectadores. Si el tema no existe igual en ambos países, la diferencia puede ser de vocabulario, no de oportunidad.',
      nextStep: sameLang ? 'Adapta el vocabulario local y verifica con una búsqueda adicional en ese país.' : 'Prueba un vídeo en ese idioma con terminología propia, no traducida literalmente.' })
  }
  const order: Record<OppStrength, number> = { fuerte: 0, moderada: 1, indicio: 2, a_verificar: 3 }
  return out.sort((x, y) => order[x.strength] - order[y.strength] || y.demand - x.demand)
}

export const OPP_TITLES: Record<OppKind, string> = {
  demanda_poca_oferta: 'Hay demanda y se publica poco', canales_pequenos: 'Canales pequeños que funcionan', contenido_envejecido: 'Lo más visto es antiguo',
  tema_emergente: 'Tema al alza', idioma: 'Hueco por idioma', pais: 'Diferencia entre países', preguntas: 'Preguntas del público', busqueda_floja: 'Búsqueda con pocos resultados útiles',
}
