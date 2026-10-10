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
export type ProviderId = 'openai' | 'fal' | 'elevenlabs' | 'cloudflare' | 'gemini' | 'higgsfield' | 'alibaba' | 'topmediai'
export type Format = '16:9' | '9:16' | '1:1'
export type Capability = 'text_in_image' | 'native_audio' | 'loop' | 'instrumental' | 'vocals' | 'voice_direction' | 'account_voices' | 'spanish' | 'negative_prompt' | 'variants' | 'reference_images' | 'photoreal'

/**
 * How much we actually know about a model. Nothing is presented as working unless it was exercised:
 *  - tested: a real request to the provider confirmed the behaviour stated (see evidenceNote and date).
 *  - documented: the provider's own documentation says so; we did not call it with a real key.
 *  - secondary: only third-party sources (blogs, resellers) say so; treat as a lead, not a fact.
 *  - unverified: implemented from documentation fragments; the exact response shape is not confirmed.
 * Automatic strategies never pick `unverified` models; they must be chosen by hand.
 */
export type Evidence = 'tested' | 'documented' | 'secondary' | 'unverified'

/** Commercial-use position of the OUTPUT, as published by the provider. Always re-check the plan and terms. */
export type Rights = 'commercial' | 'plan_dependent' | 'non_commercial' | 'check_terms'

/**
 * Free allowance of a pool shared by every model of a provider account.
 * daily/monthly renew by themselves; promo is a one-off grant that expires (validDays after activation).
 */
export type AllowanceKind = 'daily' | 'monthly' | 'promo'
export type AllowanceUnit = 'neurons' | 'seconds' | 'characters' | 'usd'
export type Allowance = { pool: string; kind: AllowanceKind; amount: number; unit: AllowanceUnit; validDays?: number; note: string }

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
  /** Spends account credits with an unpublished per-model price: always needs an explicit confirmation. */
  confirm?: boolean
  /** What we know about this model and how (default: documented). */
  evidence?: Evidence
  evidenceNote?: string
  /** Free allowance this model draws from (pool shared across the provider's models). */
  allowance?: Allowance
  /** Units of that allowance one generation uses (e.g. neurons); 0/undefined when it does not apply. */
  allowanceUnits?: (o: GenerationOptions) => number
  rights?: Rights
  rightsNote?: string
  /** Largest output, e.g. "1920×1920", "720p", "1080p". */
  maxResolution?: string
  /** Shortest side in pixels of the largest output; used to filter by resolution. */
  maxShortSidePx?: number
  /** Reference images accepted by the model (identity / style references). */
  references?: { max: number; note?: string }
}

export type GenerationOptions = {
  format?: Format
  durationSeconds?: number
  variants?: number
  quality?: 'medium' | 'high'
  audio?: boolean
  instrumental?: boolean
  loop?: boolean
  /** Number of reference images attached (changes the cost of some models). */
  references?: number
}

const n = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Output size used for each format by models that take explicit width/height (multiples of 16, within 256–1920). */
export const imageDimensions: Record<Format, { width: number; height: number }> = {
  '16:9': { width: 1344, height: 768 }, '9:16': { width: 768, height: 1344 }, '1:1': { width: 1024, height: 1024 },
}
const dims = (o: GenerationOptions) => imageDimensions[o.format ?? '16:9']
/** Workers AI bills images per 512×512 tile; an area-based count is an ESTIMATE of that. */
const tiles = (o: GenerationOptions) => Math.ceil((dims(o).width * dims(o).height) / (512 * 512))
const megapixels = (o: GenerationOptions) => Math.ceil((dims(o).width * dims(o).height) / 1e6)

export const POOLS = {
  cloudflare: { pool: 'cloudflare-neurons', kind: 'daily', amount: 10_000, unit: 'neurons', note: '10.000 neuronas gratis al día; se renuevan a las 00:00 UTC.' } satisfies Allowance,
  alibabaWan: { pool: 'alibaba-wan-promo', kind: 'promo', amount: 50, unit: 'seconds', validDays: 90, note: 'Cuota de bienvenida de Alibaba Cloud Model Studio (Singapur): 30–50 s de vídeo Wan durante 90 días desde la activación. No se renueva y, con una cuenta verificada, pasa a cobrar por uso al agotarse.' } satisfies Allowance,
  topmediaiTts: { pool: 'topmediai-tts-chars', kind: 'promo', amount: 5_000, unit: 'characters', note: 'La API de voz de TopMediai indica 5.000 caracteres gratuitos; no está documentado si se renuevan.' } satisfies Allowance,
} as const

export const catalog: CatalogModel[] = [
  // ---------- Images ----------
  {
    id: 'cloudflare:@cf/black-forest-labs/flux-1-schnell', modality: 'image', provider: 'cloudflare', label: 'FLUX.1 schnell (Cloudflare)',
    strength: 'Gratis dentro del cupo diario; rápido, calidad correcta para bocetos y fondos.',
    tier: 'free', price: 'Gratis con 10.000 neuronas/día (≈ 4,8 neuronas por tesela 512² + 9,6 por paso)', priceConfirmed: true,
    estimateUsd: () => 0, quality: 2, speed: 'fast', limits: 'Máx. 8 pasos; salida cuadrada 1024².', capabilities: [],
    env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], sync: true, formats: ['1:1'],
    evidence: 'documented', evidenceNote: 'Adaptador existente según la documentación de Cloudflare; no probado con credenciales en esta sesión.',
    allowance: POOLS.cloudflare, allowanceUnits: () => Math.round((4 * 4.8 + 8 * 9.6) * 100) / 100,
    rights: 'check_terms', rightsNote: 'FLUX.1 [schnell] se publica bajo Apache 2.0 según Black Forest Labs; confírmalo en su ficha.', maxResolution: '1024×1024', maxShortSidePx: 1024,
  },
  {
    id: 'openai:gpt-image-1', modality: 'image', provider: 'openai', label: 'OpenAI GPT Image',
    strength: 'Realismo documental con los estilos del canal. Según terceros se retira el 23-oct-2026: usa GPT Image 2 / 1.5.',
    tier: 'paid', price: '≈ $0.06 (media) · $0.25 (alta) por imagen horizontal', priceConfirmed: true,
    estimateUsd: o => (o.quality === 'high' ? 0.25 : 0.06), quality: 4, speed: 'medium', capabilities: ['text_in_image', 'reference_images'],
    env: ['OPENAI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
    evidence: 'documented', rights: 'commercial', maxResolution: '1536×1024', maxShortSidePx: 1024, references: { max: 10, note: 'images/edits' },
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
  // --- Gratis (Cloudflare Workers AI, dentro de las 10.000 neuronas diarias) ---
  {
    id: 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b', modality: 'image', provider: 'cloudflare', label: 'FLUX.2 klein 4B (Cloudflare) · modo gratis',
    strength: 'La mejor imagen sin coste: FLUX.2 en 4 pasos, más realista que FLUX.1 schnell, con hasta 4 imágenes de referencia para mantener un personaje.',
    tier: 'free', price: 'Gratis dentro de 10.000 neuronas/día: ≈ 26 neuronas por tesela 512² de salida y ≈ 5 por referencia (≈ 100 imágenes/día a 1344×768).', priceConfirmed: true,
    estimateUsd: () => 0, quality: 3, speed: 'fast', capabilities: ['reference_images', 'photoreal'],
    limits: 'Lado entre 256 y 1920 px; 4 pasos fijos; referencias de hasta 512×512 (Cerebro las reduce). Sin prompt negativo.',
    env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], sync: true, formats: ['16:9', '9:16', '1:1'],
    evidence: 'documented', evidenceNote: 'Ficha y precios en developers.cloudflare.com (consultados 2026-10-10). No se pudo llamar sin credenciales de Cloudflare.',
    allowance: POOLS.cloudflare, allowanceUnits: o => Math.round((tiles(o) * 26.05 + n(o.references, 0) * 5.37) * 100) / 100,
    rights: 'check_terms', rightsNote: 'Licencia del modelo FLUX.2 [klein] de Black Forest Labs; revisa si tu uso comercial la cumple.',
    maxResolution: '1920×1920', maxShortSidePx: 1920, references: { max: 4, note: 'input_image_0…3, ≤ 512×512' },
  },
  {
    id: 'cloudflare:@cf/black-forest-labs/flux-2-klein-9b', modality: 'image', provider: 'cloudflare', label: 'FLUX.2 klein 9B (Cloudflare) · gratis, más calidad',
    strength: 'Más detalle y fidelidad que la 4B, a cambio de gastar el cupo diario más rápido (unas 7 imágenes al día).',
    tier: 'free', price: '≈ $0,015 por megapíxel en la tarifa de Cloudflare (≈ 1.360 neuronas): unas 7 imágenes/día dentro del cupo gratuito.', priceConfirmed: false,
    estimateUsd: () => 0, quality: 4, speed: 'medium', capabilities: ['reference_images', 'photoreal'],
    limits: 'Puede requerir el plan Workers Paid: Cloudflare limita en Free algunos modelos pesados (error 403/5035).',
    env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], sync: true, formats: ['16:9', '9:16', '1:1'],
    evidence: 'unverified', evidenceNote: 'El precio por megapíxel sale de la tabla de Cloudflare; la conversión a neuronas y el esquema de entrada se deducen de la ficha de la 4B. Sin llamada real: solo se usa si la eliges a mano.',
    allowance: POOLS.cloudflare, allowanceUnits: o => Math.round(megapixels(o) * 1363.64),
    rights: 'check_terms', rightsNote: 'Licencia de FLUX.2 [klein] 9B de Black Forest Labs; revisa los términos.',
    maxResolution: '1920×1920', maxShortSidePx: 1920, references: { max: 4, note: 'mismo esquema que la 4B (sin confirmar)' },
  },
  // --- Máxima calidad (de pago): Gemini / Nano Banana ---
  {
    id: 'gemini:gemini-3-pro-image', modality: 'image', provider: 'gemini', label: 'Nano Banana Pro (Gemini API) · máxima calidad',
    strength: 'Escenas complejas, texto legible y hasta 14 imágenes de referencia para personajes y objetos coherentes.',
    tier: 'paid', price: 'De pago: sin nivel gratuito en la API (comprobado: 429 con clave gratuita, 2026-10-10). Referencia ≈ $0,13–0,15 por imagen.', priceConfirmed: false,
    estimateUsd: () => 0.15, quality: 5, speed: 'medium', capabilities: ['text_in_image', 'reference_images', 'photoreal'],
    limits: 'Exige facturación activa en Google AI Studio / Cloud. Marca SynthID.',
    env: ['GEMINI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'],
    evidence: 'documented', evidenceNote: 'Modelo listado en tu clave y rechazado sin facturación (429) el 2026-10-10; el formato de respuesta es el de la documentación de generateContent y no se pudo ejecutar con éxito.',
    rights: 'commercial', rightsNote: 'Condiciones de la API de Gemini: el contenido generado es tuyo; revisa SynthID y políticas de uso.',
    maxResolution: '4K', maxShortSidePx: 2160, references: { max: 14, note: 'según la documentación de Google' },
  },
  {
    id: 'gemini:gemini-3.1-flash-image', modality: 'image', provider: 'gemini', label: 'Nano Banana 2 (Gemini API)',
    strength: 'Casi la calidad de Pro más rápido y más barato; buenas referencias de personaje.',
    tier: 'paid', price: 'De pago: sin nivel gratuito en la API (comprobado 2026-10-10). Precio exacto no confirmado; referencia ≈ $0,07.', priceConfirmed: false,
    estimateUsd: () => 0.07, quality: 4, speed: 'fast', capabilities: ['text_in_image', 'reference_images', 'photoreal'],
    env: ['GEMINI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'],
    evidence: 'documented', evidenceNote: 'Igual que Pro: existe en tu clave, exige facturación (429 sin ella).',
    rights: 'commercial', rightsNote: 'Condiciones de la API de Gemini.', maxResolution: '2K', maxShortSidePx: 2048, references: { max: 3, note: 'cifra prudente; Google admite más según el modelo' },
  },
  {
    id: 'gemini:gemini-3.1-flash-lite-image', modality: 'image', provider: 'gemini', label: 'Nano Banana 2 Lite (Gemini API)',
    strength: 'La opción de Google más barata para borradores y variaciones.',
    tier: 'paid', price: 'De pago: sin nivel gratuito en la API (comprobado 2026-10-10). Precio exacto no confirmado; referencia ≈ $0,04.', priceConfirmed: false,
    estimateUsd: () => 0.04, quality: 3, speed: 'fast', capabilities: ['reference_images', 'photoreal'],
    env: ['GEMINI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'],
    evidence: 'documented', evidenceNote: 'Igual que Pro: existe en tu clave, exige facturación (429 sin ella).',
    rights: 'commercial', rightsNote: 'Condiciones de la API de Gemini.', maxResolution: '1K', maxShortSidePx: 1024, references: { max: 3, note: 'cifra prudente' },
  },
  // --- Máxima calidad (de pago): OpenAI ---
  {
    id: 'openai:gpt-image-2', modality: 'image', provider: 'openai', label: 'OpenAI GPT Image 2 · máxima calidad',
    strength: 'El generador de imágenes de ChatGPT por API: líder en realismo y en seguir instrucciones largas; edición con varias referencias.',
    tier: 'paid', price: 'De pago. Precio no confirmado en la documentación oficial; referencia ≈ $0,05 (media) · $0,20 (alta) por imagen.', priceConfirmed: false,
    estimateUsd: o => (o.quality === 'high' ? 0.2 : 0.05), quality: 5, speed: 'medium', capabilities: ['text_in_image', 'reference_images', 'photoreal'],
    env: ['OPENAI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
    evidence: 'secondary', evidenceNote: 'El identificador gpt-image-2 y su precio aparecen solo en fuentes de terceros (2026-10-10). Si OpenAI lo rechaza, la llamada falla sin coste.',
    rights: 'commercial', rightsNote: 'OpenAI: el contenido generado pertenece al usuario según sus condiciones.', maxResolution: '1536×1024', maxShortSidePx: 1024,
    references: { max: 10, note: 'images/edits con varias imágenes' },
  },
  {
    id: 'openai:gpt-image-1.5', modality: 'image', provider: 'openai', label: 'OpenAI GPT Image 1.5',
    strength: 'Generación anterior de ChatGPT Images: muy buena, más barata que la 2.',
    tier: 'paid', price: 'De pago: ≈ $0,05 (media) · $0,20 (alta) por imagen horizontal/vertical según guías de terceros.', priceConfirmed: false,
    estimateUsd: o => (o.quality === 'high' ? 0.2 : 0.05), quality: 4, speed: 'medium', capabilities: ['text_in_image', 'reference_images', 'photoreal'],
    env: ['OPENAI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
    evidence: 'secondary', evidenceNote: 'Precios y existencia confirmados solo por terceros.', rights: 'commercial', maxResolution: '1536×1024', maxShortSidePx: 1024,
    references: { max: 10, note: 'images/edits con varias imágenes' },
  },
  {
    id: 'openai:gpt-image-1-mini', modality: 'image', provider: 'openai', label: 'OpenAI GPT Image 1 mini · barato',
    strength: 'Imagen de pago al menor coste de OpenAI; para borradores y volumen.',
    tier: 'paid', price: 'De pago: desde ≈ $0,005 hasta ≈ $0,05 por imagen según calidad y tamaño (terceros).', priceConfirmed: false,
    estimateUsd: o => (o.quality === 'high' ? 0.05 : 0.015), quality: 3, speed: 'fast', capabilities: ['text_in_image', 'reference_images'],
    env: ['OPENAI_API_KEY'], sync: true, formats: ['16:9', '9:16', '1:1'], maxVariants: 1,
    evidence: 'secondary', evidenceNote: 'Precios de terceros.', rights: 'commercial', maxResolution: '1536×1024', maxShortSidePx: 1024, references: { max: 10 },
  },
  // ---------- Video ----------
  {
    id: 'gemini:veo-3.1-fast-generate-preview', modality: 'video', provider: 'gemini', label: 'Google Veo 3.1 Fast (API oficial)',
    strength: 'El modelo de Google Flow por su API oficial; vídeo con sonido nativo.',
    tier: 'paid', price: 'Referencia Vertex AI (Veo 3 Fast): $0.15/s con audio. Precio exacto de Veo 3.1 en Gemini API no publicado en la tabla consultada.', priceConfirmed: false,
    estimateUsd: o => n(o.durationSeconds, 8) * 0.15, quality: 5, speed: 'slow',
    limits: '4, 6 u 8 s; 720p por defecto. El resultado se borra de Google a los 2 días (Cerebro lo copia antes).', capabilities: ['native_audio'],
    env: ['GEMINI_API_KEY'], sync: false, formats: ['16:9', '9:16'], durations: [4, 6, 8],
    evidence: 'documented', evidenceNote: 'Sin nivel gratuito: la API respondió 429 con la clave gratuita el 2026-10-10 (Veo 3.1 Lite). El tipo de durationSeconds debe ser numérico (corregido).',
    rights: 'commercial', rightsNote: 'Condiciones de la API de Gemini; vídeo con marca SynthID.', maxResolution: '720p', maxShortSidePx: 720,
  },
  {
    id: 'gemini:veo-3.1-lite-generate-preview', modality: 'video', provider: 'gemini', label: 'Google Veo 3.1 Lite (API oficial) · el Veo más barato',
    strength: 'El Veo más económico por la API oficial; vídeo con sonido nativo para pruebas y volumen.',
    tier: 'paid', price: 'De pago. Terceros indican ≈ $0,05/s a 720p; Google no lo confirma en la fuente consultada.', priceConfirmed: false,
    estimateUsd: o => n(o.durationSeconds, 8) * 0.05, quality: 4, speed: 'slow',
    limits: '4, 6 u 8 s. El resultado se borra de Google a los 2 días (Cerebro lo copia antes).', capabilities: ['native_audio'],
    env: ['GEMINI_API_KEY'], sync: false, formats: ['16:9', '9:16'], durations: [4, 6, 8],
    evidence: 'documented', evidenceNote: 'Listado en tu clave (predictLongRunning). Sin nivel gratuito: 429 el 2026-10-10.',
    rights: 'commercial', rightsNote: 'Condiciones de la API de Gemini; SynthID.', maxResolution: '1080p', maxShortSidePx: 720,
  },
  {
    id: 'gemini:veo-3.1-generate-preview', modality: 'video', provider: 'gemini', label: 'Google Veo 3.1 (API oficial) · máxima calidad',
    strength: 'Veo 3.1 estándar: la mayor calidad y fidelidad de Google, con sonido nativo.',
    tier: 'paid', price: 'De pago. Terceros indican ≈ $0,40/s (720p y 1080p); sin confirmar en la fuente oficial consultada.', priceConfirmed: false,
    estimateUsd: o => n(o.durationSeconds, 8) * 0.4, quality: 5, speed: 'slow',
    limits: '4, 6 u 8 s. El resultado se borra de Google a los 2 días (Cerebro lo copia antes).', capabilities: ['native_audio'],
    env: ['GEMINI_API_KEY'], sync: false, formats: ['16:9', '9:16'], durations: [4, 6, 8],
    evidence: 'documented', evidenceNote: 'Listado en tu clave (predictLongRunning). Sin nivel gratuito: 429 el 2026-10-10 con el modelo Lite.',
    rights: 'commercial', rightsNote: 'Condiciones de la API de Gemini; SynthID.', maxResolution: '4K', maxShortSidePx: 1080,
  },
  {
    id: 'higgsfield:higgsfield-ai/soul/standard', modality: 'image', provider: 'higgsfield', label: 'Higgsfield Soul',
    strength: 'Fotografía realista y estética editorial; hasta 4 variantes en 2K.',
    tier: 'credits', price: 'Créditos de tu cuenta Higgsfield (coste por modelo en la consola; no publicado en la documentación).', priceConfirmed: false,
    estimateUsd: () => 0, quality: 4, speed: 'medium', limits: '2K, 1–4 imágenes; formatos 16:9, 9:16, 1:1 y otros.', capabilities: ['variants'],
    env: ['HIGGSFIELD_API_KEY_ID', 'HIGGSFIELD_API_KEY_SECRET'], sync: false, formats: ['16:9', '9:16', '1:1'], maxVariants: 4, confirm: true,
  },
  {
    id: 'higgsfield:kling-video/v2.5-turbo/pro/text-to-video', modality: 'video', provider: 'higgsfield', label: 'Kling 2.5 Turbo Pro (Higgsfield)',
    strength: 'El mismo Kling 2.5 Turbo Pro pagando con tus créditos de Higgsfield.',
    tier: 'credits', price: 'Créditos de tu cuenta Higgsfield (coste por modelo en la consola).', priceConfirmed: false,
    estimateUsd: () => 0, quality: 4, speed: 'slow', limits: '5 o 10 s. La API documentada no tiene parámetro de formato.', capabilities: ['negative_prompt'],
    env: ['HIGGSFIELD_API_KEY_ID', 'HIGGSFIELD_API_KEY_SECRET'], sync: false, formats: ['16:9'], durations: [5, 10], negative: true, confirm: true,
  },
  {
    id: 'higgsfield:minimax/hailuo-2.3/standard/text-to-video', modality: 'video', provider: 'higgsfield', label: 'Hailuo 2.3 (Higgsfield)',
    strength: 'Movimiento natural y buena física; optimiza el prompt automáticamente.',
    tier: 'credits', price: 'Créditos de tu cuenta Higgsfield (coste por modelo en la consola).', priceConfirmed: false,
    estimateUsd: () => 0, quality: 4, speed: 'slow', limits: '6 o 10 s. La API documentada no tiene parámetro de formato.', capabilities: [],
    env: ['HIGGSFIELD_API_KEY_ID', 'HIGGSFIELD_API_KEY_SECRET'], sync: false, formats: ['16:9'], durations: [6, 10], confirm: true,
  },
  {
    id: 'fal:fal-ai/kling-video/v2.5-turbo/pro/text-to-video', modality: 'video', provider: 'fal', label: 'Kling 2.5 Turbo Pro',
    strength: 'Movimiento natural y cámara cinematográfica.',
    tier: 'paid', price: '$0.35 por 5 s · $0.07 cada segundo extra', priceConfirmed: true,
    estimateUsd: o => 0.35 + Math.max(0, n(o.durationSeconds, 5) - 5) * 0.07, quality: 4, speed: 'medium', capabilities: ['negative_prompt'],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16', '1:1'], durations: [5, 10], negative: true,
  },
  {
    id: 'fal:fal-ai/wan/v2.2-5b/text-to-video/fast-wan', modality: 'video', provider: 'fal', label: 'Wan 2.2 5B Fast (vídeo borrador, coste mínimo)',
    strength: 'Clips cortos de borrador (unos 3–5 s, 720p) para probar ideas o la integración al menor coste; no es calidad final.',
    tier: 'paid', price: 'Unos $0.025 por clip a 720p según la ficha pública de fal (a confirmar en la cuenta)', priceConfirmed: false,
    estimateUsd: () => 0.025, quality: 2, speed: 'fast', capabilities: [],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16', '1:1'], limits: 'Duración fija del modelo; sin audio.',
  },
  {
    id: 'fal:fal-ai/veo3/fast', modality: 'video', provider: 'fal', label: 'Google Veo 3 Fast (vía fal)',
    strength: 'Vídeo con sonido generado; muy buena física y luz.',
    tier: 'paid', price: '$0.10/s sin audio · $0.15/s con audio', priceConfirmed: true,
    estimateUsd: o => n(o.durationSeconds, 8) * (o.audio === false ? 0.1 : 0.15), quality: 5, speed: 'slow', capabilities: ['native_audio', 'negative_prompt'],
    env: ['FAL_KEY'], sync: false, formats: ['16:9', '9:16'], durations: [4, 6, 8], negative: true,
  },
  {
    id: 'alibaba:wan2.2-t2v-plus', modality: 'video', provider: 'alibaba', label: 'Wan 2.2 Plus (Alibaba Model Studio) · cuota de bienvenida',
    strength: 'Wan 2.2 oficial de Alibaba por su API. Sirve para aprovechar la cuota gratuita de bienvenida (≈ 50 s durante 90 días); no se renueva.',
    tier: 'credits', price: 'Gratis dentro de la cuota de bienvenida (solo nuevos usuarios, 90 días). Al agotarla, una cuenta verificada cobra por segundo (tabla de Model Studio, no consultada).', priceConfirmed: false,
    estimateUsd: () => 0, quality: 4, speed: 'slow', limits: 'Clips de 5 s. Cerebro se niega a enviar cuando su contador local indica que la cuota se agotó, para no generar cargos.',
    capabilities: ['negative_prompt'],
    env: ['DASHSCOPE_API_KEY'], sync: false, formats: ['16:9', '9:16', '1:1'], durations: [5], negative: true, confirm: true,
    evidence: 'unverified', evidenceNote: 'Cuota y facturación según la documentación oficial de Model Studio (consultada vía buscador). El endpoint, los parámetros y el nombre exacto del modelo vienen de la documentación DashScope y no se pudieron probar: no hay clave ni acceso a ese dominio desde aquí.',
    allowance: POOLS.alibabaWan, allowanceUnits: o => n(o.durationSeconds, 5),
    rights: 'check_terms', rightsNote: 'Revisa las condiciones de uso comercial de Alibaba Cloud Model Studio para tu cuenta.', maxResolution: '1080p', maxShortSidePx: 720,
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
    evidence: 'tested', evidenceNote: 'generateContent con gemini-3.8-flash-tts devolvió audio/wav con la clave gratuita el 2026-10-10 (HTTP 200).',
    rights: 'commercial', rightsNote: 'Condiciones de la API de Gemini; audio con marca SynthID.',
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
  {
    id: 'topmediai:text2speech', modality: 'voice', provider: 'topmediai', label: 'TopMediai Voz (API oficial)',
    strength: 'Voces de TopMediai por su API oficial (más de 3.200 voces y 190 idiomas según su web). La API se contrata aparte de tus suscripciones.',
    tier: 'freemium', price: 'API aparte de tus planes: 5.000 caracteres gratuitos; después, plan de API de pago (precio en su web, sin confirmar).', priceConfirmed: false,
    estimateUsd: () => 0, quality: 3, speed: 'fast', capabilities: ['spanish'],
    limits: 'Máx. 500 caracteres por petición. Necesita el ID del speaker (TOPMEDIAI_SPEAKER o el campo de voz).',
    env: ['TOPMEDIAI_API_KEY'], sync: true, confirm: true,
    evidence: 'unverified', evidenceNote: 'Endpoint, cabecera x-api-key y campos text/speaker/emotion según docs.topmediai.com (vía buscador). La forma exacta de la respuesta no está confirmada: el adaptador acepta audio directo o JSON con una URL, y falla de forma explícita si no reconoce la respuesta.',
    allowance: POOLS.topmediaiTts, rights: 'plan_dependent', rightsNote: 'TopMediai: el uso comercial depende del plan de pago; los planes gratuitos son de uso personal.',
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

export const evidenceOf = (m: CatalogModel): Evidence => m.evidence ?? 'documented'
export const rightsOf = (m: CatalogModel): Rights => m.rights ?? 'check_terms'

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
    case 'fal-ai/wan/v2.2-5b/text-to-video/fast-wan':
      // Minimal body: the model's own defaults decide length and resolution (that is what the public price refers to).
      return format === '16:9' ? { prompt } : { prompt, aspect_ratio: format }
    case 'fal-ai/veo3/fast':
      return { prompt, duration: `${duration ?? 8}s`, aspect_ratio: format === '9:16' ? '9:16' : '16:9', resolution: '720p', generate_audio: o.audio !== false, ...neg }
    case 'fal-ai/lyria2':
      return { prompt, ...neg }
    default:
      throw new Error(`No input mapping for ${model.id}.`)
  }
}

import { isFalMediaUrl } from './fal-queue'

export type FalMedia = { url: string; contentType: string }

/** Extracts media URLs from a fal result, whatever the modality. */
export function falOutputs(result: unknown, modality: Modality): FalMedia[] {
  if (!result || typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  const one = (f: unknown, fallback: string): FalMedia | null => {
    if (!f || typeof f !== 'object') return null
    const file = f as Record<string, unknown>
    return isFalMediaUrl(file.url) && typeof file.url === 'string'
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
