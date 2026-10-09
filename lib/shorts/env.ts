export type EnvRequirement = {
  name: string
  purpose: string
  /** blocking: sin esto no se prepara ningún Short. optional: degrada una función concreta. */
  level: 'blocking' | 'upload' | 'optional'
  present: boolean
}

const has = (name: string) => Boolean(process.env[name]?.trim())

export function readiness(): EnvRequirement[] {
  const r = (name: string, purpose: string, level: EnvRequirement['level']): EnvRequirement => ({ name, purpose, level, present: has(name) })
  return [
    r('GEMINI_API_KEY', 'Gemini free tier: temas, guion, verificación de fuentes y voz', 'blocking'),
    r('CLOUDFLARE_ACCOUNT_ID', 'Cloudflare Workers AI: imágenes', 'blocking'),
    r('CLOUDFLARE_API_TOKEN', 'Cloudflare Workers AI: imágenes (token con permiso Workers AI)', 'blocking'),
    r('YOUTUBE_API_KEY', 'YouTube Data API: vídeos similares y mediana del nicho (datos de interés)', 'blocking'),
    r('SUPABASE_SERVICE_ROLE_KEY', 'Preparación en servidor sin sesión (cron y botón «preparar ahora»)', 'blocking'),
    r('CRON_SECRET', 'Autoriza las tareas programadas de Vercel Cron', 'blocking'),
    r('SHORTS_OWNER_ID', 'UUID de Jesús en auth.users: propietario de los Shorts del cron', 'blocking'),
    r('TOKEN_ENCRYPTION_KEY', 'Descifrar los tokens de YouTube de channel_connections', 'upload'),
    r('GOOGLE_OAUTH_CLIENT_ID', 'Refrescar el acceso a YouTube (subida y Analytics)', 'upload'),
    r('GOOGLE_OAUTH_CLIENT_SECRET', 'Refrescar el acceso a YouTube (subida y Analytics)', 'upload'),
    r('GEMINI_TEXT_MODEL', 'Modelo de texto (por defecto gemini-3.8-flash)', 'optional'),
    r('GEMINI_TTS_MODEL', 'Modelo de voz (por defecto gemini-2.5-flash-preview-tts)', 'optional'),
    r('CLOUDFLARE_IMAGE_MODEL', 'Modelo de imagen (por defecto @cf/black-forest-labs/flux-1-schnell)', 'optional'),
  ]
}

export function missingFor(level: EnvRequirement['level'] | 'all-required') {
  return readiness().filter(r => !r.present && (level === 'all-required' ? r.level !== 'optional' : r.level === level))
}

/** Lo mínimo para PREPARAR un Short (el cron además necesita CRON_SECRET, SERVICE_ROLE y SHORTS_OWNER_ID). */
export const PIPELINE_ENV = ['GEMINI_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'YOUTUBE_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
export const pipelineMissing = () => PIPELINE_ENV.filter(n => !has(n))
