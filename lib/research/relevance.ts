import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { nichesOf, wordHit } from './taxonomy'

/**
 * Is a video really about the topic that was searched, in the market it was searched for?
 *
 * search.list is a fuzzy search: it also matches descriptions and tags, and `regionCode` / `relevanceLanguage` only bias the ranking.
 * So "ISA explained" can return Indonesian religious videos ("Isa" is Jesus), and "first time buyer UK" can return cars. Every video
 * is judged here BEFORE it can influence an index, and every exclusion keeps its reason so the screen can show it.
 */

const fold = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}#+]+/gu, ' ').replace(/\s+/g, ' ').trim()} `
const words = (s: string) => fold(s).trim().split(' ').filter(Boolean)

// ---------- Query understanding ----------
const STOP = new Set(('a an the of to in on for and or vs with without is are be do does did how what why when which who your you my our its it this that these those at by from as ' +
  'el la los las un una unos unas de del al en y o con sin por para es son como que cual cuales quien se su tu mi lo ' +
  'der die das ein eine einen und oder mit ohne fur für von zu im in ist sind wie was warum wer ' +
  'le les des du et ou avec sans pour est sont comment que qui ' +
  'desde hasta sobre entre tras hacia muy mas más menos tambien también todo todos toda todas cada solo sin bien into over under about after before between more most very just only really ever best').split(' '))
/** Words that describe the KIND of video, not its topic: a video about the topic does not have to contain them. */
const MODIFIER = new Set(('explained explain explanation guide tutorial tutorials review reviews best top tips tricks beginners beginner basics basic introduction intro complete full ultimate easy simple quick new latest 2023 2024 2025 2026 2027 ' +
  'explicado explicacion guia tutorial reseña mejores mejor consejos principiantes basico basica completo completa facil rapido nuevo ' +
  'erklart erklärt einfach anleitung tipps anfanger anfänger grundlagen komplett beste').split(' '))
/** Market qualifiers: they say WHERE, which the market filter handles, not what the video must contain. */
const PLACE = new Set(('uk gb usa us u.s england britain british united kingdom states america american canada canadian australia australian aussie deutschland germany german schweiz suisse switzerland swiss espana españa spain spanish mexico chile argentina').split(' '))

/** Short stem so that «reformas / reforma», «baratas / barata», «negocios / negocio», «mystery / mysteries» meet. */
export const stem = (w: string) => { let r = w.replace(/y$/, 'i'); if (r.length >= 5) r = r.replace(/s$/, ''); if (r.length >= 5) r = r.replace(/(a|o|e)$/, ''); return r }
/** Acronyms and their long forms: a video about «inteligencia artificial» is a video about «IA». */
const SYNONYMS: Record<string, string[]> = { ia: ['inteligencia artificial', 'artificial intelligence', 'ai'], ai: ['artificial intelligence', 'inteligencia artificial', 'ia'], ki: ['kunstliche intelligenz', 'ai'], seo: ['search engine optimization', 'optimizacion web'], diy: ['hazlo tu mismo', 'do it yourself'] }
/** Does the (folded, padded) text contain the term, its stem as a word prefix, or a known synonym? Short terms must match as whole words. */
export function termHit(text: string, term: string): boolean {
  const one = (t: string) => { const st = stem(t), st2 = t.replace(/(ies|y)$/, ''); return st.length >= 5 ? text.includes(` ${st}`) || (st2.length >= 5 && text.includes(` ${st2}`)) : text.includes(` ${t} `) || text.includes(` ${t}s `) || text.includes(` ${st} `) }
  return one(term) || (SYNONYMS[term] ?? []).some(alt => (alt.includes(' ') ? text.includes(` ${alt}`) : one(alt)))
}

export type QueryProfile = { terms: string[]; niches: string[]; raw: string }
export function queryProfile(query: string): QueryProfile {
  const ws = words(query)
  const terms = ws.filter(w => !STOP.has(w) && !MODIFIER.has(w) && !PLACE.has(w) && !/^\d+$/.test(w))
  // A query made only of modifiers/places ("best uk") has no topic of its own: fall back to every non-stop word.
  const use = terms.length ? terms : ws.filter(w => !STOP.has(w))
  return { terms: use, niches: nichesOf({ title: query, tags: [], categoryId: null, channelTitle: '' }, { useCategory: false }).map(n => n.niche), raw: query }
}

// ---------- Language ----------
const LANG_WORDS: Record<string, string> = {
  en: 'the and of to in is for with that this you are on it be as at your what how why from have not but can will about all we they there their new best first time',
  es: 'el la los las de que en y un una es por con para como mas pero sus del al se no lo le su este esta muy todo hay ser cuando donde porque sobre',
  de: 'der die das und ist nicht mit ein eine zu den von fur für auf im dem des sich auch wie was wir sie sind bei nach oder aber wird kann',
  fr: 'le la les de des et est un une que pour dans pas sur avec qui au ce son sont plus comment vous nous mais cette tout fait',
  pt: 'o a os as de que e do da em um uma para com nao não por mais como mas dos das se ao seu sua muito foi quando tudo voce você',
  it: 'il lo la gli le di che e un una per con non sono come piu più dei delle del della nel nella anche questo questa tutto quando',
  nl: 'de het een en van is dat niet met voor op te zijn ook maar als dan wat hoe naar bij nog wordt uit',
  id: 'yang dan di untuk dengan ini itu dari adalah apa tidak ke pada akan juga saya kita kamu anda atau oleh dalam sebagai karena cara bisa ada',
  tr: 've bir bu için icin ile de da ne nasil nasıl çok cok daha gibi kadar olarak ben sen biz',
  pl: 'i w nie na to jest się z do jak co dla czy że ale już tak jej jego po',
}
const LANG_SETS = Object.fromEntries(Object.entries(LANG_WORDS).map(([k, v]) => [k, new Set(v.split(' '))])) as Record<string, Set<string>>
const SCRIPTS: Array<[string, RegExp]> = [['ar', /[؀-ۿ]/g], ['he', /[֐-׿]/g], ['ru', /[Ѐ-ӿ]/g], ['ja', /[぀-ヿ]/g], ['ko', /[가-힯]/g], ['zh', /[一-鿿]/g], ['hi', /[ऀ-ॿ]/g], ['th', /[฀-๿]/g]]

export type DetectedLanguage = { lang: string | null; confidence: number }
/** Cheap language guess from a title (+ tags/description): script first, then function-word frequency. Returns null when it cannot tell. */
export function detectLanguage(text: string): DetectedLanguage {
  for (const [lang, re] of SCRIPTS) { const m = text.match(re); if (m && m.length >= 3) return { lang, confidence: 0.95 } }
  const ws = words(text).filter(w => w.length <= 12)
  if (ws.length < 3) return { lang: null, confidence: 0 }
  const scores = Object.entries(LANG_SETS).map(([lang, set]) => [lang, ws.filter(w => set.has(w)).length] as const).sort((a, b) => b[1] - a[1])
  const [best, second] = scores
  if (best[1] < 2 || best[1] === second[1]) return { lang: null, confidence: 0 }
  return { lang: best[0], confidence: Math.min(0.95, 0.5 + (best[1] - second[1]) / ws.length * 1.5 + best[1] * 0.05) }
}

/** Languages a market may legitimately use. A multilingual country accepts its official languages. */
const MARKET_LANGUAGES: Record<string, string[]> = { CH: ['de', 'fr', 'it'], CA: ['en', 'fr'], BE: ['nl', 'fr', 'de'], LU: ['fr', 'de'], IN: ['hi', 'en'], SG: ['en', 'zh'], ZA: ['en'] }
export const expectedLanguages = (region: string | null, language: string | null): string[] => {
  if (!language) return []
  const extra = region ? MARKET_LANGUAGES[region] : undefined
  return [...new Set([language, ...(extra && extra.includes(language) ? extra : [])])]
}

export type LanguageCheck = { verdict: 'coincide' | 'no_coincide' | 'sin_verificar'; language: string | null; source: 'declarado' | 'detectado' | null; declared: string | null; detected: string | null }
export function languageCheck(v: Pick<YouTubeVideoResult, 'title' | 'tags' | 'description' | 'declaredLanguage'>, expected: string[]): LanguageCheck {
  const det = detectLanguage([v.title, ...(v.tags ?? []).slice(0, 8), v.description ?? ''].join(' . '))
  const declared = (v.declaredLanguage ?? '').slice(0, 2).toLowerCase() || null
  // A confident reading of the text wins over a declaration (uploaders often leave the wrong default); otherwise the declaration decides.
  const language = det.lang && det.confidence >= 0.75 ? det.lang : declared ?? (det.lang && det.confidence >= 0.6 ? det.lang : null)
  const source = language === null ? null : language === declared && language !== det.lang ? 'declarado' : 'detectado'
  const base = { language, source: source as LanguageCheck['source'], declared, detected: det.lang }
  if (!expected.length) return { verdict: language ? 'coincide' : 'sin_verificar', ...base }
  if (!language) return { verdict: 'sin_verificar', ...base }
  return { verdict: expected.includes(language) ? 'coincide' : 'no_coincide', ...base }
}

// ---------- Promotions and attention outliers ----------
const PROMO = /(^|[\s(\[|])(#ad|#sponsored|sponsored|sponsorizado|patrocinado|patrocinada|publicidad|werbung|advertisement|advert|paid partnership|official (music )?video|official trailer|teaser trailer|tv spot|commercial)([\s)\]|:.,!-]|$)/i
export const isPromo = (v: Pick<YouTubeVideoResult, 'title'>) => PROMO.test(v.title)

const quantile = (sorted: number[], q: number) => { const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo) }
export const median = (xs: number[]) => (xs.length ? quantile([...xs].sort((a, b) => a - b), 0.5) : null)
/** Indices of values far above the rest (viral hits): beyond Q3 + 3·IQR AND more than 10× the median. Needs at least 8 values. */
export function viralOutliers(values: number[]): Set<number> {
  const out = new Set<number>()
  if (values.length < 8) return out
  const s = [...values].sort((a, b) => a - b), q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), med = quantile(s, 0.5)
  const fence = q3 + 3 * (q3 - q1)
  values.forEach((v, i) => { if (v > fence && v > 10 * Math.max(med, 1)) out.add(i) })
  return out
}

// ---------- The judgement ----------
export type ExclusionReason = 'tema' | 'nicho' | 'idioma' | 'directo'
export type Assessment = { relevant: boolean; reason: ExclusionReason | null; detail: string; coverage: number; language: LanguageCheck; promo: boolean }

/** Minimum share of the topic terms a video must show (title/tags count fully, description half). */
export const minCoverage = (n: number) => (n <= 2 ? 0.75 : n === 3 ? 0.67 : 0.6)

/** Niches that rarely contradict a topic: a finance video may also be educational or news. Pairs that often overlap are listed too. */
const GENERIC = new Set(['educacion', 'entretenimiento', 'desarrollo', 'noticias', 'historia', 'documental'])
const NEIGHBOURS: Array<[string, string]> = [['ia', 'tecnologia'], ['finanzas', 'negocios'], ['salud', 'fitness'], ['musica', 'entretenimiento'], ['viajes', 'cocina'], ['gaming', 'tecnologia']]
const compatible = (a: string, b: string) => a === b || GENERIC.has(b) || NEIGHBOURS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

/**
 * Does the video belong to a DIFFERENT domain than the query? The query's own words must not vouch for the video: "first time buyer"
 * is a finance phrase, but "Best first time buyer cars" is about cars. So the niches are re-read from the video WITHOUT the query terms:
 * if what remains points to another, incompatible domain and nothing in it supports the query's domain, the video is off-topic.
 */
function nicheConflict(v: YouTubeVideoResult, q: QueryProfile): { conflict: boolean; detail: string } {
  if (!q.niches.length) return { conflict: false, detail: '' }
  let rest = ` ${[v.title, ...(v.tags ?? [])].join(' ')} `
  for (const t of q.terms) rest = fold(rest).replace(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'g'), ' ')
  const own = nichesOf({ title: rest, tags: [], categoryId: null, channelTitle: '' }, { useCategory: false }).map(x => x.niche)
  if (own.some(x => q.niches.includes(x))) return { conflict: false, detail: '' }
  const foreign = own.filter(x => !q.niches.some(qn => compatible(qn, x)))
  return foreign.length ? { conflict: true, detail: `fuera de las palabras del tema, el vídeo trata de ${foreign.join(', ')} y el tema es de ${q.niches.join(', ')}` } : { conflict: false, detail: '' }
}

export function assessVideo(v: YouTubeVideoResult, q: QueryProfile, expected: string[]): Assessment {
  const lang = languageCheck(v, expected), promo = isPromo(v)
  const base = { language: lang, promo }
  if (v.live === 'live' || v.live === 'upcoming') return { ...base, relevant: false, reason: 'directo', detail: 'directo en emisión o programado', coverage: 0 }
  // Language first: a video in another language cannot satisfy the topic words of this market, and that is the clearer reason to show.
  if (lang.verdict === 'no_coincide') return { ...base, relevant: false, reason: 'idioma', detail: `idioma ${lang.language} (${lang.source}) fuera del mercado (${expected.join(', ')})`, coverage: 0 }
  const head = fold([v.title, ...(v.tags ?? [])].join(' ')), desc = fold(v.description ?? '')
  const n = q.terms.length
  let score = 0
  for (const t of q.terms) { if (termHit(head, t)) score += 1; else if (termHit(desc, t)) score += 0.5 }
  const coverage = n ? score / n : 1
  if (n && coverage < minCoverage(n)) return { ...base, relevant: false, reason: 'tema', detail: `solo muestra ${Math.round(coverage * 100)} % de los términos del tema (${q.terms.join(', ')})`, coverage }
  const nc = nicheConflict(v, q)
  if (nc.conflict) return { ...base, relevant: false, reason: 'nicho', detail: nc.detail, coverage }
  // A short, ambiguous single term ("isa") needs corroboration: the language must at least be verified as the market's.
  if (n === 1 && q.terms[0].length <= 4 && q.niches.length && lang.verdict !== 'coincide') {
    const vn = nichesOf(v, { useCategory: false }).map(x => x.niche)
    if (!vn.some(x => q.niches.includes(x))) return { ...base, relevant: false, reason: 'tema', detail: `«${q.terms[0]}» es ambiguo y nada confirma que sea el mismo tema`, coverage }
  }
  return { ...base, relevant: true, reason: null, detail: '', coverage }
}

export type SampleQuality = {
  examined: number; kept: number
  excluded: Record<ExclusionReason, number>
  /** Examples of what was dropped and why (max 5), so the user can check the judgement. */
  examples: Array<{ title: string; reason: ExclusionReason; detail: string }>
  promo: number; outliers: number
  languageUnverified: number
  /** Kept videos whose CHANNEL declares the market's country / that declare any country. */
  channelInMarket: number; channelCountryKnown: number
}
