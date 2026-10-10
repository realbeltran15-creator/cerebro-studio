import type { ScriptBasis, ScriptRow, ScriptSection } from '@/lib/types/database'

export const basisLabels: Record<ScriptBasis, string> = {
  verified_fact: 'Hecho verificado',
  testimony: 'Testimonio verificado',
  reconstruction: 'Reconstrucción narrativa',
  interpretation: 'Interpretación',
}

export const basisHelp: Record<ScriptBasis, string> = {
  verified_fact: 'Dato comprobado. Debe tener al menos una fuente.',
  testimony: 'Declaración real de un protagonista. Indica quién habla y la fuente.',
  reconstruction: 'Narración que conecta hechos. No inventa emociones, diálogos ni detalles.',
  interpretation: 'Lectura o reflexión del narrador. Se presenta como tal, no como hecho.',
}

export const scriptStatusLabels: Record<ScriptRow['status'], string> = {
  draft: 'Borrador',
  review: 'En revisión',
  approved: 'Aprobado',
  archived: 'Archivado',
}

/** Default structure for a new long-form script. Headings are editable. */
export const defaultStructure: Array<Pick<ScriptSection, 'heading' | 'basis'>> = [
  { heading: 'Normalidad previa', basis: 'verified_fact' },
  { heading: 'Punto de no retorno', basis: 'verified_fact' },
  { heading: 'Primera fase crítica', basis: 'reconstruction' },
  { heading: 'Escalada', basis: 'reconstruction' },
  { heading: 'Desenlace', basis: 'verified_fact' },
  { heading: 'Recompensa final', basis: 'interpretation' },
]

export function newSectionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function makeSection(heading = 'Nueva sección', basis: ScriptBasis = 'reconstruction'): ScriptSection {
  return { id: newSectionId(), heading, basis, text: '', sources: [] }
}

/** Normalises whatever is stored in the jsonb column into valid sections. */
export function normalizeSections(value: unknown): ScriptSection[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const raw = item as Record<string, unknown>
    const basis = (typeof raw.basis === 'string' && raw.basis in basisLabels ? raw.basis : 'reconstruction') as ScriptBasis
    return [{
      id: typeof raw.id === 'string' && raw.id ? raw.id : newSectionId(),
      heading: typeof raw.heading === 'string' ? raw.heading : '',
      basis,
      text: typeof raw.text === 'string' ? raw.text : '',
      sources: Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [],
      speaker: typeof raw.speaker === 'string' && raw.speaker ? raw.speaker : undefined,
    }]
  })
}

export function wordCount(text: string | null | undefined) {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length
}

/**
 * ESTIMATION, not a measurement: Spanish documentary narration at ~150 words/minute.
 * Always label the result as an estimate in the UI.
 */
export const NARRATION_WORDS_PER_SECOND = 2.5

export function estimateSeconds(text: string | null | undefined) {
  const words = wordCount(text)
  return words === 0 ? 0 : Math.max(2, Math.round(words / NARRATION_WORDS_PER_SECOND))
}

export function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.round(totalSeconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export type ScriptWarning = { sectionId?: string; message: string }

/** Integrity checks derived from the channel's rules: facts need sources, testimony needs a speaker. */
export function scriptWarnings(script: Pick<ScriptRow, 'hook' | 'cta'> & { sections: ScriptSection[] }): ScriptWarning[] {
  const warnings: ScriptWarning[] = []
  if (!script.hook?.trim()) warnings.push({ message: 'Falta el hook de apertura.' })
  for (const section of script.sections) {
    const name = section.heading.trim() || 'Sección sin título'
    if (!section.text.trim()) warnings.push({ sectionId: section.id, message: `«${name}» no tiene narración.` })
    if (section.basis === 'verified_fact' && section.sources.length === 0)
      warnings.push({ sectionId: section.id, message: `«${name}» se marca como hecho verificado pero no tiene fuente.` })
    if (section.basis === 'testimony' && (!section.speaker?.trim() || section.sources.length === 0))
      warnings.push({ sectionId: section.id, message: `«${name}» es un testimonio: indica quién habla y la fuente.` })
  }
  return warnings
}

export type PlannedScene = {
  position: number
  duration_ms: number
  narration: string | null
  metadata: Record<string, unknown>
}

/** Turns a script into storyboard scenes: hook → one scene per section → CTA. */
export function scriptToScenes(script: Pick<ScriptRow, 'id' | 'version' | 'hook' | 'cta'> & { sections: ScriptSection[] }): PlannedScene[] {
  const parts: Array<{ narration: string; metadata: Record<string, unknown> }> = []
  if (script.hook?.trim()) parts.push({ narration: script.hook.trim(), metadata: { heading: 'Hook', basis: 'reconstruction', sources: [] } })
  for (const section of script.sections) {
    if (!section.text.trim()) continue
    parts.push({
      narration: section.text.trim(),
      metadata: { heading: section.heading, basis: section.basis, sources: section.sources, speaker: section.speaker ?? null, script_section_id: section.id },
    })
  }
  if (script.cta?.trim()) parts.push({ narration: script.cta.trim(), metadata: { heading: 'Cierre / CTA', basis: 'interpretation', sources: [] } })
  return parts.map((part, index) => ({
    position: index + 1,
    duration_ms: Math.max(2, estimateSeconds(part.narration)) * 1000,
    narration: part.narration,
    metadata: { ...part.metadata, script_id: script.id, script_version: script.version, duration_is_estimate: true },
  }))
}

/** True when PostgREST reports that the scripts migration has not been applied yet. */
export function isMissingScriptsTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return error.code === 'PGRST205' || error.code === '42P01' || /scripts/.test(error.message ?? '') && /(does not exist|could not find)/i.test(error.message ?? '')
}
