/**
 * Catalogue of generation models (the "what") on top of the provider directory (the "who",
 * lib/providers/directory.ts). Adding a provider = one directory entry + catalogue entries +
 * one adapter in lib/providers/adapters; the creation flow, cost confirmation, history and
 * library do not change.
 *
 * Every endpoint is documented by its provider (checked 2026-09-30 / 2026-10-01). Prices are
 * public list prices and are shown as ESTIMATES; `priceConfirmed: false` means the provider does
 * not publish a per-generation price for that exact model and the figure is a reference only.
 */
import type { CostTier } from './directory'

export type Modality = 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'ambient'
export type ProviderId = 'openai' | 'fal' | 'elevenlabs' | 'cloudflare' | 'gemini'
export type Format = '16:9' | '9:16' | '1:1'
export type Capability = 'text_in_image' | 'native_audio' | 'loop' | 'instrumental' | 'vocals' | 'voice_direction' | 'account_voices' | 'spanish' | 'negative_prompt' | 'variants'

export type CatalogModel = {
  id: string
  modality: Modality
  provider: ProviderId
  label: string
  /** One line: what it is good at. */
  strength: string
  /** How this generation is paid: free allowance, plan credits, freemium tier or pay per use. */
  tier: CostTier
  /** Public list price, human readable. Always an estimate. */
  price: string
  priceConfirmed: boolean
  /** Rough estimate in USD for one generation with the chosen options (0 = free allowance or plan credits). */
  estimateUsd: (o: GenerationOptions) => number
  /** 1 (basic) – 5 (best available). Editorial judgement, used only to rank options. */
  quality: 1 | 2 | 3 | 4 | 5
  speed: 'fast' | 'medium' | 'slow'
  limits?: string
  capabilities: Capability[]
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
  loop?: boolean
}

const n = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export const catalog: CatalogModel[] = [
  // ---------- Images ----------
  {
    id: 'cloudflare:@cf/black-forest-labs/flux-1-schnell', modality: 'image', provider: 'cloudflare', label: 'FLUX.1 schnell (Cloudflare)',
    strength: 'Gratis dentro del cupo diario; rápido, calidad correcta para bocetos y fondos.',
    tier: 'free', price: 'Gratis con 10.000 neuronas/día (≈ 4,8 neuronas por tesela 512² + 9,6 por paso)', priceConfirmed: true,
    estimateUsd: () => 0, quality: 2, speed: 'fast', limits: 'Máx. 8 pasos; salida cuadrada 1024².', capabilities: [],
    env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], sync: true, formats: ['1:1'],
  },
  {
    id: 'openai:gpt-image-1', modality: 'image', provider: 'openai', label: 'OpenAI GPT Image',
    strength: 'Realismo documental con los estilos del canal; sigue bien instrucciones largas.',
    tier: 'paid', price: '≈ $0.06 (media) · $0.25 (alta) por imagen horizontal', priceConfirmed: true,
    estimateUsd: o => (o.quality === 'high' ? 0.25 : 0.06), quality: 4, speed: 'medium', capabilities: ['text_in_image'],
    env: ['OPENAI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
  },
  {
    id: 'fal:fal-ai/flux-2-pro', modality: 'image', provider: 'fal', label: 'FLUX.2 Pro',
    strength: 'Fotorrealismo de estudio, rápido y barato.',
    tier: 'paid', price: '$0.03 por megapíxel (≈ $0.03–0.05)', priceConfirmed: true,
    estimateUsd: () => 0.045, quality: 4, speed: 'fast', capabilities: [],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
  },
  {
    id: 'fal:fal-ai/nano-banana-pro', modality: 'image', provider: 'fal', label: 'Nano Banana Pro (Gemini)',
    strength: 'Escenas complejas y texto legible dentro de la imagen.',
    tier: 'paid', price: '$0.15 por imagen', priceConfirmed: true,
    estimateUsd: o => 0.15 * n(o.variants, 1), quality: 5, speed: 'medium', capabilities: ['text_in_image', 'variants'],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16', '1:1'], maxVariants: 4,
  },
  {
    id: 'fal:fal-ai/ideogram/v3', modality: 'image', provider: 'fal', label: 'Ideogram 3',
    strength: 'Tipografía y diseño: miniaturas, carteles, títulos.',
    tier: 'paid', price: '$0.06 por imagen (calidad equilibrada)', priceConfirmed: true,
    estimateUsd: o => 0.06 * n(o.variants, 1), quality: 4, speed: 'fast', capabilities: ['text_in_image', 'negative_prompt', 'variants'],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16', '1:1'], maxVariants: 4, negative: true,
  },
  // ---------- Video ----------
  {
    id: 'gemini:veo-3.1-fast-generate-preview', modality: 'video', provider: 'gemini', label: 'Google Veo 3.1 Fast (API oficial)',
    strength: 'El modelo de Google Flow por su API oficial; vídeo con sonido nativo.',
    tier: 'paid', price: 'Referencia Vertex AI (Veo 3 Fast): $0.15/s con audio. Precio exacto de Veo 3.1 en Gemini API no publicado en la tabla consultada.', priceConfirmed: false,
    estimateUsd: o => n(o.durationSeconds, 8) * 0.15, quality: 5, speed: 'slow',
    limits: '4, 6 u 8 s; 720p por defecto. El resultado se borra de Google a los 2 días (Cerebro lo copia antes).', capabilities: ['native_audio'],
    env: ['GEMINI_API_KEY'], sync: false, formats: ['16:9', '9:16'], durations: [4, 6, 8],
  },
  {
    id: 'fal:fal-ai/kling-video/v2.5-turbo/pro/text-to-video', modality: 'video', provider: 'fal', label: 'Kling 2.5 Turbo Pro',
    strength: 'Movimiento natural y cámara cinematográfica.',
    tier: 'paid', price: '$0.35 por 5 s · $0.07 cada segundo extra', priceConfirmed: true,
    estimateUsd: o => 0.35 + Math.max(0, n(o.durationSeconds, 5) - 5) * 0.07, quality: 4, speed: 'medium', capabilities: ['negative_prompt'],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16', '1:1'], durations: [5, 10], negative: true,
  },
  {
    id: 'fal:fal-ai/veo3/fast', modality: 'video', provider: 'fal', label: 'Google Veo 3 Fast (vía fal)',
    strength: 'Vídeo con sonido generado; muy buena física y luz.',
    tier: 'paid', price: '$0.10/s sin audio · $0.15/s con audio', priceConfirmed: true,
    estimateUsd: o => n(o.durationSeconds, 8) * (o.audio === false ? 0.1 : 0.15), quality: 5, speed: 'slow', capabilities: ['native_audio', 'negative_prompt'],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16'], durations: [4, 6, 8], negative: true,
  },
  // ---------- Voice ----------
  {
    id: 'cloudflare:@cf/myshell-ai/melotts', modality: 'voice', provider: 'cloudflare', label: 'MeloTTS (Cloudflare)',
    strength: 'Voz gratuita dentro del cupo diario; sirve para borradores y pruebas de ritmo.',
    tier: 'free', price: 'Gratis con 10.000 neuronas/día (≈ 18,6 neuronas por minuto de audio)', priceConfirmed: true,
    estimateUsd: () => 0, quality: 2, speed: 'fast', capabilities: ['spanish'],
    env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], sync: true,
  },
  {
    id: 'gemini:gemini-3.8-flash-tts', modality: 'voice', provider: 'gemini', label: 'Gemini TTS',
    strength: '30 voces, más de 130 idiomas y estilo dirigible con texto. Nivel gratuito en la API.',
    tier: 'freemium', price: 'Nivel gratuito; de pago: $0.50/1M tokens de texto + $9/1M tokens de audio', priceConfirmed: true,
    estimateUsd: () => 0, quality: 4, speed: 'fast', capabilities: ['spanish', 'voice_direction'],
    env: ['GEMINI_API_KEY'], sync: true,
  },
  {
    id: 'elevenlabs:eleven_multilingual_v2', modality: 'voice', provider: 'elevenlabs', label: 'ElevenLabs Multilingual v2',
    strength: 'Narración natural en español con las voces de tu cuenta.',
    tier: 'credits', price: 'Consume caracteres de tu plan (coste real leído de la respuesta)', priceConfirmed: true,
    estimateUsd: () => 0, quality: 5, speed: 'fast', capabilities: ['spanish', 'account_voices'],
    env: ['ELEVENLABS_API_KEY'], sync: true,
  },
  {
    id: 'openai:gpt-4o-mini-tts', modality: 'voice', provider: 'openai', label: 'OpenAI TTS (dirigible)',
    strength: 'Voces con indicaciones de tono, ritmo y emoción.',
    tier: 'paid', price: '≈ $0.015 por minuto de audio', priceConfirmed: true,
    estimateUsd: () => 0.015, quality: 4, speed: 'fast', capabilities: ['spanish', 'voice_direction'],
    env: ['OPENAI_VOICE_API_KEY'], sync: true,
  },
  // ---------- Music ----------
  {
    id: 'elevenlabs:music_v1', modality: 'music', provider: 'elevenlabs', label: 'ElevenLabs Music',
    strength: 'Música completa con estructura; instrumental o con voz.',
    tier: 'credits', price: 'Consume créditos de tu plan de ElevenLabs', priceConfirmed: true,
    estimateUsd: () => 0, quality: 5, speed: 'medium', capabilities: ['instrumental', 'vocals'],
    env: ['ELEVENLABS_API_KEY'], sync: true, durations: [15, 30, 60, 120],
  },
  {
    id: 'fal:fal-ai/lyria2', modality: 'music', provider: 'fal', label: 'Google Lyria 2 (vía fal)',
    strength: 'Instrumentales de alta calidad para fondos.',
    tier: 'paid', price: '$0.10 por cada 30 s', priceConfirmed: true,
    estimateUsd: () => 0.1, quality: 4, speed: 'medium', capabilities: ['instrumental', 'negative_prompt'],
    env: ['FAL_KEY'], sync: false, negative: true,
  },
  // ---------- Sound effects & ambiences ----------
  {
    id: 'elevenlabs:sound-generation', modality: 'sfx', provider: 'elevenlabs', label: 'ElevenLabs Efectos',
    strength: 'Efectos a partir de una descripción (hasta 30 s).',
    tier: 'credits', price: 'Consume créditos de tu plan (coste real leído de la respuesta)', priceConfirmed: true,
    estimateUsd: () => 0, quality: 5, speed: 'fast', capabilities: [],
    env: ['ELEVENLABS_API_KEY'], sync: true, durations: [2, 5, 10, 30],
  },
  {
    id: 'elevenlabs:sound-generation-loop', modality: 'ambient', provider: 'elevenlabs', label: 'ElevenLabs Ambientes en bucle',
    strength: 'Ambientes que se repiten sin corte (lluvia, selva, ciudad, cabina…).',
    tier: 'credits', price: 'Consume créditos de tu plan (coste real leído de la respuesta)', priceConfirmed: true,
    estimateUsd: () => 0, quality: 5, speed: 'fast', capabilities: ['loop'],
    env: ['ELEVENLABS_API_KEY'], sync: true, durations: [10, 20, 30],
  },
]

export const modalityLabels: Record<Modality, string> = {
  image: 'Imagen', video: 'Vídeo', voice: 'Voz', music: 'Música', sfx: 'Efectos', ambient: 'Ambientes',
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
  image: 'image', video: 'video', voice: 'voice', music: 'music', sfx: 'sfx', ambient: 'sfx',
}
