import { THEMES, type ShortsConfig, type Theme } from './config'

/**
 * Topic selection, in the owner's order: (1) proven interest from Radar / Market Intelligence data,
 * (2) fact verification (see sources.ts), (3) fit with the channel and with what has worked, never repeating a topic.
 * Every component of a score carries its kind: observed (API value), calculated (formula here) or inferred (a guess from history).
 */

export type OpportunityRow = {
  id: string
  title: string
  source_id: string | null
  observed_metrics: Record<string, unknown> | null
  calculated_metrics: Record<string, unknown> | null
}

export type Candidate = {
  opportunityId: string
  title: string
  url: string | null
  channelTitle: string | null
  views: number | null
  viewsPerDay: number | null
  /** Views gained per day since the previous Radar reading (observed twice, calculated here); null on the first reading. */
  growthPerDay: number | null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function candidatesFromOpportunities(rows: OpportunityRow[]): Candidate[] {
  return rows.map(r => {
    const o = r.observed_metrics ?? {}, c = r.calculated_metrics ?? {}
    return {
      opportunityId: r.id, title: r.title, url: r.source_id,
      channelTitle: typeof o.channel_title === 'string' ? o.channel_title : null,
      views: num(o.views), viewsPerDay: num(c.viewsPerDay), growthPerDay: num(c.viewsPerDaySinceLastCheck),
    }
  })
}

export const median = (values: number[]) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

const STOP = new Set(('el la los las un una unos unas de del al y o u e en por para con sin sobre que como mas pero si no se su sus lo le les es son fue ser ha han hay este esta estos estas ese esa eso esto asi muy todo todos cada cuando donde quien porque ya mi tu te me nos').split(' '))

/** Meaningful words of a text (no accents, no stop words, at least 3 letters). */
export function topicTokens(text: string) {
  return [...new Set(normalize(text).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !STOP.has(t)))]
}

export function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0
  const sb = new Set(b)
  const inter = a.filter(x => sb.has(x)).length
  return inter / (a.length + b.length - inter)
}

/** A topic repeats when it shares most of its meaningful words with one already used. */
export function isRepeatTopic(topic: string, previous: string[], threshold = 0.5) {
  const t = topicTokens(topic)
  return previous.some(p => jaccard(t, topicTokens(p)) >= threshold)
}

const THEME_WORDS: Record<Exclude<Theme, 'otros'>, string[]> = {
  espacio: ['espacio', 'universo', 'planeta', 'sol', 'luna', 'galaxia', 'estrella', 'nasa', 'agujero', 'marte', 'cosmos', 'astronauta'],
  ciencia: ['ciencia', 'fisica', 'quimica', 'atomo', 'energia', 'cientificos', 'experimento', 'ley', 'particula', 'cuantica'],
  naturaleza: ['animal', 'animales', 'oceano', 'mar', 'planta', 'bosque', 'volcan', 'tierra', 'clima', 'especie', 'insecto', 'ave', 'pez'],
  'cuerpo humano': ['cuerpo', 'cerebro', 'corazon', 'sangre', 'huesos', 'celulas', 'sueno', 'musculo', 'piel', 'organo', 'humano'],
  historia: ['historia', 'imperio', 'guerra', 'antiguo', 'antigua', 'egipto', 'roma', 'siglo', 'rey', 'civilizacion', 'medieval'],
  tecnología: ['tecnologia', 'internet', 'robot', 'computadora', 'inteligencia', 'artificial', 'satelite', 'maquina', 'invento', 'telefono'],
  cultura: ['cultura', 'idioma', 'palabra', 'tradicion', 'comida', 'musica', 'arte', 'religion', 'costumbre'],
}

/** Deterministic theme (no AI call): the theme with most keyword hits, "otros" when none. */
export function classifyTheme(text: string): Theme {
  const t = new Set(topicTokens(text))
  let best: Theme = 'otros', score = 0
  for (const theme of THEMES) {
    if (theme === 'otros') continue
    const hits = THEME_WORDS[theme].filter(w => t.has(w)).length
    if (hits > score) { best = theme; score = hits }
  }
  return best
}

export type ScoreComponent = { value: number; kind: 'observed' | 'calculated' | 'inferred'; note: string }

export type RankedCandidate = {
  candidate: Candidate
  theme: Theme
  provenInterest: boolean
  /** Why interest is not proven, when it is not. */
  rejection: string | null
  components: { interest: ScoreComponent; trend: ScoreComponent; fit: ScoreComponent; history: ScoreComponent }
  score: number
}

/** Boost from past retention by theme: INFERRED (a guess from a handful of Shorts), never shown as a measurement. */
export type HistoryBoost = (theme: Theme) => ScoreComponent

export function rankCandidates(candidates: Candidate[], cfg: ShortsConfig, opts: { previousTopics?: string[]; history?: HistoryBoost } = {}): { ranked: RankedCandidate[]; nicheMedian: number | null; poolSize: number; blocker: string | null } {
  const viewed = candidates.filter((c): c is Candidate & { views: number } => c.views !== null)
  const nicheMedian = median(viewed.map(c => c.views))
  const medianPerDay = median(candidates.map(c => c.viewsPerDay).filter((v): v is number => v !== null))
  const poolSize = viewed.length
  if (poolSize < cfg.minPoolSize || !nicheMedian) {
    return { ranked: [], nicheMedian, poolSize, blocker: `Hacen falta al menos ${cfg.minPoolSize} vídeos con vistas en Radar para calcular la mediana del nicho; hay ${poolSize}.` }
  }
  const keywords = cfg.channelKeywords.map(normalize)
  const ranked: RankedCandidate[] = viewed.map(c => {
    const ratio = c.views / nicheMedian
    const theme = classifyTheme(c.title)
    const tokens = topicTokens(c.title)
    const fitHits = keywords.filter(k => tokens.includes(k) || normalize(c.title).includes(k)).length
    const trending = (c.growthPerDay !== null && c.growthPerDay > 0) || (c.viewsPerDay !== null && medianPerDay !== null && c.viewsPerDay >= medianPerDay)
    const repeated = isRepeatTopic(c.title, opts.previousTopics ?? [])
    const proven = ratio >= cfg.minRatioToMedian
    const history = opts.history?.(theme) ?? { value: 0, kind: 'inferred' as const, note: 'Sin historial suficiente de retención.' }
    const components = {
      interest: { value: Math.min(ratio, 10), kind: 'calculated' as const, note: `${c.views.toLocaleString('es-ES')} vistas observadas ÷ mediana del nicho ${Math.round(nicheMedian).toLocaleString('es-ES')} = ${ratio.toFixed(1)}×` },
      trend: { value: trending ? 1 : 0, kind: 'calculated' as const, note: trending ? 'Crece o va por encima de la mediana de vistas por día.' : 'Sin tendencia al alza medible.' },
      fit: { value: Math.min(fitHits, 2), kind: 'calculated' as const, note: fitHits ? `${fitHits} palabra(s) del canal en el título.` : 'Sin palabras del canal en el título.' },
      history,
    }
    return {
      candidate: c, theme, provenInterest: proven && !repeated,
      rejection: repeated ? 'Tema ya usado.' : proven ? null : `Interés no comprobado: ${ratio.toFixed(1)}× la mediana (mínimo ${cfg.minRatioToMedian}×).`,
      components, score: components.interest.value + components.trend.value + components.fit.value + components.history.value,
    }
  })
  ranked.sort((a, b) => Number(b.provenInterest) - Number(a.provenInterest) || b.score - a.score)
  return { ranked, nicheMedian, poolSize, blocker: ranked.some(r => r.provenInterest) ? null : 'Ningún vídeo del Radar supera la mediana del nicho lo bastante como para probar interés.' }
}
