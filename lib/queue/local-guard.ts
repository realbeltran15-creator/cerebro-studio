/**
 * Bloqueo explicito de infraestructura real para el runner de simulacion (Fase 4B.2).
 * Rechaza (no ignora) cualquier configuracion que no sea local: variables de entorno de Production,
 * hosts remotos de base de datos y dry_run distinto de true. Solo mira NOMBRES de variables, nunca imprime valores.
 */
export class LocalOnlyError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Configuracion no local rechazada: ${reasons.join('; ')}`)
    this.name = 'LocalOnlyError'
  }
}

const FORBIDDEN_ENV = /^(NEXT_PUBLIC_)?SUPABASE|^VERCEL|^CRON_SECRET$|^DATABASE_URL$|^POSTGRES|^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SSLMODE)$|^YOUTUBE|^GOOGLE_|OAUTH|_API_KEY$|^STRIPE|^ELEVEN|^FAL_|^HIGGSFIELD|^REPLICATE|^OPENAI|^ANTHROPIC|^GEMINI/i
const REMOTE_HOST = /supabase|vercel|neon\.|amazonaws|pooler|azure|googleapis|render\.com|railway|fly\.dev|cockroach|planetscale/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function assertLocalOnly(i: { env: Record<string, string | undefined>; dbHost: string; dryRun: boolean }): void {
  const why: string[] = []
  const bad = Object.keys(i.env).filter(k => FORBIDDEN_ENV.test(k) && (i.env[k] ?? '') !== '')
  if (bad.length) why.push(`variables de entorno no permitidas en una simulacion local: ${bad.sort().join(', ')}`)
  const isSocketDir = i.dbHost.startsWith('/') && !REMOTE_HOST.test(i.dbHost)
  if (!isSocketDir && !LOCAL_HOSTS.has(i.dbHost)) why.push('el host de la base de datos no es local (solo socket unix, localhost o 127.0.0.1)')
  if (REMOTE_HOST.test(i.dbHost)) why.push('el host parece un servicio remoto')
  if (i.dryRun !== true) why.push('dry_run debe ser true')
  if (why.length) throw new LocalOnlyError(why)
}
