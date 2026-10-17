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
  /** true = Cerebro has an adapter for it; false = researched only (nothing is called). */
  integrated?: boolean
  /**
   * Is there a FREE allowance reachable by API (not the web app)? 
   *  daily/monthly renew by themselves; promo is a one-off grant; none = paid only; unknown = not confirmed.
   */
  freeApi?: 'daily' | 'monthly' | 'promo' | 'none' | 'unknown'
  /** What we know about the claims in this entry and from where (see Evidence in catalog.ts). */
  evidence?: 'tested' | 'documented' | 'secondary' | 'unverified'
  /** Date of the last check of this entry (ISO). Defaults to verifiedAt. */
  checkedOn?: string
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
    allowance: '10.000 neuronas al día gratis (se renuevan a las 00:00 UTC) en los planes Free y Paid. Por encima: $0.011 / 1.000 neuronas (solo plan Paid). Incluye FLUX.1 schnell y FLUX.2 klein 4B/9B para imágenes. Cloudflare limita en el plan Free algunos modelos pesados (403, error 5035).',
    auth: 'api_key', env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], api: 'official', integrated: true, freeApi: 'daily', evidence: 'documented', checkedOn: '2026-10-10',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/', pricingUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/', verifiedAt: V,
    terms: 'Cada modelo mantiene su propia licencia (p. ej. FLUX.1 schnell: términos de Black Forest Labs).',
  },
  {
    id: 'gemini', name: 'Google Gemini API (AI Studio)', tier: 'freemium',
    allowance: 'Nivel gratuito para texto (Gemini 3.8 Flash) y para Gemini TTS. Imagen (Nano Banana en todas sus versiones), Veo y Lyria NO tienen nivel gratuito en la API: comprobado con una petición real el 2026-10-10 (429 en los 5 modelos de imagen, en Lyria 3 y en Veo 3.1 Lite con clave gratuita). El acceso gratuito de la app/web de Gemini no cuenta como API.',
    auth: 'api_key', env: ['GEMINI_API_KEY'], api: 'official_preview', integrated: true, freeApi: 'daily', evidence: 'tested', checkedOn: '2026-10-10',
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
    integrated: true, freeApi: 'none', evidence: 'documented',
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', tier: 'credits',
    allowance: 'Créditos (caracteres) incluidos en tu plan mensual; el saldo se lee en vivo desde /v1/user/subscription.',
    auth: 'api_key', env: ['ELEVENLABS_API_KEY'], api: 'official',
    docsUrl: 'https://elevenlabs.io/docs', pricingUrl: 'https://elevenlabs.io/pricing', verifiedAt: V,
    terms: 'Los derechos de uso comercial dependen del plan contratado.',
    integrated: true, freeApi: 'monthly', evidence: 'documented',
  },
  {
    id: 'fal', name: 'fal.ai', tier: 'paid',
    allowance: 'Pago por uso. Sin nivel gratuito confirmado en la documentación.',
    auth: 'api_key', env: ['FAL_KEY'], api: 'official',
    docsUrl: 'https://fal.ai/docs', pricingUrl: 'https://fal.ai/pricing', verifiedAt: '2026-09-30',
    terms: 'Cada modelo tiene su licencia; las URLs de resultados caducan, por eso se copian a la Biblioteca.',
    integrated: true, freeApi: 'none', evidence: 'documented',
  },
  {
    id: 'higgsfield', name: 'Higgsfield', tier: 'credits',
    allowance: 'Créditos de tu cuenta (caducan al año). Los fallidos y bloqueados se reembolsan. Sin nivel gratuito confirmado en la documentación.',
    auth: 'api_key', env: ['HIGGSFIELD_API_KEY_ID', 'HIGGSFIELD_API_KEY_SECRET'], api: 'official',
    docsUrl: 'https://docs.higgsfield.ai', pricingUrl: 'https://console.higgsfield.ai', verifiedAt: '2026-10-07',
    terms: 'Claves solo en el servidor. Resultados disponibles al menos 7 días: Cerebro los copia a tu nube.',
    integrated: true, freeApi: 'unknown', evidence: 'documented',
  },
  {
    id: 'alibaba', name: 'Alibaba Cloud Model Studio (Wan)', tier: 'credits',
    allowance: 'Cuota de bienvenida de un solo uso: 30 s (wan3.0-video) o 50 s (varios wan2.x de texto a vídeo) durante 90 días desde la activación, región Singapur/Internacional. Los fallos no consumen cuota. Un usuario no verificado se detiene al agotarla; uno verificado pasa a pago por uso automáticamente.',
    auth: 'api_key', env: ['DASHSCOPE_API_KEY'], api: 'official',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/text-to-video-guide', pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/new-free-quota', verifiedAt: '2026-10-10',
    terms: 'Condiciones de Alibaba Cloud; revisa el uso comercial de la salida para tu cuenta.',
    notes: 'Promocional, no renovable. Con cuenta verificada hay cobro automático al agotar la cuota: Cerebro cuenta los segundos y se niega a enviar al agotarlos.',
    integrated: true, freeApi: 'promo', evidence: 'unverified', checkedOn: '2026-10-10',
  },
  {
    id: 'topmediai', name: 'TopMediai (API oficial)', tier: 'freemium',
    allowance: 'La API se contrata APARTE de las suscripciones (voz, canciones, covers): su FAQ dice que "no está incluida en los planes". Voz: 5.000 caracteres gratuitos de API. Música: planes mensuales de créditos (la API no se aplica al generador online). Efectos de sonido: sin API.',
    auth: 'api_key', env: ['TOPMEDIAI_API_KEY'], api: 'official',
    docsUrl: 'https://docs.topmediai.com/', pricingUrl: 'https://www.topmediai.com/api/ai-music-generator-api/purchase/', verifiedAt: '2026-10-10',
    terms: 'Uso comercial solo con plan de pago (certificado PDF por pista); las pistas gratuitas son de uso personal. No se pueden registrar en Content ID como composiciones originales.',
    notes: 'Con tu suscripción actual no hay API: usa «Importar desde TopMediai» (descarga los archivos desde tu cuenta y arrástralos a Cerebro). Voz por API disponible con clave, sin probar.',
    integrated: true, freeApi: 'promo', evidence: 'unverified', checkedOn: '2026-10-10',
  },
  {
    id: 'kling', name: 'Kling AI (API oficial)', tier: 'paid',
    allowance: 'La API usa paquetes de recursos de prepago, separados de los créditos de la web. Los créditos gratuitos diarios/mensuales (web) NO dan acceso a la API. No hay créditos gratuitos de API confirmados.',
    auth: 'api_key', env: [], api: 'official',
    docsUrl: 'https://app.klingai.com/global/dev/document-api', pricingUrl: 'https://app.klingai.com/global/dev', verifiedAt: '2026-10-10',
    terms: 'Condiciones de Kuaishou/Kling.', notes: 'Disponible hoy vía fal.ai y Higgsfield (ya integrados). Sin adaptador directo: sin créditos gratuitos no compensa.',
    integrated: false, freeApi: 'none', evidence: 'secondary', checkedOn: '2026-10-10',
  },
  {
    id: 'pika', name: 'Pika', tier: 'paid',
    allowance: 'Sin API propia confirmada: su página de API remite a fal.ai (Pika v2.2 texto a vídeo ≈ $0,20 por 5 s en 720p según terceros).',
    auth: 'api_key', env: [], api: 'no_public_api',
    docsUrl: 'https://fal.ai/models/fal-ai/pika/v2.2/text-to-video', pricingUrl: 'https://fal.ai/models/fal-ai/pika/v2.2/text-to-video', verifiedAt: '2026-10-10',
    terms: 'Condiciones de Pika y de fal.ai.', notes: 'Solo a través de fal.ai (de pago). Sin adaptador: el esquema de entrada no se pudo comprobar.',
    integrated: false, freeApi: 'none', evidence: 'secondary', checkedOn: '2026-10-10',
  },
  {
    id: 'ltx', name: 'Lightricks LTX-2 (API)', tier: 'paid',
    allowance: 'Créditos de prepago (mínimo de compra $5). Sin créditos gratuitos confirmados por Lightricks.',
    auth: 'api_key', env: [], api: 'official',
    docsUrl: 'https://help.ltx.io/hc/en-us/articles/32478713737618-Understanding-LTX-2-API-Pricing', pricingUrl: 'https://static.lightricks.com/legal/ltx-2-api-credit-terms.pdf', verifiedAt: '2026-10-10',
    terms: 'Términos de créditos de la API de Lightricks (3-dic-2025).', notes: 'Pesos abiertos: se puede alojar uno mismo. Sin adaptador.',
    integrated: false, freeApi: 'none', evidence: 'documented', checkedOn: '2026-10-10',
  },
  {
    id: 'minimax', name: 'MiniMax Hailuo (API)', tier: 'paid',
    allowance: 'Sin API gratuita confirmada. Los créditos de prueba que citan terceros (200 créditos en 3 días) son de la web, con marca de agua y sin derechos comerciales.',
    auth: 'api_key', env: [], api: 'official',
    docsUrl: 'https://platform.minimax.io', pricingUrl: 'https://platform.minimax.io', verifiedAt: '2026-10-10',
    terms: 'Condiciones de MiniMax.', notes: 'Disponible vía Higgsfield (Hailuo 2.3) ya integrado.',
    integrated: false, freeApi: 'unknown', evidence: 'secondary', checkedOn: '2026-10-10',
  },
  {
    id: 'zai', name: 'Z.ai / Zhipu (CogVideoX)', tier: 'paid',
    allowance: 'CogVideoX-3 cuesta $0,20 por vídeo en la documentación de Z.ai. Un "CogVideoX-Flash" gratuito solo aparece en fuentes de terceros y solo para la plataforma de China continental: no confirmado.',
    auth: 'api_key', env: [], api: 'official',
    docsUrl: 'https://docs.z.ai/guides/video/cogvideox-3', pricingUrl: 'https://docs.z.ai/guides/overview/pricing', verifiedAt: '2026-10-10',
    terms: 'Condiciones de Z.ai.', notes: 'Sin adaptador.', integrated: false, freeApi: 'unknown', evidence: 'documented', checkedOn: '2026-10-10',
  },
  {
    id: 'pollinations', name: 'Pollinations', tier: 'free',
    allowance: 'Endpoint de imagen sin clave con límite por IP (cifras contradictorias: 1 petición cada 5–15 s) y posible marca de agua; con cuenta hay un cupo diario "Pollen". Vídeo: sin datos fiables.',
    auth: 'none', env: [], api: 'official', docsUrl: 'https://enter.pollinations.ai', pricingUrl: 'https://enter.pollinations.ai', verifiedAt: '2026-10-10',
    terms: 'Servicio comunitario sin garantías de disponibilidad ni de derechos comerciales claros.', notes: 'Sin adaptador: sin SLA, límites poco claros y licencias dudosas; no apto para producción del canal.',
    integrated: false, freeApi: 'daily', evidence: 'secondary', checkedOn: '2026-10-10',
  },
  {
    id: 'bfl', name: 'Black Forest Labs (FLUX API)', tier: 'paid',
    allowance: 'Créditos de prepago ($0,01 cada uno). FLUX.2 klein 4B ≈ $0,014, klein 9B ≈ $0,015, Pro ≈ $0,03 (edición $0,045), Flex ≈ $0,05. Dev solo local. Sin nivel gratuito.',
    auth: 'api_key', env: [], api: 'official', docsUrl: 'https://docs.bfl.ml', pricingUrl: 'https://docs.bfl.ml/quick_start/pricing', verifiedAt: '2026-10-10',
    terms: 'Licencias por modelo (klein 4B: Apache 2.0 según BFL; Dev: no comercial).', notes: 'FLUX.2 Pro ya disponible vía fal.ai; klein 4B gratis dentro del cupo de Cloudflare.',
    integrated: false, freeApi: 'none', evidence: 'secondary', checkedOn: '2026-10-10',
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
    integrated: false, freeApi: 'monthly', evidence: 'documented',
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
