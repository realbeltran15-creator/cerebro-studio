import { NARRATION_WORDS_PER_SECOND, wordCount } from '@/lib/scripts'
import { comparable } from './sources'
import type { ShortsConfig } from './config'

/**
 * Prompts, schemas and deterministic checks for the model steps. The model proposes; code checks. Rules:
 * hook and main fact inside the first 2 s, every number in the narration present in the verified sources, 20–58 s.
 */

export const FIRST_SECONDS = 2
/** Words that fit in the first 2 s at the narration pace, plus one of margin. */
export const FIRST_WORDS = Math.round(FIRST_SECONDS * NARRATION_WORDS_PER_SECOND) + 1
export const MIN_SECONDS = 20
export const MAX_SECONDS = 58

// ---------- Step 1: proposal ----------
export type Proposal = { topic: string; statement: string; keyTerms: string[]; sources: Array<{ url: string; title: string }> }

export const proposalSchema = {
  type: 'object', additionalProperties: false, required: ['topic', 'statement', 'keyTerms', 'sources'],
  properties: {
    topic: { type: 'string' },
    statement: { type: 'string' },
    keyTerms: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'title'], properties: { url: { type: 'string' }, title: { type: 'string' } } } },
  },
}

export function parseProposal(v: unknown): Proposal | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '')
  const topic = text(o.topic, 140), statement = text(o.statement, 400)
  const keyTerms = Array.isArray(o.keyTerms) ? o.keyTerms.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(x => x.length >= 2 && x.length <= 40).slice(0, 4) : []
  const sources = Array.isArray(o.sources) ? o.sources.flatMap(s => {
    const r = s as Record<string, unknown>
    return typeof r?.url === 'string' ? [{ url: r.url.trim().slice(0, 400), title: text(r.title, 160) }] : []
  }).slice(0, 5) : []
  return topic && statement && keyTerms.length >= 1 && sources.length >= 2 ? { topic, statement, keyTerms, sources } : null
}

export function proposalPrompt(cfg: ShortsConfig, titles: string[], avoid: string[]) {
  return {
    system: 'Eres el editor de curiosidades de un canal de YouTube Shorts en español. Solo propones datos que puedas respaldar con páginas reales de fuentes fiables (instituciones, revistas científicas, enciclopedias, agencias). No inventes direcciones: si no conoces la URL exacta de una página, no la incluyas. Responde solo con el JSON pedido.',
    user: [
      `Canal: ${cfg.channelName}. Vídeos que están funcionando en el nicho (solo como señal de interés, no los copies):`,
      ...titles.map(t => `- ${t}`),
      avoid.length ? `Temas ya usados (no repetir): ${avoid.slice(0, 40).join('; ')}.` : '',
      'Propón UN dato concreto y comprobable relacionado con el interés de esos vídeos.',
      '- topic: el tema en pocas palabras.',
      '- statement: el dato en una frase, con la cifra o el nombre exactos.',
      '- keyTerms: 1 a 4 términos que DEBEN aparecer en cualquier página que lo respalde (cifras sin separadores o nombres propios).',
      '- sources: 2 a 4 páginas de dominios distintos que lo respalden (url https completa y título).',
    ].filter(Boolean).join('\n'),
  }
}

// ---------- Step 2: verification against the fetched excerpts ----------
export type Verification = { supported: boolean; contradictions: string[]; note: string }
export const verificationSchema = {
  type: 'object', additionalProperties: false, required: ['supported', 'contradictions', 'note'],
  properties: { supported: { type: 'boolean' }, contradictions: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
}
export function parseVerification(v: unknown): Verification | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.supported !== 'boolean') return null
  return { supported: o.supported, contradictions: Array.isArray(o.contradictions) ? o.contradictions.filter((x): x is string => typeof x === 'string').slice(0, 5).map(x => x.slice(0, 200)) : [], note: typeof o.note === 'string' ? o.note.slice(0, 300) : '' }
}
export function verificationPrompt(statement: string, excerpts: Array<{ domain: string; excerpt: string }>) {
  return {
    system: 'Eres un verificador de datos estricto. Juzgas solo con los extractos que se te dan, nunca con tu memoria. Si los extractos no confirman el dato exacto (cifra incluida) o se contradicen, supported es false.',
    user: [`Dato a verificar: ${statement}`, ...excerpts.map((e, i) => `Fuente ${i + 1} (${e.domain}): ${e.excerpt}`), 'Indica si ambas fuentes respaldan el dato tal como está escrito, y lista contradicciones o diferencias de cifras.'].join('\n\n'),
  }
}

// ---------- Step 3: the script ----------
export type ShortScene = { narration: string; visual: string; onScreenText: string }
export type ShortScript = { title: string; description: string; hashtags: string[]; scenes: ShortScene[] }

export const scriptSchema = {
  type: 'object', additionalProperties: false, required: ['title', 'description', 'hashtags', 'scenes'],
  properties: {
    title: { type: 'string' }, description: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
    scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['narration', 'visual', 'onScreenText'], properties: { narration: { type: 'string' }, visual: { type: 'string' }, onScreenText: { type: 'string' } } } },
  },
}

export function parseScript(v: unknown): ShortScript | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '')
  const scenes = Array.isArray(o.scenes) ? o.scenes.map(s => {
    const r = (s ?? {}) as Record<string, unknown>
    return { narration: text(r.narration, 400), visual: text(r.visual, 400), onScreenText: text(r.onScreenText, 80) }
  }).filter(s => s.narration && s.visual) : []
  const title = text(o.title, 100)
  return title && scenes.length ? {
    title, description: text(o.description, 1500),
    hashtags: Array.isArray(o.hashtags) ? o.hashtags.filter((x): x is string => typeof x === 'string').map(h => h.replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 30)).filter(Boolean).slice(0, 6) : [],
    scenes,
  } : null
}

export function scriptPrompt(cfg: ShortsConfig, fact: { statement: string; keyTerms: string[] }, excerpts: string[], feedback: string[] = []) {
  return {
    system: `Escribes guiones de YouTube Shorts de curiosidades en español neutro para el canal ${cfg.channelName}. Solo usas datos presentes en los extractos verificados: ninguna cifra, fecha o nombre que no aparezca en ellos. Frases cortas, tono claro y sin exageraciones. Responde solo con el JSON pedido.`,
    user: [
      `Dato verificado: ${fact.statement}`,
      `Términos clave: ${fact.keyTerms.join(', ')}`,
      ...excerpts.map((e, i) => `Extracto ${i + 1}: ${e}`),
      'Reglas obligatorias:',
      `- La primera escena debe abrir en sus primeras ${FIRST_WORDS} palabras con el gancho Y el dato principal (con uno de los términos clave).`,
      '- onScreenText de la primera escena: máximo 8 palabras, con el dato principal; se ve desde el segundo 0.',
      `- Entre ${cfg.scenes.min} y ${cfg.scenes.max} escenas; narración total entre ${Math.round(MIN_SECONDS * NARRATION_WORDS_PER_SECOND)} y ${Math.round(MAX_SECONDS * NARRATION_WORDS_PER_SECOND)} palabras.`,
      '- visual: descripción de una imagen vertical fotorrealista SIN texto ni rostros reconocibles.',
      '- Cierra con una frase que invite a seguir el canal, sin prometer nada.',
      ...(feedback.length ? ['Corrige estos fallos del intento anterior:', ...feedback.map(f => `- ${f}`)] : []),
    ].join('\n'),
  }
}

export type Check = { id: string; ok: boolean; message: string }

const firstWords = (text: string, n: number) => text.trim().split(/\s+/).slice(0, n).join(' ')
const NUMBER = /\d[\d.,]*/g

export function scriptChecks(script: ShortScript, fact: { keyTerms: string[] }, verifiedText: string, cfg: ShortsConfig): { ok: boolean; checks: Check[]; seconds: number } {
  const first = script.scenes[0]
  const opening = comparable(firstWords(first?.narration ?? '', FIRST_WORDS))
  const terms = fact.keyTerms.map(comparable).filter(Boolean)
  const hasTerm = (s: string) => terms.some(t => s.includes(t))
  const narration = script.scenes.map(s => s.narration).join(' ')
  const words = wordCount(narration)
  const seconds = Math.round(words / NARRATION_WORDS_PER_SECOND)
  const verified = comparable(verifiedText)
  const unknownNumbers = [...new Set((narration.match(NUMBER) ?? []).map(n => comparable(n.replace(/[.,]+$/, ''))).filter(n => /\d/.test(n) && !verified.includes(n)))]
  const screen = first?.onScreenText ?? ''
  const checks: Check[] = [
    { id: 'hook_fact_2s', ok: Boolean(first) && hasTerm(opening), message: `Gancho y dato principal en los primeros ${FIRST_SECONDS} s (≈ ${FIRST_WORDS} palabras): «${firstWords(first?.narration ?? '', FIRST_WORDS)}»` },
    { id: 'screen_text_0s', ok: Boolean(screen) && wordCount(screen) <= 8 && hasTerm(comparable(screen)), message: `Texto en pantalla desde el segundo 0 con el dato: «${screen || 'falta'}»` },
    { id: 'duration', ok: seconds >= MIN_SECONDS && seconds <= MAX_SECONDS, message: `Duración estimada ${seconds} s (entre ${MIN_SECONDS} y ${MAX_SECONDS} s)` },
    { id: 'scene_count', ok: script.scenes.length >= cfg.scenes.min && script.scenes.length <= cfg.scenes.max, message: `${script.scenes.length} escenas (entre ${cfg.scenes.min} y ${cfg.scenes.max})` },
    { id: 'numbers_verified', ok: unknownNumbers.length === 0, message: unknownNumbers.length ? `Cifras que no aparecen en las fuentes verificadas: ${unknownNumbers.join(', ')}` : 'Todas las cifras de la narración aparecen en las fuentes verificadas' },
    { id: 'visual_no_text', ok: script.scenes.every(s => !/\b(texto|letrero|cartel|rotulo|titulo escrito)\b/.test(comparable(s.visual)) ), message: 'Las descripciones visuales no piden texto dentro de la imagen' },
  ]
  return { ok: checks.every(c => c.ok), checks, seconds }
}
