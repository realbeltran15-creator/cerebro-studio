import { NextResponse } from 'next/server'

/**
 * Preview protection (server side). A Vercel Preview shares Supabase (database, Auth, Storage) and every provider key with Production,
 * so a Preview must not be able to spend money, publish, run automations or use privileged credentials.
 *
 * - The environment comes only from VERCEL_ENV, which Vercel sets on the server ('production' | 'preview' | 'development'). It is NOT a public
 *   variable, the browser cannot change it, and hiding a button is never the protection: every sensitive route calls `previewBlock` as its
 *   FIRST statement, before authentication, before reading the body and before any external call.
 * - Production keeps its current behaviour. Local development (no VERCEL_ENV) is the person's own machine and is not blocked.
 * - There is deliberately no override switch: to allow one of these things in Preview, change the code (a reviewed commit), not a setting.
 */
export type DeployEnv = 'production' | 'preview' | 'local'
export type Sensitivity = 'paid-provider' | 'publication' | 'automation' | 'privileged' | 'destructive'

export function deployEnv(env: Record<string, string | undefined> = process.env): DeployEnv {
  const v = env.VERCEL_ENV?.trim()
  if (!v) return 'local'
  return v === 'production' ? 'production' : 'preview'
}
export const isPreviewDeploy = (env: Record<string, string | undefined> = process.env) => deployEnv(env) === 'preview'

const WHAT: Record<Sensitivity, string> = {
  'paid-provider': 'las llamadas a proveedores de pago',
  publication: 'la aprobación y publicación de contenido',
  automation: 'las automatizaciones y tareas programadas',
  privileged: 'las operaciones con cuentas conectadas o credenciales privilegiadas',
  destructive: 'los borrados de archivos',
}

/** Returns a 403 response when this deployment is a Preview, otherwise null. Call it first in the handler: `const b = previewBlock('x'); if (b) return b`. */
export function previewBlock(kind: Sensitivity, env: Record<string, string | undefined> = process.env): Response | null {
  if (!isPreviewDeploy(env)) return null
  return NextResponse.json(
    { error: `Bloqueado en Preview: ${WHAT[kind]} solo funcionan en Production, porque esta versión de prueba comparte datos y claves con Production.`, blocked: 'preview', kind },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}
