/**
 * Provider adapters for the Virtual Influencer Studio. They reuse the existing Cerebro providers
 * where one exists. Status comes from the server environment; an adapter with no API or no
 * credentials is NOT_CONNECTED and is never presented as available.
 */

export type ViJobKind = 'image' | 'video' | 'voice' | 'lipsync' | 'upscale'
export type AdapterStatus = 'CONNECTED' | 'NOT_CONNECTED'

export type AdapterDefinition = {
  id: string
  label: string
  kind: ViJobKind
  /** Existing Cerebro provider reused by this adapter, if any. */
  reuses: string | null
  /** All of these env vars must be set (any-of groups use |). */
  env: string[]
  paid: boolean
  /** Supports conditioning on reference images of the persona (needed for identity consistency). */
  referenceConditioning: boolean
  notes: string
}

export const adapters: AdapterDefinition[] = [
  { id: 'openai-image', label: 'OpenAI gpt-image-1', kind: 'image', reuses: 'openai-image', env: ['OPENAI_API_KEY'], paid: true, referenceConditioning: false, notes: 'Genera a partir de texto: no garantiza la misma identidad entre imágenes. Útil para exploración, no para producción consistente.' },
  { id: 'fal-video', label: 'fal.ai (texto a vídeo)', kind: 'video', reuses: 'fal-h3-turbo', env: ['FAL_KEY'], paid: true, referenceConditioning: false, notes: 'Adaptador de prueba de coste fijo (5 s, 480p). Sin condicionamiento por identidad.' },
  { id: 'openai-voice', label: 'OpenAI TTS', kind: 'voice', reuses: 'openai-voice', env: ['OPENAI_VOICE_API_KEY'], paid: true, referenceConditioning: false, notes: 'Voces genéricas predefinidas: no clona la voz del Voice Profile.' },
  { id: 'elevenlabs-voice', label: 'ElevenLabs', kind: 'voice', reuses: 'elevenlabs-voice', env: ['ELEVENLABS_API_KEY'], paid: true, referenceConditioning: true, notes: 'Voz estable por voice id; admite voz diseñada o clonada con consentimiento.' },
  { id: 'identity-image', label: 'Imagen con identidad (referencias)', kind: 'image', reuses: null, env: ['VI_IDENTITY_IMAGE_ENDPOINT', 'VI_IDENTITY_IMAGE_API_KEY'], paid: true, referenceConditioning: true, notes: 'Endpoint para un modelo condicionado por referencias (p. ej. LoRA/IP-Adapter propio). No configurado.' },
  { id: 'identity-video', label: 'Vídeo con identidad (imagen a vídeo)', kind: 'video', reuses: null, env: ['VI_IDENTITY_VIDEO_ENDPOINT', 'VI_IDENTITY_VIDEO_API_KEY'], paid: true, referenceConditioning: true, notes: 'Imagen de referencia aprobada → vídeo. No configurado.' },
  { id: 'lipsync', label: 'Sincronización labial', kind: 'lipsync', reuses: null, env: ['VI_LIPSYNC_ENDPOINT', 'VI_LIPSYNC_API_KEY'], paid: true, referenceConditioning: true, notes: 'Vídeo + voz → vídeo con labios sincronizados. No configurado.' },
  { id: 'upscale', label: 'Escalado / restauración', kind: 'upscale', reuses: null, env: ['VI_UPSCALE_ENDPOINT', 'VI_UPSCALE_API_KEY'], paid: true, referenceConditioning: false, notes: 'No configurado.' },
]

export function adapterStatus(a: AdapterDefinition, env: Record<string, string | undefined> = process.env): AdapterStatus {
  return a.env.every(k => Boolean(env[k]?.trim())) ? 'CONNECTED' : 'NOT_CONNECTED'
}

/** Public view: never includes env values, only names of what is missing. */
export function adapterReport(env: Record<string, string | undefined> = process.env) {
  return adapters.map(a => {
    const status = adapterStatus(a, env)
    return { id: a.id, label: a.label, kind: a.kind, status, paid: a.paid, referenceConditioning: a.referenceConditioning, reuses: a.reuses, notes: a.notes, missing: status === 'CONNECTED' ? [] : a.env.filter(k => !env[k]?.trim()) }
  })
}

export function adapterById(id: string) {
  return adapters.find(a => a.id === id) ?? null
}
