/**
 * "Fábrica de Shorts de curiosidades" (canal Umbral del Hito). Rules approved by the owner:
 *  - topic: proven interest (Radar data), a fact backed by ≥ 2 reliable sources, fit with the channel and with what worked; never repeated
 *  - before approval: hook and main fact inside the first 2 s, sources visible on the approval screen
 *  - main metric: average view percentage at 7 days (YouTube Analytics), stored as observed data
 *  - spend: free only. If free options do not reach the minimum quality the Short is not created that day
 *  - flow: 1 Short a day prepared on the server, MP4 rendered in the browser, every Short approved by the owner (mode A),
 *    uploaded as private with synthetic content declared. Nothing is published without that approval.
 */
export const THEMES = ['espacio', 'ciencia', 'naturaleza', 'cuerpo humano', 'historia', 'tecnología', 'cultura', 'otros'] as const
export type Theme = (typeof THEMES)[number]

export type ShortsConfig = {
  channelName: string
  region: string
  /** Words that describe what the channel is about; used for the "fit with the channel" score. */
  channelKeywords: string[]
  /** A candidate must reach this multiple of the niche median views (proven interest). */
  minRatioToMedian: number
  /** Videos needed in the pool before a median means anything. */
  minPoolSize: number
  /** Minimum quality (1–5) of the free image, voice and text models. Below it the Short is not created. */
  minImageQuality: number
  minVoiceQuality: number
  minTextQuality: number
  scenes: { min: number; max: number }
  /** Hard cap on Gemini text calls per day (the free tier has a small daily allowance). */
  maxTextCalls: number
  /** Candidates tried per day before giving up. */
  maxCandidatesPerDay: number
  extraReliableDomains: string[]
  musicQuery: string
  voice: string
  voiceStyle: string
}

export const defaultShortsConfig: ShortsConfig = {
  channelName: 'Umbral del Hito',
  region: 'ES',
  channelKeywords: ['curiosidades', 'sabias', 'ciencia', 'universo', 'historia', 'planeta', 'cuerpo', 'animales', 'tecnologia', 'misterio', 'descubrimiento', 'por que'],
  minRatioToMedian: 1.5,
  minPoolSize: 5,
  minImageQuality: 3,
  minVoiceQuality: 4,
  minTextQuality: 4,
  scenes: { min: 4, max: 7 },
  maxTextCalls: 6,
  maxCandidatesPerDay: 3,
  extraReliableDomains: [],
  musicQuery: 'ambient cinematic background',
  voice: 'Charon',
  voiceStyle: 'Español latino neutro, voz masculina grave, ritmo ágil y claro.',
}

const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}
const strings = (v: unknown, max: number, len = 60) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(s => s.trim().slice(0, len)).filter(Boolean).slice(0, max) : null)

/** Reads whatever is stored in automations.config into a safe configuration. */
export function shortsConfig(raw: Record<string, unknown> = {}): ShortsConfig {
  const d = defaultShortsConfig
  const domains = (strings(raw.extraReliableDomains, 30, 80) ?? []).map(x => x.toLowerCase()).filter(x => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x))
  const min = Math.round(clampNum((raw.scenes as { min?: number } | undefined)?.min, 3, 8, d.scenes.min))
  return {
    channelName: typeof raw.channelName === 'string' && raw.channelName.trim() ? raw.channelName.trim().slice(0, 80) : d.channelName,
    region: typeof raw.region === 'string' && /^[A-Z]{2}$/.test(raw.region) ? raw.region : d.region,
    channelKeywords: strings(raw.channelKeywords, 30)?.length ? strings(raw.channelKeywords, 30)! : d.channelKeywords,
    minRatioToMedian: clampNum(raw.minRatioToMedian, 1, 20, d.minRatioToMedian),
    minPoolSize: Math.round(clampNum(raw.minPoolSize, 3, 200, d.minPoolSize)),
    minImageQuality: Math.round(clampNum(raw.minImageQuality, 1, 5, d.minImageQuality)),
    minVoiceQuality: Math.round(clampNum(raw.minVoiceQuality, 1, 5, d.minVoiceQuality)),
    minTextQuality: Math.round(clampNum(raw.minTextQuality, 1, 5, d.minTextQuality)),
    scenes: { min, max: Math.max(min, Math.round(clampNum((raw.scenes as { max?: number } | undefined)?.max, 3, 8, d.scenes.max))) },
    maxTextCalls: Math.round(clampNum(raw.maxTextCalls, 2, 12, d.maxTextCalls)),
    maxCandidatesPerDay: Math.round(clampNum(raw.maxCandidatesPerDay, 1, 5, d.maxCandidatesPerDay)),
    extraReliableDomains: domains,
    musicQuery: typeof raw.musicQuery === 'string' && raw.musicQuery.trim() ? raw.musicQuery.trim().slice(0, 80) : d.musicQuery,
    voice: typeof raw.voice === 'string' && /^[A-Za-z]{3,20}$/.test(raw.voice) ? raw.voice : d.voice,
    voiceStyle: typeof raw.voiceStyle === 'string' && raw.voiceStyle.trim() ? raw.voiceStyle.trim().slice(0, 300) : d.voiceStyle,
  }
}
