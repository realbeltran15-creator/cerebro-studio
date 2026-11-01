/**
 * Start-up and CI checks for the private beta configuration. Self-contained on purpose (no imports) so that instrumentation.ts,
 * Vitest and `node scripts/check-beta-config.mjs` can all load it. It never prints or returns a secret VALUE, only variable names.
 *
 * The beta must run on its OWN Supabase project and carry no payment-provider keys and no privileged keys.
 */
type Env = Record<string, string | undefined>

/** Reference of the Production Supabase project (an identifier, not a secret). */
export const PRODUCTION_SUPABASE_REF = 'psbvqdaksrfrkxbewrll'

/** Keys of providers that charge per call. Must be absent in the beta. */
export const PAID_PROVIDER_VARS = [
  'FAL_KEY', 'OPENAI_API_KEY', 'OPENAI_TEXT_API_KEY', 'OPENAI_VOICE_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'DASHSCOPE_API_KEY',
  'HIGGSFIELD_API_KEY_ID', 'HIGGSFIELD_API_KEY_SECRET', 'TOPMEDIAI_API_KEY', 'TEXT_GATEWAY_API_KEY', 'GROQ_API_KEY', 'CLOUDFLARE_API_TOKEN',
] as const
/** Privileged credentials (bypass RLS, sign or decrypt tokens, run scheduled jobs, publish). Must be absent in the beta. */
export const PRIVILEGED_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'TOKEN_ENCRYPTION_KEY', 'PUBLICATION_SEAL_KEY',
  'GOOGLE_OAUTH_CLIENT_SECRET', 'INSTAGRAM_APP_SECRET', 'TIKTOK_CLIENT_SECRET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
] as const

const filled = (v: string | undefined) => typeof v === 'string' && v.trim() !== ''

/** The `ref` claim of a legacy Supabase key (a JWT), or null. Nothing else of the token is read. */
function jwtRef(key: string | undefined): string | null {
  const part = key?.split('.')[1]
  if (!part) return null
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))) as { ref?: unknown }
    return typeof json.ref === 'string' ? json.ref : null
  } catch { return null }
}

export function supabaseRefOf(url: string | undefined): string | null {
  try { const h = new URL(url ?? '').hostname; const m = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(h); return m ? m[1] : null } catch { return null }
}

/** Human-readable problems (empty = configuration accepted). */
export function betaConfigProblems(env: Env): string[] {
  const out: string[] = []
  if (env.NEXT_PUBLIC_CEREBRO_BETA !== 'private') out.push('NEXT_PUBLIC_CEREBRO_BETA no es «private»: el alcance cerrado de la beta no está activo.')
  if (env.VERCEL_ENV === 'production') out.push('VERCEL_ENV=production: la beta privada no se despliega en Production.')
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  let parsed = true
  try { new URL(url ?? '') } catch { parsed = false }
  if (!parsed) out.push('NEXT_PUBLIC_SUPABASE_URL falta o no es una URL válida.')
  else {
    if (supabaseRefOf(url) === PRODUCTION_SUPABASE_REF || (url ?? '').includes(PRODUCTION_SUPABASE_REF)) out.push('NEXT_PUBLIC_SUPABASE_URL apunta al proyecto Supabase de Production: la beta necesita un proyecto independiente.')
    else if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test((url ?? '').replace(/\/+$/, '')) && !supabaseRefOf(url)) out.push('NEXT_PUBLIC_SUPABASE_URL no es un proyecto *.supabase.co ni una dirección local: no se puede comprobar que sea independiente de Production.')
  }
  if (!filled(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) out.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY falta.')
  if (jwtRef(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) === PRODUCTION_SUPABASE_REF) out.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY es una clave del proyecto de Production.')
  for (const k of PAID_PROVIDER_VARS) if (filled(env[k])) out.push(`${k} está definida: la beta no debe tener claves de proveedores de pago.`)
  for (const k of PRIVILEGED_VARS) if (filled(env[k])) out.push(`${k} está definida: la beta no debe tener claves privilegiadas.`)
  return out
}
