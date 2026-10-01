/**
 * Provider directory: who each provider is, how it is paid for, how it authenticates and what is
 * known about its free allowance. Every statement comes from the provider's own documentation,
 * checked on `verifiedAt`. When a figure could not be confirmed it says so instead of guessing.
 * Prices and limits change: the provider's site and invoice are always the source of truth.
 */

export type CostTier = 'free' | 'credits' | 'freemium' | 'paid' | 'local'
export type AuthKind = 'none' | 'api_key' | 'oauth' | 'cloud_account'
export type ApiStatus = 'official' | 'official_preview' | 'no_public_api'

export type ProviderInfo = {
  id: string
  name: string
  tier: CostTier
  /** What is free/included, in the provider's own terms. */
  allowance: string
  auth: AuthKind
  env: string[]
  api: ApiStatus
  docsUrl: string
  pricingUrl: string
  verifiedAt: string
  /** Licensing / terms the user must keep in mind. */
  terms: string
  notes?: string
}

export const tierLabels: Record<CostTier, string> = {
  free: 'Gratis',
  credits: 'Créditos incluidos',
  freemium: 'Freemium',
  paid: 'De pago',
  local: 'Local / open source',
}

export const authLabels: Record<AuthKind, string> = {
  none: 'Sin clave',
  api_key: 'Requiere API key',
  oauth: 'Requiere OAuth',
  cloud_account: 'Cuenta cloud + API key',
}

const V = '2026-10-01'

export const providers: ProviderInfo[] = [
  {
    id: 'cloudflare', name: 'Cloudflare Workers AI', tier: 'free',
    allowance: '10.000 neuronas al día gratis en los planes Free y Paid. Por encima: $0.011 / 1.000 neuronas (solo plan Paid).',
    auth: 'api_key', env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], api: 'official',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/', pricingUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/', verifiedAt: V,
    terms: 'Cada modelo mantiene su propia licencia (p. ej. FLUX.1 schnell: términos de Black Forest Labs).',
  },
  {
    id: 'gemini', name: 'Google Gemini API (AI Studio)', tier: 'freemium',
    allowance: 'Nivel gratuito para texto (Gemini 3.8 Flash) y para Gemini TTS. Imagen nativa (gemini-3.1-flash-image) y Veo no tienen nivel gratuito en la API.',
    auth: 'api_key', env: ['GEMINI_API_KEY'], api: 'official_preview',
    docsUrl: 'https://ai.google.dev/gemini-api/docs', pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing', verifiedAt: V,
    terms: 'Vídeos con marca SynthID. Los vídeos generados se conservan 2 días en el servidor de Google: Cerebro los copia a la Biblioteca al terminar.',
    notes: 'Es la vía oficial para usar los modelos de Google Flow (Veo) desde una aplicación. Ver “Google Flow” en Conectores.',
  },
  {
    id: 'openai', name: 'OpenAI', tier: 'paid',
    allowance: 'Sin nivel gratuito para imagen ni voz.',
    auth: 'api_key', env: ['OPENAI_API_KEY'], api: 'official',
    docsUrl: 'https://platform.openai.com/docs', pricingUrl: 'https://openai.com/api/pricing/', verifiedAt: '2026-09-30',
    terms: 'El contenido generado pertenece al usuario según las condiciones de OpenAI.',
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', tier: 'credits',
    allowance: 'Créditos (caracteres) incluidos en tu plan mensual; el saldo se lee en vivo desde /v1/user/subscription.',
    auth: 'api_key', env: ['ELEVENLABS_API_KEY'], api: 'official',
    docsUrl: 'https://elevenlabs.io/docs', pricingUrl: 'https://elevenlabs.io/pricing', verifiedAt: V,
    terms: 'Los derechos de uso comercial dependen del plan contratado.',
  },
  {
    id: 'fal', name: 'fal.ai', tier: 'paid',
    allowance: 'Pago por uso. Sin nivel gratuito confirmado en la documentación.',
    auth: 'api_key', env: ['FAL_KEY'], api: 'official',
    docsUrl: 'https://fal.ai/docs', pricingUrl: 'https://fal.ai/pricing', verifiedAt: '2026-09-30',
    terms: 'Cada modelo tiene su licencia; las URLs de resultados caducan, por eso se copian a la Biblioteca.',
  },
  {
    id: 'freesound', name: 'Freesound', tier: 'free',
    allowance: 'API gratuita con token (solo lectura). Descargar el original requiere OAuth2; Cerebro importa la vista previa HQ (MP3).',
    auth: 'api_key', env: ['FREESOUND_API_KEY'], api: 'official',
    docsUrl: 'https://freesound.org/docs/api/', pricingUrl: 'https://freesound.org/docs/api/', verifiedAt: V,
    terms: 'Licencias por sonido: Creative Commons 0, Attribution o Attribution NonCommercial. Se registran autor y licencia.',
  },
  {
    id: 'pexels', name: 'Pexels', tier: 'free',
    allowance: '200 peticiones/hora y 20.000/mes por defecto.',
    auth: 'api_key', env: ['PEXELS_API_KEY'], api: 'official',
    docsUrl: 'https://www.pexels.com/api/documentation/', pricingUrl: 'https://www.pexels.com/api/', verifiedAt: V,
    terms: 'Licencia Pexels. Mostrar un enlace a Pexels y acreditar al autor cuando sea posible.',
  },
  {
    id: 'pixabay', name: 'Pixabay', tier: 'free',
    allowance: 'API gratuita de imágenes y vídeos. Sin API pública de música ni efectos.',
    auth: 'api_key', env: ['PIXABAY_API_KEY'], api: 'official',
    docsUrl: 'https://pixabay.com/api/docs/', pricingUrl: 'https://pixabay.com/api/docs/', verifiedAt: V,
    terms: 'Pixabay Content License. No se permite hotlinking permanente: Cerebro copia el archivo a la Biblioteca.',
  },
  {
    id: 'groq', name: 'Groq', tier: 'freemium',
    allowance: 'Plan gratuito sin tarjeta con límites por minuto y día (Whisper: 20 peticiones/día y 28.800 s de audio/día). De pago: GPT-OSS 120B $0.15/$0.60 por 1M tokens; Whisper large v3 $0.111/hora.',
    auth: 'api_key', env: ['GROQ_API_KEY'], api: 'official',
    docsUrl: 'https://console.groq.com/docs/speech-to-text', pricingUrl: 'https://console.groq.com/docs/rate-limits', verifiedAt: V,
    terms: 'Modelos open-weight (GPT-OSS, Whisper) servidos por Groq.',
    notes: 'Integrado: texto (guiones, prompts) y transcripción para subtítulos.',
  },
  {
    id: 'huggingface', name: 'Hugging Face Inference Providers', tier: 'credits',
    allowance: '$0.10/mes de créditos para usuarios gratuitos y $2.00/mes para PRO; después, pago por uso.',
    auth: 'api_key', env: ['HF_TOKEN'], api: 'official',
    docsUrl: 'https://huggingface.co/docs/inference-providers', pricingUrl: 'https://huggingface.co/docs/inference-providers/pricing', verifiedAt: V,
    terms: 'Licencia según cada modelo open source.',
    notes: 'Registrado como opción; sin adaptador todavía (el crédito gratuito es muy pequeño).',
  },
  {
    id: 'google-flow', name: 'Google Flow (producto)', tier: 'credits',
    allowance: 'Google AI Pro: 1.000 créditos de Flow/mes. Ultra: 10.000/mes. Solo se usan dentro de la interfaz de Flow.',
    auth: 'none', env: [], api: 'no_public_api',
    docsUrl: 'https://labs.google/flow', pricingUrl: 'https://one.google.com/about/google-ai-plans/', verifiedAt: V,
    terms: 'Sin API oficial para automatizarlo. No se integra con métodos no oficiales.',
    notes: 'AI Pro incluye además $10/mes en créditos de Google Cloud (Google Developer Program) que pueden servir para pagar la API oficial.',
  },
  {
    id: 'self-hosted', name: 'Modelos propios (open source)', tier: 'local',
    allowance: 'Sin coste por uso; pagas tu servidor/GPU.',
    auth: 'api_key', env: ['SELF_HOSTED_ENDPOINT'], api: 'official',
    docsUrl: 'https://github.com/realbeltran15-creator/cerebro-studio', pricingUrl: '', verifiedAt: V,
    terms: 'Licencia de cada modelo (p. ej. Stable Audio Open, Piper, MusicGen).',
    notes: 'Aún sin adaptador: hace falta un servidor propio (endpoint) y elegir el modelo. La arquitectura admite añadirlo como un proveedor más.',
  },
]

export function providerById(id: string) {
  return providers.find(p => p.id === id)
}
