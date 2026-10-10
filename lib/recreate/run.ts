import { geminiAnalyzeYouTube } from '@/lib/providers/gemini'
import { extractJson, runTextTask, TextRouteError } from '@/lib/providers/text'
import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA, PLAN_SCHEMA, planSystem, planUser } from './prompts'
import { checkOriginality, type OriginalityReport } from './originality'
import { canonicalYouTubeUrl } from './youtube-url'
import { publicAnalysis, validateAnalysis, validatePlan } from './validate'
import type { Plan, VideoAnalysis } from './types'

export class RecreateError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'bad_request') { super(message) }
}

/** Understands the reference: the video itself through Gemini, or — when it cannot be reached — a transcript the user pastes. */
export async function analyseReference(input: { url?: string; transcript?: string; requestId: string }): Promise<{ analysis: VideoAnalysis; via: 'gemini-video' | 'transcript'; source: string | null }> {
  const url = input.url?.trim() ? canonicalYouTubeUrl(input.url) : null
  if (input.url?.trim() && !url) throw new RecreateError('Pega el enlace de un vídeo público de YouTube (youtube.com/watch, youtu.be o /shorts).')
  const transcript = input.transcript?.trim().slice(0, 12000)
  if (!url && !transcript) throw new RecreateError('Indica el enlace del vídeo de referencia o pega su transcripción.')
  if (url) {
    try {
      const r = await geminiAnalyzeYouTube(url, ANALYSIS_PROMPT)
      const analysis = validateAnalysis(JSON.parse(extractJson(r.text)))
      if (analysis) return { analysis, via: 'gemini-video', source: url }
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 429) throw new RecreateError('Se agotó el cupo gratuito de Gemini por hoy. Vuelve mañana o pega la transcripción para usar otro proveedor de texto. No se cambia a ninguno de pago.', 429, 'quota')
      if (status === 0) throw new RecreateError('Falta GEMINI_API_KEY en el servidor (clave gratuita de Google AI Studio) para analizar vídeos por enlace. Mientras tanto puedes pegar la transcripción.', 503, 'not_configured')
      if (!transcript) throw new RecreateError('Gemini no pudo ver ese vídeo (¿es privado, con restricción de edad o demasiado largo?). Pega su transcripción y lo analizo igualmente.', 422, 'unreachable')
    }
  }
  const r = await runTextTask('analysis', {
    system: 'Analiza la estructura de un YouTube Short a partir de su transcripción. No inventes lo que no aparece. Devuelve SOLO el JSON pedido.\n' + ANALYSIS_PROMPT,
    user: `TRANSCRIPCIÓN:\n${transcript}`, schema: ANALYSIS_SCHEMA, schemaName: 'video_analysis', requestId: input.requestId, validate: validateAnalysis,
  }).catch(e => { throw textFailure(e) })
  return { analysis: { ...r.data, spoken_text: r.data.spoken_text || transcript! }, via: 'transcript', source: url }
}

function textFailure(e: unknown) {
  if (e instanceof TextRouteError) {
    return new RecreateError(e.status === 429 ? 'El cupo gratuito del proveedor de texto está agotado. No se cambia a uno de pago sin tu autorización.' : e.message, e.status === 429 ? 429 : 502, e.status === 429 ? 'quota' : 'text_failed')
  }
  return e
}

export type PlanResult = { plan: Plan; originality: OriginalityReport; model: string; attempts: number }

/** Writes the original story. If it leans on the reference's wording it is rewritten once; if it still does, it is refused. */
export async function createPlan(analysis: VideoAnalysis, o: { idea?: string; consistent: boolean; requestId: string; refTitle?: string | null }): Promise<PlanResult> {
  let feedback = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await runTextTask('analysis', {
      system: planSystem(o.consistent), user: planUser(analysis, o) + feedback, schema: PLAN_SCHEMA, schemaName: 'short_plan',
      requestId: o.requestId, validate: v => validatePlan(v, o.consistent),
    }).catch(e => { throw textFailure(e) })
    const originality = checkOriginality(r.data, { spokenText: analysis.spoken_text, title: o.refTitle })
    if (originality.ok) return { plan: r.data, originality, model: r.model.id, attempts: attempt }
    feedback = `\n\nINTENTO ANTERIOR RECHAZADO: ${originality.problems.join(' ')}`
  }
  throw new RecreateError('La historia generada seguía demasiado cerca del vídeo de referencia. Prueba con tu propia idea en el campo de tema.', 422, 'not_original')
}

export { publicAnalysis }
