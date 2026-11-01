import { betaScopeOn } from '@/lib/beta-scope'

/**
 * In the private beta the server refuses to start with an unsafe configuration (Production project, paid or privileged keys):
 * the message names the variables (never their values) and the process exits, so nothing is ever served with it.
 */
export async function register() {
  if (!betaScopeOn()) return
  const { betaConfigProblems } = await import('@/lib/security/beta-config')
  const problems = betaConfigProblems(process.env)
  if (!problems.length) return
  const message = `Configuración de la beta rechazada:\n- ${problems.join('\n- ')}`
  console.error(message)
  // Node runtime only (bracket access: `process.exit` is not available to the Edge bundle's static analysis).
  if (process.env.NEXT_RUNTIME === 'nodejs') process['exit'](1)
  throw new Error(message)
}
