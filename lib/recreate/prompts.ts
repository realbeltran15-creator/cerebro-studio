import { LIMITS } from './types'
import type { VideoAnalysis } from './types'

/** Step 1 of the tutorial: understand the reference video (structure only, never a copy). */
export const ANALYSIS_PROMPT = `Eres analista de YouTube Shorts. Mira el vídeo y devuelve SOLO un JSON con:
hook (qué ocurre en los primeros 1-2 s y por qué atrapa), hook_seconds, duration_seconds,
scenes (lista en orden: start y end en segundos, description, shot_type, emotion),
pace (ritmo general), avg_scene_seconds, dominant_emotion, viral_element (qué lo hace viral),
narration_style (tono y forma de contar), niche, characters (name, role, appearance, outfit, expression; vacío si no hay),
spoken_text (transcripción literal de lo que se dice, vacío si no hay voz).
No inventes lo que no se ve ni se oye. Responde en español salvo spoken_text (idioma original).`

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string' }, hook_seconds: { type: 'number' }, duration_seconds: { type: 'number' },
    scenes: { type: 'array', items: { type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' }, description: { type: 'string' }, shot_type: { type: 'string' }, emotion: { type: 'string' } }, required: ['description'] } },
    pace: { type: 'string' }, avg_scene_seconds: { type: 'number' }, dominant_emotion: { type: 'string' }, viral_element: { type: 'string' }, narration_style: { type: 'string' }, niche: { type: 'string' },
    characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, appearance: { type: 'string' }, outfit: { type: 'string' }, expression: { type: 'string' } }, required: ['name'] } },
    spoken_text: { type: 'string' },
  },
  required: ['hook', 'scenes', 'pace', 'dominant_emotion', 'viral_element', 'narration_style'],
} as const

const RULES = `REGLAS DE ESTRUCTURA
- Entre ${LIMITS.minScenes} y ${LIMITS.maxScenes} escenas, cada una de ${LIMITS.minSceneSeconds} a ${LIMITS.maxSceneSeconds} segundos; total entre ${LIMITS.minTotalSeconds} y ${LIMITS.maxTotalSeconds} segundos; formato vertical 9:16.
- Misma estructura, ritmo y emoción que el vídeo analizado, pero una historia ORIGINAL: otros personajes, otra situación, otras palabras. No copies frases del vídeo.
- Gancho potente en los primeros 1-2 segundos (la primera escena).
- Narración en español, natural y sencilla, de máximo ~${Math.floor(LIMITS.maxSceneSeconds * LIMITS.wordsPerSecond)} palabras por escena (cabe en ${LIMITS.maxSceneSeconds} s).
- Título viral de 8 a 12 palabras y descripción corta con emojis.
- visual_prompt_en en inglés, empieza por "Ultra-realistic cinematic shot, vertical 9:16," y describe plano, ambiente, luz y acción; sin texto ni logotipos en imagen.
- animation_prompt_en en inglés: solo el movimiento de cámara y de los personajes (2-3 frases).`

const CHARACTER_RULES = `PERSONAJES CONSISTENTES
- Lista de personajes con: name, age, personality, appearance, outfit, expression, unique_traits y prompt_en (descripción en inglés de un retrato de cuerpo medio, fondo neutro, que sirva de referencia de identidad).
- En cada escena indica en "characters" los nombres que aparecen y repite en visual_prompt_en los rasgos clave (ropa, pelo, rasgos únicos) de cada uno, idénticos en todas las escenas.
- Máximo ${LIMITS.maxCharacters} personajes.`

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' }, description: { type: 'string' },
    characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'string' }, personality: { type: 'string' }, appearance: { type: 'string' }, outfit: { type: 'string' }, expression: { type: 'string' }, unique_traits: { type: 'string' }, prompt_en: { type: 'string' } }, required: ['name', 'appearance', 'prompt_en'] } },
    scenes: { type: 'array', items: { type: 'object', properties: { action: { type: 'string' }, seconds: { type: 'number' }, characters: { type: 'array', items: { type: 'string' } }, narration: { type: 'string' }, visual_prompt_en: { type: 'string' }, animation_prompt_en: { type: 'string' } }, required: ['seconds', 'narration', 'visual_prompt_en', 'animation_prompt_en'] } },
  },
  required: ['title', 'description', 'scenes'],
} as const

export function planSystem(consistent: boolean) {
  return `Eres guionista de YouTube Shorts virales en español. Recreas la ESTRUCTURA de un vídeo de referencia con una historia original.\n${RULES}${consistent ? `\n${CHARACTER_RULES}` : '\n- Sin personajes recurrentes: deja "characters" vacío y "characters" de cada escena vacío.'}\nResponde SOLO con JSON.`
}

/** The reference's spoken text is deliberately NOT given to the writer, so the new narration cannot lean on it. */
export function planUser(a: VideoAnalysis, o: { idea?: string; consistent: boolean }) {
  const { spoken_text: _omit, ...safe } = a
  void _omit
  return `ANÁLISIS DEL VÍDEO DE REFERENCIA (solo estructura):\n${JSON.stringify(safe)}\n\n${o.idea?.trim() ? `Idea o tema del usuario: ${o.idea.trim().slice(0, 500)}` : 'Elige tú un tema original del mismo nicho.'}\nCrea el Short ${o.consistent ? 'con personajes consistentes' : 'normal'}.`
}
