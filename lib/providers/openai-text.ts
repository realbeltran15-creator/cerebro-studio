import type { ScriptBasis } from '@/lib/types/database'
import { routeText, runTextTask, TextRouteError } from './text'

/**
 * Script assistance through OpenAI Chat Completions with a strict JSON schema.
 * Server-only. Uses OPENAI_TEXT_API_KEY, falling back to OPENAI_API_KEY.
 * The model only proposes text: nothing is stored until the user applies and saves it.
 */

export type ScriptAssistMode = 'hook' | 'draft'

export type ScriptAssistInput = {
  mode: ScriptAssistMode
  projectName: string
  projectDescription: string | null
  title: string
  idea: string | null
  brief: string | null
  hook: string | null
  cta: string | null
  sections: Array<{ heading: string; basis: ScriptBasis; text: string; sources: string[] }>
  research: Array<{ title: string; source: string | null; notes: string[] }>
  allowedSources: string[]
}

export type ScriptAssistProposal = {
  /** Token usage reported by OpenAI (no cost is reported by the API). */
  usage?: Record<string, unknown> | null
  hooks: string[]
  sections: Array<{ heading: string; basis: ScriptBasis; text: string; sources: string[] }>
  cta: string
  notes: string[]
}

export class TextProviderError extends Error {
  constructor(message: string, readonly status: number | null) { super(message) }
}

export const textModel = () => process.env.OPENAI_TEXT_MODEL?.trim() || 'gpt-4.1-mini'
const textKey = () => process.env.OPENAI_TEXT_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || ''
/** True when at least one text provider (OpenAI, Gemini or Groq) is configured. */
export const textConfigured = () => routeText('tags').length > 0 || Boolean(textKey())

const bases: ScriptBasis[] = ['verified_fact', 'testimony', 'reconstruction', 'interpretation']

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['hooks', 'sections', 'cta', 'notes'],
  properties: {
    hooks: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'basis', 'text', 'sources'],
        properties: {
          heading: { type: 'string' },
          basis: { type: 'string', enum: bases },
          text: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    cta: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const

const rules = `Eres guionista de documentales narrativos para YouTube en español.
Reglas obligatorias:
- No inventes hechos, cifras, fechas, nombres, emociones, pensamientos ni diálogos. Usa solo lo que aparece en la idea, el brief, la investigación y las secciones existentes.
- Si falta información para una parte, escribe un marcador [PENDIENTE: qué hay que investigar] en lugar de rellenarlo.
- Marca cada sección con su base: verified_fact (dato comprobado con fuente), testimony (declaración real de un protagonista con fuente), reconstruction (narración que conecta hechos sin añadir detalles), interpretation (reflexión del narrador).
- En "sources" usa exclusivamente URLs de la lista de fuentes permitidas. Si no hay fuente para un hecho, no lo marques como verified_fact.
- El hook sitúa al espectador dentro de la situación en la primera frase, sin clickbait falso.
- El cierre deja una idea o paradoja y conecta con el siguiente vídeo.
- En "notes" explica brevemente qué falta verificar.`

function userPrompt(input: ScriptAssistInput) {
  const task = input.mode === 'hook'
    ? 'Propón 3 hooks alternativos (máximo 45 palabras cada uno). Deja "sections" vacío y "cta" vacío.'
    : 'Propón la estructura completa del guion: 5 a 8 secciones con narración, más 1 hook en "hooks" y un cierre en "cta". Conserva y mejora el texto que ya exista sin cambiar su sentido.'
  return JSON.stringify({
    tarea: task,
    proyecto: { nombre: input.projectName, descripcion: input.projectDescription },
    guion_actual: { titulo: input.title, idea: input.idea, brief: input.brief, hook: input.hook, cierre: input.cta, secciones: input.sections },
    investigacion: input.research,
    fuentes_permitidas: input.allowedSources,
  })
}

const clip = (value: string, max: number) => value.trim().slice(0, max)

export async function proposeScript(input: ScriptAssistInput, requestId: string): Promise<ScriptAssistProposal> {
  // Quality first: drafts need the most reliable model available; hooks need good but not maximum quality.
  let result
  try {
    result = await runTextTask(input.mode === 'draft' ? 'script_draft' : 'script_hooks', {
      system: rules, user: userPrompt(input), schema, schemaName: 'script_proposal', requestId,
      validate: v => {
        const p = v as Partial<ScriptAssistProposal>
        if (!p || !Array.isArray(p.hooks) || !Array.isArray(p.sections) || typeof p.cta !== 'string' || !Array.isArray(p.notes)) return null
        if (input.mode === 'hook' ? p.hooks.filter(h => typeof h === 'string' && h.trim()).length === 0 : p.sections.length === 0) return null
        return p as ScriptAssistProposal
      },
    })
  } catch (error) {
    if (error instanceof TextRouteError) throw new TextProviderError(error.message, error.status)
    throw error
  }
  const parsed = result.data
  const usage = { provider: result.model.provider, model: result.model.model(), tier: result.model.tier, ...result.usage, estimatedUsd: result.estimatedUsd, fallbacks: result.attempts }

  // Enforce the rules server-side instead of trusting the model.
  const allowed = new Set(input.allowedSources)
  const notes = (parsed.notes ?? []).map(n => clip(n, 400)).filter(Boolean).slice(0, 10)
  const sections = (parsed.sections ?? []).slice(0, 12).map(s => {
    const sources = (s.sources ?? []).filter(src => allowed.has(src))
    const dropped = (s.sources ?? []).length - sources.length
    if (dropped > 0) notes.push(`Se descartaron ${dropped} fuente(s) no presentes en la investigación en «${clip(s.heading, 80)}».`)
    return { heading: clip(s.heading, 120) || 'Sección', basis: bases.includes(s.basis) ? s.basis : 'reconstruction', text: clip(s.text, 6000), sources }
  })
  return {
    hooks: (parsed.hooks ?? []).map(h => clip(h, 600)).filter(Boolean).slice(0, 3),
    sections,
    cta: clip(parsed.cta ?? '', 1500),
    notes,
    usage,
  }
}

export type PromptModality = 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'ambient'
export type PromptEnhancement = { prompt: string; negative: string; notes: string[]; usage: Record<string, unknown> | null }

const enhanceGuides: Record<PromptModality, string> = {
  image: 'Prompt en inglés para un generador de imágenes: sujeto, acción, entorno, época, encuadre y lente, luz real, paleta. Fotografía creíble, anatomía natural, sin texto, logos ni marcas de agua salvo que se pidan.',
  video: 'Prompt en inglés para un generador de vídeo de 5–10 s: un solo plano, sujeto y acción continua, movimiento de cámara concreto (dolly, pan, handheld), luz, ritmo. Sin cortes ni texto en pantalla.',
  voice: 'Indicaciones de locución en español para un TTS dirigible: tono, ritmo, pausas, emoción e intención. Máximo 3 frases. No reescribas el texto a locutar.',
  music: 'Prompt en inglés para un generador de música: género, subgénero, tempo en BPM, instrumentos, estado de ánimo, evolución y uso (fondo de narración documental, sin competir con la voz).',
  sfx: 'Prompt en inglés para un generador de efectos de sonido: fuente, material, distancia, espacio acústico, duración e intensidad. Sin música.',
  ambient: 'Prompt en inglés para un ambiente sonoro continuo que se repetirá en bucle: lugar, capas (fondo, detalles), densidad, distancia, sin eventos bruscos ni música.',
}

/** Rewrites a user's idea into a better provider prompt. Never adds facts about real people or events. */
export async function enhancePrompt(modality: PromptModality, idea: string, context: string, requestId: string): Promise<PromptEnhancement> {
  const enhanceSchema = {
    type: 'object', additionalProperties: false, required: ['prompt', 'negative', 'notes'],
    properties: { prompt: { type: 'string' }, negative: { type: 'string' }, notes: { type: 'array', items: { type: 'string' } } },
  }
  try {
    const r = await runTextTask('prompt_enhance', {
      system: `Eres director de arte y prompt engineer de un estudio de YouTube documental. ${enhanceGuides[modality]}\nReglas: conserva la intención del usuario; no inventes hechos sobre personas o sucesos reales; nada de estilos de artistas vivos ni personajes con derechos. "negative" = lo que conviene evitar (vacío si no aplica). "notes" = 1–3 consejos breves en español.`,
      user: JSON.stringify({ idea: idea.slice(0, 3000), contexto_del_proyecto: context.slice(0, 2000) }),
      schema: enhanceSchema, schemaName: 'prompt_enhancement', requestId,
      validate: v => { const p = v as { prompt?: unknown; negative?: unknown; notes?: unknown }; return typeof p?.prompt === 'string' && p.prompt.trim() ? p as { prompt: string; negative?: string; notes?: string[] } : null },
    })
    return {
      prompt: clip(r.data.prompt, 3000), negative: clip(r.data.negative ?? '', 800), notes: (r.data.notes ?? []).map(n => clip(String(n), 300)).filter(Boolean).slice(0, 3),
      usage: { provider: r.model.provider, model: r.model.model(), tier: r.model.tier, ...r.usage, estimatedUsd: r.estimatedUsd },
    }
  } catch (error) {
    if (error instanceof TextRouteError) throw new TextProviderError(error.message, error.status)
    throw error
  }
}
