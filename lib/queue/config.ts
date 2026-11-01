/**
 * Configuracion de la cola para endpoints/panel (4B.3 preparada, DESACTIVADA por defecto).
 * Principio: la cola solo se activa si TODAS las condiciones se cumplen; cualquier duda = desactivada.
 * Nunca se imprimen valores de variables, solo nombres.
 */
export const PRODUCTION_PROJECT_REF = 'psbvqdaksrfrkxbewrll'

export type QueueConfig =
  | { enabled: false; reason: string }
  | { enabled: true; environment: 'test'; projectRef: string; supabaseUrl: string; dryRunOnly: true }

const REF_RE = /^[a-z0-9]{20}$/

export function resolveQueueConfig(env: Record<string, string | undefined>): QueueConfig {
  const off = (reason: string): QueueConfig => ({ enabled: false, reason })
  if (env.QUEUE_ENABLED !== 'true') return off('QUEUE_ENABLED no es "true" (interruptor apagado)')
  if (env.QUEUE_KILL_SWITCH === 'true') return off('QUEUE_KILL_SWITCH activo')
  if (env.QUEUE_ENVIRONMENT !== 'test') return off('QUEUE_ENVIRONMENT debe ser exactamente "test": hay que identificar el entorno de pruebas')
  if (env.VERCEL_ENV === 'production') return off('VERCEL_ENV=production: la cola nunca se activa en Production')
  const ref = (env.QUEUE_TEST_PROJECT_REF ?? '').trim()
  if (!REF_RE.test(ref)) return off('QUEUE_TEST_PROJECT_REF ausente o con formato invalido')
  if (ref === PRODUCTION_PROJECT_REF) return off('QUEUE_TEST_PROJECT_REF es el proyecto de Production')
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  let host = ''
  try { host = new URL(url).hostname } catch { return off('NEXT_PUBLIC_SUPABASE_URL ausente o invalida') }
  if (host.includes(PRODUCTION_PROJECT_REF)) return off('NEXT_PUBLIC_SUPABASE_URL apunta a Production')
  if (host !== `${ref}.supabase.co`) return off('NEXT_PUBLIC_SUPABASE_URL no coincide con QUEUE_TEST_PROJECT_REF')
  if (env.QUEUE_ALLOW_LIVE === 'true' || env.QUEUE_DRY_RUN === 'false') return off('el modo real no existe en esta fase: dry_run es obligatorio')
  return { enabled: true, environment: 'test', projectRef: ref, supabaseUrl: url, dryRunOnly: true }
}
