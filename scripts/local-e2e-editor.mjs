// E2E del recorrido audiovisual con el Editor REAL: Next.js real + Chromium real + PostgREST real (RLS) + Auth/Storage SIMULADOS (lite).
// El MP4 lo produce el Editor (RenderPanel → exportación rápida WebCodecs) en el navegador; aquí solo se verifica con FFprobe.
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startLite } from './local-supabase-lite.mjs'

const { PGRST_URL, JWT_SECRET, PGDIR, PGPORT, CHROMIUM_PATH } = process.env, LITE = 54380, WEB = 54381
const MEDIA = process.env.E2E_MEDIA || '/tmp/e2e-media'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const sq = sql => execFileSync('psql', ['-h', PGDIR, '-p', PGPORT, '-U', 'postgres', '-X', '-q', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const anon = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'anon', iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` })()
const storageDir = mkdtempSync(path.join(os.tmpdir(), 'lite-e2e-'))
const lite = await startLite({ port: LITE, pgrst: PGRST_URL, secret: JWT_SECRET, storageDir, onUserCreated: u => sq(`insert into auth.users (id, email, raw_user_meta_data) values ('${u.id}', '${u.email}', '{}')`) })
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${LITE}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon }
let pass = 0, fail = 0
const t = async (name, fn) => { try { const r = await fn(); if (r === true) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name, '->', JSON.stringify(r)) } } catch (e) { fail++; console.log('FAIL ', name, '-> excepción', e.message.split('\n').slice(0, 3).join(' | ')) } }
if (!process.env.SKIP_BUILD) { console.log('next build…'); const b = spawn('npx', ['next', 'build'], { cwd: root, env, stdio: 'ignore' }); const code = await new Promise(r => b.on('exit', r)); if (code) { console.log('FAIL build', code); process.exit(1) } }
const web = spawn('npx', ['next', 'start', '-p', String(WEB)], { cwd: root, env, stdio: 'ignore', detached: true })
process.on('exit', () => { try { process.kill(-web.pid) } catch {} })
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${WEB}/login`); break } catch { await new Promise(r => setTimeout(r, 500)) } }
const base = `http://127.0.0.1:${WEB}`
const browser = await chromium.launch({ executablePath: CHROMIUM_PATH })
const mkCtx = async () => { const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage(); page.errors = []; page.dialogs = []; page.on('dialog', d => { page.dialogs.push(d.message().slice(0, 160)); void d.accept() }); page.bad = []; page.on('requestfailed', r => page.bad.push(`FAILED ${r.url().slice(0, 140)} ${r.failure()?.errorText}`)); page.on('response', r => { if (r.status() >= 400) page.bad.push(`${r.status()} ${r.url().slice(0, 140)}`) }); page.on('console', m => { if (m.type() === 'error') page.bad.push('console: ' + m.text().slice(0, 200)) }); page.on('pageerror', e => page.errors.push(e.message)); page.on('response', r => { if (r.status() >= 500) page.errors.push(`${r.status()} ${r.url()}`) }); return { ctx, page } }
const settle = async p => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(400) }
const dump = async (p, label) => console.log(`   [${label}] url=${p.url()}\n` + (await p.locator('main').innerText().catch(() => '')).slice(0, 1500).split('\n').map(l => '     | ' + l).join('\n'))
const login = async (p, email, pw) => { await p.goto(base + '/login'); await p.getByLabel('Correo electrónico').fill(email); await p.locator('input[type=password]').fill(pw); await p.getByRole('button', { name: 'Entrar', exact: true }).click(); await p.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 }) }
const signup = async (p, email, pw) => { await p.goto(base + '/login'); await p.getByRole('button', { name: /Crear cuenta/ }).first().click().catch(() => {}); await p.getByLabel('Correo electrónico').fill(email); await p.locator('input[type=password]').fill(pw); await p.getByRole('button', { name: /Crear cuenta|Registrarme|Entrar/ }).last().click(); await p.waitForTimeout(1500) }
const EMAIL = 'editor-e2e@example.test', PW = 'synthetic-pass-e2e', PROJ = 'Proyecto E2E Editor'
const S = { bail: false }
const jobPath = () => sq(`select id from render_jobs where status='draft' order by updated_at desc limit 1`)
const step = async (name, fn) => { if (S.bail) return; await t(name, async () => { try { const r = await fn(); if (r !== true) S.bail = true; return r } catch (e) { S.bail = true; throw e } }) }
const finish = async () => { await browser.close(); web.kill(); lite.close(); console.log(`\nRESUMEN E2E EDITOR: ${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0) }
const { ctx, page } = await mkCtx()
// Alta de la cuenta usando el cliente real (el alta por UI se ejerce aparte); el resto es 100 % interfaz.
const seed = createClient(`http://127.0.0.1:${LITE}`, anon, { auth: { persistSession: false } })
await seed.auth.signUp({ email: EMAIL, password: PW })
await seed.auth.signUp({ email: 'otro-e2e@example.test', password: PW })

await step('1 login por la interfaz', async () => { await login(page, EMAIL, PW); return !/\/login/.test(page.url()) })
await step('2 crear proyecto en /projects', async () => { await page.goto(base + '/projects'); await settle(page); await page.getByLabel('Nombre del proyecto').fill(PROJ); await page.getByRole('button', { name: 'Crear proyecto' }).click(); await settle(page); return (await page.getByText(PROJ).count()) > 0 })
await step('3 crear guion v1 y rellenar texto', async () => {
  await page.goto(base + '/scripts'); await settle(page)
  await page.getByRole('button', { name: 'Crear guion v1' }).click(); await settle(page)
  await page.locator('#script-hook').fill('Una ciudad que nunca duerme.'); await page.locator('#script-cta').fill('Y tú, ¿qué harías?')
  const tas = page.locator('textarea[id^="t-"]'); const n = await tas.count(); for (let i = 0; i < n; i++) await tas.nth(i).fill(`Texto de la sección ${i + 1}. Narración sintética de prueba.`)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click(); await settle(page)
  return n > 0 || (await dump(page, 'guion'), false)
})
await step('4 convertir guion en storyboard con escenas', async () => {
  await page.getByRole('button', { name: 'Convertir en storyboard' }).click(); await settle(page); await page.waitForTimeout(1500)
  const rows = sq(`select count(*) from scenes`); console.log('   escenas en BD:', rows)
  return Number(rows) >= 2 || (await dump(page, 'tras convertir'), false)
})

await step('5 subir medios reales en /library (2 vídeos H.264/AAC + 1 imagen)', async () => {
  await page.goto(base + '/library'); await settle(page)
  const up = async (file, kind) => {
    if (!(await page.locator('#up-file').count())) { await page.getByRole('button', { name: 'Subir archivo' }).first().click(); await page.locator('#up-file').waitFor() }
    await page.locator('#up-file').setInputFiles(path.join(MEDIA, file))
    await page.locator('#up-kind').selectOption(kind)
    await page.locator('#up-project').selectOption({ label: PROJ })
    const title = page.locator('#up-title'); if (await title.count()) await title.fill(file)
    const lic = page.locator('#up-license'); if (await lic.count()) await lic.selectOption('owned')
    await page.getByRole('button', { name: 'Subir', exact: true }).click(); await settle(page); await page.waitForTimeout(1500)
  }
  await up('clip-a.mp4', 'video'); await up('clip-b.mp4', 'video'); await up('still.png', 'image')
  console.log('   assets:', sq(`select asset_type||':'||coalesce(storage_path,'-') from assets order by created_at`).replace(/\n/g, ' ; '))
  return Number(sq('select count(*) from assets where storage_path is not null')) === 3 || (await dump(page, 'library'), false)
})
await step('6 el Editor ensambla el montaje; se asignan medios a 3 escenas y se guarda', async () => {
  await page.goto(base + '/editor'); await settle(page); await page.waitForTimeout(1500)
  const vis = page.locator('section.panel select').filter({ has: page.locator('option', { hasText: 'Sin visual' }) })
  const nv = await vis.count(); console.log('   clips con selector visual:', nv)
  console.log('   opciones:', (await vis.first().locator('option').allInnerTexts()).join(' | '))
  for (let i = 0; i < 3; i++) await vis.nth(i).selectOption({ index: i + 1 })
  await page.getByRole('button', { name: 'Guardar montaje' }).click(); await settle(page); await page.waitForTimeout(1200)
  const n = Number(sq(`select count(*) from render_jobs where status='draft'`)); console.log('   borradores en BD:', n)
  const withAssets = sq(`select count(*) from render_jobs where status='draft' and composition::text like '%visualAssetId%'`)
  console.log('   borrador con visualAssetId:', withAssets)
  return n >= 1 || (await dump(page, 'editor'), false)
})
await step('7 abrir el Editor manual desde el enlace', async () => {
  await page.getByRole('link', { name: 'Abrir en el Editor manual' }).click(); await page.waitForURL(/\/editor\/manual\?job=/, { timeout: 20000 }); await settle(page); await page.waitForTimeout(2500)
  console.log('   errores de página:', page.errors); console.log('   peticiones malas:', page.bad.filter(x => !/googleapis|ERR_ABORTED|ERR_TUNNEL/.test(x)).slice(0, 12)); return true
})
await step('8 importar un audio real (WAV) con el Centro de importación', async () => {
  await page.getByRole('button', { name: /Música y sonidos/ }).first().click().catch(() => {}); await page.waitForTimeout(500)
  await page.locator('summary', { hasText: 'Importar o añadir' }).click(); await page.waitForTimeout(300)
  await page.locator('#ic-files').setInputFiles(path.join(MEDIA, 'music.wav')); await page.waitForTimeout(6000)
  console.log('   cola:', (await page.locator('[aria-label="Importar materiales"]').innerText().catch(() => '(sin panel)')).replace(/\n/g, ' / ').slice(0, 400), '|', page.bad.filter(x => !/googleapis|ERR_ABORTED|ERR_TUNNEL/.test(x)).slice(0, 5))
  const n = Number(sq(`select count(*) from assets where storage_path like '%.wav' or asset_type in ('music','voice','sfx')`)); console.log('   audios en BD:', n)
  return n >= 1 || (await dump(page, 'import'), false)
})
await step('9 opciones de exportación visibles', async () => {
  for (const l of ['Modo de exportación', 'Resolución', 'Calidad', 'Destino']) console.log('   ', l, '=', JSON.stringify(await page.getByLabel(l, { exact: true }).first().locator('option').allInnerTexts().catch(() => '?')))
  return true
})
await step('10 edición: música de fondo + guardar ahora (persistencia del montaje)', async () => {
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Sin música' }) }).first()
  const opts = await sel.locator('option').allInnerTexts(); console.log('   música:', opts)
  await sel.selectOption({ index: 1 }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Guardar ahora' }).click(); await page.waitForTimeout(2500)
  const musicId = sq(`select id from assets where asset_type in ('music') limit 1`)
  const stored = sq(`select (composition::text like '%${musicId}%')::text from render_jobs where status='draft' order by updated_at desc limit 1`)
  console.log('   música en el borrador guardado:', stored, '| id', musicId)
  return stored === 'true'
})
let exported = null
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { encoding: 'utf8' }))
const findFile = rel => { const out = []; const walk = d => { for (const n of readdirSync(d)) { const f = path.join(d, n); statSync(f).isDirectory() ? walk(f) : f.endsWith(rel) && out.push(f) } }; walk(storageDir); return out[0] }
await step('11 exportar MP4 (modo rápido, 480p, 24 fps) a la Biblioteca desde el RenderPanel', async () => {
  await page.getByRole('button', { name: /^Exportar/ }).first().click(); await page.locator('#ed-export').waitFor({ state: 'visible' })
  const pick = async (l, v) => page.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Modo de exportación', 'fast'); await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
  await page.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const t0 = Date.now(); let st = ''; await page.waitForTimeout(1500); console.log('   confirmaciones aceptadas:', page.dialogs)
  while (Date.now() - t0 < 270000) { st = sq(`select status from render_jobs where status<>'draft' order by created_at desc limit 1`); if (st === 'completed' || st === 'failed') break; await page.waitForTimeout(2000) }
  console.log('   estado del render:', st || '(sin job)', `en ${Math.round((Date.now() - t0) / 1000)} s`)
  if (st !== 'completed') { console.log('   error BD:', sq(`select coalesce(error,'-') from render_jobs where status<>'draft' order by created_at desc limit 1`)); console.log('   panel:', (await page.locator('#ed-export').innerText()).replace(/\n/g, ' / ').slice(-1400)); console.log('   peticiones malas:', page.bad.filter(x => !/googleapis|ERR_ABORTED|ERR_TUNNEL/.test(x)).slice(0, 6), page.errors.slice(0, 4)); return false }
  const a = sq(`select a.id||'|'||a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' order by r.created_at desc limit 1`)
  console.log('   asset de salida:', a); if (!a) return false
  const [id, sp] = a.split('|'); exported = { id, sp, file: findFile(sp.split('/').pop()) }
  return Boolean(exported.file)
})
await step('12 integridad del MP4 con FFprobe (duración, códecs, resolución, audio)', async () => {
  const j = probe(exported.file), v = j.streams.find(s => s.codec_type === 'video'), au = j.streams.find(s => s.codec_type === 'audio')
  const dur = Number(j.format.duration); console.log('   ffprobe:', JSON.stringify({ format: j.format.format_name, dur, size: Number(j.format.size), v: v && [v.codec_name, v.width, v.height, v.r_frame_rate], a: au && [au.codec_name, au.sample_rate, au.channels] }))
  execFileSync('ffmpeg', ['-v', 'error', '-i', exported.file, '-f', 'null', '-'], { encoding: 'utf8' }) // decodes the whole file; throws on corruption
  exported.dur = dur
  return Boolean(v) && /h264|avc|vp9|av1/.test(v.codec_name) && Math.abs(dur - 28) < 1.5 && Boolean(au) || { dur, v: v?.codec_name, a: au?.codec_name }
})
const luma = (f, ss) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(ss), '-i', f, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' })[0]
await step('13 contenido del MP4: imagen real en las escenas con medios, negro en las vacías, audio con señal', async () => {
  const early = luma(exported.file, 1), late = luma(exported.file, 26)
  const vol = spawnSync('ffmpeg', ['-v', 'info', '-i', exported.file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const mean = Number((/mean_volume: (-?[\d.]+) dB/.exec(vol) ?? [])[1])
  console.log('   luma t=1s:', early, '| luma t=26s:', late, '| volumen medio dB:', mean)
  return early > 40 && late < 25 && mean > -50 || { early, late, mean }
})
await step('14 el vídeo aparece en la Biblioteca y se descarga con los mismos bytes', async () => {
  await page.goto(base + '/library'); await settle(page); await page.waitForTimeout(1200)
  const txt = await page.locator('main').innerText(); const inList = /Montaje|render|\.mp4/i.test(txt)
  const bytes = await page.evaluate(async id => { const j = await (await fetch(`/api/assets/${id}/signed-url`)).json(); const b = await (await fetch(j.url)).arrayBuffer(); return b.byteLength }, exported.id)
  console.log('   bytes descargados vía URL firmada:', bytes, '| bytes en disco:', statSync(exported.file).size)
  return inList && bytes === statSync(exported.file).size || { inList, bytes }
})
await step('15 cerrar sesión por la interfaz: rutas protegidas vuelven a /login', async () => {
  await page.goto(base + '/projects'); await settle(page); await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await page.waitForTimeout(1500)
  await page.goto(base + '/editor/manual?job=' + jobPath()); await page.waitForTimeout(800)
  return /\/login/.test(page.url()) || page.url()
})
await step('16 reabrir sesión y proyecto: el montaje conserva clips, medios, música y la exportación', async () => {
  await login(page, EMAIL, PW); await page.goto(base + '/editor/manual?job=' + jobPath()); await settle(page); await page.waitForTimeout(3000)
  const txt = await page.locator('main').innerText()
  const comp = JSON.parse(sq(`select composition::text from render_jobs where status='draft' order by updated_at desc limit 1`))
  const visuals = comp.clips.filter(c => c.visualAssetId).length
  console.log('   en pantalla:', /8 clips/.test(txt), '| BD: clips', comp.clips.length, 'con medio', visuals, 'música', Boolean(comp.musicAssetId))
  const done = sq(`select count(*) from render_jobs where status='completed' and output_asset_id='${exported.id}'`)
  return /8 clips/.test(txt) && comp.clips.length === 8 && visuals === 3 && Boolean(comp.musicAssetId) && done === '1'
})
await step('17 aislamiento: otro usuario no ve el proyecto, el montaje ni los archivos', async () => {
  const o = await mkCtx(); await login(o.page, 'otro-e2e@example.test', PW)
  await o.page.goto(base + '/projects'); await settle(o.page)
  const sees = await o.page.getByText(PROJ).count()
  const job = jobPath(); await o.page.goto(base + '/editor/manual?job=' + job); await settle(o.page); await o.page.waitForTimeout(2500)
  const mtxt = await o.page.locator('main').innerText(); const leaked = /8 clips/.test(mtxt)
  const api = await o.page.evaluate(async id => (await fetch(`/api/assets/${id}/signed-url`)).status, exported.id)
  const lib = await (async () => { await o.page.goto(base + '/library'); await settle(o.page); return /clip-a\.mp4|clip-b\.mp4|still\.png|music\.wav/.test(await o.page.locator('main').innerText()) })()
  console.log('   otro usuario: ve proyecto', sees, '| ve el montaje', leaked, '| signed-url del MP4 ajeno →', api, '| ve medios en biblioteca', lib)
  await o.ctx.close()
  return sees === 0 && !leaked && [401, 403, 404].includes(api) && !lib || { sees, leaked, api, lib }
})
await step('18 recuperación: un medio desaparece del almacenamiento → la exportación falla con aviso y se recupera al restaurarlo', async () => {
  const comp = JSON.parse(sq(`select composition::text from render_jobs where status='draft' order by updated_at desc limit 1`))
  const sp = sq(`select storage_path from assets where id='${comp.clips[0].visualAssetId}'`); const f = findFile(sp.split('/').pop()); const hold = f + '.held'
  const { renameSync } = await import('node:fs'); renameSync(f, hold)
  const before = Number(sq(`select count(*) from render_jobs where status='completed'`))
  await page.goto(base + '/editor/manual?job=' + jobPath()); await settle(page); await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /^Exportar/ }).first().click(); await page.locator('#ed-export').waitFor({ state: 'visible' })
  await page.locator('#ed-export').getByLabel('Resolución', { exact: true }).first().selectOption('480'); await page.locator('#ed-export').getByLabel('Destino', { exact: true }).first().selectOption('library')
  await page.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const t0 = Date.now(); let st = ''
  while (Date.now() - t0 < 120000) { st = sq(`select status from render_jobs where status<>'draft' order by created_at desc limit 1`); const n = Number(sq(`select count(*) from render_jobs where status<>'draft'`)); if (n >= 2 && st !== 'rendering') break; await page.waitForTimeout(1500) }
  const err = sq(`select coalesce(error,'-') from render_jobs where status<>'draft' order by created_at desc limit 1`)
  const completed = Number(sq(`select count(*) from render_jobs where status='completed'`))
  console.log('   con el medio ausente → estado:', st, '| error guardado:', err.slice(0, 140), '| completados:', before, '→', completed, '| errores de página:', page.errors.length)
  const panelTxt = (await page.locator('#ed-export').innerText()).replace(/\n/g, ' / ')
  console.log('   aviso en pantalla:', (/(no se pudo|no están|falló|Error|ya no existe)[^/]{0,160}/i.exec(panelTxt) ?? ['(ninguno visible)'])[0])
  renameSync(hold, f)
  const failedAsReported = st === 'failed' && completed === before && /\[fase: [^·]+· id [0-9a-f]{6}\]/.test(err)
  return failedAsReported || { st, before, completed, err }
})
await step('19 tras restaurar el medio, la misma exportación se completa', async () => {
  const before = Number(sq(`select count(*) from render_jobs where status='completed'`))
  await page.reload(); await settle(page); await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /^Exportar/ }).first().click(); await page.locator('#ed-export').waitFor({ state: 'visible' })
  await page.locator('#ed-export').getByLabel('Resolución', { exact: true }).first().selectOption('480'); await page.locator('#ed-export').getByLabel('Destino', { exact: true }).first().selectOption('library')
  await page.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const t0 = Date.now(); let n = before
  while (Date.now() - t0 < 120000) { n = Number(sq(`select count(*) from render_jobs where status='completed'`)); if (n > before) break; await page.waitForTimeout(1500) }
  console.log('   completados:', before, '→', n, `en ${Math.round((Date.now() - t0) / 1000)} s`)
  return n === before + 1
})
await finish()
