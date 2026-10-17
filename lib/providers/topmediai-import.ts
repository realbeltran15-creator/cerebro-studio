/**
 * Import of files generated in the TopMediai web app. TopMediai's API is a separate product (not
 * included in the consumer subscriptions), so nothing is automated: the user downloads their own files
 * from their account and drops them here. No scraping, no login, no calls to TopMediai.
 *
 * What matters for the library is the licence. TopMediai states that commercial use needs a paid plan
 * (a PDF licence certificate comes with each eligible track) and that free-plan tracks are for personal
 * use only; tracks cannot be registered in YouTube Content ID as original compositions.
 */
export type TopMediaiPlan = 'paid' | 'free'
export type ImportKind = 'music' | 'sfx' | 'voice'

export const TOPMEDIAI_URL = 'https://www.topmediai.com/'
export const CONTENT_ID_NOTE = 'TopMediai indica que sus pistas no pueden registrarse en YouTube Content ID como composiciones originales, y que una licencia no garantiza que una plataforma nunca emita una reclamación.'

export type ClassifyInput = { name: string; durationSeconds: number | null }

/** Best guess from the file name and length; the user can always change it. */
export function classifyKind({ name, durationSeconds }: ClassifyInput): ImportKind {
  const n = name.toLowerCase()
  if (/\b(tts|voice|voz|speech|locuci|narra|text[-_ ]?to[-_ ]?speech)/.test(n)) return 'voice'
  if (/\b(sfx|effect|efecto|sound[-_ ]?fx|foley|whoosh|impact)/.test(n)) return 'sfx'
  if (/\b(song|music|musica|música|track|cover|instrumental|beat)/.test(n)) return 'music'
  if (durationSeconds !== null && durationSeconds < 12) return 'sfx'
  return 'music'
}

export type LicenseDecision = { status: 'licensed' | 'restricted'; notes: string }

/**
 * `paid` only counts when the user confirms the files were generated while a paid plan was active.
 * Anything else is stored as restricted (personal use), which the library and publication checks surface.
 */
export function licenseFor(plan: TopMediaiPlan, confirmedPaidAtGeneration: boolean, certificate?: string | null): LicenseDecision {
  if (plan === 'paid' && confirmedPaidAtGeneration) {
    const cert = certificate?.trim()
    return {
      status: 'licensed',
      notes: `Generado en TopMediai con plan de pago (licencia comercial según TopMediai).${cert ? ` Certificado: ${cert.slice(0, 300)}.` : ' Guarda el certificado PDF de cada pista.'} ${CONTENT_ID_NOTE}`,
    }
  }
  return {
    status: 'restricted',
    notes: 'Generado en TopMediai sin confirmar un plan de pago: según TopMediai, las pistas del plan gratuito son de uso personal. No usar en publicaciones comerciales.',
  }
}

export type ImportMeta = {
  title: string
  kind: ImportKind
  plan: TopMediaiPlan
  confirmedPaid: boolean
  prompt?: string | null
  lyrics?: string | null
  model?: string | null
  voice?: string | null
  generatedOn?: string | null
  certificate?: string | null
  originalFilename: string
}

/** Provenance fields stored with the asset (the upload helper adds size, mime and duration). */
export function importProvenance(m: ImportMeta) {
  const license = licenseFor(m.plan, m.confirmedPaid, m.certificate)
  const clean = (v?: string | null, max = 1000) => (v?.trim() ? v.trim().slice(0, max) : null)
  return {
    license,
    extra: {
      provider: 'topmediai',
      providerName: 'TopMediai (importado)',
      importedAt: new Date().toISOString(),
      importedFrom: 'topmediai-web',
      costTier: 'credits',
      cost: { amount: null, currency: null, reported: false },
      originalPrompt: clean(m.prompt),
      lyrics: clean(m.lyrics, 3000),
      generationModel: clean(m.model, 80),
      voice: clean(m.voice, 80),
      generatedOn: clean(m.generatedOn, 40),
      planAtGeneration: m.plan === 'paid' && m.confirmedPaid ? 'paid' : 'unconfirmed_or_free',
      licenseCertificate: clean(m.certificate, 300),
      contentIdWarning: m.kind === 'music' ? CONTENT_ID_NOTE : null,
    } as Record<string, unknown>,
  }
}

export function importProblems(files: Array<{ name: string; size: number; type: string }>) {
  const out: string[] = []
  if (!files.length) out.push('Elige al menos un archivo.')
  if (files.length > 20) out.push('Importa como máximo 20 archivos a la vez.')
  for (const f of files) if (!/^audio\//.test(f.type)) out.push(`«${f.name}» no es un archivo de audio (${f.type || 'tipo desconocido'}). Descarga el MP3 o WAV desde TopMediai.`)
  return out
}

export const steps = [
  'En TopMediai abre tus creaciones (música, voz o efectos) y descarga cada archivo en MP3 o WAV.',
  'Arrástralos aquí. Cerebro detecta el tipo y la duración; puedes corregirlos y pegar el prompt o la letra.',
  'Indica con qué plan los generaste. Solo con un plan de pago confirmado quedan como "con licencia"; si no, quedan como uso personal.',
]
