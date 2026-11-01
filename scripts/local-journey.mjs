// Local authenticated journey with the REAL @supabase/supabase-js client against: real PostgreSQL schema (reconstructed live baseline + pending),
// real PostgREST (RLS), SIMULATED Auth and SIMULATED Storage (see local-supabase-lite.mjs for what is and is not real). Synthetic data only.
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startLite } from './local-supabase-lite.mjs'

const { PGRST_URL, JWT_SECRET, PGDIR, PGPORT } = process.env, PORT = 54360
const sq = sql => execFileSync('psql', ['-h', PGDIR, '-p', PGPORT, '-U', 'postgres', '-X', '-q', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const anon = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'anon', iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` })()
const server = await startLite({ port: PORT, pgrst: PGRST_URL, secret: JWT_SECRET, storageDir: mkdtempSync(path.join(os.tmpdir(), 'lite-storage-')), onUserCreated: u => sq(`insert into auth.users (id, email, raw_user_meta_data) values ('${u.id}', '${u.email}', '{"name":"synthetic"}')`) })
const mk = () => createClient(`http://127.0.0.1:${PORT}`, anon, { auth: { persistSession: false, autoRefreshToken: false } })
let pass = 0, fail = 0
const t = async (name, fn) => { try { const r = await fn(); if (r === true) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name, '->', JSON.stringify(r)) } } catch (e) { fail++; console.log('FAIL ', name, '-> excepción', e.message) } }
const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) % 256))

console.log('== 1. alta, login y sesión (Auth SIMULADO) ==')
const A = mk(), B = mk(), anonC = mk()
const sa = await A.auth.signUp({ email: 'a@example.test', password: 'synthetic-pass-1' })
await t('signUp devuelve sesión y usuario', async () => !!sa.data.session?.access_token && !!sa.data.user?.id)
const uidA = sa.data.user.id
await t('el disparador crea el perfil del usuario (handle_new_user)', async () => sq(`select display_name from profiles where id='${uidA}'`) === 'synthetic')
await t('contraseña incorrecta -> error', async () => (await mk().auth.signInWithPassword({ email: 'a@example.test', password: 'mala-contraseña' })).error != null)
await A.auth.signOut()
const si = await A.auth.signInWithPassword({ email: 'a@example.test', password: 'synthetic-pass-1' })
await t('login con contraseña correcta', async () => !!si.data.session)
await t('getUser devuelve al mismo usuario', async () => (await A.auth.getUser()).data.user?.id === uidA)
await t('refresh de sesión funciona', async () => { const r = await mk().auth.refreshSession({ refresh_token: si.data.session.refresh_token }); return !!r.data.session })

console.log('== 2. Proyecto -> Guion -> Storyboard -> Escenas -> Editor -> MP4 -> Biblioteca ==')
const proj = (await A.from('projects').insert({ owner_id: uidA, name: 'Proyecto sintético' }).select().single()).data
await t('crear proyecto (RLS: owner = auth.uid())', async () => !!proj?.id)
const sc = (await A.from('scripts').insert({ owner_id: uidA, project_id: proj.id, title: 'Guion 1', sections: [{ id: 's1' }, { id: 's2' }] }).select().single()).data
await t('crear guion', async () => !!sc?.id)
const secs = [{ position: 1, duration_ms: 4000, narration: 'hook', metadata: { script_section_id: 's1' } }, { position: 2, duration_ms: 6000, narration: 'cuerpo', metadata: { script_section_id: 's2' } }]
const sb = await A.rpc('create_storyboard_from_script', { p_script_id: sc.id, p_scenes: secs })
await t('storyboard desde guion (RPC pendiente)', async () => !!sb.data)
await t('la segunda llamada es idempotente (mismo storyboard)', async () => (await A.rpc('create_storyboard_from_script', { p_script_id: sc.id, p_scenes: secs })).data === sb.data)
await t('escenas ordenadas y completas', async () => { const r = await A.from('scenes').select('position,duration_ms').eq('storyboard_id', sb.data).order('position'); return r.data?.length === 2 && r.data[0].position === 1 && r.data[1].duration_ms === 6000 })
const path1 = `${uidA}/${proj.id}/montaje.mp4`
const up = await A.storage.from('generated-assets').upload(path1, bytes, { contentType: 'video/mp4' })
await t('subir el MP4 a Storage (SIMULADO) bajo la carpeta del usuario', async () => !up.error)
const asset = (await A.from('assets').insert({ owner_id: uidA, project_id: proj.id, asset_type: 'video', storage_path: path1, license_status: 'generated' }).select().single()).data
await t('registrar el asset en la biblioteca', async () => !!asset?.id)
const rj = (await A.from('render_jobs').insert({ owner_id: uidA, project_id: proj.id, output_format: '16:9', status: 'completed', output_asset_id: asset.id, composition: { clips: [] } }).select().single()).data
await t('render job completado enlazado al asset', async () => rj?.output_asset_id === asset.id)

console.log('== 3. Cierre de sesión y reapertura ==')
await A.auth.signOut()
const A2 = mk(); await A2.auth.signInWithPassword({ email: 'a@example.test', password: 'synthetic-pass-1' })
await t('reabre: el proyecto sigue ahí', async () => (await A2.from('projects').select('id,name')).data?.[0]?.name === 'Proyecto sintético')
await t('reabre: guion, storyboard y 2 escenas persisten', async () => { const r = await A2.from('storyboards').select('id,script_id,scenes(id)').eq('id', sb.data).single(); return r.data?.script_id === sc.id && r.data.scenes.length === 2 })
await t('reabre: biblioteca lista el asset y el render job', async () => (await A2.from('assets').select('id')).data?.length === 1 && (await A2.from('render_jobs').select('status').eq('id', rj.id).single()).data?.status === 'completed')
const dl = await A2.storage.from('generated-assets').download(path1)
await t('reabre: el MP4 descargado es idéntico byte a byte', async () => !dl.error && Buffer.from(await dl.data.arrayBuffer()).equals(bytes))
const su = await A2.storage.from('generated-assets').createSignedUrl(path1, 60)
await t('URL firmada de descarga funciona', async () => { const r = await fetch(su.data.signedUrl); return r.ok && Buffer.from(await r.arrayBuffer()).equals(bytes) })
const sup = await A2.storage.from('generated-assets').createSignedUploadUrl(`${uidA}/${proj.id}/subtitulos.srt`)
await t('URL firmada de subida (createSignedUploadUrl + uploadToSignedUrl)', async () => { const r = await A2.storage.from('generated-assets').uploadToSignedUrl(sup.data.path, sup.data.token, Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nhola')); return !r.error })
await t('list de la carpeta del usuario devuelve 2 archivos', async () => (await A2.storage.from('generated-assets').list(`${uidA}/${proj.id}`)).data?.length === 2)

console.log('== 4. Aislamiento entre usuarios y anónimo ==')
await B.auth.signUp({ email: 'b@example.test', password: 'synthetic-pass-2' })
await t('B no ve proyectos, guiones, escenas ni assets de A', async () => (await B.from('projects').select('id')).data.length === 0 && (await B.from('scripts').select('id')).data.length === 0 && (await B.from('scenes').select('id')).data.length === 0 && (await B.from('assets').select('id')).data.length === 0)
await t('B no puede insertar en el proyecto de A (RLS)', async () => (await B.from('projects').insert({ owner_id: uidA, name: 'robo' })).error != null)
await t('B no puede crear storyboard sobre el guion de A', async () => /script_not_found/.test((await B.rpc('create_storyboard_from_script', { p_script_id: sc.id, p_scenes: secs })).error?.message ?? ''))
await t('B no puede descargar el MP4 de A', async () => (await B.storage.from('generated-assets').download(path1)).error != null)
await t('B no puede subir a la carpeta de A', async () => (await B.storage.from('generated-assets').upload(`${uidA}/${proj.id}/x.mp4`, bytes)).error != null)
await t('B no ve la carpeta de A al listar', async () => (await B.storage.from('generated-assets').list(`${uidA}/${proj.id}`)).data?.length === 0)
await t('B no puede pedir URL firmada de un archivo de A', async () => (await B.storage.from('generated-assets').createSignedUrl(path1, 60)).error != null)
await t('anónimo no ve datos', async () => ((await anonC.from('projects').select('id')).data ?? []).length === 0)
await t('anónimo no descarga Storage', async () => (await anonC.storage.from('generated-assets').download(path1)).error != null)
await t('token manipulado -> 401 en REST', async () => { const r = await fetch(`http://127.0.0.1:${PORT}/rest/v1/projects`, { headers: { apikey: anon, Authorization: 'Bearer ' + si.data.session.access_token.slice(0, -3) + 'abc' } }); return r.status === 401 })
await t('generation_spend: el usuario autenticado no puede escribir (solo servidor)', async () => (await A2.from('generation_spend').insert({ owner_id: uidA, request_id: 'x', provider: 'p', model: 'm', tier: 't', estimate_usd: 1 })).error != null)
await t('channel_connections y tokens: el usuario no puede leerlos directamente', async () => (await A2.from('channel_connections').select('*')).error != null)

console.log('== 5. Borrado en cascada ==')
await t('borrar el proyecto elimina guion, storyboard, escenas y render jobs', async () => { await A2.from('projects').delete().eq('id', proj.id); return sq(`select (select count(*) from scripts where project_id='${proj.id}')+(select count(*) from storyboards where project_id='${proj.id}')+(select count(*) from scenes where storyboard_id='${sb.data}')+(select count(*) from render_jobs where project_id='${proj.id}')`) === '0' })
await t('borrar el archivo de Storage', async () => (await A2.storage.from('generated-assets').remove([path1])).data?.length === 1)

console.log(`\nRESUMEN: ${pass} correctas, ${fail} fallidas`)
server.close(); process.exit(fail ? 1 : 0)
