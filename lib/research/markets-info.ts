import type { TopicAnalysis } from './topic-analysis'

/**
 * What can and cannot be compared between markets. The country notes are EDITORIAL knowledge (typed by hand, not read from YouTube) and are
 * labelled as such. The data limits are structural: the official API's regionCode only biases results toward a country — it never proves
 * where the viewers or the creators are — so any cross-country figure is a comparison of two samples, not of two audiences.
 */
export type CountryInfo = {
  code: string; name: string
  /** Languages a viewer in this market may search in, main first. */
  languages: string[]
  /** Local words for the same idea: searching the translation of a term from another country finds a different (or empty) market. */
  terminology: Array<{ idea: string; terms: string[] }>
  context: string
}

export const COUNTRY_INFO: CountryInfo[] = [
  { code: 'US', name: 'Estados Unidos', languages: ['en', 'es'], context: 'Mercado más grande en inglés; tamaño de público y competencia mayores que en el resto. Hay una audiencia hispanohablante propia que no aparece al buscar en inglés.',
    terminology: [{ idea: 'ahorro para la jubilación', terms: ['401k', 'Roth IRA', 'IRA'] }, { idea: 'primera vivienda', terms: ['first-time homebuyer', 'FHA loan'] }, { idea: 'cuenta de ahorro con ventajas fiscales', terms: ['HSA', '529 plan'] }] },
  { code: 'GB', name: 'Reino Unido', languages: ['en'], context: 'Inglés británico: ortografía y vocabulario propios. Varios términos financieros solo existen aquí o significan otra cosa.',
    terminology: [{ idea: 'cuenta de ahorro libre de impuestos', terms: ['ISA', 'Stocks and Shares ISA'] }, { idea: 'primera vivienda', terms: ['first time buyer', 'Help to Buy', 'stamp duty'] }, { idea: 'jubilación', terms: ['pension', 'SIPP', 'state pension'] }] },
  { code: 'CA', name: 'Canadá', languages: ['en', 'fr'], context: 'Dos mercados lingüísticos (inglés y francés de Quebec) con vocabulario distinto; una búsqueda en uno no cubre el otro.',
    terminology: [{ idea: 'cuenta de ahorro libre de impuestos', terms: ['TFSA', 'CELI (fr)'] }, { idea: 'jubilación', terms: ['RRSP', 'REER (fr)'] }, { idea: 'primera vivienda', terms: ['first-time home buyer', 'FHSA'] }] },
  { code: 'AU', name: 'Australia', languages: ['en'], context: 'Inglés australiano; sistema de pensiones y fiscalidad propios. Mercado más pequeño: pocos vídeos pueden bastar para un tema con poca oferta.',
    terminology: [{ idea: 'jubilación', terms: ['super', 'superannuation', 'SMSF'] }, { idea: 'primera vivienda', terms: ['first home buyer', 'First Home Super Saver'] }, { idea: 'impuestos', terms: ['ATO', 'tax return'] }] },
  { code: 'DE', name: 'Alemania', languages: ['de'], context: 'Mercado en alemán: hay que buscar con términos alemanes, no traducir los ingleses. Alemania, Austria y Suiza comparten idioma pero no leyes ni impuestos.',
    terminology: [{ idea: 'fondo cotizado (ETF)', terms: ['ETF Sparplan', 'Indexfonds'] }, { idea: 'jubilación', terms: ['Altersvorsorge', 'Rente', 'Riester'] }, { idea: 'primera vivienda', terms: ['Immobilie kaufen', 'Baufinanzierung'] }] },
  { code: 'CH', name: 'Suiza', languages: ['de', 'fr', 'it'], context: 'Tres idiomas oficiales: un vídeo en alemán, francés o italiano es normal aquí. Mercado pequeño; gran parte del contenido viene de Alemania y Francia.',
    terminology: [{ idea: 'jubilación', terms: ['Säule 3a', 'pilier 3a', 'AHV'] }, { idea: 'primera vivienda', terms: ['Eigenheim', 'hypothèque'] }, { idea: 'impuestos', terms: ['Steuererklärung', 'déclaration d’impôts'] }] },
]

export const GEOLOCATION_LIMITS = [
  'El país de una búsqueda (regionCode) solo orienta los resultados hacia ese país: no demuestra dónde viven los espectadores ni los creadores.',
  'Un canal puede declarar un país, pero no tiene por qué coincidir con el de su público; muchos no declaran ninguno.',
  'YouTube no ofrece el desglose de audiencia por país de vídeos ajenos: eso solo lo ve el propietario del canal en su propio panel.',
  'Las cifras de dos países salen de muestras distintas de 25 vídeos: sirven para ordenar y detectar diferencias grandes, no para medir pequeñas.',
]

export const countryInfo = (code: string | null) => COUNTRY_INFO.find(c => c.code === code) ?? null

export type Comparability = 'comparable' | 'parcial' | 'no_comparable'
export type MarketColumn = { key: string; label: string; region: string | null; language: string | null; analysis: TopicAnalysis }
export type MarketComparison = {
  topic: string
  columns: Array<{ key: string; label: string; demand: number; competition: number; supply: number; opportunity: number; growth: string; relevantVideos: number; confidence: string; languageUnverifiedShare: number | null }>
  /** One verdict per pair of markets: what may be compared and why not. */
  pairs: Array<{ a: string; b: string; level: Comparability; reasons: string[] }>
  /** Plain statements the data supports; empty when nothing can be said without overreaching. */
  findings: string[]
  notes: string[]
}

const share = (n: number, d: number) => (d ? n / d : null)

export function compareMarkets(cols: MarketColumn[]): MarketComparison | null {
  if (cols.length < 2) return null
  const topic = cols[0].analysis.topic
  const columns = cols.map(c => {
    const a = c.analysis
    return { key: c.key, label: c.label, demand: a.indices.demand, competition: a.indices.competition, supply: a.indices.supply, opportunity: a.indices.opportunity, growth: a.growth.state === 'calculable' ? a.growth.label ?? 'calculable' : 'No calculable', relevantVideos: a.sampleSizes.top + a.sampleSizes.recent, confidence: a.confidence, languageUnverifiedShare: share(a.quality.languageUnverified, a.quality.kept) }
  })
  const pairs: MarketComparison['pairs'] = []
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    const A = cols[i], B = cols[j], reasons: string[] = []; let level: Comparability = 'comparable'
    const down = (to: Comparability, why: string) => { reasons.push(why); if (to === 'no_comparable' || level === 'comparable') level = to }
    if (A.language !== B.language) down('parcial', `Idiomas distintos (${A.language ?? 'sin filtro'} y ${B.language ?? 'sin filtro'}): se buscan palabras diferentes, así que los vídeos no son el mismo tema traducido.`)
    if (A.analysis.recentDays !== B.analysis.recentDays) down('no_comparable', 'Ventanas de «reciente» de distinta duración: la oferta por semana no es comparable.')
    if (A.analysis.topic.trim().toLowerCase() !== B.analysis.topic.trim().toLowerCase()) down('parcial', 'Se buscaron términos distintos en cada mercado (adaptación local): comparar con cuidado.')
    const low = [A, B].filter(c => c.analysis.confidence === 'baja'); if (low.length) down('parcial', `Confianza baja en ${low.map(c => c.label).join(' y ')}: la muestra relevante es pequeña.`)
    const thin = [A, B].filter(c => c.analysis.sampleSizes.top + c.analysis.sampleSizes.recent < 20); if (thin.length) down('no_comparable', `Muestra relevante demasiado pequeña en ${thin.map(c => c.label).join(' y ')} (menos de 20 vídeos).`)
    const geoBad = [A, B].filter(c => c.analysis.geo?.requested && c.analysis.geo.level === 'contradictoria'); if (geoBad.length) down('no_comparable', `Los resultados de ${geoBad.map(c => c.label).join(' y ')} son sobre todo de otros países (pistas geográficas contradictorias): no representan ese mercado.`)
    const geoWeak = [A, B].filter(c => c.analysis.geo?.requested && c.analysis.geo.level === 'baja'); if (geoWeak.length) down('parcial', `Confianza geográfica baja en ${geoWeak.map(c => c.label).join(' y ')}: son investigaciones orientadas a esos países, no demanda local.`)
    const geoNone = [A, B].filter(c => c.analysis.geo?.requested && c.analysis.geo.level === 'insuficiente'); if (geoNone.length) reasons.push(`Sin pistas geográficas suficientes en ${geoNone.map(c => c.label).join(' y ')}: se comparan como búsquedas orientadas a cada país, no como demanda local.`)
    const unv = [A, B].filter(c => (share(c.analysis.quality.languageUnverified, c.analysis.quality.kept) ?? 0) > 0.5); if (unv.length) down('parcial', `Más de la mitad de los vídeos de ${unv.map(c => c.label).join(' y ')} no tiene idioma verificable.`)
    if (!reasons.length) reasons.push('Mismo tema, idioma y ventana, con muestra suficiente: se puede comparar, siempre como muestras y no como audiencias.')
    pairs.push({ a: A.label, b: B.label, level, reasons })
  }
  const findings: string[] = []
  const strong = columns.filter(c => c.confidence !== 'baja' && c.relevantVideos >= 20)
  if (strong.length >= 2) {
    const byOpp = [...strong].sort((x, y) => y.opportunity - x.opportunity)
    if (byOpp[0].opportunity - byOpp[byOpp.length - 1].opportunity >= 15) findings.push(`${byOpp[0].label} puntúa ${byOpp[0].opportunity}/100 frente a ${byOpp[byOpp.length - 1].opportunity}/100 de ${byOpp[byOpp.length - 1].label}: diferencia suficiente para considerarla real, no un ruido de la muestra.`)
    else findings.push('Las puntuaciones de oportunidad de los mercados con datos suficientes difieren poco (menos de 15 puntos): no hay base para decir que uno es mejor.')
    const comp = [...strong].sort((x, y) => x.competition - y.competition)
    if (comp[comp.length - 1].competition - comp[0].competition >= 20) findings.push(`La competencia es claramente menor en ${comp[0].label} (${comp[0].competition}/100) que en ${comp[comp.length - 1].label} (${comp[comp.length - 1].competition}/100).`)
  } else findings.push('No hay al menos dos mercados con confianza suficiente y 20 vídeos relevantes: no se saca ninguna conclusión entre países.')
  const notes = [...GEOLOCATION_LIMITS]
  for (const c of cols) { const info = countryInfo(c.region); if (info && c.language && !info.languages.includes(c.language)) notes.push(`${info.name}: el idioma ${c.language} no es habitual en este mercado; los resultados pueden ser de pocos canales.`) }
  return { topic, columns, pairs, findings, notes }
}
