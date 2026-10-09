export type ShortStatus =
  | 'preparing' | 'discarded' | 'ready_for_approval' | 'approved' | 'rejected'
  | 'uploading' | 'uploaded_private' | 'upload_failed'

export type Trend = 'rising' | 'flat' | 'falling'

/** Datos de interés de un candidato. `observed` viene de la API de YouTube; `calculated` lo deriva Cerebro. */
export type InterestData = {
  similarViews: number[]
  nicheMedian: number
  trend: Trend | null
  fetchedAt?: string
}

export type Candidate = {
  opportunityId: string
  title: string
  topicKey: string
  interest: InterestData | null
}

export type ScoreBreakdown = {
  total: number
  interest: { points: number; basis: 'observed'; similarMedian: number; nicheMedian: number; ratio: number; samples: number }
  trend: { points: number; basis: 'observed'; value: Trend | null }
  fit: { points: number; basis: 'inferred'; rawScore: number | null }
  history: { points: number; basis: 'observed' | 'none'; category?: string; meanRetention?: number; samples?: number }
}

export type Source = {
  url: string
  domain: string
  title?: string
  /** Cita literal encontrada en la página descargada (comprobada por código, no por el modelo). */
  quote: string
  verified_at: string
}

export type Facts = { claim: string; key_datum: string; sources: Source[] }

export type Beat = { text: string; visual_prompt: string }

export type Script = {
  hook: string
  beats: Beat[]
  key_datum: string
  category: string
  title: string
  description: string
  tags: string[]
}

export type ManifestScene = {
  index: number
  text: string
  image_path: string
  start: number
  end: number
  captions: { text: string; start: number; end: number }[]
}

/** Composición 9:16 que el navegador renderiza. Los tiempos por escena son proporcionales a los caracteres (inferidos). */
export type Manifest = {
  width: 1080
  height: 1920
  fps: 30
  duration: number
  voice_path: string
  voice_duration: number
  scenes: ManifestScene[]
  hook: { text: string; key_datum: string; overlay_until: number }
  music: { kind: 'procedural'; seed: number; license: string }
  timing_basis: 'inferred_from_characters' | 'scene_cuts_snapped_to_voice_pauses'
}

export type GateResult = { name: string; pass: boolean; detail: string }

export type FactoryConfig = {
  channelName: string
  nicheDescription: string
  tone: string
  language: string
  categories: string[]
  nicheQuery: string
  minInterestRatio: number
  minSamples: number
  minFitScore: number
  maxTopicsTried: number
  maxHookWords: number
  hookSeconds: number
  minDuration: number
  maxDuration: number
  minRetentionSamples: number
  voiceName: string
  reliableDomains: string[]
}

export const DEFAULT_CONFIG: FactoryConfig = {
  channelName: 'Umbral del Hito',
  nicheDescription: 'Shorts de curiosidades: datos sorprendentes y verificables sobre ciencia, naturaleza, espacio, historia y cuerpo humano.',
  tone: 'cercano, claro, con intriga; sin clickbait falso ni exageraciones',
  language: 'es',
  categories: ['espacio', 'naturaleza', 'cuerpo humano', 'historia', 'ciencia', 'tecnología', 'mar', 'geografía'],
  nicheQuery: 'curiosidades datos sorprendentes shorts',
  minInterestRatio: 1,
  minSamples: 5,
  minFitScore: 6,
  maxTopicsTried: 3,
  maxHookWords: 7,
  hookSeconds: 2,
  minDuration: 18,
  maxDuration: 50,
  minRetentionSamples: 2,
  voiceName: 'Kore',
  reliableDomains: [
    'wikipedia.org', 'britannica.com', 'nasa.gov', 'esa.int', 'noaa.gov', 'nih.gov', 'who.int', 'cdc.gov',
    'nature.com', 'science.org', 'sciencedirect.com', 'smithsonianmag.com', 'nationalgeographic.com',
    'bbc.com', 'bbc.co.uk', 'nationalgeographic.es', 'rtve.es', 'csic.es', 'ign.es', 'usgs.gov', 'cern.ch',
    'scientificamerican.com', 'sciencenews.org', 'nhm.ac.uk', 'si.edu', 'loc.gov', 'unesco.org',
  ],
}
