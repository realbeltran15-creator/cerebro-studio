/**
 * Quality checks for identity versions and generated media. Consistency and photorealism come first.
 *
 * Every check declares how it is measured. Only checks with a real measurement in this codebase are
 * "automated"; everything that needs a face/landmark/lip-sync model that is not connected is
 * "human" review. A report can only pass when every applicable check passed — nothing is auto-approved
 * and no score is simulated.
 */

export type SubjectKind = 'identity' | 'image' | 'video' | 'voice' | 'lipsync'
export type CheckMethod = 'automated' | 'human'
export type CheckStatus = 'pending' | 'pass' | 'fail'

export type CheckDefinition = {
  id: string
  label: string
  group: 'Rostro' | 'Cuerpo' | 'Vestuario y entorno' | 'Movimiento' | 'Voz y audio' | 'Técnico'
  appliesTo: SubjectKind[]
  method: CheckMethod
  /** For human checks: the model that would be needed to automate it (shown as pending integration). */
  automationNeeds?: string
  guidance: string
}

export const qualityChecks: CheckDefinition[] = [
  { id: 'face_identity', label: 'Rostro y landmarks coinciden con la identidad', group: 'Rostro', appliesTo: ['identity', 'image', 'video', 'lipsync'], method: 'human', automationNeeds: 'Modelo de embeddings faciales (similitud con referencias aprobadas)', guidance: 'Compara con las referencias de frente y tres cuartos: mandíbula, pómulos, nariz, distancia entre ojos, labios.' },
  { id: 'eyes', label: 'Forma y color de ojos', group: 'Rostro', appliesTo: ['identity', 'image', 'video', 'lipsync'], method: 'human', automationNeeds: 'Detector de landmarks oculares y color de iris', guidance: 'Mismo color de iris, forma de párpado y cejas.' },
  { id: 'hair', label: 'Cabello y línea capilar', group: 'Rostro', appliesTo: ['identity', 'image', 'video'], method: 'human', guidance: 'Color, textura y línea capilar estables; sin mechones que aparecen o desaparecen.' },
  { id: 'skin', label: 'Tono y textura de piel', group: 'Rostro', appliesTo: ['identity', 'image', 'video', 'lipsync'], method: 'human', guidance: 'Tono consistente con la iluminación; poros y textura reales, sin piel plástica.' },
  { id: 'teeth_tongue', label: 'Dientes y lengua', group: 'Rostro', appliesTo: ['identity', 'image', 'video', 'lipsync'], method: 'human', guidance: 'Número y forma de dientes plausibles, sin fusiones; lengua coherente al hablar.' },
  { id: 'blink_gaze', label: 'Parpadeo y dirección de la mirada', group: 'Rostro', appliesTo: ['video', 'lipsync'], method: 'human', automationNeeds: 'Seguimiento de párpados y mirada por fotograma', guidance: 'Parpadeo natural (no ausente ni excesivo); la mirada apunta a donde debe.' },
  { id: 'body_proportions', label: 'Proporciones corporales', group: 'Cuerpo', appliesTo: ['identity', 'image', 'video'], method: 'human', automationNeeds: 'Estimación de pose y proporciones', guidance: 'Hombros, brazos, cuello y altura coherentes con la identidad.' },
  { id: 'hands', label: 'Manos, dedos, uñas y articulaciones', group: 'Cuerpo', appliesTo: ['identity', 'image', 'video'], method: 'human', automationNeeds: 'Detector de landmarks de manos', guidance: 'Cinco dedos por mano, articulaciones que doblan bien, uñas completas.' },
  { id: 'wardrobe', label: 'Vestuario y accesorios', group: 'Vestuario y entorno', appliesTo: ['image', 'video'], method: 'human', guidance: 'Coincide con la ficha de vestuario elegida; sin cambios entre planos.' },
  { id: 'environment', label: 'Entorno y geometría', group: 'Vestuario y entorno', appliesTo: ['image', 'video'], method: 'human', guidance: 'Coincide con la Scene Bible; líneas rectas, escala y objetos coherentes.' },
  { id: 'light_shadow', label: 'Sombras, reflejos y perspectiva', group: 'Vestuario y entorno', appliesTo: ['image', 'video'], method: 'human', guidance: 'Sombras con la misma fuente de luz; reflejos plausibles; perspectiva correcta.' },
  { id: 'motion', label: 'Movimiento facial y corporal', group: 'Movimiento', appliesTo: ['video', 'lipsync'], method: 'human', guidance: 'Movimiento natural, sin saltos, deslizamientos ni miembros que se deforman.' },
  { id: 'frame_stability', label: 'Flicker y deformaciones entre fotogramas', group: 'Movimiento', appliesTo: ['video', 'lipsync'], method: 'automated', guidance: 'Variación de luminancia media entre fotogramas consecutivos (medida en el navegador). Las deformaciones locales siguen necesitando revisión humana.' },
  { id: 'lip_sync', label: 'Sincronización labial', group: 'Voz y audio', appliesTo: ['lipsync'], method: 'human', automationNeeds: 'Modelo de sincronía labio-audio (tipo SyncNet)', guidance: 'Los fonemas coinciden con la boca; sin desfase apreciable.' },
  { id: 'voice_identity', label: 'Identidad y estabilidad de la voz', group: 'Voz y audio', appliesTo: ['voice', 'lipsync'], method: 'human', automationNeeds: 'Embeddings de hablante comparados con el Voice Profile', guidance: 'Misma voz que las muestras aprobadas: timbre, acento, ritmo.' },
  { id: 'av_sync', label: 'Sincronización audiovisual (duración)', group: 'Voz y audio', appliesTo: ['video', 'lipsync'], method: 'automated', guidance: 'Diferencia entre la duración de la pista de audio y la de vídeo.' },
  { id: 'resolution', label: 'Resolución mínima', group: 'Técnico', appliesTo: ['image', 'video', 'lipsync'], method: 'automated', guidance: 'Imagen o vídeo de al menos 1024 px en el lado corto para imagen y 720 px para vídeo.' },
]

export type CheckResult = { id: string; status: CheckStatus; method: CheckMethod; value?: number | null; note?: string | null; decidedAt?: string | null }

export function checksFor(kind: SubjectKind) {
  return qualityChecks.filter(c => c.appliesTo.includes(kind))
}

export function newReport(kind: SubjectKind): CheckResult[] {
  return checksFor(kind).map(c => ({ id: c.id, status: 'pending', method: c.method, value: null, note: null, decidedAt: null }))
}

export function overall(results: CheckResult[]): 'pending' | 'pass' | 'fail' {
  if (results.length === 0) return 'pending'
  if (results.some(r => r.status === 'fail')) return 'fail'
  return results.every(r => r.status === 'pass') ? 'pass' : 'pending'
}

/** Human decision on one check. Automated checks cannot be overridden by hand. */
export function decide(results: CheckResult[], id: string, status: CheckStatus, note: string | null, now = new Date()): CheckResult[] {
  return results.map(r => {
    if (r.id !== id) return r
    if (r.method !== 'human') throw new Error('Los controles automáticos no se pueden marcar a mano.')
    return { ...r, status, note: note?.trim().slice(0, 500) || null, decidedAt: status === 'pending' ? null : now.toISOString() }
  })
}

// Thresholds for the automated checks, applied to real measurements.
export const MIN_IMAGE_SHORT_SIDE = 1024
export const MIN_VIDEO_SHORT_SIDE = 720
export const MAX_AV_DRIFT_MS = 120
/** Mean absolute change of mean frame luminance (0-255) between consecutive frames. */
export const MAX_LUMA_FLICKER = 6

export function resolutionCheck(kind: 'image' | 'video' | 'lipsync', width: number, height: number): CheckResult {
  const min = kind === 'image' ? MIN_IMAGE_SHORT_SIDE : MIN_VIDEO_SHORT_SIDE
  const short = Math.min(width, height)
  return { id: 'resolution', method: 'automated', status: short >= min ? 'pass' : 'fail', value: short, note: `${width}×${height} (mínimo ${min} px en el lado corto)`, decidedAt: new Date().toISOString() }
}

export function avSyncCheck(videoMs: number, audioMs: number | null): CheckResult {
  if (audioMs === null) return { id: 'av_sync', method: 'automated', status: 'fail', value: null, note: 'El archivo no tiene pista de audio.', decidedAt: new Date().toISOString() }
  const drift = Math.abs(videoMs - audioMs)
  return { id: 'av_sync', method: 'automated', status: drift <= MAX_AV_DRIFT_MS ? 'pass' : 'fail', value: drift, note: `Diferencia de ${drift} ms (máximo ${MAX_AV_DRIFT_MS} ms)`, decidedAt: new Date().toISOString() }
}

/** lumas: mean luminance of consecutive sampled frames. */
export function flickerCheck(lumas: number[]): CheckResult {
  if (lumas.length < 3) return { id: 'frame_stability', method: 'automated', status: 'pending', value: null, note: 'No hay suficientes fotogramas medidos.', decidedAt: null }
  let sum = 0
  for (let i = 1; i < lumas.length; i++) sum += Math.abs(lumas[i] - lumas[i - 1])
  const mean = Math.round((sum / (lumas.length - 1)) * 100) / 100
  return { id: 'frame_stability', method: 'automated', status: mean <= MAX_LUMA_FLICKER ? 'pass' : 'fail', value: mean, note: `Cambio medio de luminancia entre fotogramas: ${mean} (máximo ${MAX_LUMA_FLICKER})`, decidedAt: new Date().toISOString() }
}

/** Merges automated measurements into a report without touching human decisions. */
export function applyAutomated(results: CheckResult[], measured: CheckResult[]): CheckResult[] {
  const byId = new Map(measured.map(m => [m.id, m]))
  return results.map(r => (r.method === 'automated' && byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r))
}
