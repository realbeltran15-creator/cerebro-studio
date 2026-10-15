import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { formatOf } from './discovery'

/**
 * Niche and content-type classification. Everything here is INFERRED from titles, tags, YouTube's own category and duration:
 * the API does not say what niche or format a video belongs to. Every label carries the reason it was assigned.
 */

export type Niche = { id: string; label: string; /** YouTube category ids that point at this niche. */ categories: number[]; /** Lowercase words/phrases in es, en, de, pt, fr that point at it. */ words: string[]; seeds: string[] }

export const NICHES: Niche[] = [
  { id: 'tecnologia', label: 'Tecnología', categories: [28], words: ['tecnología', 'tecnologia', 'tech', 'technology', 'gadget', 'smartphone', 'iphone', 'android', 'software', 'hardware', 'pc ', 'laptop', 'programación', 'programming', 'coding', 'ciberseguridad', 'cybersecurity'], seeds: ['mejores gadgets', 'tutorial de programación', 'ciberseguridad para principiantes'] },
  { id: 'ia', label: 'Inteligencia artificial', categories: [], words: ['inteligencia artificial', 'artificial intelligence', ' ia ', ' ai ', 'chatgpt', 'gemini', 'claude', 'openai', 'machine learning', 'aprendizaje automático', 'midjourney', 'künstliche intelligenz', 'llm'], seeds: ['herramientas de inteligencia artificial', 'automatizar con ia', 'ia para negocios'] },
  { id: 'finanzas', label: 'Finanzas e inversión', categories: [], words: ['inversión', 'inversion', 'invertir', 'investing', 'investment', 'investor', 'bolsa', 'stocks', 'stock market', 'acciones', 'etf', 'cripto', 'crypto', 'bitcoin', 'ahorro', 'savings', 'dinero', 'finanzas', 'finance', 'hipoteca', 'jubilación', 'aktien', 'geld', 'isa', 'mortgage', 'first time buyer', 'pension', 'savings account', 'stocks and shares', 'property', 'buy to let', 'credit score', 'tax', 'taxes', 'impuestos', 'steuer', 'steuern', 'hypothek', 'immobilien', 'vivienda', 'inmobiliaria'], seeds: ['cómo invertir desde cero', 'ahorrar dinero', 'finanzas personales'] },
  { id: 'negocios', label: 'Negocios y emprendimiento', categories: [], words: ['negocio', 'negocios', 'business', 'emprender', 'emprendimiento', 'startup', 'ecommerce', 'dropshipping', 'marketing', 'ventas', 'sales', 'freelance', 'ingresos pasivos', 'side hustle'], seeds: ['ideas de negocio', 'marketing digital', 'ingresos pasivos'] },
  { id: 'educacion', label: 'Educación y ciencia', categories: [27, 28], words: ['ciencia', 'science', 'física', 'physics', 'química', 'biología', 'biology', 'matemáticas', 'math', 'explicado', 'explained', 'cómo funciona', 'how it works', 'universo', 'espacio', 'space', 'wissenschaft'], seeds: ['ciencia explicada', 'cómo funciona', 'curiosidades científicas'] },
  { id: 'historia', label: 'Historia y documentales', categories: [], words: ['historia', 'history', 'imperio', 'empire', 'guerra', 'war', 'medieval', 'antigua', 'ancient', 'documental', 'documentary', 'geschichte', 'histoire'], seeds: ['historia medieval', 'imperios olvidados', 'documental histórico'] },
  { id: 'salud', label: 'Salud y bienestar', categories: [], words: ['salud', 'health', 'bienestar', 'wellness', 'nutrición', 'nutrition', 'dieta', 'diet', 'meditación', 'meditation', 'sueño', 'sleep', 'ansiedad', 'anxiety', 'psicología', 'psychology', 'gesundheit'], seeds: ['dormir mejor', 'psicología cotidiana', 'nutrición fácil'] },
  { id: 'fitness', label: 'Fitness y deporte', categories: [17], words: ['fitness', 'entrenamiento', 'workout', 'gimnasio', 'gym', 'rutina', 'musculación', 'yoga', 'running', 'fútbol', 'football', 'soccer', 'baloncesto', 'basketball', 'sport', 'deporte'], seeds: ['rutina en casa', 'yoga para principiantes', 'running para empezar'] },
  { id: 'cocina', label: 'Cocina y recetas', categories: [], words: ['receta', 'recipe', 'cocina', 'cooking', 'cocinar', 'postre', 'dessert', 'comida', 'food', 'rezept', 'recette'], seeds: ['recetas fáciles', 'cocina saludable', 'postres rápidos'] },
  { id: 'viajes', label: 'Viajes y turismo', categories: [19], words: ['viaje', 'viajes', 'travel', 'turismo', 'tourism', 'destino', 'vuelo', 'flight', 'hotel', 'mochilero', 'backpacking', 'reisen'], seeds: ['viajar barato', 'destinos poco conocidos', 'vivir en el extranjero'] },
  { id: 'gaming', label: 'Videojuegos', categories: [20], words: ['gameplay', 'videojuego', 'videojuegos', 'gaming', 'minecraft', 'fortnite', 'roblox', 'playstation', 'xbox', 'nintendo', 'speedrun', 'walkthrough'], seeds: ['juegos indie', 'guía de videojuego', 'retro gaming'] },
  { id: 'entretenimiento', label: 'Entretenimiento y humor', categories: [23, 24, 1, 22], words: ['humor', 'comedia', 'comedy', 'sketch', 'reacción', 'reaction', 'broma', 'prank', 'meme', 'challenge', 'reto', 'película', 'movie', 'serie', 'series'], seeds: ['sketch de comedia', 'reacciones', 'historias graciosas'] },
  { id: 'musica', label: 'Música y ambiente', categories: [10], words: ['música', 'music', 'canción', 'song', 'lofi', 'lo-fi', 'chill', 'relajante', 'relaxing', 'ambient', 'ambiental', 'piano', 'guitarra', 'guitar', 'beats', 'playlist', 'study music', 'sleep music'], seeds: ['música para estudiar', 'sonidos ambientales', 'lofi para dormir'] },
  { id: 'noticias', label: 'Noticias y política', categories: [25], words: ['noticias', 'news', 'política', 'politics', 'elecciones', 'election', 'gobierno', 'government', 'actualidad', 'nachrichten'], seeds: ['análisis de actualidad', 'política internacional', 'economía explicada'] },
  { id: 'hogar', label: 'Hogar y bricolaje', categories: [26], words: ['bricolaje', 'diy', 'hazlo tú mismo', 'reforma', 'renovation', 'decoración', 'decor', 'jardín', 'garden', 'huerto', 'carpintería', 'woodworking', 'herramientas manuales', 'power tools'], seeds: ['reformas baratas', 'huerto en casa', 'carpintería para principiantes'] },
  { id: 'motor', label: 'Motor y vehículos', categories: [2], words: ['coche', 'coches', 'car', 'cars', 'moto', 'motorcycle', 'motor', 'tesla', 'eléctrico', 'electric vehicle', 'ev ', 'auto', 'mecánica', 'mechanic'], seeds: ['coches eléctricos', 'mecánica básica', 'reseñas de coches'] },
  { id: 'animales', label: 'Animales y mascotas', categories: [15], words: ['perro', 'dog', 'gato', 'cat', 'mascota', 'pet', 'animal', 'animales', 'animals', 'cachorro', 'puppy', 'kitten', 'tier'], seeds: ['adiestramiento de perros', 'cuidado de gatos', 'animales salvajes'] },
  { id: 'belleza', label: 'Belleza y moda', categories: [], words: ['maquillaje', 'makeup', 'belleza', 'beauty', 'moda', 'fashion', 'skincare', 'peluquería', 'hair', 'outfit'], seeds: ['rutina skincare', 'moda minimalista', 'peinados fáciles'] },
  { id: 'misterio', label: 'Misterio y true crime', categories: [], words: ['misterio', 'mystery', 'true crime', 'crimen', 'crime', 'asesino', 'killer', 'paranormal', 'conspiración', 'conspiracy', 'desaparecido', 'unsolved', 'sin resolver'], seeds: ['casos sin resolver', 'misterios históricos', 'crímenes reales'] },
  { id: 'desarrollo', label: 'Desarrollo personal', categories: [], words: ['productividad', 'productivity', 'hábitos', 'habits', 'motivación', 'motivation', 'mentalidad', 'mindset', 'disciplina', 'discipline', 'estoicismo', 'stoic', 'autoayuda', 'self improvement'], seeds: ['hábitos que cambian la vida', 'estoicismo práctico', 'productividad sin estrés'] },
  { id: 'idiomas', label: 'Idiomas', categories: [27], words: ['aprender inglés', 'learn english', 'idioma', 'idiomas', 'language learning', 'vocabulario', 'vocabulary', 'gramática', 'grammar', 'pronunciación', 'pronunciation', 'deutsch lernen', 'apprendre'], seeds: ['inglés para viajar', 'vocabulario cotidiano', 'alemán desde cero'] },
]

export const nicheLabel = (id: string) => NICHES.find(n => n.id === id)?.label ?? id

const strip = (s: string) => ` ${s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}#+\- ]+/gu, ' ').replace(/\s+/g, ' ')} `

/**
 * Whole-word match. Words of 5+ letters also match as a prefix (inversión → inversiones, Aktien → Aktienmarkt), but never inside another
 * word: "invest" no longer matches "investigation", nor "tier" "frontier". Short words must be complete.
 */
export function wordHit(text: string, w: string): boolean {
  const t = w.trim()
  return t.length >= 5 ? text.includes(` ${t}`) : text.includes(` ${t} `)
}

export type NicheMatch = { niche: string; reason: string }

/** A video can belong to several niches (multi-label): "tecnología" and "inteligencia artificial" are not exclusive. */
export function nichesOf(video: Pick<YouTubeVideoResult, 'title' | 'tags' | 'categoryId' | 'channelTitle'>, opts: { useCategory?: boolean } = {}): NicheMatch[] {
  const text = strip([video.title, ...(video.tags ?? [])].join(' '))
  const out: NicheMatch[] = []
  for (const n of NICHES) {
    const hit = n.words.find(w => wordHit(text, w))
    if (hit) { out.push({ niche: n.id, reason: `palabra «${hit.trim()}» en título o etiquetas` }); continue }
    if (opts.useCategory !== false && video.categoryId && n.categories.includes(Number(video.categoryId))) out.push({ niche: n.id, reason: `categoría de YouTube ${video.categoryId}` })
  }
  return out
}

export function matchesAnyNiche(video: Parameters<typeof nichesOf>[0], ids: string[]) { const m = nichesOf(video).map(x => x.niche); return ids.some(i => m.includes(i)) }
export function matchesAllNiches(video: Parameters<typeof nichesOf>[0], ids: string[]) { const m = nichesOf(video).map(x => x.niche); return ids.every(i => m.includes(i)) }

// ---------- Format and content type ----------
export type Confidence = 'alta' | 'media' | 'baja'
export type InferredFormat = { format: 'short' | 'brief' | 'medium' | 'long' | 'live' | 'unknown'; confidence: Confidence; reason: string }

/**
 * Shorts are NOT labelled by the API. A video of up to 60 s is a "probable Short"; a #shorts tag in the title raises the confidence,
 * and a 60–180 s video only counts when it says #shorts. This is an inference, and the screen says so.
 */
export function inferFormat(v: Pick<YouTubeVideoResult, 'title' | 'tags' | 'observed' | 'live'> & { description?: string; categoryId?: string | null }): InferredFormat {
  // Only a stream that is on air (or scheduled) is a "directo". An ended stream or a premiere keeps its normal format, by duration.
  if (v.live === 'live' || v.live === 'upcoming') return { format: 'live', confidence: 'alta', reason: v.live === 'live' ? 'YouTube lo marca como directo en emisión' : 'YouTube lo marca como directo programado' }
  const s = v.observed.durationSeconds
  if (s === null) return { format: 'unknown', confidence: 'baja', reason: 'sin duración' }
  // The API has no "is a Short" flag and no aspect ratio. #shorts in the title, tags or description is the only explicit signal.
  const tagged = /(^|\s)#shorts?\b/i.test(`${v.title} ${v.description ?? ''}`) || (v.tags ?? []).some(t => /^#?shorts?$/i.test(t))
  if (tagged && s <= 180) return { format: 'short', confidence: 'alta', reason: `lleva #shorts y dura ${Math.round(s)} s` }
  if (s <= 60) {
    // A clip of up to a minute is often NOT a Short: music videos, trailers, teasers, scenes and highlights are cut to that length too.
    if (v.categoryId === '10' || CLIP_LIKE.test(v.title)) return { format: 'brief', confidence: 'baja', reason: 'dura ≤ 60 s pero parece un clip, tráiler o vídeo musical: no se confirma como Short' }
    return { format: 'short', confidence: 'media', reason: 'dura ≤ 60 s sin #shorts: probable Short (la API no permite confirmarlo)' }
  }
  const f = formatOf(s)!
  return { format: f, confidence: 'alta', reason: s <= 180 ? `dura ${Math.round(s)} s sin #shorts: vídeo corto, no Short confirmado` : `duración ${Math.round(s / 60)} min` }
}
const CLIP_LIKE = /\b(official (music )?video|lyrics?|letra|trailer|teaser|clip|scene|highlights?|best moments|full (episode|movie)|escena)\b/i

export type ContentType = { id: string; label: string; words: string[] }
export const CONTENT_TYPES: ContentType[] = [
  { id: 'tutorial', label: 'Tutoriales', words: ['tutorial', 'cómo ', 'como hacer', 'how to', 'paso a paso', 'step by step', 'guía', 'guide', 'aprende', 'learn', 'anleitung'] },
  { id: 'documental', label: 'Documentales', words: ['documental', 'documentary', 'investigación', 'dokumentation'] },
  { id: 'historia', label: 'Historias', words: ['historia de', 'la historia', 'story', 'storytime', 'cuento', 'relato', 'geschichte von'] },
  { id: 'ambiente', label: 'Música y ambiente', words: ['lofi', 'lo-fi', 'ambient', 'ambiental', 'relajante', 'relaxing', 'study music', 'sleep', 'para dormir', 'para estudiar', 'rain sounds', 'lluvia', 'white noise', 'ruido blanco', 'beats'] },
  { id: 'educativo', label: 'Contenido educativo', words: ['explicado', 'explained', 'por qué', 'why ', 'qué es', 'what is', 'clase', 'lección', 'lesson', 'curso', 'course'] },
  { id: 'entretenimiento', label: 'Entretenimiento', words: ['reacción', 'reaction', 'broma', 'prank', 'reto', 'challenge', 'humor', 'comedy', 'sketch', 'react'] },
  { id: 'resena', label: 'Reseñas y comparativas', words: ['reseña', 'review', 'análisis de', 'vs ', 'comparativa', 'unboxing', 'mejores ', 'best '] },
]

export function contentTypesOf(v: Pick<YouTubeVideoResult, 'title' | 'tags' | 'live'>): Array<{ id: string; reason: string }> {
  const text = strip([v.title, ...(v.tags ?? [])].join(' '))
  const out = CONTENT_TYPES.flatMap(c => { const w = c.words.find(x => wordHit(text, x)); return w ? [{ id: c.id, reason: `«${w.trim()}»` }] : [] })
  if (v.live === 'live' || v.live === 'upcoming') out.push({ id: 'directo', reason: 'marcado como directo en YouTube' })
  else if (v.live === 'was_live') out.push({ id: 'directo', reason: 'emisión en directo ya finalizada (o estreno)' })
  return out
}

export const CONTENT_TYPE_OPTIONS: Array<[string, string]> = [...CONTENT_TYPES.map(c => [c.id, c.label] as [string, string]), ['directo', 'Directos']]
export const FORMAT_OPTIONS: Array<[InferredFormat['format'], string]> = [['short', 'Shorts (inferido)'], ['brief', 'Cortos (1–4 min)'], ['medium', 'Medios (4–20 min)'], ['long', 'Largos (+20 min)'], ['live', 'Directos']]
