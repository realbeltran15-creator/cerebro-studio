// Valida las dos migraciones PROPUESTAS (propiedad de proyectos y permisos de channel_connections) y sus rollbacks
// contra el stack OFICIAL local (GoTrue + PostgREST reales, usuarios reales). Solo datos sintéticos; nunca Production.
// Uso: lo lanza scripts/test-official-supabase.sh con JOURNEY_SCRIPT=official-proposals-check.mjs
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import path from 'node:path'
const { JWT_SECRET, PGDIR, PGPORT } = process.env, GW = Number(process.env.GATEWAY_PORT || 54321)
const root = path.resolve(new URL('..', import.meta.url).pathname), BASE = `http://127.0.0.1:${GW}`
const sq = (sql) => execFileSync('psql', ['-h', PGDIR, '-p', PGPORT, '-U', 'postgres', '-X', '-q', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const sqf = (f) => execFileSync('psql', ['-h', PGDIR, '-p', PGPORT, '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const anon = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'anon', iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` })()
let pass = 0, fail = 0
const t = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : '-> ' + extra) }
const J = { 'content-type': 'application/json' }
async function user(tag) {
  const email = `${tag}-${Date.now()}@beta.test`, password = 'Prueba-sintetica-1234'
  await fetch(`${BASE}/auth/v1/signup`, { method: 'POST', headers: { ...J, apikey: anon }, body: JSON.stringify({ email, password }) })
  const r = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { ...J, apikey: anon }, body: JSON.stringify({ email, password }) })).json()
  if (!r.access_token) throw new Error('sin sesión: ' + JSON.stringify(r).slice(0, 120))
  return { id: r.user.id, token: r.access_token }
}
const rest = (u, method, table, body, qs = '') => fetch(`${BASE}/rest/v1/${table}${qs}`, { method, headers: { ...J, apikey: anon, authorization: `Bearer ${u.token}`, prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ s: r.status, b: await r.text() }))

const A = await user('a'), B = await user('b')
const PA = (await (await rest(A, 'POST', 'projects', { owner_id: A.id, name: 'Proyecto A' })).b)
const pa = JSON.parse(PA)[0].id
const asset = (u, project) => rest(u, 'POST', 'assets', { owner_id: u.id, project_id: project, asset_type: 'image', storage_path: `t-${Math.random()}.png`, license_status: 'owned' })
sq(`insert into public.channel_connections(owner_id,provider,status) values ('${A.id}','youtube','connected') on conflict do nothing`)

// ANTES de aplicar nada
let r = await asset(B, pa)
t('antes: B inserta un activo apuntando al proyecto de A (el defecto reproducido con usuarios reales)', r.s === 201, `${r.s} ${r.b.slice(0, 100)}`)
r = await rest(A, 'GET', 'channel_connections', null, '?select=token_ciphertext')
console.log('INFO  antes: A pidiendo token_ciphertext recibe', r.s, '(el stack local no concede el GRANT que sí existe en Production; la propuesta lo deja por columnas)')

// APLICAR las dos propuestas
for (const f of ['20261105120000_channel_connections_status_read.sql', '20261105130000_project_ownership_check.sql']) {
  try { sqf(path.join(root, 'supabase/proposed', f)); t('aplica sin error: ' + f, true) } catch (e) { t('aplica sin error: ' + f, false, String(e.stderr || e).slice(0, 200)) }
}
r = await asset(B, pa); t('después: B ya NO inserta en el proyecto de A', r.s >= 400, `${r.s}`)
const pb = JSON.parse((await rest(B, 'POST', 'projects', { owner_id: B.id, name: 'Proyecto B' })).b)[0].id
r = await asset(B, pb); t('después: B sí inserta en su propio proyecto', r.s === 201, `${r.s} ${r.b.slice(0, 100)}`)
r = await asset(B, null); t('después: B sí inserta sin proyecto (Biblioteca general)', r.s === 201, `${r.s}`)
r = await rest(B, 'POST', 'render_jobs', { owner_id: B.id, project_id: pa, output_format: '16:9', status: 'draft', composition: {} }); t('después: B no crea trabajos de exportación en el proyecto de A', r.s >= 400, `${r.s}`)
r = await rest(A, 'GET', 'channel_connections', null, '?select=provider,status'); t('después: A lee estado de su conexión (provider,status)', r.s === 200 && r.b.includes('youtube'), `${r.s} ${r.b.slice(0, 80)}`)
for (const col of ['token_ciphertext', 'token_metadata', 'owner_id', '*']) { r = await rest(A, 'GET', 'channel_connections', null, `?select=${col}`); t(`después: A NO puede leer ${col}`, r.s >= 400, `${r.s} ${r.b.slice(0, 80)}`) }
r = await rest(A, 'PATCH', 'channel_connections', { status: 'revoked' }, '?provider=eq.youtube'); t('después: A no puede escribir en channel_connections', r.s >= 400, `${r.s}`)
r = await rest(B, 'GET', 'channel_connections', null, '?select=provider'); t('después: B no ve la conexión de A', r.s === 200 && r.b === '[]', `${r.s} ${r.b.slice(0, 80)}`)

// ROLLBACK
for (const f of ['20261105130000_project_ownership_check.rollback.sql', '20261105120000_channel_connections_status_read.rollback.sql']) {
  try { sqf(path.join(root, 'supabase/proposed', f)); t('rollback sin error: ' + f, true) } catch (e) { t('rollback sin error: ' + f, false, String(e.stderr || e).slice(0, 200)) }
}
r = await asset(B, pa); t('rollback: vuelve el comportamiento anterior (confirma que el rollback actúa)', r.s === 201, `${r.s}`)
// Reaplicar (idempotencia) y dejar el esquema como la beta lo espera
for (const f of ['20261105120000_channel_connections_status_read.sql', '20261105130000_project_ownership_check.sql', '20261105130000_project_ownership_check.sql']) sqf(path.join(root, 'supabase/proposed', f))
r = await asset(B, pa); t('reaplicar (dos veces): vuelve a bloquear', r.s >= 400, `${r.s}`)
console.log(`\nRESUMEN: ${pass} correctas, ${fail} fallidas`)
process.exit(fail ? 1 : 0)
