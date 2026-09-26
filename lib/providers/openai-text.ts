import type { ScriptBasis } from '@/lib/types/database'

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
export const textConfigured = () => Boolean(textKey())

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
  const key = textKey()
  if (!key) throw new TextProviderError('El proveedor de texto no está configurado.', null)

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId },
    body: JSON.stringify({
      model: textModel(),
      temperature: 0.6,
      messages: [{ role: 'system', content: rules }, { role: 'user', content: userPrompt(input) }],
      response_format: { type: 'json_schema', json_schema: { name: 'script_proposal', strict: true, schema } },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) throw new TextProviderError(`OpenAI text generation failed (${response.status}).`, response.status)

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }> }
  const message = payload.choices?.[0]?.message
  if (message?.refusal) throw new TextProviderError('El modelo rechazó la solicitud.', null)
  let parsed: ScriptAssistProposal
  try { parsed = JSON.parse(message?.content ?? '') as ScriptAssistProposal } catch { throw new TextProviderError('El modelo devolvió una respuesta no válida.', null) }

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
  }
}
