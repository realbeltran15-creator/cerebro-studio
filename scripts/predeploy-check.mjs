// Comprobación previa al despliegue de la beta. FALLA CERRADO: cualquier duda = exit 1. No imprime valores de secretos (solo nombres y ubicaciones).
//   node scripts/predeploy-check.mjs --env <fichero con las variables planeadas> [--vercel-config <otro vercel.json>]
// No lee Vercel ni Supabase, no ejecuta migraciones, no hace red. Solo lee el repositorio y el fichero indicado.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { betaConfigProblems } from '../lib/security/beta-config.ts'
import { REALTIME_EXPORT_ENABLED } from '../lib/editor/export-policy.ts'
import { BETA_API_ALLOWED } from '../lib/beta-scope.ts'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }
const results = []
const check = (name, problems) => { const list = [].concat(problems).filter(Boolean); results.push({ name, ok: list.length === 0, list }) }
const guard = (name, fn) => { try { check(name, fn()) } catch (e) { check(name, `no se pudo comprobar (${e.message.split('\n')[0]}) → se rechaza por defecto`) } }

// 1. Variables planeadas (solo las del fichero; nunca las del entorno real de quien ejecuta)
guard('variables planeadas del despliegue', () => {
  const f = arg('--env')
  if (!f) return 'falta --env <fichero>: sin variables planeadas no hay nada que aprobar'
  if (!existsSync(f)) return `no existe el fichero ${f}`
  const env = {}
  for (const l of readFileSync(f, 'utf8').split('\n')) { const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '') }
  const p = betaConfigProblems(env)
  if (env.NEXT_PUBLIC_CEREBRO_BETA !== 'private') p.push('NEXT_PUBLIC_CEREBRO_BETA debe ser «private» (el alcance cerrado se incrusta al compilar)')
  if (env.NEXT_PUBLIC_SUPABASE_URL && !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.NEXT_PUBLIC_SUPABASE_URL) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.NEXT_PUBLIC_SUPABASE_URL)) p.push('NEXT_PUBLIC_SUPABASE_URL no es un proyecto *.supabase.co ni local')
  return p
})
// 2. Configuración de Vercel: sin crons (las automatizaciones no deben existir en la beta)
guard('configuración de Vercel sin crons ni comandos de migración', () => {
  const f = path.resolve(root, arg('--vercel-config') || 'vercel.json'); const p = []
  const j = JSON.parse(readFileSync(f, 'utf8'))
  if (j.crons && j.crons.length) p.push(`${path.basename(f)} define ${j.crons.length} cron(s) (${j.crons.map(c => c.path).join(', ')}): la beta no puede tener crons; en la rama beta-privada el vercel.json no los define`)
  if (!j.ignoreCommand || !/beta-privada/.test(j.ignoreCommand)) p.push('falta ignoreCommand que limite las construcciones a la rama beta-privada (sin él, cualquier rama que llegue al proyecto se desplegaría)')
  for (const k of ['buildCommand', 'installCommand', 'devCommand']) if (j[k] && /migrat|db\s+(push|reset)|psql/i.test(j[k])) p.push(`${k} ejecuta migraciones`)
  return p
})
// 3. Scripts del ciclo de vida: nada que migre una base remota al instalar, compilar o arrancar
guard('scripts de instalación/compilación/arranque sin migraciones', () => {
  const s = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {}
  return ['preinstall', 'install', 'postinstall', 'prepare', 'prebuild', 'build', 'postbuild', 'vercel-build', 'prestart', 'start', 'poststart'].filter(k => s[k] && /supabase|migrat|psql|prisma|drizzle|knex|db\s+push/i.test(s[k])).map(k => `el script «${k}» toca migraciones/bases de datos`)
})
guard('flujos de CI sin migraciones remotas', () => {
  const dir = path.join(root, '.github/workflows'); if (!existsSync(dir)) return []
  const out = execFileSync('git', ['ls-files', '.github/workflows'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  return out.filter(f => /supabase\s+(db\s+push|migration\s+up|link)|supabase_access_token|apply_migration/i.test(readFileSync(path.join(root, f), 'utf8'))).map(f => `${f} ejecuta o prepara migraciones remotas`)
})
// 4. Alcance de la beta y política de exportación
guard('alcance cerrado de la API (solo lectura/propio del usuario) y sin publicación, cron ni proveedores', () => {
  const allowed = [...BETA_API_ALLOWED]; const p = []
  if (allowed.length > 4) p.push(`la beta abre ${allowed.length} rutas de API (esperadas ≤ 4)`)
  for (const a of allowed) if (/publish|cron|oauth|youtube|instagram|tiktok|generate|queue|render\/ticket|webhook|automation/i.test(a)) p.push(`ruta abierta que no debe estarlo: ${a}`)
  return p
})
guard('exportación en tiempo real desactivada', () => (REALTIME_EXPORT_ENABLED === false ? [] : 'REALTIME_EXPORT_ENABLED no es false'))
// 5. Secretos en el repositorio (solo ubicaciones, nunca el valor)
guard('sin secretos ni ficheros .env versionados', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean)
  const p = []
  for (const f of files) if (/(^|\/)\.env(\.|$)/.test(f) && !/\.example$|\.sample$/.test(f)) p.push(`fichero de entorno versionado: ${f}`)
  const rules = [[/sk-[A-Za-z0-9_-]{24,}/, 'clave tipo sk-'], [/AKIA(?![0-9A-Z]{9}EXAMPLE)[0-9A-Z]{16}/, 'clave de acceso AWS (se admite solo el vector público «…EXAMPLE» de la documentación de AWS)'], [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'clave privada'], [/gh[pousr]_[A-Za-z0-9]{30,}/, 'token de GitHub'], [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'token de Slack'], [/sbp_[a-f0-9]{30,}/, 'token de acceso de Supabase'], [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}/, 'JWT literal']]
  for (const f of files) {
    if (/(^|\/)(package-lock\.json|.*\.(png|jpg|jpeg|gif|webp|ico|woff2?|mp4|mp3|wav|pdf))$/.test(f)) continue
    let txt; try { txt = readFileSync(path.join(root, f), 'utf8') } catch { continue }
    txt.split('\n').forEach((line, i) => { for (const [re, what] of rules) if (re.test(line)) p.push(`${f}:${i + 1}: posible ${what}`) })
  }
  return p
})
const failed = results.filter(r => !r.ok)
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`); for (const l of r.list) console.log(`        - ${l}`) }
console.log(`\n${failed.length ? 'DESPLIEGUE RECHAZADO' : 'APTO'}: ${results.length - failed.length}/${results.length} comprobaciones superadas`)
process.exit(failed.length ? 1 : 0)
