/**
 * Catalogue of generation models available to the Creation Studio.
 *
 * Every entry is a real, documented endpoint (checked against the provider docs on 2026-09-30).
 * Prices are the providers' public list prices at that date and are shown as ESTIMATES: the
 * provider's invoice is the only source of truth. A model is usable only when its server
 * environment variables are configured; nothing here calls a provider.
 */

export type Modality = 'image' | 'video' | 'voice' | 'music' | 'sfx'
export type ProviderId = 'openai' | 'fal' | 'elevenlabs'
export type Format = '16:9' | '9:16' | '1:1'

export type CatalogModel = {
  id: string
  modality: Modality
  provider: ProviderId
  label: string
  /** One line: what it is good at. */
  strength: string
  /** Public list price, human readable. Always an estimate. */
  price: string
  /** Rough estimate in USD for one generation with default options (used for the confirm button). */
  estimateUsd: (o: GenerationOptions) => number
  /** Server env vars that must all be set. */
  env: string[]
  /** true = the provider answers in one request; false = queued job that is polled. */
  sync: boolean
  formats?: Format[]
  durations?: number[]
  maxVariants?: number
  /** Accepts a negative prompt. */
  negative?: boolean
}

export type GenerationOptions = {
  format?: Format
  durationSeconds?: number
  variants?: number
  quality?: 'medium' | 'high'
  audio?: boolean
  instrumental?: boolean
}

const n = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export const catalog: CatalogModel[] = [
  // ---------- Images ----------
  {
    id: 'openai:gpt-image-1', modality: 'image', provider: 'openai', label: 'OpenAI GPT Image',
    strength: 'Realismo documental con los estilos del canal; sigue bien instrucciones largas.',
    price: '≈ $0.06 (media) · $0.25 (alta) por imagen horizontal', env: ['OPENAI_API_KEY'], sync: true,
    formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
    estimateUsd: o => (o.quality === 'high' ? 0.25 : 0.06),
  },
  {
    id: 'fal:fal-ai/flux-2-pro', modality: 'image', provider: 'fal', label: 'FLUX.2 Pro',
    strength: 'Fotorrealismo de estudio, rápido y barato.',
    price: '$0.03 por megapíxel (≈ $0.03–0.05)', env: ['FAL_KEY'], sync: false,
    formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
    estimateUsd: () => 0.045,
  },
  {
    id: 'fal:fal-ai/nano-banana-pro', modality: 'image', provider: 'fal', label: 'Nano Banana Pro (Gemini)',
    strength: 'Escenas complejas y texto legible dentro de la imagen.',
    price: '$0.15 por imagen', env: ['FAL_KEY'], sync: false,
    formats: ['16:9', '9:16', '1:1'], maxVariants: 4,
    estimateUsd: o => 0.15 * n(o.variants, 1),
  },
  {
    id: 'fal:fal-ai/ideogram/v3', modality: 'image', provider: 'fal', label: 'Ideogram 3',
    strength: 'Tipografía y diseño: miniaturas, carteles, títulos.',
    price: '$0.06 por imagen (calidad equilibrada)', env: ['FAL_KEY'], sync: false,
    formats: ['16:9', '9:16', '1:1'], maxVariants: 4, negative: true,
    estimateUsd: o => 0.06 * n(o.variants, 1),
  },
  // ---------- Video ----------
  {
    id: 'fal:fal-ai/kling-video/v2.5-turbo/pro/text-to-video', modality: 'video', provider: 'fal', label: 'Kling 2.5 Turbo Pro',
    strength: 'Movimiento natural y cámara cinematográfica.',
    price: '$0.35 por 5 s · $0.07 cada segundo extra', env: ['FAL_KEY'], sync: false,
    formats: ['16:9', '9:16', '1:1'], durations: [5, 10], negative: true,
    estimateUsd: o => 0.35 + Math.max(0, n(o.durationSeconds, 5) - 5) * 0.07,
  },
  {
    id: 'fal:fal-ai/veo3/fast', modality: 'video', provider: 'fal', label: 'Google Veo 3 Fast',
    strength: 'Vídeo con sonido generado; muy buena física y luz.',
    price: '$0.10/s sin audio · $0.15/s con audio', env: ['FAL_KEY'], sync: false,
    formats: ['16:9', '9:16'], durations: [4, 6, 8], negative: true,
    estimateUsd: o => n(o.durationSeconds, 8) * (o.audio === false ? 0.1 : 0.15),
  },
  // ---------- Voice ----------
  {
    id: 'elevenlabs:eleven_multilingual_v2', modality: 'voice', provider: 'elevenlabs', label: 'ElevenLabs Multilingual v2',
    strength: 'Narración natural en español con las voces de tu cuenta.',
    price: 'Consume caracteres de tu plan de ElevenLabs', env: ['ELEVENLABS_API_KEY'], sync: true,
    estimateUsd: () => 0,
  },
  {
    id: 'openai:gpt-4o-mini-tts', modality: 'voice', provider: 'openai', label: 'OpenAI TTS (dirigible)',
    strength: 'Voces con indicaciones de tono, ritmo y emoción.',
    price: '≈ $0.015 por minuto de audio', env: ['OPENAI_VOICE_API_KEY'], sync: true,
    estimateUsd: () => 0.015,
  },
  // ---------- Music ----------
  {
    id: 'elevenlabs:music_v1', modality: 'music', provider: 'elevenlabs', label: 'ElevenLabs Music',
    strength: 'Música completa con estructura; instrumental o con voz.',
    price: 'Consume créditos de tu plan de ElevenLabs', env: ['ELEVENLABS_API_KEY'], sync: true,
    durations: [15, 30, 60, 120],
    estimateUsd: () => 0,
  },
  {
    id: 'fal:fal-ai/lyria2', modality: 'music', provider: 'fal', label: 'Google Lyria 2',
    strength: 'Instrumentales de alta calidad para fondos.',
    price: '$0.10 por cada 30 s', env: ['FAL_KEY'], sync: false, negative: true,
    estimateUsd: () => 0.1,
  },
  // ---------- Sound effects ----------
  {
    id: 'elevenlabs:sound-generation', modality: 'sfx', provider: 'elevenlabs', label: 'ElevenLabs Efectos',
    strength: 'Efectos y ambientes a partir de una descripción (hasta 22 s).',
    price: 'Consume créditos de tu plan de ElevenLabs', env: ['ELEVENLABS_API_KEY'], sync: true,
    durations: [2, 5, 10, 22],
    estimateUsd: () => 0,
  },
]

export const modalityLabels: Record<Modality, string> = {
  image: 'Imagen', video: 'Vídeo', voice: 'Voz', music: 'Música', sfx: 'Efectos',
}

/** Voices of OpenAI's speech API (documented set). */
export const openAiVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const

export function modelById(id: string) {
  return catalog.find(m => m.id === id)
}

export function isConfigured(model: CatalogModel, env: Record<string, string | undefined>) {
  return model.env.every(name => Boolean(env[name]?.trim()))
}

/** fal endpoint id from a catalogue id ("fal:fal-ai/veo3/fast" → "fal-ai/veo3/fast"). */
export function falEndpoint(model: CatalogModel) {
  if (model.provider !== 'fal') throw new Error('Not a fal model.')
  return model.id.slice('fal:'.length)
}

const falImageSize: Record<Format, string> = { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd' }

/**
 * Request body for a fal model. Only fields documented for that endpoint are sent,
 * and every value is clamped to the documented options.
 */
export function falInput(model: CatalogModel, prompt: string, o: GenerationOptions, negativePrompt?: string): Record<string, unknown> {
  const format: Format = o.format && model.formats?.includes(o.format) ? o.format : (model.formats?.[0] ?? '16:9')
  const variants = Math.min(Math.max(Math.round(n(o.variants, 1)), 1), model.maxVariants ?? 1)
  const duration = model.durations?.includes(n(o.durationSeconds, NaN)) ? o.durationSeconds! : model.durations?.[0]
  const neg = model.negative && negativePrompt?.trim() ? { negative_prompt: negativePrompt.trim().slice(0, 1000) } : {}
  switch (falEndpoint(model)) {
    case 'fal-ai/flux-2-pro':
      return { prompt, image_size: falImageSize[format], output_format: 'png', enable_safety_checker: true }
    case 'fal-ai/nano-banana-pro':
      return { prompt, aspect_ratio: format, num_images: variants, output_format: 'png', resolution: '1K' }
    case 'fal-ai/ideogram/v3':
      return { prompt, image_size: falImageSize[format], num_images: variants, rendering_speed: 'BALANCED', expand_prompt: false, ...neg }
    case 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video':
      return { prompt, duration: String(duration ?? 5), aspect_ratio: format, ...neg }
    case 'fal-ai/veo3/fast':
      return { prompt, duration: `${duration ?? 8}s`, aspect_ratio: format === '9:16' ? '9:16' : '16:9', resolution: '720p', generate_audio: o.audio !== false, ...neg }
    case 'fal-ai/lyria2':
      return { prompt, ...neg }
    default:
      throw new Error(`No input mapping for ${model.id}.`)
  }
}

export type FalMedia = { url: string; contentType: string }

/** Extracts media URLs from a fal result, whatever the modality. */
export function falOutputs(result: unknown, modality: Modality): FalMedia[] {
  if (!result || typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  const one = (f: unknown, fallback: string): FalMedia | null => {
    if (!f || typeof f !== 'object') return null
    const file = f as Record<string, unknown>
    return typeof file.url === 'string' && file.url.startsWith('https://')
      ? { url: file.url, contentType: typeof file.content_type === 'string' ? file.content_type : fallback }
      : null
  }
  if (modality === 'image') return (Array.isArray(r.images) ? r.images : []).map(i => one(i, 'image/png')).filter((x): x is FalMedia => Boolean(x))
  if (modality === 'video') return [one(r.video, 'video/mp4')].filter((x): x is FalMedia => Boolean(x))
  return [one(r.audio, 'audio/wav') ?? one(r.audio_file, 'audio/wav')].filter((x): x is FalMedia => Boolean(x))
}

/** Asset type stored in public.assets for each modality. */
export const assetKindFor: Record<Modality, 'image' | 'video' | 'voice' | 'music' | 'sfx'> = {
  image: 'image', video: 'video', voice: 'voice', music: 'music', sfx: 'sfx',
}
