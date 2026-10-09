/**
 * Persona Bible: the written definition of a virtual influencer. It is the source of truth for
 * prompts, voice direction and reviews. Two guarantees are enforced, not optional:
 * the persona is an adult and it is openly disclosed as AI-generated, and it must not imitate a real person.
 */

export type PersonaBible = {
  summary: string
  apparentAge: number | null
  gender: string
  nationality: string
  languages: string[]
  personality: string
  backstory: string
  values: string
  contentPillars: string[]
  tone: string
  catchphrases: string[]
  doList: string[]
  dontList: string[]
  /** Always true: platforms require labeling synthetic media and the audience must know. */
  aiDisclosure: true
  /** Confirms the look and voice are original and not modeled on an identifiable real person. */
  originalLikenessConfirmed: boolean
}

export const emptyBible = (): PersonaBible => ({
  summary: '', apparentAge: null, gender: '', nationality: '', languages: [], personality: '', backstory: '',
  values: '', contentPillars: [], tone: '', catchphrases: [], doList: [], dontList: [],
  aiDisclosure: true, originalLikenessConfirmed: false,
})

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : []).map(x => str(x, maxLen)).filter(Boolean).slice(0, maxItems)

/** Normalizes untrusted input (form or stored JSON) into a bible. aiDisclosure cannot be turned off. */
export function parseBible(raw: unknown): PersonaBible {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const age = Number(r.apparentAge)
  return {
    summary: str(r.summary, 600), apparentAge: Number.isFinite(age) && age > 0 ? Math.round(age) : null,
    gender: str(r.gender, 60), nationality: str(r.nationality, 80), languages: list(r.languages, 8, 40),
    personality: str(r.personality, 2000), backstory: str(r.backstory, 4000), values: str(r.values, 1500),
    contentPillars: list(r.contentPillars, 10, 120), tone: str(r.tone, 600), catchphrases: list(r.catchphrases, 10, 160),
    doList: list(r.doList, 20, 200), dontList: list(r.dontList, 20, 200),
    aiDisclosure: true, originalLikenessConfirmed: r.originalLikenessConfirmed === true,
  }
}

export type BibleIssue = { field: keyof PersonaBible; message: string; blocking: boolean }

export function bibleIssues(b: PersonaBible): BibleIssue[] {
  const issues: BibleIssue[] = []
  const need = (ok: boolean, field: keyof PersonaBible, message: string) => { if (!ok) issues.push({ field, message, blocking: true }) }
  need(b.apparentAge !== null && b.apparentAge >= 18, 'apparentAge', 'La edad aparente debe ser de 18 años o más.')
  need(b.summary.length >= 20, 'summary', 'Describe a la persona en al menos una frase (20 caracteres).')
  need(b.personality.length >= 20, 'personality', 'Define la personalidad (al menos 20 caracteres).')
  need(b.tone.length >= 5, 'tone', 'Define el tono de comunicación.')
  need(b.languages.length > 0, 'languages', 'Indica al menos un idioma.')
  need(b.contentPillars.length > 0, 'contentPillars', 'Añade al menos un pilar de contenido.')
  need(b.dontList.length > 0, 'dontList', 'Añade al menos un límite (lo que la persona nunca hará o dirá).')
  need(b.originalLikenessConfirmed, 'originalLikenessConfirmed', 'Confirma que el aspecto y la voz son originales y no imitan a una persona real.')
  if (!b.backstory) issues.push({ field: 'backstory', message: 'Sin historia de fondo: recomendable para mantener la coherencia.', blocking: false })
  return issues
}
