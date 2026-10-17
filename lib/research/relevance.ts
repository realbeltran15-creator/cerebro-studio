import { fold } from './text'
import { geoOf, shortCountry } from './geo'
import { financeCues } from './lexicon'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { nichesOf, wordHit } from './taxonomy'

/**
 * Is a video really about the topic that was searched, in the market it was searched for?
 *
 * search.list is a fuzzy search: it also matches descriptions and tags, and `regionCode` / `relevanceLanguage` only bias the ranking.
 * So "ISA explained" can return Indonesian religious videos ("Isa" is Jesus), and "first time buyer UK" can return cars. Every video
 * is judged here BEFORE it can influence an index, and every exclusion keeps its reason so the screen can show it.
 */

export { fold }
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
const SYNONYMS: Record<string, string[]> = { buyer: ['buyers', 'homebuyer', 'homebuyers', 'buying', 'buy', 'purchasing'], etf: ['etfs', 'indexfonds', 'indexfondsen', 'index fund', 'index funds', 'exchange traded fund', 'exchange traded funds', 'fondo indexado', 'fondos indexados', 'fonds indiciel', 'fonds indiciels', 'fondo indicizzato', 'fondi indicizzati', 'fundos de indice'], sparplan: ['sparplane', 'sparplaene', 'sparrate', 'sparraten', 'ansparen', 'monatlich investieren', 'monatlich sparen', 'dauerauftrag', 'durchschnittskosteneffekt', 'cost average', 'plan de ahorro', 'plan de inversion periodica', 'plan d epargne', 'piano di accumulo', 'plano de poupanca', 'dca'], ia: ['inteligencia artificial', 'artificial intelligence', 'ai'], ai: ['artificial intelligence', 'inteligencia artificial', 'ia'], ki: ['kunstliche intelligenz', 'ai'], seo: ['search engine optimization', 'optimizacion web'], diy: ['hazlo tu mismo', 'do it yourself'] }
/** Does the (folded, padded) text contain the term, its stem as a word prefix, or a known synonym? Short terms must match as whole words. */
export function termHit(text: string, term: string): boolean {
  const one = (t: string) => { const st = stem(t), st2 = t.replace(/(ies|y)$/, ''); return st.length >= 5 ? text.includes(` ${st}`) || (st2.length >= 5 && text.includes(` ${st2}`)) : text.includes(` ${t} `) || text.includes(` ${t}s `) || text.includes(` ${st} `) }
  return one(term) || inHashtag(text, term) || (SYNONYMS[term] ?? []).some(alt => (alt.includes(' ') ? text.includes(` ${alt}`) : one(alt) || inHashtag(text, alt)))
}

/** Hashtags glue words together («#datoscuriosos» = «datos curiosos»): a topic word of 4+ letters inside a hashtag counts as present. */
function inHashtag(text: string, term: string): boolean {
  if (!text.includes('#') || term.length < 4 || term.includes(' ')) return false
  const t = (stem(term).length >= 4 ? stem(term) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`#[^ ]*${t}`).test(text)
}

/**
 * Concepts people say in several ways. A query like «first time buyer» is one idea, not three words: «Buying your first home», «first-time
 * homebuyer», «first home buyer» (Australia) and «getting on the property ladder» are the same subject without sharing the words. When all
 * the `match` terms are in the query, any phrase in `alts` counts as covering ALL of them. Typed by hand, extended when the audits show a gap.
 */
const PHRASES: Array<{ match: string[]; alts: string[] }> = [
  { match: ['first', 'time', 'buyer'], alts: ['for the first time', 'buying a house', 'buy a house', 'buying a home', 'buy a home', 'buying an apartment', 'buy an apartment', 'buying a condo', 'buying a flat', 'buy a flat', 'home buying', 'house buying', 'homebuying', 'home buyer', 'homebuyer', 'homebuyers', 'house hunting', 'purchasing a home', 'purchase a home', 'buying property', 'first time purchaser', 'ftb', 'moving house', 'first time home buyer', 'first time homebuyer', 'first home buyer', 'first time house buyer', 'first time buying', 'first time buyers', 'first home', 'first house', 'first flat', 'first property', 'buying your first', 'buying my first', 'buying a first', 'buy your first', 'buy a first', 'buy my first', 'bought my first', 'bought our first', 'buying our first', 'property ladder', 'first timer', 'first timers', 'first time purchase', 'help to buy', 'lifetime isa for a first', 'stamp duty for first', 'mortgage for first', 'deposit for first', 'eerste woning', 'erste wohnung', 'erstes haus', 'primera vivienda', 'primera casa', 'primo acquisto', 'première maison', 'premier achat'] },
  { match: ['first', 'home'], alts: ['first time buyer', 'first home buyer', 'homebuyer', 'property ladder', 'first house', 'first property'] },
]
const phraseCoverage = (head: string, desc: string, terms: string[]) => {
  const out = new Map<string, number>()
  for (const ph of PHRASES) {
    if (!ph.match.every(m => terms.includes(m))) continue
    const inHead = ph.alts.some(a => head.includes(` ${a}`)), inDesc = !inHead && ph.alts.some(a => desc.includes(` ${a}`))
    if (inHead || inDesc) for (const m of ph.match) out.set(m, Math.max(out.get(m) ?? 0, inHead ? 1 : 0.5))
  }
  return out
}

// ---------- Ambiguous terms: which MEANING does the query intend? ----------
/**
 * A word-list of known meanings for terms that people search with several senses («ISA» is a UK savings account, a name of Jesus in
 * Indonesian and Arabic, a military unit, a game…). For each sense: the words that give it away. A video is judged by which sense its
 * own title, tags, description and channel point to — and the verdict names the words it saw, so every exclusion can be checked.
 * Terms that are NOT in this table are covered by the data-driven check (see `isAmbiguousSample`), not by a rigid list.
 */
export type Sense = { id: string; label: string; /** The sense this research tool is about (money). */ intended?: boolean; niche?: string; words: string[] }
export const SENSES: Record<string, Sense[]> = {
  isa: [
    { id: 'finanzas', label: 'cuenta de ahorro/inversión (ISA)', intended: true, niche: 'finanzas', words: ['cash isa', 'stocks and shares', 'stocks shares', 'lifetime isa', 'junior isa', 'isa allowance', 'tax free', 'allowance', 'savings', 'saver', 'invest', 'investing', 'investment', 'interest', 'rates', 'hmrc', 'pension', 'portfolio', 'fund', 'funds', 'shares', 'stocks', 'bank', 'building society', 'wealth', 'money', 'finance', 'financial', 'mortgage', 'inflation', 'dividend', 'index fund', 'tax', 'budget', 'accounts'] },
    { id: 'religion', label: 'religión (Isa = Jesús)', words: ['nabi', 'jesus', 'christ', 'islam', 'islamic', 'quran', 'koran', 'allah', 'prophet', 'bible', 'church', 'kisah', 'injil', 'nazareth', 'maryam', 'muslim', 'christian', 'sermon', 'gospel', 'ayat', 'surah', 'ceramah', 'dakwah', 'tuhan', 'rasul', 'messiah', 'crucifixion', 'miracle', 'miracles', 'saints', 'sheikh'] },
    { id: 'militar', label: 'unidad o terminología militar', words: ['intelligence support activity', 'special forces', 'army', 'delta force', 'seal', 'jsoc', 'military', 'battalion', 'regiment', 'soldier', 'operators', 'special operations', 'combat', 'weapons', 'tactical'] },
    { id: 'videojuegos', label: 'videojuegos', words: ['game', 'games', 'gameplay', 'minecraft', 'roblox', 'fortnite', 'walkthrough', 'lets play', 'gaming', 'speedrun', 'mod', 'mods', 'server', 'player', 'valorant', 'skin', 'clan', 'tournament', 'boss', 'level', 'rpg', 'playthrough', 'ps5', 'xbox', 'steam'] },
  ],
  hsa: [
    { id: 'finanzas', label: 'cuenta de ahorro sanitaria (HSA)', intended: true, niche: 'finanzas', words: ['health savings account', 'health savings', 'hdhp', 'high deductible', 'deductible', 'tax advantage', 'tax advantaged', 'contribution', 'contributions', 'medical expenses', 'fsa', 'invest', 'investing', 'investment', 'irs', 'retirement', 'triple tax', 'savings', 'insurance', 'premiums', 'fidelity', 'lively', 'tax', 'taxes', 'money', 'finance'] },
    { id: 'otro', label: 'otro uso de HSA (colegios, siglas, juegos)', words: ['school', 'hsa class', 'gameplay', 'minecraft', 'roblox', 'valorant', 'concert', 'album', 'lyrics', 'official video', 'soundtrack', 'trailer', 'student council', 'alumni'] },
  ],
  etf: [
    { id: 'finanzas', label: 'fondo cotizado (ETF)', intended: true, niche: 'finanzas', words: ['exchange traded fund', 'exchange traded funds', 'index fund', 'index funds', 'etfs', 'vanguard', 'ishares', 'dividend', 'dividends', 'portfolio', 'invest', 'investing', 'investment', 'stocks', 'shares', 'expense ratio', 'vwce', 'voo', 'spy', 'passive', 'broker', 'sp 500', 's p 500', 'msci', 'bonds', 'fund', 'funds', 'wealth', 'money', 'finance', 'returns'] },
    { id: 'otro', label: 'otro uso de ETF (siglas, juegos, música)', words: ['gameplay', 'minecraft', 'roblox', 'valorant', 'lyrics', 'official video', 'album', 'concert', 'trailer', 'task force', 'emergency', 'fanfic', 'anime'] },
  ],
  super: [
    { id: 'finanzas', label: 'superannuation / fondo de jubilación (Australia)', intended: true, niche: 'finanzas', words: ['superannuation', 'super fund', 'super funds', 'industry super', 'smsf', 'self managed super', 'employer contributions', 'contribution', 'contributions', 'retirement', 'pension', 'ato', 'balance', 'fees', 'invest', 'investing', 'investment', 'return', 'returns', 'unisuper', 'australiansuper', 'hostplus', 'tax', 'money', 'finance', 'wealth', 'savings'] },
    { id: 'otro', label: 'otro uso de «super» (superhéroes, juegos, deporte)', words: ['superhero', 'mario', 'smash', 'bowl', 'hero', 'heroes', 'man', 'woman', 'girl', 'power', 'powers', 'gameplay', 'game', 'games', 'sonic', 'marvel', 'dc', 'anime', 'cartoon', 'toy', 'toys', 'trailer', 'movie', 'film', 'league', 'football', 'nfl'] },
  ],
  ira: [
    { id: 'finanzas', label: 'cuenta de jubilación individual (IRA)', intended: true, niche: 'finanzas', words: ['roth', 'traditional ira', 'rollover', 'contribution', 'contributions', 'retirement', '401k', 'irs', 'tax', 'taxes', 'invest', 'investing', 'investment', 'brokerage', 'fidelity', 'vanguard', 'limits', 'savings', 'money', 'finance', 'wealth'] },
    { id: 'otro', label: 'otro uso de IRA (historia, política, nombres)', words: ['republican army', 'irish', 'ireland', 'terrorist', 'troubles', 'provisional', 'war', 'history', 'documentary', 'belfast', 'band', 'lyrics'] },
  ],
  fire: [
    { id: 'finanzas', label: 'independencia financiera (FIRE)', intended: true, niche: 'finanzas', words: ['financial independence', 'retire early', 'early retirement', 'savings rate', 'fatfire', 'leanfire', 'coastfire', 'invest', 'investing', 'investment', 'portfolio', 'net worth', 'passive income', '4 rule', 'safe withdrawal', 'retirement', 'money', 'finance', 'wealth', 'budget'] },
    { id: 'otro', label: 'fuego', words: ['firefighter', 'wildfire', 'burning', 'flame', 'flames', 'campfire', 'fireplace', 'fireworks', 'rescue', 'extinguisher', 'forest', 'smoke', 'blaze', 'arson', 'gun', 'shooting', 'weapon'] },
  ],
}
const AMBIGUOUS_TERMS = new Set(Object.keys(SENSES))

const phraseHit = (text: string, w: string) => (w.includes(' ') ? text.includes(` ${w}`) : w.length >= 7 ? text.includes(` ${w}`) : text.includes(` ${w} `) || text.includes(` ${w}s `))
export type SenseEvidence = { intended: string[]; competing: Array<{ sense: Sense; hits: string[] }> }
export function senseEvidence(video: Pick<YouTubeVideoResult, 'title' | 'tags' | 'description' | 'channelTitle'>, term: string, langs: Array<string | null | undefined> = []): SenseEvidence {
  const raw = [video.title, ...(video.tags ?? []), video.description ?? '', video.channelTitle].join(' ')
  const text = fold(raw), senses = SENSES[term] ?? []
  const hits = (s: Sense) => { const h = s.words.filter(w => phraseHit(text, fold(w).trim())); if (s.intended && /[£€$]\s?\d/.test(raw)) h.push('importe en dinero'); if (s.intended && s.niche === 'finanzas') h.push(...financeCues(text, langs).filter(c => !h.includes(c))); return h }
  return { intended: hits(senses.find(x => x.intended)!), competing: senses.filter(x => !x.intended).map(sense => ({ sense, hits: hits(sense) })) }
}

export type QueryProfile = { terms: string[]; niches: string[]; raw: string; /** Set when the query is one of the ambiguous terms (alone, or with the money niche). */ ambiguity: { term: string; intended: Sense } | null }
export function queryProfile(query: string): QueryProfile {
  const ws = words(query)
  const terms = ws.filter(w => !STOP.has(w) && !MODIFIER.has(w) && !PLACE.has(w) && !/^\d+$/.test(w))
  // A query made only of modifiers/places ("best uk") has no topic of its own: fall back to every non-stop word.
  const use = terms.length ? terms : ws.filter(w => !STOP.has(w))
  // The domain comes from the TOPIC words only: «explained» or «guide» must not make a finance query look educational.
  const found = nichesOf({ title: use.join(' '), tags: [], categoryId: null, channelTitle: '' }, { useCategory: false }).map(n => n.niche)
  const amb = use.find(t => AMBIGUOUS_TERMS.has(t))
  const intended = amb ? SENSES[amb].find(x => x.intended) : undefined
  // «super mario» has other topic terms and no money niche: the other words already say which «super» is meant.
  const ambiguity = amb && intended && (use.length === 1 || found.includes(intended.niche ?? '')) ? { term: amb, intended } : null
  const niches = ambiguity?.intended.niche ? [...new Set([...found, ambiguity.intended.niche])] : found
  return { terms: use, niches, raw: query, ambiguity }
}

// ---------- Language ----------
const LANG_WORDS: Record<string, string> = {
  en: 'the and of to in is for with that this you are on it be as at your what how why from have not but can will about all we they there their new best first time',
  es: 'el la los las de que en y un una es por con para como mas pero sus del al se no lo le su este esta muy todo hay ser cuando donde porque sobre esto estos estas eso esos ese ella ellos mira asi aqui tambien cada todos todas nunca siempre antes despues hacer hace tiene tienen puede pueden mejor sin entre hasta desde quien cual cuanto datos cosas sabias sabes curiosos curiosas secreto mundo',
  de: 'der die das und ist nicht mit ein eine zu den von fur für auf im dem des sich auch wie was wir sie sind bei nach oder aber wird kann',
  fr: 'le la les de des et est un une que pour dans pas sur avec qui au ce son sont plus comment vous nous mais cette tout fait',
  pt: 'o a os as de que e do da em um uma para com nao não por mais como mas dos das se ao seu sua muito foi quando tudo voce você isso essa esse estes esses tambem sao ate ainda sempre depois fazer faz tem pode podem melhor sem onde quem qual quanto fatos coisas sabia sabe segredo mundo',
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
  const raw = text.toLowerCase()
  for (const [lang, re] of SCRIPTS) { const m = text.match(re); if (m && m.length >= 3) return { lang, confidence: 0.95 } }
  const allWords = words(text), ws = allWords.filter(w => w.length <= 12)
  if (allWords.length < 3) return { lang: null, confidence: 0 }
  // Spanish and Portuguese share many function words (de, que, como, para, por, mas…): count only the words that belong to one of them, and let the
  // letters that exist in one but not the other (ñ ¿ ¡ for Spanish, ã õ for Portuguese) weigh in. Accents are gone from `ws`, so they come from the raw text.
  const LANG_SETS_BOTH_IBERIAN = (w: string) => LANG_SETS.es.has(w) && LANG_SETS.pt.has(w)
  const SHARED_IBERIAN = new Set(['de', 'que', 'como', 'para', 'por', 'mas', 'con', 'se', 'no', 'em', 'o', 'a', 'e'])
  const cue = (lang: string) => (lang === 'es' ? (raw.match(/[ñ¿¡]/g)?.length ?? 0) : lang === 'pt' ? (raw.match(/[ãõ]/g)?.length ?? 0) : 0) * 2
  // Hashtags glue words together («#datoscuriosos»): a word of the language (5+ letters, not shared) inside a hashtag counts once.
  const tagHint = (_lang: string, set: Set<string>) => allWords.some(w => w.startsWith('#') && [...set].some(x => x.length >= 5 && !SHARED_IBERIAN.has(x) && w.includes(x))) ? 1 : 0
  const own = (lang: string, set: Set<string>) => tagHint(lang, set) + ws.filter(w => set.has(w) && !((lang === 'es' || lang === 'pt') && SHARED_IBERIAN.has(w)) && !(LANG_SETS_BOTH_IBERIAN(w) && (lang === 'es' || lang === 'pt'))).length + cue(lang)
  const scores = Object.entries(LANG_SETS).map(([lang, set]) => [lang, own(lang, set) + ((lang === 'es' || lang === 'pt') ? ws.filter(w => set.has(w) && SHARED_IBERIAN.has(w)).length * 0.5 : ws.filter(w => set.has(w)).length * 0)] as const).sort((a, b) => b[1] - a[1])
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
// A clear ad (the video IS the advertisement) vs a sponsored video (an organic video with a disclosed sponsor). Both stay out of the DEMAND
// figure because paid reach is not interest; neither is thrown away from the sample, and ordinary reviews are never touched.
const AD_TITLE = /(^|[\s(\[|])(#ad|#advert|#anuncio|#publi|#publicidad|#sponsored|#werbung|official (music )?video|official (tv )?(ad|advert|commercial|spot|tvc)|official trailer|teaser( trailer)?|tv spot|tv commercial|commercial|werbespot|spot (tv|publicitario)|anuncio oficial|publicidad|werbung|advertisement|advert)([\s)\]|:.,!-]|$)/i
const AD_TAG = /^(#?ad|#?ads|#?advert|#?advertisement|#?sponsored|#?publi|#?anuncio|#?commercial|#?tvc)$/i
const NEGATED = /\b(not|no|isn'?t|without|sin|ohne)\s+(a\s+)?(sponsored|sponsor|ad|paid|patrocinad\w*|publicidad|werbung)\b/i
const DISCLOSURE = /(this (video|episode) is (sponsored|brought to you)|sponsored by|paid (promotion|partnership)|includes paid promotion|in partnership with|patrocinado por|este v[ií]deo (est[aá] )?patrocinado|incluye promoci[oó]n pagada|colaboraci[oó]n pagada|publicidad:|bezahlte partnerschaft|enthält werbung|gifted by|enviado por la marca|promoción pagada)/i
const SPONSOR_TITLE = /(^|[\s(\[|])(sponsored|sponsorizado|patrocinado|patrocinada|paid partnership|sponsored by|patrocinado por)([\s)\]|:.,!-]|$)/i
export type PromoKind = 'anuncio' | 'patrocinado'
export function promoKind(v: Pick<YouTubeVideoResult, 'title'> & Partial<Pick<YouTubeVideoResult, 'tags' | 'description'>>): { kind: PromoKind; why: string } | null {
  const title = v.title ?? '', desc = (v.description ?? '').slice(0, 400)
  if (NEGATED.test(title) || NEGATED.test(desc.slice(0, 120))) return null     // «honest review, not sponsored»
  const t = AD_TITLE.exec(title); if (t) return { kind: 'anuncio', why: `el título lo declara («${t[2].toLowerCase()}»)` }
  const tag = (v.tags ?? []).find(x => AD_TAG.test(x.trim())); if (tag) return { kind: 'anuncio', why: `etiqueta «${tag}»` }
  const st = SPONSOR_TITLE.exec(title); if (st) return { kind: 'patrocinado', why: `el título lo declara («${st[2].toLowerCase()}»)` }
  const d = DISCLOSURE.exec(desc); if (d) return { kind: 'patrocinado', why: `la descripción declara «${d[1].toLowerCase()}»` }
  return null
}
export const isPromo = (v: Pick<YouTubeVideoResult, 'title'> & Partial<Pick<YouTubeVideoResult, 'tags' | 'description'>>) => promoKind(v) !== null

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
/**
 * aceptado   = counted in the metrics.
 * descartado = excluded for a verifiable reason (another language, another topic, another meaning of the word, a live stream).
 * dudoso     = excluded from the metrics but NOT called wrong: nothing in the video confirms the intended meaning. It is listed so it can be checked.
 */
export type ExclusionReason = 'tema' | 'nicho' | 'idioma' | 'directo' | 'sentido' | 'contexto'
export type VideoStatus = 'aceptado' | 'dudoso' | 'descartado'
export type Assessment = { relevant: boolean; status: VideoStatus; reason: ExclusionReason | null; detail: string; coverage: number; language: LanguageCheck; promo: boolean; /** Why it is flagged as an ad or sponsored video (null when it is not). */ promoWhy: string | null; /** Words that confirmed (or contradicted) the meaning. */ evidence: string[] }

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
function nicheEvidence(v: YouTubeVideoResult, q: QueryProfile): { own: string[]; foreign: string[]; conflict: boolean } {
  // Everything the video says about itself, minus the query's own words (they must not vouch for the video).
  let rest = ` ${[v.title, ...(v.tags ?? []), v.description ?? '', v.channelTitle].join(' ')} `
  for (const t of q.terms) rest = fold(rest).replace(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'g'), ' ')
  const own = nichesOf({ title: rest, tags: [], categoryId: null, channelTitle: '' }, { useCategory: false }).map(x => x.niche)
  const supports = own.some(x => q.niches.includes(x))
  const foreign = own.filter(x => !q.niches.some(qn => compatible(qn, x)))
  return { own, foreign, conflict: !!q.niches.length && !supports && foreign.length > 0 }
}

export type AssessOptions = { /** Market the search was oriented to: a video whose own content is about ANOTHER country is set aside as doubtful. */ region?: string | null; /** Require positive evidence of the intended topic, not just the absence of a contradiction (used when the sample itself is ambiguous). */ strict?: boolean }

// ---------- Phrases that define a DOMAIN ----------
/**
 * «first time buyer» does not say what is being bought. Without help, a video about a first car, a first watch or a first puppy shares all the
 * query words, while a house video that mentions «pet rent» in its description looks like it is about animals. For such phrases the DOMAIN is
 * decided by positive evidence: housing words (US and UK) confirm it, words of the usual rivals (cars, watches, phones, pets, crypto…) in the
 * title or tags reject it, and a video with no housing words at all is only «doubtful». Incidental words elsewhere in the text cannot overrule it.
 */
type DomainRule = { id: string; label: string; match: string[]; cues: string[]; rivals: string[] }
const DOMAIN_RULES: DomainRule[] = [{
  id: 'vivienda', label: 'compra de vivienda', match: ['first', 'time', 'buyer'],
  cues: ['home', 'homes', 'house', 'houses', 'housing', 'homebuyer', 'homebuyers', 'home buyer', 'home buyers', 'homeowner', 'homeowners', 'homeownership', 'home ownership', 'property', 'properties', 'real estate', 'realtor', 'realtors', 'estate agent', 'mortgage', 'mortgages', 'remortgage', 'down payment', 'deposit', 'closing costs', 'closing cost', 'pre approval', 'preapproval', 'pre approved', 'preapproved', 'escrow', 'appraisal', 'home inspection', 'fha', 'fha loan', 'va loan', 'usda', 'conventional loan', 'home loan', 'lender', 'lenders', 'refinance', 'home equity', 'hoa', 'condo', 'condos', 'townhouse', 'townhome', 'apartment', 'flat', 'starter home', 'house hunting', 'open house', 'listing', 'listings', 'housing market', 'house prices', 'house price', 'rent vs buy', 'renting vs buying', 'stamp duty', 'help to buy', 'shared ownership', 'lifetime isa', 'conveyancing', 'solicitor', 'rightmove', 'zoopla', 'leasehold', 'freehold', 'buy to let', 'mortgage broker', 'offer accepted', 'survey', 'fhsa', 'home buyers plan', 'cmhc', 'first home', 'first house', 'first flat', 'first property', 'zillow', 'redfin', 'afford a house', 'afford a home'],
  rivals: ['car', 'cars', 'used car', 'new car', 'vehicle', 'vehicles', 'truck', 'trucks', 'suv', 'dealership', 'tesla', 'motorcycle', 'motorbike', 'bike', 'bikes', 'watch', 'watches', 'rolex', 'omega', 'seiko', 'laptop', 'laptops', 'phone', 'phones', 'iphone', 'android', 'camera', 'cameras', 'guitar', 'guitars', 'piano', 'drone', 'drones', 'dog', 'dogs', 'puppy', 'puppies', 'cat', 'cats', 'kitten', 'horse', 'pet', 'pets', 'gun', 'guns', 'rifle', 'knife', 'shoes', 'sneakers', 'headphones', 'gpu', 'keyboard', 'console', 'ps5', 'xbox', 'bitcoin', 'crypto', 'cryptocurrency', 'stock', 'stocks', 'etf', 'mattress', 'bed', 'sofa', 'furniture', 'perfume', 'makeup', 'skincare', 'handbag', 'jewelry', 'ring', 'engagement ring'],
}]

/** Does a phrase-defined domain (housing for «first time buyer») apply to this query? Used to know which stored analyses an engine change touched. */
export const domainRuleApplies = (topic: string) => { const q = queryProfile(topic); return DOMAIN_RULES.some(r => r.match.every(m => q.terms.includes(m)) && q.terms.length <= r.match.length) }

type DomainVerdict = { rule: DomainRule; cues: string[]; titleCues: string[]; rivals: string[] }
function domainOf(v: YouTubeVideoResult, q: QueryProfile): DomainVerdict | null {
  const rule = DOMAIN_RULES.find(r => r.match.every(m => q.terms.includes(m)) && q.terms.length <= r.match.length)
  if (!rule) return null
  const head = fold([v.title, ...(v.tags ?? [])].join(' ')), all = fold([v.title, ...(v.tags ?? []), (v.description ?? '').slice(0, 400), v.channelTitle].join(' '))
  const has = (text: string, w: string) => text.includes(` ${w} `) || text.includes(` ${w}s `)
  return { rule, cues: rule.cues.filter(w => has(all, fold(w).trim())), titleCues: rule.cues.filter(w => has(head, fold(w).trim())), rivals: rule.rivals.filter(w => has(head, fold(w).trim())) }
}

/** Doubtful because the video's OWN text is about another country than the market asked for (never because of the channel's declared country). */
function otherCountry(v: YouTubeVideoResult, region: string | null | undefined): string | null {
  if (!region) return null
  const g = geoOf(v, region)
  return g.verdict === 'otro_pais' && g.contentCountry ? `habla de ${shortCountry(g.contentCountry)} (${g.cues.slice(0, 3).join(', ')}), no del mercado pedido (${shortCountry(region)})` : null
}

export function assessVideo(v: YouTubeVideoResult, q: QueryProfile, expected: string[], opts: AssessOptions = {}): Assessment {
  const lang = languageCheck(v, expected), pk = promoKind(v), promo = pk !== null
  const out = (status: VideoStatus, reason: ExclusionReason | null, detail: string, coverage: number, evidence: string[] = []): Assessment => ({ relevant: status === 'aceptado', status, reason, detail, coverage, language: lang, promo, promoWhy: pk ? `${pk.kind === 'anuncio' ? 'Anuncio' : 'Vídeo patrocinado'}: ${pk.why}` : null, evidence })
  if (v.live === 'live' || v.live === 'upcoming') return out('descartado', 'directo', 'directo en emisión o programado', 0)
  // Language first: a video in another language cannot satisfy the topic words of this market, and that is the clearer reason to show.
  if (lang.verdict === 'no_coincide') return out('descartado', 'idioma', `idioma ${lang.language} (${lang.source}) fuera del mercado (${expected.join(', ')})`, 0)
  const head = fold([v.title, ...(v.tags ?? [])].join(' ')), desc = fold(v.description ?? '')
  const n = q.terms.length
  let score = 0
  const phrase = phraseCoverage(head, desc, q.terms)
  for (const t of q.terms) { if (termHit(head, t)) score += 1; else if (termHit(desc, t)) score += 0.5; if (phrase.has(t)) score = score - (termHit(head, t) ? 1 : termHit(desc, t) ? 0.5 : 0) + Math.max(phrase.get(t)!, termHit(head, t) ? 1 : termHit(desc, t) ? 0.5 : 0) }
  // The meaning cues are read in the language the video is in (German «Sparplan», French «épargne»…), not only in English.
  const ev0 = q.ambiguity ? senseEvidence(v, q.ambiguity.term, [lang.language, lang.declared, ...expected]) : null
  // Domain credit: a video that names the ambiguous term itself AND is clearly about the intended domain (2+ distinct cues in its language) covers
  // the other topic words only half, instead of nothing: «Welcher ETF ist der beste?» is a German ETF video even though it never says «Sparplan».
  if (q.ambiguity && ev0 && n > 1 && ev0.intended.length >= 1 && ev0.competing.every(c => c.hits.length === 0)) {
    const amb = q.ambiguity.term, ambHit = termHit(head, amb), others = q.terms.filter(t => t !== amb)
    const hitOthers = others.filter(t => termHit(head, t) || termHit(desc, t) || phrase.has(t))
    // Either the ambiguous word is there and some other topic words are missing, or the specific words are there and the ambiguous one is missing.
    if (ambHit) score += (others.length - hitOthers.length) * 0.5
    else if (hitOthers.length === others.length && new Set(ev0.intended).size >= 2) score += 0.5
  }
  // Domain credit for phrases that define a domain (housing for «first time buyer»): a video with housing words in its TITLE, no rival product, and at
  // least one of the query words (or a synonym) is on the topic even if it does not repeat the whole phrase.
  const dom0 = domainOf(v, q)
  if (dom0 && score > 0 && dom0.titleCues.length >= 1 && dom0.rivals.length === 0 && n && score / n < minCoverage(n)) score = Math.max(score, n * minCoverage(n))
  const coverage = n ? score / n : 1
  if (n && coverage < minCoverage(n)) return out('descartado', 'tema', `solo muestra ${Math.round(coverage * 100)} % de los términos del tema (${q.terms.join(', ')})`, coverage)

  // Which meaning of an ambiguous term does the video use? Decided by what the video itself says, and the words are quoted.
  if (q.ambiguity) {
    const ev = ev0!, best = [...ev.competing].sort((x, y) => y.hits.length - x.hits.length)[0]
    if (best && best.hits.length > ev.intended.length) return out('descartado', 'sentido', `«${q.ambiguity.term.toUpperCase()}» aquí es ${best.sense.label} (palabras: ${best.hits.slice(0, 4).join(', ')})`, coverage, best.hits)
    if (ev.intended.length === 0) return out('dudoso', 'contexto', `nada en el título, etiquetas, descripción o canal confirma que «${q.ambiguity.term.toUpperCase()}» sea ${q.ambiguity.intended.label}`, coverage)
    if (best && best.hits.length === ev.intended.length && best.hits.length > 0) return out('dudoso', 'contexto', `significado ambiguo: tantas pistas de ${q.ambiguity.intended.label} (${ev.intended.slice(0, 3).join(', ')}) como de ${best.sense.label} (${best.hits.slice(0, 3).join(', ')})`, coverage, ev.intended)
    const ne = nicheEvidence(v, q)
    if (ne.conflict) return out('descartado', 'nicho', `fuera de las palabras del tema, el vídeo trata de ${ne.foreign.join(', ')} y el tema es de ${q.niches.join(', ')}`, coverage)
    const g1 = otherCountry(v, opts.region); if (g1) return out('dudoso', 'contexto', g1, coverage)
    return out('aceptado', null, `confirmado por: ${ev.intended.slice(0, 4).join(', ')}`, coverage, ev.intended)
  }

  const dom = domainOf(v, q)
  if (dom) {
    if (dom.rivals.length && !dom.titleCues.length) return out('descartado', 'nicho', `el título habla de ${dom.rivals.slice(0, 3).join(', ')}, no de ${dom.rule.label} (${dom.rule.cues.slice(0, 3).join(', ')}…)`, coverage)
    if (!dom.cues.length) return out('dudoso', 'contexto', `nada en el título, etiquetas, descripción o canal confirma que trate de ${dom.rule.label}`, coverage)
    if (dom.rivals.length > dom.titleCues.length) return out('descartado', 'nicho', `habla más de ${dom.rivals.slice(0, 3).join(', ')} que de ${dom.rule.label}`, coverage)
    const gd = otherCountry(v, opts.region); if (gd) return out('dudoso', 'contexto', gd, coverage)
    return out('aceptado', null, `confirmado por vocabulario de ${dom.rule.label}: ${dom.cues.slice(0, 4).join(', ')}`, coverage, dom.cues)
  }
  const ne = nicheEvidence(v, q)
  if (ne.conflict) return out('descartado', 'nicho', `fuera de las palabras del tema, el vídeo trata de ${ne.foreign.join(', ')} y el tema es de ${q.niches.join(', ')}`, coverage)
  if (opts.strict && q.niches.length && !ne.own.some(x => q.niches.includes(x))) return out('dudoso', 'contexto', `el tema es de ${q.niches.join(', ')} y nada en el vídeo, salvo las palabras de la consulta, lo confirma`, coverage)
  const g2 = otherCountry(v, opts.region); if (g2) return out('dudoso', 'contexto', g2, coverage)
  return out('aceptado', null, '', coverage)
}

export type SampleQuality = {
  examined: number; kept: number
  /** Excluded for a verifiable reason, by reason. */
  excluded: Record<ExclusionReason, number>
  /** Left out of the metrics because nothing confirms the intended meaning (not called wrong). */
  uncertain: number
  /** True when the sample itself showed several meanings, so every video had to confirm the intended one. */
  ambiguousSample: boolean
  promo: number; outliers: number
  languageUnverified: number
  /** Kept videos whose CHANNEL declares the market's country / that declare any country. */
  channelInMarket: number; channelCountryKnown: number
}
