// Valida el registro cerrado de la beta (lista de correos) contra GoTrue/PostgREST OFICIALES locales. Solo datos sintéticos.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const { JWT_SECRET, PGDIR, PGPORT } = process.env, GW = Number(process.env.GATEWAY_PORT || 54321)
const root = path.resolve(new URL('..', import.meta.url).pathname), BASE = `http://127.0.0.1:${GW}`
const psql = (args) => execFileSync('psql', ['-h', PGDIR, '-p', PGPORT, '-U', 'postgres', '-X', '-q', ...args], { encoding: 'utf8' }).trim()
const sq = (sql) => psql(['-At', '-c', sql])
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const anon = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'anon', iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` })()
const J = { 'content-type': 'application/json' }
let pass = 0, fail = 0
const t = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS ' : 'FAIL ', n, ok ? '' : '-> ' + x) }
const signup = async (email) => { const r = await fetch(`${BASE}/auth/v1/signup`, { method: 'POST', headers: { ...J, apikey: anon }, body: JSON.stringify({ email, password: 'Prueba-sintetica-1234' }) }); return { s: r.status, b: await r.text() } }
const count = (email) => Number(sq(`select count(*) from auth.users where lower(email)='${email.toLowerCase()}'`))
// Solo el bloque del registro cerrado (el esquema completo ya está en el stack): se extrae del propio schema-beta.sql
const full = readFileSync(path.join(root, 'supabase/beta/schema-beta.sql'), 'utf8')
writeFileSync('/tmp/allowlist-block.sql', full.slice(full.indexOf('-- ===== Beta privada: registro CERRADO')))
psql(['-v', 'ON_ERROR_STOP=1', '-f', '/tmp/allowlist-block.sql'])
const ok = `ok-${Date.now()}@beta.test`, no = `intruso-${Date.now()}@beta.test`
let r = await signup(no); t('lista vacía: nadie se registra (falla cerrado)', r.s >= 400 && count(no) === 0, `${r.s} ${r.b.slice(0, 100)}`)
sq(`insert into public.beta_allowed_emails values ('${ok.toLowerCase()}')`)
r = await signup(ok); t('correo autorizado: se registra', r.s === 200 && count(ok) === 1, `${r.s} ${r.b.slice(0, 100)}`)
r = await signup(no); t('correo NO autorizado: rechazado y sin fila en auth.users', r.s >= 400 && count(no) === 0, `${r.s} ${r.b.slice(0, 100)}`)
r = await signup(ok.toUpperCase()); t('mayúsculas del correo autorizado: no duplican la cuenta', count(ok) === 1)
const rest = await fetch(`${BASE}/rest/v1/beta_allowed_emails?select=email`, { headers: { apikey: anon } }); t('la lista no es legible con la clave pública', rest.status >= 400 || (await rest.text()) === '[]', `${rest.status}`)
const ins = await fetch(`${BASE}/rest/v1/beta_allowed_emails`, { method: 'POST', headers: { ...J, apikey: anon }, body: JSON.stringify({ email: no.toLowerCase() }) }); t('un anónimo no puede añadirse a la lista', ins.status >= 400 && count(no) === 0, `${ins.status}`)
const lg = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { ...J, apikey: anon }, body: JSON.stringify({ email: ok, password: 'Prueba-sintetica-1234' }) }); t('el autorizado puede iniciar sesión', lg.status === 200, `${lg.status}`)
let up = ''; try { sq(`update auth.users set email='${no.toLowerCase()}' where lower(email)='${ok.toLowerCase()}'`) } catch { up = 'bloqueado' } t('cambiar el correo de una cuenta a uno no autorizado queda bloqueado', up === 'bloqueado')
console.log(`\nRESUMEN: ${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0)
