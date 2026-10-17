import { COUNTRIES, LANGUAGES } from './discovery'

/** Plain-Spanish names for the codes the data carries, so no screen shows «research», «GB» or «en» to a person. */
const SOURCES: Record<string, string> = { research: 'Investigación', youtube: 'YouTube', radar: 'Radar de tendencias', manual: 'Manual', automation: 'Automatización', trends: 'Tendencias' }
export const sourceLabel = (p: string | null | undefined) => (p ? SOURCES[p] ?? p.charAt(0).toUpperCase() + p.slice(1) : '—')
export const regionLabel = (code: string | null | undefined) => (code ? COUNTRIES.find(c => c.code === code.toUpperCase())?.name ?? code : 'Mundial')
export const languageLabel = (code: string | null | undefined) => (code ? LANGUAGES.find(([c]) => c === code.slice(0, 2).toLowerCase())?.[1] ?? code : '—')
/** Plain names for the states an opportunity can have (the stored values are technical). */
const OPP_STATUS: Record<string, string> = { discovered: 'Descubierta', research_needed: 'Necesita investigación', candidate: 'Candidata', experiment_approved: 'Experimento aprobado', discarded: 'Descartada' }
export const statusLabel = (s: string | null | undefined) => (s ? OPP_STATUS[s] ?? s.replace(/_/g, ' ') : '—')
const CONFIDENCE: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja', 'muy baja': 'Muy baja' }
export const confidenceLabel = (c: string | null | undefined) => (c ? CONFIDENCE[c] ?? c : '—')
/** An index that may not be calculable: never an empty cell or the word «null». */
export const indexText = (n: number | null | undefined) => (n === null || n === undefined ? 'No calculable' : String(n))
