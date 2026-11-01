// Checks a beta configuration without starting anything and without printing a single secret value.
//   node scripts/check-beta-config.mjs                       -> checks the current environment
//   node --env-file=/path/to/file scripts/check-beta-config.mjs  -> checks a file (e.g. the variables planned for Preview)
import { betaConfigProblems } from '../lib/security/beta-config.ts'
const problems = betaConfigProblems(process.env)
if (problems.length) { console.log('CONFIGURACIÓN DE LA BETA RECHAZADA:'); for (const p of problems) console.log(' -', p); process.exit(1) }
console.log('OK: configuración de beta aceptada (proyecto Supabase distinto de Production, sin claves de pago ni privilegiadas).')
