import { bibleIssues, type PersonaBible } from './bible'

/** Identity traits recorded per version. Free text written by a person; nothing here is measured. */
export const traitFields = [
  { key: 'faceShape', label: 'Forma del rostro y landmarks', hint: 'Óvalo, mandíbula, pómulos, distancia entre ojos, nariz, labios' },
  { key: 'eyes', label: 'Ojos: forma y color', hint: 'Forma, color exacto, cejas, pestañas' },
  { key: 'hair', label: 'Cabello y línea capilar', hint: 'Color, textura, largo, peinado base, entradas' },
  { key: 'skin', label: 'Piel: tono y textura', hint: 'Tono, subtono, pecas, poros, lunares visibles' },
  { key: 'body', label: 'Proporciones corporales', hint: 'Altura aparente, complexión, hombros, postura' },
  { key: 'hands', label: 'Manos, dedos y uñas', hint: 'Forma, longitud de dedos, uñas, anillos fijos' },
  { key: 'teeth', label: 'Dientes y sonrisa', hint: 'Alineación, color, sonrisa característica' },
  { key: 'marks', label: 'Rasgos distintivos', hint: 'Cicatrices, tatuajes, piercings, asimetrías' },
] as const

export type TraitKey = (typeof traitFields)[number]['key']
export type Traits = Partial<Record<TraitKey, string>>

export function parseTraits(raw: unknown): Traits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Traits = {}
  for (const f of traitFields) { const v = r[f.key]; if (typeof v === 'string' && v.trim()) out[f.key] = v.trim().slice(0, 1000) }
  return out
}

export const referenceCategories = [
  { id: 'face_front', label: 'Rostro de frente', min: 2 },
  { id: 'face_three_quarter', label: 'Rostro tres cuartos', min: 2 },
  { id: 'face_profile', label: 'Rostro de perfil', min: 1 },
  { id: 'expression', label: 'Expresiones', min: 2 },
  { id: 'body', label: 'Cuerpo completo', min: 1 },
  { id: 'hands', label: 'Manos', min: 1 },
  { id: 'teeth', label: 'Sonrisa / dientes', min: 1 },
  { id: 'hair', label: 'Cabello', min: 0 },
  { id: 'wardrobe', label: 'Vestuario', min: 0 },
  { id: 'environment', label: 'Entornos', min: 0 },
  { id: 'voice_sample', label: 'Muestras de voz', min: 0 },
  { id: 'other', label: 'Otras', min: 0 },
] as const

export type ReferenceCategory = (typeof referenceCategories)[number]['id']
export type ReferenceRow = { category: string; approved: boolean }

/** What is missing before an identity version can be sent to review. Only approved references count. */
export function identityReadiness(input: { bible: PersonaBible; traits: Traits; references: ReferenceRow[] }) {
  const missing: string[] = []
  for (const i of bibleIssues(input.bible)) if (i.blocking) missing.push(`Persona Bible: ${i.message}`)
  for (const f of traitFields) if (!input.traits[f.key]) missing.push(`Rasgo sin describir: ${f.label}.`)
  for (const c of referenceCategories) {
    const have = input.references.filter(r => r.category === c.id && r.approved).length
    if (have < c.min) missing.push(`Referencias aprobadas de «${c.label}»: ${have} de ${c.min}.`)
  }
  return { ready: missing.length === 0, missing }
}

export function nextVersionNumber(existing: Array<{ version: number }>) {
  return existing.reduce((m, v) => Math.max(m, v.version), 0) + 1
}
