import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { fold } from './text'

/**
 * Four different things get called «the country» of a search result, and they must not be mixed up:
 *   1. REQUESTED   — the country the search was asked for (regionCode). It only biases the ranking toward that country.
 *   2. CHANNEL     — the country the channel's owner declared in their channel settings (optional, often empty, can be anything).
 *   3. CONTENT     — the country the video itself talks about: its laws, taxes, products, institutions, currency (read from its own text).
 *   4. AUDIENCE    — where the viewers live. The public API does NOT provide it for other people's videos, so it is never known here.
 * The channel country is NOT used as a stand-in for the audience. Only the content context can make a video «not about this market».
 */
export const COUNTRY_SHORT: Record<string, string> = { GB: 'Reino Unido', US: 'EE. UU.', CA: 'Canadá', AU: 'Australia', DE: 'Alemania', CH: 'Suiza', AT: 'Austria', IE: 'Irlanda', ES: 'España', FR: 'Francia', IT: 'Italia', NL: 'Países Bajos' }
export const shortCountry = (c: string) => COUNTRY_SHORT[c] ?? c

export type GeoVerdict = 'en_mercado' | 'otro_pais' | 'sin_pistas'

/** High-precision cues per country, folded (no accents). Only things that are specific to ONE country: institutions, taxes, products, schemes, currency words. */
export const GEO_CUES: Record<string, string[]> = {
  GB: ['uk', 'united kingdom', 'britain', 'british', 'england', 'scotland', 'wales', 'hmrc', 'stamp duty', 'help to buy', 'council tax', 'isa', 'lifetime isa', 'lisa', 'sipp', 'rightmove', 'zoopla', 'nhs', 'national insurance', 'premium bonds', 'shared ownership', 'building society', 'buy to let', 'right to buy', 'pounds', 'sterling', '£', 'ucas', 'moneysavingexpert', 'martin lewis', 'bank of england', 'gilts', 'p60'],
  US: ['usa', 'u s', 'united states', 'american', 'irs', '401k', '401 k', 'roth ira', 'ira', 'fha', 'fha loan', 'va loan', 'fafsa', 'medicare', 'medicaid', 'social security', 'fannie mae', 'freddie mac', 'hsa', 'zillow', 'realtor', 'closing costs', 'down payment assistance', 'fico', 'schwab', 'fidelity', 'robinhood', 'turbotax', 'w2', 'w 2', '529', 'federal reserve', 'us dollar', 'usd'],
  CA: ['canada', 'canadian', 'cra', 'rrsp', 'tfsa', 'fhsa', 'resp', 'cmhc', 'ontario', 'toronto', 'vancouver', 'quebec', 'alberta', 'wealthsimple', 'questrade', 'td bank', 'rbc', 'cad', 'canadian dollars', 'home buyers plan', 'celi', 'reer'],
  AU: ['australia', 'australian', 'aussie', 'ato', 'superannuation', 'super fund', 'smsf', 'first home super saver', 'fhog', 'first home owner grant', 'centrelink', 'commbank', 'afterpay', 'sydney', 'melbourne', 'brisbane', 'negative gearing', 'aud', 'medicare levy'],
  DE: ['deutschland', 'deutsch', 'finanzamt', 'sparerpauschbetrag', 'freistellungsauftrag', 'riester', 'ruerup', 'rurup', 'bafog', 'kfw', 'schufa', 'grunderwerbsteuer', 'abgeltungsteuer', 'kirchensteuer', 'bundesbank', 'trade republic', 'scalable capital', 'comdirect', 'dkb', 'ing diba', 'verbraucherzentrale', 'bundesland', 'gez'],
  CH: ['schweiz', 'swiss', 'suisse', 'svizzera', 'saule 3a', 'pilier 3a', '3a', 'ahv', 'avs', 'pensionskasse', 'eigenmietwert', 'chf', 'franken', 'postfinance', 'kanton', 'zurich', 'finma', 'snb'],
  AT: ['osterreich', 'austria', 'finanzamt osterreich', 'bausparen', 'pensionskonto', 'sozialversicherung svs', 'wien'],
  IE: ['ireland', 'irish', 'revenue ie', 'prsa', 'dublin', 'help to buy ireland', 'central bank of ireland'],
  ES: ['espana', 'espanol', 'hacienda', 'irpf', 'seguridad social', 'euribor', 'autonomo', 'plan de pensiones', 'idealista', 'fotocasa', 'bizum', 'ibex', 'cnmv'],
  FR: ['france', 'francais', 'impots gouv', 'assurance vie', 'pea', 'livret a', 'caf', 'urssaf', 'loi pinel', 'prelevement', 'amf', 'paris'],
  IT: ['italia', 'italiano', 'agenzia delle entrate', 'irpef', 'isee', 'inps', 'mutuo prima casa', 'bonus casa', 'consob', 'btp'],
  NL: ['nederland', 'nederlands', 'belastingdienst', 'box 3', 'hypotheekrenteaftrek', 'funda', 'digid', 'dnb', 'aex'],
}

const hit = (text: string, cue: string) => (cue === '£' ? text.includes('£') : text.includes(` ${cue} `) || (cue.length >= 6 && text.includes(` ${cue}`)))

/** Countries whose cues appear in the video's own title, tags, description and channel name, with the cues that were seen. */
export function contentCues(v: Pick<YouTubeVideoResult, 'title' | 'tags' | 'description' | 'channelTitle'>): Array<{ country: string; cues: string[] }> {
  const raw = [v.title, ...(v.tags ?? []), (v.description ?? '').slice(0, 400), v.channelTitle].join(' ')
  const text = fold(raw.replace(/£/g, ' £ '))
  const out: Array<{ country: string; cues: string[] }> = []
  for (const [country, cues] of Object.entries(GEO_CUES)) { const found = cues.filter(c => hit(text, c)); if (found.length) out.push({ country, cues: found }) }
  return out.sort((a, b) => b.cues.length - a.cues.length)
}

export type GeoAssessment = { verdict: GeoVerdict; /** The country the CONTENT talks about, when its text says so. */ contentCountry: string | null; cues: string[]; channelCountry: string | null }

/** Where the video's own content points, compared with the requested market. Does not look at the channel country to decide anything. */
export function geoOf(v: Pick<YouTubeVideoResult, 'title' | 'tags' | 'description' | 'channelTitle' | 'channelCountry'>, region: string | null): GeoAssessment {
  const found = contentCues(v), top = found[0], second = found[1]
  const decisive = top && (!second || top.cues.length > second.cues.length) ? top : null
  const channelCountry = v.channelCountry ?? null
  if (!region || !found.length) return { verdict: 'sin_pistas', contentCountry: decisive?.country ?? null, cues: decisive?.cues ?? [], channelCountry }
  // A video that mentions the requested country's cues is «in the market» even if it also mentions another one (a comparison).
  if (found.some(f => f.country === region)) return { verdict: 'en_mercado', contentCountry: region, cues: found.find(f => f.country === region)!.cues, channelCountry }
  return { verdict: 'otro_pais', contentCountry: decisive?.country ?? null, cues: decisive?.cues ?? found[0].cues, channelCountry }
}

// ---------- Summary for an analysis ----------
export type GeoLevel = 'media' | 'baja' | 'contradictoria' | 'insuficiente'
export type GeoSummary = {
  requested: string | null
  /** The channel's declared country (optional, not the audience). */
  channel: { known: number; inMarket: number; others: Array<{ country: string; n: number }> }
  /** The country the videos' own text talks about. */
  content: { withCues: number; inMarket: number; others: Array<{ country: string; n: number }> }
  /** Kept videos with any geographic evidence at all, out of those kept. */
  coverage: number
  /** Share of the evidence pointing at the requested country (content counts fully, channel country counts half). */
  inMarketShare: number | null
  level: GeoLevel
  /** Videos set aside as doubtful because their content is about another country. */
  setAside: number
  /** What this result is: always «orientada a un mercado», never «demanda local verificada»: the audience is not observable. */
  statement: string
  limits: string[]
}

export const GEO_LIMITS = [
  'El país de la búsqueda solo orienta los resultados hacia ese país: no demuestra dónde viven los espectadores.',
  'La API pública no da el país de los espectadores de vídeos ajenos; ese dato solo lo ve cada propietario en su panel.',
  'El país del canal es el que su dueño declara (muchos no declaran ninguno): no equivale a la audiencia ni al país del contenido.',
  'El contexto del contenido se lee de su propio texto (leyes, impuestos, productos, moneda); un vídeo sin esas pistas puede ser de cualquier país.',
]

const tally = (xs: string[]) => [...xs.reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map<string, number>())].map(([country, n]) => ({ country, n })).sort((a, b) => b.n - a.n)

export function summarizeGeo(kept: Array<Pick<YouTubeVideoResult, 'title' | 'tags' | 'description' | 'channelTitle' | 'channelCountry'>>, region: string | null, setAside = 0, countryName: (c: string) => string = shortCountry): GeoSummary {
  const g = kept.map(v => geoOf(v, region))
  const contentKnown = g.filter(x => x.contentCountry), channelKnown = g.filter(x => x.channelCountry)
  const contentIn = contentKnown.filter(x => x.contentCountry === region).length, channelIn = channelKnown.filter(x => x.channelCountry === region).length
  const withEvidence = g.filter(x => x.contentCountry || x.channelCountry).length
  const coverage = kept.length ? withEvidence / kept.length : 0
  const weight = contentKnown.length + channelKnown.length * 0.5
  const inMarketShare = region && weight > 0 ? (contentIn + channelIn * 0.5) / weight : null
  let level: GeoLevel
  if (!region) level = 'insuficiente'
  else if (kept.length < 5 || weight < 4 || inMarketShare === null) level = 'insuficiente'
  else if (inMarketShare < 0.35) level = 'contradictoria'
  else if (inMarketShare >= 0.6 && coverage >= 0.3) level = 'media'
  else level = 'baja'
  const where = region ? countryName(region) : 'ningún país concreto'
  const others = tally([...contentKnown.filter(x => x.contentCountry !== region).map(x => x.contentCountry!), ...channelKnown.filter(x => x.channelCountry !== region).map(x => x.channelCountry!)]).slice(0, 3)
  const othersText = others.map(o => countryName(o.country)).join(' y ')
  const statement = !region ? 'Búsqueda sin país: resultados mundiales en el idioma elegido, sin orientación a un mercado.'
    : level === 'contradictoria' ? `Búsqueda orientada a ${where}, pero la mayoría de las pistas geográficas apuntan a ${othersText || 'otros países'}: estos resultados NO se pueden presentar como demanda de ${where}.`
    : level === 'media' ? `Investigación orientada a ${where}, con pistas geográficas que la apoyan (no es demanda local verificada: la audiencia no se puede medir).`
    : level === 'baja' ? `Investigación orientada a ${where}, con pocas pistas geográficas${othersText ? ` y parte del contenido de ${othersText}` : ''}: tómala como orientativa, no como demanda local.`
    : `Investigación orientada a ${where}. No hay pistas geográficas suficientes para saber si los resultados son realmente de ese mercado.`
  return { requested: region, channel: { known: channelKnown.length, inMarket: channelIn, others: tally(channelKnown.filter(x => x.channelCountry !== region).map(x => x.channelCountry!)) }, content: { withCues: contentKnown.length, inMarket: contentIn, others: tally(contentKnown.filter(x => x.contentCountry !== region).map(x => x.contentCountry!)) }, coverage: Math.round(coverage * 100) / 100, inMarketShare: inMarketShare === null ? null : Math.round(inMarketShare * 100) / 100, level, setAside, statement, limits: GEO_LIMITS }
}

export const GEO_LEVEL_LABEL: Record<GeoLevel, string> = { media: 'Confianza geográfica media', baja: 'Confianza geográfica baja', contradictoria: 'Pistas geográficas contradictorias', insuficiente: 'Sin pistas geográficas suficientes' }
