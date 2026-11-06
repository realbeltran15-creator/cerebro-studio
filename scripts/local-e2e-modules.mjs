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
import { renameSync, writeFileSync, readFileSync as rfs } from 'node:fs'

const { PGRST_URL, JWT_SECRET, PGDIR, PGPORT, CHROMIUM_PATH } = process.env, LITE = 54380, WEB = 54382
const MEDIA = process.env.E2E_MEDIA || '/tmp/e2e-media'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const sq = sql => execFileSync('psql', ['-h', PGDIR, '-p', PGPORT, '-U', 'postgres', '-X', '-q', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const anon = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'anon', iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` })()
// OFFICIAL=1: Auth/Storage/PostgREST OFICIALES (scripts/test-official-supabase.sh) detrás de la pasarela de rutas; el medio se lee/borra por la API de Storage con la clave de servicio local.
const OFFICIAL = process.env.OFFICIAL === '1', GW = Number(process.env.GATEWAY_PORT || 54321)
const jwtFor = role => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role, iss: 'local', exp: 4102444800 }); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` }
const storageDir = mkdtempSync(path.join(os.tmpdir(), 'lite-e2e-'))
const lite = OFFICIAL ? { close() {} } : await startLite({ port: LITE, pgrst: PGRST_URL, secret: JWT_SECRET, storageDir, onUserCreated: u => sq(`insert into auth.users (id, email, raw_user_meta_data) values ('${u.id}', '${u.email}', '{}')`) })
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: '1', ...(process.env.E2E_BETA ? { NEXT_PUBLIC_CEREBRO_BETA: 'private' } : {}), CEREBRO_STOCK_FIXTURE: '1', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${OFFICIAL ? GW : LITE}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon }
let pass = 0, fail = 0
const t = async (name, fn) => { const T0 = Date.now(); try { const r = await fn(); console.log('   ⏱ ' + name.split(' ')[0] + ': ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s medidos'); if (r === true) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name, '->', JSON.stringify(r)) } } catch (e) { fail++; console.log('FAIL ', name, '-> excepción', e.message.split('\n').slice(0, 3).join(' | ')) } }
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
const ONLY = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null // p. ej. E2E_ONLY=1,2,3,4,5,M25,M30,M36,M39: ejecuta solo esos pasos (iteración rápida)
const step = async (name, fn) => { if (S.bail) return; if (ONLY && !ONLY.includes(name.split(' ')[0])) { console.log('SKIP ', name.slice(0, 60)); return }; await t(name, async () => { try { const r = await fn(); if (r !== true) S.bail = true; return r } catch (e) { S.bail = true; throw e } }) }
const finish = async () => { await browser.close(); web.kill(); lite.close(); console.log(`\nRESUMEN E2E MÓDULOS: ${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0) }
const { ctx, page } = await mkCtx()
// Alta de la cuenta usando el cliente real (el alta por UI se ejerce aparte); el resto es 100 % interfaz.
const seed = createClient(`http://127.0.0.1:${OFFICIAL ? GW : LITE}`, anon, { auth: { persistSession: false } })
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

const rj = () => sq(`select count(*) from render_jobs`)
await step('M1 Editar con mi estilo: elegir 3 materiales y montar', async () => {
  await page.goto(base + '/editor/style'); await settle(page); await page.waitForTimeout(800)
  const boxes = page.locator('main ul input[type=checkbox]'); const n = await boxes.count(); for (let i = 0; i < n; i++) await boxes.nth(i).check()
  console.log('   materiales marcados:', n)
  await page.getByRole('button', { name: /Editar automáticamente con mi estilo/ }).click()
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); if (/editor\/manual/.test(page.url()) || Number(rj()) > 0) break }
  await settle(page); await dump(page, 'tras montar'); console.log('   url:', page.url(), 'render_jobs:', rj())
  return true
})


await step('M2 el borrador guardado tiene 3 clips en el orden elegido y sobrevive a recargar', async () => {
  const comp = JSON.parse(sq(`select composition::text from render_jobs order by created_at desc limit 1`))
  const names = comp.clips.map(c => sq(`select asset_type||':'||coalesce(provenance->>'title',provenance->>'original_name','?') from assets where id='${c.visualAssetId}'`)).join(',')
  console.log('   orden de clips:', names, '· duraciones:', comp.clips.map(c => c.durationMs).join(','), '· claves clip:', Object.keys(comp.clips[0]).join(','))
  await page.goto(base + '/editor/manual'); await settle(page)
  const listed = await page.locator('main').innerText()
  return comp.clips.length === 3 && /Montaje con mi estilo[\s\S]*3 clips/.test(listed) && true
})
await step('M3 abrir el montaje en el editor manual y exportar (Renderizar y guardar)', async () => {
  await page.getByRole('button', { name: 'Abrir' }).first().click().catch(async () => { await page.getByText('Abrir', { exact: true }).first().click() }); await settle(page); await page.waitForTimeout(1500)
  console.log('   url:', page.url()); console.log('   botones:', (await page.locator('main button').allInnerTexts()).map(s => s.trim()).filter(Boolean).slice(0, 60).join(' | '))
  return true
})

const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { encoding: 'utf8' }))
const svc = jwtFor('service_role'), sbase = `http://127.0.0.1:${GW}/storage/v1/object`
const objName = rel => sq(`select name from storage.objects where bucket_id='generated-assets' and name like '%${rel.replace(/'/g, '')}' order by created_at desc limit 1`)
const download = rel => { const name = objName(rel); if (!name) return undefined; const dir = mkdtempSync(path.join(os.tmpdir(), 'mod-dl-')); const f = path.join(dir, rel); execFileSync('curl', ['-sf', '-H', `authorization: Bearer ${svc}`, '-o', f, `${sbase}/authenticated/generated-assets/${name}`]); return f }
await step('M4 exportar a MP4 el montaje «con mi estilo» y comprobarlo con FFprobe', async () => {
  await page.getByRole('button', { name: /^Exportar/ }).first().click(); await page.locator('#ed-export').waitFor({ state: 'visible' })
  const pick = async (l, v) => page.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
  await page.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const t0 = Date.now(); let st = ''
  while (Date.now() - t0 < 270000) { st = sq(`select status from render_jobs where status<>'draft' order by created_at desc limit 1`); if (st === 'completed' || st === 'failed') break; await page.waitForTimeout(2000) }
  console.log('   estado:', st || '(sin job)', `en ${Math.round((Date.now() - t0) / 1000)} s`)
  if (st !== 'completed') { console.log('   error:', sq(`select coalesce(error,'-') from render_jobs where status<>'draft' order by created_at desc limit 1`)); return false }
  const a = sq(`select a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' order by r.created_at desc limit 1`)
  const f = download(a.split('/').pop()); if (!f) return false
  const j = probe(f), v = j.streams.find(x => x.codec_type === 'video'); const dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  console.log('   ffprobe:', JSON.stringify({ dur, v: v && [v.codec_name, v.width, v.height] }))
  return Boolean(v) && Math.abs(dur - 27) < 1.5
})
await step('M5 guardar el montaje como plantilla (nombre duplicado rechazado)', async () => {
  await page.getByText('IA', { exact: true }).first().click(); await page.waitForTimeout(500)
  const save = page.getByRole('button', { name: 'Guardar como plantilla' }); const name = page.getByLabel('Nombre de la plantilla')
  await name.fill('Plantilla E2E'); await save.click(); await page.waitForTimeout(1200)
  const ok = await page.locator('main').innerText(); console.log('   ', (ok.match(/Plantilla «[^\n]+/) || ['(sin mensaje)'])[0])
  await save.click(); await page.waitForTimeout(1000)
  const dup = /Ya tienes una plantilla/.test(await page.locator('main').innerText())
  return /Plantilla «Plantilla E2E» guardada/.test(ok) && dup
})
await step('M6 la plantilla aparece en /editor/templates tras recargar', async () => {
  await page.goto(base + '/editor/templates'); await settle(page); await page.waitForTimeout(800)
  await dump(page, 'plantillas'); console.log('   botones:', (await page.locator('main button').allInnerTexts()).map(s => s.trim()).filter(Boolean).join(' | '))
  console.log('   campos:', (await page.locator('main select, main input').evaluateAll(els => els.map(e => `${e.tagName}${e.type ? ':' + e.type : ''}[${e.getAttribute('aria-label') || e.id || ''}]`))).join(' '))
  return /Plantilla E2E/.test(await page.locator('main').innerText())
})

// Medios sintéticos extra (se generan si faltan): raw.mp4 = 4 s rojo con tono + 3 s negro SIN audio + 5 s azul con tono; long.mp4 = 100 s con patrón y tono.
if (!existsSync(path.join(MEDIA, 'raw.mp4'))) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=24:d=4', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=24:d=3', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24:d=5', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=3', '-f', 'lavfi', '-i', 'sine=f=660:d=5', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(MEDIA, 'raw.mp4')])
if (!existsSync(path.join(MEDIA, 'long.mp4'))) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=100', '-f', 'lavfi', '-i', 'sine=f=330:d=100', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(MEDIA, 'long.mp4')])
const jobsDrafts = () => Number(sq(`select count(*) from render_jobs where status='draft'`))
await step('M7 crear un montaje desde la plantilla con otros archivos (misma estructura) y que aparezca en el editor manual', async () => {
  const before = jobsDrafts()
  const pickBy = async (n, label) => page.getByLabel(`Archivo para Visual ${n}`).selectOption({ label: new RegExp(label) }).catch(async () => { const opts = await page.getByLabel(`Archivo para Visual ${n}`).locator('option').allInnerTexts(); const o = opts.find(t => t.includes(label)); await page.getByLabel(`Archivo para Visual ${n}`).selectOption({ label: o }) })
  await page.getByLabel('Título del montaje').fill('Montaje desde plantilla')
  await pickBy(1, 'clip-a.mp4'); await pickBy(2, 'still.png'); await pickBy(3, 'clip-b.mp4')
  await page.getByRole('button', { name: 'Crear montaje con esta plantilla' }).click(); await settle(page); await page.waitForTimeout(1500)
  console.log('   url:', page.url(), '· borradores', before, '→', jobsDrafts())
  const comp = JSON.parse(sq(`select composition::text from render_jobs where status='draft' order by created_at desc limit 1`))
  const names = comp.clips.map(c => sq(`select provenance->>'title' from assets where id='${c.visualAssetId}'`)).join(',')
  console.log('   clips:', names, '· duraciones', comp.clips.map(c => c.durationMs).join(','), '· título:', comp.title)
  return jobsDrafts() === before + 1 && comp.clips.length === 3 && names === 'clip-a.mp4,still.png,clip-b.mp4' && comp.title === 'Montaje desde plantilla'
})
await step('M8 sin archivos en los huecos: aviso claro (clips en negro) y no se rompe', async () => {
  await page.goto(base + '/editor/templates'); await settle(page)
  const warn = /Sin archivo: Visual 1, Visual 2, Visual 3/.test(await page.locator('main').innerText())
  return warn
})
await step('M9 borrar la plantilla persiste tras recargar', async () => {
  await page.getByRole('button', { name: 'Borrar plantilla' }).click(); await page.getByRole('button', { name: 'Cancelar' }).click(); await page.waitForTimeout(300)
  const still = /Mis plantillas \(1\)/.test(await page.locator('main').innerText()) // cancelar no borra
  await page.getByRole('button', { name: 'Borrar plantilla' }).click(); await page.getByRole('button', { name: 'Confirmar borrado' }).click(); await page.waitForTimeout(1200)
  await page.reload(); await settle(page); await page.waitForTimeout(600)
  const t = await page.locator('main').innerText(); console.log('   diálogos:', page.dialogs, '· texto:', t.slice(0, 400).replace(/\n/g, ' / '))
  return still && /Todavía no tienes plantillas/.test(t)
})

await step('M10 Montaje automático: analizar un vídeo en bruto (silencios, cambios de plano)', async () => {
  await page.goto(base + '/editor/auto'); await settle(page); await page.waitForTimeout(800)
  const sels = page.locator('main select'); const opts = await sels.nth(1).locator('option').allInnerTexts(); console.log('   opciones vídeo:', opts.join(' | '))
  const o = opts.find(t => t.includes('clip-a.mp4')); await sels.nth(1).selectOption({ label: o })
  await page.getByRole('button', { name: 'Analizar vídeo' }).click()
  for (let i = 0; i < 90; i++) { await page.waitForTimeout(1000); if (await page.getByRole('button', { name: /Crear|Montar|Aplicar|Guardar|Abrir/ }).count()) break }
  await settle(page); await dump(page, 'tras analizar')
  console.log('   botones:', (await page.locator('main button, main a.buttonLink').allInnerTexts()).map(s => s.trim()).filter(Boolean).join(' | '))
  return true
})

await step('M11 subir un vídeo en bruto con silencio y cambios de plano; el análisis lo detecta y el montaje lo recorta', async () => {
  await page.goto(base + '/library'); await settle(page)
  if (!(await page.locator('#up-file').count())) { await page.getByRole('button', { name: 'Subir archivo' }).first().click(); await page.locator('#up-file').waitFor() }
  await page.locator('#up-file').setInputFiles(path.join(MEDIA, 'raw.mp4')); await page.locator('#up-kind').selectOption('video')
  await page.locator('#up-project').selectOption({ label: PROJ }); const ti = page.locator('#up-title'); if (await ti.count()) await ti.fill('raw.mp4')
  const lic = page.locator('#up-license'); if (await lic.count()) await lic.selectOption('owned')
  await page.getByRole('button', { name: 'Subir', exact: true }).click(); await settle(page); await page.waitForTimeout(2000)
  await page.goto(base + '/editor/auto'); await settle(page); await page.waitForTimeout(800)
  const sels = page.locator('main select'); const opts = await sels.nth(1).locator('option').allInnerTexts()
  await sels.nth(1).selectOption({ label: opts.find(t => t.includes('raw.mp4')) })
  await page.getByRole('button', { name: 'Analizar vídeo' }).click()
  await page.getByRole('button', { name: /Crear montaje/ }).waitFor({ timeout: 90000 }); await page.waitForTimeout(500)
  const res = (await page.locator('main').innerText()).match(/Duración \d[^\n]*silencios[^\n]*/)?.[0] || ''; console.log('   análisis:', res)
  const before = jobsDrafts()
  await page.getByRole('button', { name: /Crear montaje/ }).click(); await settle(page); await page.waitForTimeout(2000)
  const comp = JSON.parse(sq(`select composition::text from render_jobs where status='draft' order by created_at desc limit 1`))
  const total = comp.clips.reduce((n, c) => n + c.durationMs, 0)
  console.log('   url:', page.url(), '· borradores', before, '→', jobsDrafts(), '· clips', comp.clips.length, '· total ms', total, '· formato', comp.format)
  const silencios = /([1-9]\d*) silencios? quitados?/.test(res) || /[1-9] silencios/.test(res)
  return jobsDrafts() === before + 1 && total < 11000 && total > 6000 && silencios || { res, total }
})


await step('M12 Repurpose: de un montaje horizontal a una versión vertical 9:16 (Shorts) con escenas elegidas', async () => {
  await page.goto(base + '/repurpose'); await settle(page); await page.waitForTimeout(1000)
  const src = page.getByLabel('Montaje de origen'); const opts = await src.locator('option').allInnerTexts()
  await src.selectOption({ label: opts.find(t => t.includes('Montaje con mi estilo')) }); await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Sugerir para YouTube Shorts' }).click(); await page.waitForTimeout(500)
  const sel = (await page.locator('main').innerText()).match(/Seleccionado: [^\n]+/)?.[0]; console.log('   ', sel)
  await page.getByRole('button', { name: 'Preparar versión vertical 9:16' }).click(); await page.waitForTimeout(1200)
  const t = await page.locator('main').innerText(); console.log('   tras preparar:', t.slice(t.indexOf('Preparar versión vertical') + 25, t.indexOf('Preparar versión vertical') + 900).replace(/\n/g, ' / '))
  console.log('   botones:', (await page.locator('main button').allInnerTexts()).map(s => s.trim()).filter(Boolean).join(' | '))
  return true
})

await step('M13 Repurpose: reencuadre elegido, render vertical a MP4 y comprobación con FFprobe', async () => {
  const sl = page.locator('main input[type=range]'); const n = await sl.count(); console.log('   deslizadores de encuadre:', n)
  if (n) await sl.first().fill('0.15')
  const done0 = Number(sq(`select count(*) from render_jobs where status='completed'`))
  const ex = page.locator('main').getByRole('button', { name: 'Renderizar y guardar' }); await ex.first().click()
  const t0 = Date.now(); let st = ''
  while (Date.now() - t0 < 270000) { st = sq(`select status from render_jobs where status<>'draft' order by created_at desc limit 1`); if (Number(sq(`select count(*) from render_jobs where status='completed'`)) > done0 || st === 'failed') break; await page.waitForTimeout(2000) }
  console.log('   estado:', st, `en ${Math.round((Date.now() - t0) / 1000)} s`, '· error:', sq(`select coalesce(error,'-') from render_jobs order by created_at desc limit 1`))
  const row = sq(`select r.output_format||'|'||a.storage_path||'|'||(r.composition->'clips'->0->>'focusX') from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' order by r.updated_at desc limit 1`)
  console.log('   job:', row); const [fmt, sp, fx] = row.split('|')
  const f = download(sp.split('/').pop()); const j = probe(f), v = j.streams.find(x => x.codec_type === 'video'); const dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  console.log('   ffprobe:', JSON.stringify({ dur, v: [v.codec_name, v.width, v.height] }))
  return fmt === '9:16' && v.height > v.width && Math.abs(dur - 27) < 1.5 && Number(fx) < 0.3
})

await step('M14 Repurpose desde un vídeo largo: transcripción sintética → momentos propuestos → borradores 9:16', async () => {
  await page.goto(base + '/library'); await settle(page)
  if (!(await page.locator('#up-file').count())) { await page.getByRole('button', { name: 'Subir archivo' }).first().click(); await page.locator('#up-file').waitFor() }
  await page.locator('#up-file').setInputFiles(path.join(MEDIA, 'long.mp4')); await page.locator('#up-kind').selectOption('video')
  await page.locator('#up-project').selectOption({ label: PROJ }); const ti = page.locator('#up-title'); if (await ti.count()) await ti.fill('long.mp4')
  const lic = page.locator('#up-license'); if (await lic.count()) await lic.selectOption('owned')
  await page.getByRole('button', { name: 'Subir', exact: true }).click(); await settle(page); await page.waitForTimeout(3000)
  const vid = sq(`select id from assets where provenance->>'title'='long.mp4' limit 1`); const owner = sq(`select owner_id from assets where id='${vid}'`); const proj = sq(`select project_id from assets where id='${vid}'`)
  // TRANSCRIPCIÓN SINTÉTICA sembrada en BD (la transcripción real exige Groq/Cloudflare, servicio externo que no se llama aquí)
  const phrases = ['Nadie sabe por qué esto pasa en realidad.', 'La razón es más simple de lo que imaginas.', 'Primero hay que entender el error más común.', 'Cuando lo haces mal, el resultado empeora siempre.', 'Hay tres pasos que cambian todo el proceso.', 'El mejor truco es medir antes de decidir.', 'Con 20 minutos al día se nota la diferencia.', 'Y eso es lo que casi nadie te cuenta nunca.']
  const segs = Array.from({ length: 20 }, (_, i) => ({ start: i * 5, end: i * 5 + 4.6, text: phrases[i % phrases.length] }))
  const prov = JSON.stringify({ title: 'long.mp4 (transcripción sintética)', sourceAssetId: vid, segments: segs }).replace(/'/g, "''")
  sq(`insert into assets(owner_id, project_id, asset_type, license_status, provenance) values ('${owner}','${proj}','subtitle','owned','${prov}')`)
  await page.goto(base + '/repurpose'); await settle(page); await page.waitForTimeout(1200)
  await page.locator('#lv-video').selectOption({ label: 'long.mp4' }); await page.locator('#lv-len').selectOption('20-58'); await page.locator('#lv-count').selectOption('5'); await page.waitForTimeout(600)
  const items = await page.locator('ol[aria-label="Momentos propuestos"] li').count(); console.log('   momentos propuestos:', items)
  const reasons = await page.locator('ol[aria-label="Momentos propuestos"] li').first().innerText(); console.log('   primer momento:', reasons.replace(/\n/g, ' / ').slice(0, 260))
  const before = jobsDrafts()
  await page.getByRole('button', { name: 'Elegir todos' }).click(); await page.getByRole('button', { name: /^Crear \d+ Short/ }).click(); await page.waitForTimeout(2500)
  const made = jobsDrafts() - before; console.log('   borradores creados:', made)
  const rows = sq(`select (select count(*) from jsonb_array_elements(composition->'clips')) ||':'|| output_format from render_jobs where status='draft' order by created_at desc limit ${made}`).split('\n')
  console.log('   (clips:formato):', rows.join(' '))
  const comp = JSON.parse(sq(`select composition::text from render_jobs where status='draft' order by created_at desc limit 1`))
  const c0 = comp.clips[0]; console.log('   primer clip: trimInMs', c0.trimInMs, 'durationMs', c0.durationMs, 'claves:', Object.keys(comp).join(','))
  return items >= 1 && made === items && rows.every(r => r.endsWith(':9:16')) && comp.clips.every(c => c.durationMs >= 15000 && c.durationMs <= 58500)
})

await step('M15 aislamiento: otro usuario no ve borradores, materiales ni transcripciones, y no puede modificarlos', async () => {
  const other = createClient(`http://127.0.0.1:${GW}`, anon, { auth: { persistSession: false } })
  const { error: le } = await other.auth.signInWithPassword({ email: 'otro-e2e@example.test', password: PW }); if (le) return { le: le.message }
  const jobs = await other.from('render_jobs').select('id'); const assets = await other.from('assets').select('id')
  const target = sq(`select id from render_jobs where status='draft' limit 1`)
  const upd = await other.from('render_jobs').update({ status: 'failed' }).eq('id', target).select('id'); const del = await other.from('render_jobs').delete().eq('id', target).select('id')
  const still = sq(`select status from render_jobs where id='${target}'`)
  console.log('   ve render_jobs:', jobs.data?.length, '· assets:', assets.data?.length, '· update afectó:', upd.data?.length, '· delete afectó:', del.data?.length, '· estado intacto:', still)
  return jobs.data?.length === 0 && assets.data?.length === 0 && !upd.data?.length && !del.data?.length && still === 'draft'
})


const ext = []; page.on('request', r => { try { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.protocol.startsWith('http')) ext.push(u.hostname) } catch {} })
const extNow = () => [...new Set(ext)].filter(h => !/fonts\.(googleapis|gstatic)\.com$/.test(h))
await step('M16 Workflows: estado calculado, «Dar visto bueno» persiste y los filtros cuentan bien', async () => {
  await page.goto(base + '/workflows'); await settle(page); await page.waitForTimeout(1000)
  const t0 = await page.locator('main').innerText(); const done0 = Number((t0.match(/(\d) de 8 pasos hechos/) || [])[1])
  await page.getByRole('button', { name: 'Ver detalle' }).click().catch(() => {}); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Dar visto bueno' }).first().click(); await page.waitForTimeout(1500)
  const t1 = await page.locator('main').innerText(); console.log('   antes:', done0, 'pasos · materiales:', (t0.match(/Materiales\n· ([^\n]+)/) || [])[1], '→', (t1.match(/Materiales\n· ([^\n]+)/) || [])[1], '· botones:', (await page.locator('main button').allInnerTexts()).filter(Boolean).join(' | '))
  await page.reload(); await settle(page); await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Ver detalle' }).click().catch(() => {}); await page.waitForTimeout(400)
  const t2 = await page.locator('main').innerText(); const done2 = Number((t2.match(/(\d) de 8 pasos hechos/) || [])[1])
  console.log('   tras recargar:', done2, 'pasos · materiales:', (t2.match(/Materiales\n· ([^\n]+)/) || [])[1], '· montaje:', (t2.match(/Montaje\n· ([^\n]+)/) || [])[1], '·', t2.match(/Requieren atención \(\d+\)/)?.[0])
  return done2 > done0 && /Materiales\n· Hecho/.test(t2)
})
await step('M17 Workflows: un render fallido aparece con su error y enlace para reintentar', async () => {
  const own = sq(`select owner_id from render_jobs limit 1`); const pid = sq(`insert into projects(owner_id, name) values ('${own}','Proyecto con render fallido') returning id`).split('\n')[0]
  sq(`insert into render_jobs(owner_id, project_id, output_format, status, error) values ('${own}','${pid}','16:9','failed','Error sintético de prueba: códec no soportado')`)
  await page.reload(); await settle(page); await page.waitForTimeout(1000)
  for (const b of await page.getByRole('button', { name: 'Ver detalle' }).all()) await b.click().catch(() => {}); await page.waitForTimeout(500)
  const t = await page.locator('main').innerText(); const links = await page.locator('main a').evaluateAll(a => a.map(x => x.innerText.trim() + '→' + x.getAttribute('href')))
  console.log('   enlaces:', links.join(' | ')); console.log('   texto de error:', /códec no soportado/.test(t), (t.match(/El último render falló[^\n]*/) || ['-'])[0], '· atención:', t.match(/Requieren atención \(\d+\)/)?.[0])
  return /códec no soportado/.test(t) && links.some(l => /^Reintentar render→\/editor\?project=/.test(l))
})
await step('M18 Workflows/Calendario/Costes/Campañas no contactan con hosts externos', async () => { console.log('   hosts externos vistos hasta ahora:', extNow().join(',') || '(ninguno)'); return extNow().length === 0 })

await step('M19 Calendario: crear borradores en 2 plataformas (nada se publica), fecha prevista visible, duplicado avisa', async () => {
  await page.goto(base + '/calendar'); await settle(page); await page.waitForTimeout(1200)
  await page.locator('main form select').first().selectOption({ label: PROJ }); await page.waitForTimeout(500)
  const vsel = page.locator('main form select').nth(1); const vopts = await vsel.locator('option').allInnerTexts(); console.log('   vídeos:', vopts.join(' | '))
  await vsel.selectOption({ index: 1 })
  const d = new Date(); d.setDate(d.getDate() + 3); const key = d.toISOString().slice(0, 10)
  await page.locator('main form input[type=date]').fill(key); await page.locator('main form input:not([type=date]):not([type=checkbox])').fill('Título de prueba E2E'); await page.locator('main form textarea').fill('Descripción de prueba')
  await page.getByRole('checkbox', { name: 'YouTube' }).check(); await page.getByRole('checkbox', { name: 'Instagram' }).check()
  const btn = page.getByRole('button', { name: /^Crear \d borradores?/ }); console.log('   botón:', await btn.innerText())
  await btn.click(); await page.waitForTimeout(1800)
  const rows = sq(`select platform||':'||status||':'||coalesce(scheduled_for::date::text,'-') from publication_jobs order by platform`).split('\n'); console.log('   filas:', rows.join(' '))
  const msg = (await page.locator('main').innerText()).match(/\d borradores creados[^\n]+/)?.[0]; console.log('   aviso:', msg)
  const notPub = !sq(`select count(*) from publication_jobs where status not in ('draft','awaiting_approval')`).replace('0', '') // ninguna publicada
  await page.reload(); await settle(page); await page.waitForTimeout(1000)
  const body = await page.locator('main').innerText()
  const inGrid = new RegExp('Título de prueba E2E|YouTube|Instagram').test(body)
  // duplicado: mismo vídeo + misma plataforma
  await page.locator('main form select').first().selectOption({ label: PROJ }); await page.waitForTimeout(400); await page.locator('main form select').nth(1).selectOption({ index: 1 }); await page.getByRole('checkbox', { name: 'YouTube' }).check(); await page.waitForTimeout(400)
  const dupWarn = /duplic|ya (hay|existe|tienes)/i.test(await page.locator('main').innerText())
  console.log('   aviso de duplicado:', dupWarn, '· visible en calendario:', inGrid)
  return rows.length === 2 && rows.every(r => /:draft:/.test(r)) && rows.every(r => r.endsWith(key)) && notPub && dupWarn
})
await step('M20 Calendario: cambiar y quitar la fecha prevista de un borrador persiste (recordatorio, no publica)', async () => {
  await page.goto(base + '/calendar'); await settle(page); await page.waitForTimeout(1000)
  const d = new Date(); d.setDate(d.getDate() + 6); const key = d.toISOString().slice(0, 10)
  const input = page.getByLabel(/Cambiar la fecha prevista de Título de prueba E2E/).first(); await input.fill(key); await page.waitForTimeout(1200)
  const moved = sq(`select count(*) from publication_jobs where scheduled_for::date='${key}'`)
  await page.reload(); await settle(page); await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Quitar fecha' }).first().click(); await page.waitForTimeout(1200)
  const left = sq(`select count(*) from publication_jobs where scheduled_for is not null`)
  const st = sq(`select string_agg(distinct status, ',') from publication_jobs`)
  const t = await page.locator('main').innerText(); console.log('   movidos:', moved, '· con fecha tras quitar 1:', left, '· estados:', st, '· sin fecha ahora:', t.match(/Sin fecha \(\d+\)/)?.[0])
  return Number(moved) >= 1 && Number(left) === 1 && st === 'draft' && /Sin fecha \(1\)/.test(t)
})

await step('M21 Costes: cálculos con generaciones FICTICIAS, filtros de periodo y proyecto, sin llamadas facturables', async () => {
  const own = sq(`select owner_id from projects limit 1`); const pj = sq(`select id from projects where name='${PROJ}'`); const pj2 = sq(`select id from projects where name='Proyecto con render fallido'`)
  const ins = (proj, days, prov) => sq(`insert into assets(owner_id, project_id, asset_type, license_status, source_provider, provenance, created_at) values ('${own}','${proj}','image','generated','ficticio','${JSON.stringify(prov).replace(/'/g, "''")}', now() - interval '${days} days')`)
  ins(pj, 2, { providerName: 'ProveedorFalso', catalogModel: 'modelo-a', costTier: 'paid', estimateUsd: 0.25 })
  ins(pj, 3, { providerName: 'ProveedorFalso', catalogModel: 'modelo-a', costTier: 'paid', estimateUsd: 0.25 })
  ins(pj2, 5, { providerName: 'ProveedorFalso', catalogModel: 'modelo-b', costTier: 'paid', estimateUsd: 0.10 })
  ins(pj, 6, { providerName: 'OtroFalso', catalogModel: 'modelo-gratis', costTier: 'free_allowance', estimateUsd: 0 })
  ins(pj, 60, { providerName: 'ProveedorFalso', catalogModel: 'modelo-a', costTier: 'paid', estimateUsd: 0.40 })   // fuera de 30 días, dentro de 90
  ins(pj, 200, { providerName: 'ProveedorFalso', catalogModel: 'modelo-a', costTier: 'paid', estimateUsd: 1.00 })  // solo en «Todo»
  const val = async () => { await page.waitForTimeout(500); const t = await page.locator('main').innerText(); const g = (l) => (t.match(new RegExp(`${l}\\n(\\$?[\\d.,]+|—)`)) || [])[1]; return { gen: g('Generaciones'), free: g('Gratis / cupo gratuito'), cost: g('Coste estimado \\(de pago\\)') } }
  await page.goto(base + '/usage'); await settle(page); await page.waitForTimeout(1200)
  const r30 = await val(); await page.locator('#u-range').selectOption('90'); const r90 = await val(); await page.locator('#u-range').selectOption('all'); const rAll = await val()
  await page.locator('#u-range').selectOption('30'); await page.locator('#u-project').selectOption({ label: 'Proyecto con render fallido' }); const rP = await val()
  console.log('   30 d:', JSON.stringify(r30), '· 90 d:', JSON.stringify(r90), '· todo:', JSON.stringify(rAll), '· solo proyecto 2 (30 d):', JSON.stringify(rP))
  await page.reload(); await settle(page); await page.waitForTimeout(800)
  const rows = await page.locator('main').innerText(); console.log('   tabla:', /ProveedorFalso/.test(rows), /modelo-a/.test(rows), '· hosts externos:', extNow().join(',') || '(ninguno)')
  return r30.gen === '4' && r30.free === '1' && r30.cost === '$0.60' && r90.gen === '5' && r90.cost === '$1.00' && rAll.gen === '6' && rAll.cost === '$2.00' && rP.gen === '1' && rP.cost === '$0.10' && extNow().length === 0
})



await step('M22 Campañas: rellenar el brief con datos ficticios y revisar estrategia, presupuesto e informe', async () => {
  await page.goto(base + '/campaigns'); await settle(page); await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '+ Nueva campaña' }).first().click(); await page.waitForTimeout(800)
  const f = () => page.locator('main select, main input, main textarea')
  await f().nth(2).fill('Campaña E2E ficticia'); await f().nth(3).selectOption({ label: 'Canal de Shorts / vídeo vertical' }); await f().nth(4).selectOption({ label: 'Proyecto E2E Editor' })
  await f().nth(5).selectOption({ label: 'Un canal' }); await f().nth(6).fill('Canal de prueba'); await f().nth(8).selectOption({ label: 'Suscriptores / seguidores' })
  await f().nth(9).fill('18'); await f().nth(10).fill('34'); await f().nth(11).fill('música, estudio'); await f().nth(12).fill('Estudiantes que necesitan concentrarse')
  await f().nth(13).selectOption('EUR'); await f().nth(14).fill('300'); await f().nth(15).fill('20'); await f().nth(16).fill('30'); await f().nth(17).fill('2026-12-01')
  await f().nth(18).selectOption({ label: 'Suscriptores' }); await f().nth(19).fill('500'); await page.waitForTimeout(800)
  const head = (await page.locator('main').innerText()).match(/\d de 9 preguntas respondidas/)?.[0]; console.log('   progreso:', head)
  console.log('   BOTONES>>', (await page.locator('main button, main [role=tab]').allInnerTexts()).map(x=>x.trim()).filter(Boolean).join(' | ').slice(0,900))
  for (const tab of ['Estrategia', 'Presupuesto y calendario', 'Resultados y reglas', 'Informe']) {
    await page.locator('main button', { hasText: tab }).first().click(); await page.waitForTimeout(700)
    const t = await page.locator('main').innerText(); console.log(`   TAB ${tab}>>`, t.slice(t.indexOf(tab === 'Informe' ? 'Informe' : 'Brief') + 5).replace(/\n+/g, ' / ').slice(0, 1500))
  }
  return true
})
await step('M23 Campañas: persistencia tras recargar, duplicar, eliminar y sin llamadas externas', async () => {
  await page.reload(); await settle(page); await page.waitForTimeout(1500)
  const sel = page.locator('main select').first()
  const opts = await sel.locator('option').allInnerTexts(); console.log('   opciones:', opts.join(' | '))
  if (!opts.some(o => o.includes('Campaña E2E ficticia'))) throw new Error('la campaña no persiste tras recargar')
  await sel.selectOption({ label: opts.find(o => o.includes('Campaña E2E ficticia')) }); await page.waitForTimeout(500)
  if (!(await page.locator('main').innerText()).includes('7 de 9')) throw new Error('el brief no se restauró')
  await page.getByRole('button', { name: 'Duplicar' }).click(); await page.waitForTimeout(800)
  const o2 = await page.locator('main select').first().locator('option').allInnerTexts(); console.log('   tras duplicar:', o2.join(' | '))
  if (o2.length !== opts.length + 1) throw new Error('duplicar no añadió una campaña')
  await page.getByRole('button', { name: 'Eliminar' }).click(); await page.waitForTimeout(800)
  const o3 = await page.locator('main select').first().locator('option').allInnerTexts(); console.log('   tras eliminar:', o3.join(' | '))
  if (o3.length !== opts.length) throw new Error('eliminar no quitó la copia')
  const ext = extNow(); if (ext.length) throw new Error('llamadas externas: ' + ext.join(','))
  return true
})
await step('M24 Miniaturas: texto sobre una imagen propia, 100 % local y gratis', async () => {
  await page.goto(base + '/thumbnails'); await settle(page); await page.waitForTimeout(1000)
  await page.locator('#thumb-project').selectOption({ label: PROJ }); await page.waitForTimeout(2000)
  const body = await page.locator('main').innerText()
  if (!body.includes('Imagen tuya')) throw new Error('la imagen propia no aparece como base')
  const before = sq(`select count(*) from assets where asset_type='thumbnail'`)
  await page.getByRole('button', { name: 'Añadir texto encima' }).first().click()
  await page.locator('input[id^="ct-"]').first().fill('MI TEXTO')
  await page.getByRole('button', { name: 'Crear copia con texto' }).click(); await page.waitForTimeout(4000)
  const after = sq(`select count(*) from assets where asset_type='thumbnail'`)
  console.log('   miniaturas antes/después:', before, after)
  if (Number(after) !== Number(before) + 1) throw new Error('no se creó la miniatura compuesta')
  await page.reload(); await settle(page); await page.locator('#thumb-project').selectOption({ label: PROJ }); await page.waitForTimeout(2000)
  if (!(await page.locator('main').innerText()).includes('MI TEXTO')) throw new Error('no persiste tras recargar')
  // formatos y resolución reales de los ficheros guardados
  for (const [asp, w, h] of [['9:16', 720, 1280], ['1:1', 1080, 1080]]) {
    await page.locator('select[id^="ca-"]').first().selectOption(asp).catch(async () => {
      await page.getByRole('button', { name: 'Añadir texto encima' }).first().click(); await page.locator('input[id^="ct-"]').first().fill('FORMATO ' + asp); await page.locator('select[id^="ca-"]').first().selectOption(asp)
    })
    if (!(await page.locator('input[id^="ct-"]').count())) { await page.getByRole('button', { name: 'Añadir texto encima' }).first().click() }
    await page.locator('input[id^="ct-"]').first().fill('FORMATO ' + asp); await page.locator('select[id^="ca-"]').first().selectOption(asp)
    await page.getByRole('button', { name: 'Crear copia con texto' }).click(); await page.waitForTimeout(4000)
    await page.reload(); await settle(page); await page.locator('#thumb-project').selectOption({ label: PROJ }); await page.waitForTimeout(2500)
  }
  const dims = await page.evaluate(async () => {
    const out = []
    for (const img of Array.from(document.querySelectorAll('main article img'))) { const r = await fetch(img.src); const b = await r.blob(); const bm = await createImageBitmap(b); out.push(`${b.type} ${bm.width}x${bm.height}`) }
    return out
  })
  console.log('   ficheros:', dims.join(' | '))
  for (const want of ['image/jpeg 1280x720', 'image/jpeg 720x1280', 'image/jpeg 1080x1080']) if (!dims.includes(want)) throw new Error('falta ' + want)
  const ext = extNow(); if (ext.length) throw new Error('llamadas externas: ' + ext.join(','))
  return true
})
await step('M25 Banco de materiales: buscar (datos de prueba), importar a la Biblioteca y reutilizar en Miniaturas/Plantillas/Editor', async () => {
  await page.goto(base + '/library'); await settle(page); await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Buscar fotos y vídeos gratuitos' }).click()
  await page.locator('#stock-project').selectOption({ label: PROJ })
  await page.getByLabel('Banco gratuito', { exact: true }).selectOption('pexels')
  await page.getByLabel('Buscar en el banco').fill('mar'); await page.getByRole('button', { name: 'Buscar', exact: true }).click(); await page.waitForTimeout(1500)
  const txt = await page.locator('main').innerText()
  if (!txt.includes('DATOS DE PRUEBA')) throw new Error('no se rotulan los resultados como datos de prueba')
  const before = sq(`select count(*) from assets where source_provider='pexels'`)
  await page.getByRole('button', { name: 'Importar' }).first().click(); await page.waitForTimeout(2500)
  const after = sq(`select count(*) from assets where source_provider='pexels'`)
  console.log('   importados antes/después:', before, after)
  if (Number(after) !== Number(before) + 1) throw new Error('no se importó el material')
  const row = sq(`select asset_type||'|'||license_status||'|'||(provenance->>'attribution')||'|'||(provenance->>'author') from assets where source_provider='pexels' order by created_at desc limit 1`)
  console.log('   fila:', row)
  // duplicado: importar de nuevo no crea otro
  await page.getByRole('button', { name: 'Importar' }).first().click(); await page.waitForTimeout(2000)
  if (sq(`select count(*) from assets where source_provider='pexels'`) !== after) throw new Error('el duplicado creó otro activo')
  // reutilización en Miniaturas, Plantillas y Editor
  await page.goto(base + '/thumbnails'); await settle(page); await page.locator('#thumb-project').selectOption({ label: PROJ }); await page.waitForTimeout(2500)
  if (!(await page.locator('main').innerText()).includes('Imagen tuya')) throw new Error('el material importado no está en Miniaturas')
  const ext = extNow(); if (ext.length) throw new Error('llamadas externas: ' + ext.join(','))
  // recuperación: el archivo se descarga tras recargar con URL firmada y es PNG válido
  const info = await page.evaluate(async () => {
    const out = []
    for (const img of Array.from(document.querySelectorAll('main article img'))) { const b = await (await fetch(img.src)).blob(); out.push(b.type) }
    return out
  })
  if (!info.includes('image/png')) throw new Error('no se recupera el PNG importado: ' + info.join(','))
  return true
})

// ---------- P5.10: flujo completo, aislamiento entre dos usuarios, idempotencia y concurrencia ----------
const FLOW = {}
await step('M26 flujo completo: material importado → plantilla → editor + música → MP4 → cerrar sesión y volver', async () => {
  // 1) montaje base (el de «con mi estilo», 3 clips) → guardarlo como plantilla
  const baseJob = sq(`select id from render_jobs where status='draft' order by created_at asc limit 1`)
  await page.goto(`${base}/editor/manual?job=${baseJob}`); await settle(page); await page.waitForTimeout(2000)
  await page.getByText('IA', { exact: true }).first().click(); await page.waitForTimeout(500)
  await page.getByLabel('Nombre de la plantilla').fill('Plantilla P510'); await page.getByRole('button', { name: 'Guardar como plantilla' }).click(); await page.waitForTimeout(1200)
  if (!/Plantilla «Plantilla P510» guardada/.test(await page.locator('main').innerText())) throw new Error('no se guardó la plantilla')
  // 2) material sintético importado desde la Biblioteca (ya importado en M25: prueba-1); asignarlo a los 3 huecos visuales
  const imp = sq(`select provenance->>'title' from assets where source_provider='pexels' order by created_at asc limit 1`); console.log('   material:', imp)
  await page.goto(base + '/editor/templates'); await settle(page); await page.waitForTimeout(1000)
  await page.getByRole('button', { name: /Plantilla P510/ }).click(); await page.waitForTimeout(600)
  await page.getByLabel('Proyecto', { exact: true }).selectOption({ label: PROJ }); await page.waitForTimeout(1500)
  await page.getByLabel('Título del montaje').fill('Montaje con material importado')
  for (const n of [1, 2, 3]) { const sel = page.getByLabel(`Archivo para Visual ${n}`); const opts = await sel.locator('option').allInnerTexts(); const o = opts.find(t => t.includes('PRUEBA')); if (!o) throw new Error('el material importado no se ofrece en el hueco ' + n + ': ' + opts.join('|')); await sel.selectOption({ label: o }) }
  await page.getByRole('button', { name: 'Crear montaje con esta plantilla' }).click(); await settle(page); await page.waitForTimeout(1500)
  // 3) transición Plantillas → Editor
  await page.getByRole('link', { name: /Abrir en el editor manual/ }).click(); await page.waitForURL(/\/editor\/manual\?job=/, { timeout: 20000 }); await settle(page); await page.waitForTimeout(2500)
  FLOW.job = new URL(page.url()).searchParams.get('job'); console.log('   editor:', page.url())
  // 4) música local compatible
  if (!existsSync(path.join(MEDIA, 'tono.wav'))) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=523:d=40', path.join(MEDIA, 'tono.wav')])
  console.log('   botones editor:', (await page.locator('button, summary').allInnerTexts()).map(x => x.trim()).filter(Boolean).slice(0, 70).join(' | '))
  await page.getByRole('button', { name: /Música y sonidos/ }).first().click().catch(() => {}); await page.waitForTimeout(500)
  if (!(await page.locator('#ic-files').count())) await page.locator('summary', { hasText: 'Importar o añadir' }).click({ timeout: 5000 }); await page.waitForTimeout(300)
  await page.locator('#ic-files').setInputFiles(path.join(MEDIA, 'tono.wav')); await page.waitForTimeout(6000)
  const musSel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Sin música' }) }).first()
  const mopts = await musSel.locator('option').allInnerTexts(); const mo = mopts.find(t => /tono/i.test(t)); if (!mo) throw new Error('la música no se ofrece: ' + mopts.join('|'))
  await musSel.selectOption({ label: mo }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Guardar ahora' }).click(); await page.waitForTimeout(2500)
  const comp = JSON.parse(sq(`select composition::text from render_jobs where id='${FLOW.job}'`)); console.log('   clips:', comp.clips.length, 'música:', Boolean(comp.musicAssetId))
  if (comp.clips.length !== 3 || !comp.musicAssetId) throw new Error('el montaje guardado no tiene 3 clips y música')
  // 5) exportar MP4
  await page.getByRole('button', { name: /^Exportar/ }).first().click(); await page.locator('#ed-export').waitFor({ state: 'visible' })
  const pick = async (l, v) => page.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
  await page.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const t0 = Date.now(); let st = ''
  while (Date.now() - t0 < 270000) { st = sq(`select status from render_jobs where id='${FLOW.job}' or (status<>'draft' and composition->>'title'='Montaje con material importado') order by created_at desc limit 1`); if (st === 'completed' || st === 'failed') break; await page.waitForTimeout(2000) }
  console.log('   estado:', st, `en ${Math.round((Date.now() - t0) / 1000)} s`); if (st !== 'completed') throw new Error('el render no terminó: ' + sq(`select coalesce(error,'-') from render_jobs where status<>'draft' order by created_at desc limit 1`))
  FLOW.out = sq(`select a.id||'|'||a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' and r.composition->>'title'='Montaje con material importado' order by r.created_at desc limit 1`)
  const [outId, outPath] = FLOW.out.split('|'); FLOW.outId = outId
  const f = download(outPath.split('/').pop()); if (!f) throw new Error('no se pudo descargar el MP4')
  const j = probe(f), v = j.streams.find(x => x.codec_type === 'video'), a = j.streams.find(x => x.codec_type === 'audio'); const dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  const vol = spawnSync('ffmpeg', ['-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2', '-i', f, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' })
  const mean = Number((/mean_volume: (-?[\d.]+) dB/.exec(vol) || [])[1]); console.log('   ffprobe:', JSON.stringify({ dur, v: v && [v.codec_name, v.width, v.height], a: a && a.codec_name, meanDb: mean, rgb: [...px] }))
  if (!v || !a || Math.abs(dur - 27) > 1.5 || !(mean > -50)) throw new Error('MP4 incorrecto')
  if (!(px[0] > 150 && px[1] < 110 && px[2] < 110)) throw new Error('el fotograma no es el material importado (rojo): ' + [...px])
  return true
})
await step('M27 cerrar sesión y volver a entrar: proyecto, material y resultado siguen accesibles', async () => {
  await ctx.close()
  const c2 = await mkCtx(); const p2 = c2.page; await login(p2, EMAIL, PW)
  await p2.goto(base + '/library'); await settle(p2); await p2.waitForTimeout(1500)
  const lib = await p2.locator('main').innerText()
  const sign = await p2.evaluate(async id => { const r = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!j.url) return r.status; const m = await fetch(j.url); return `${m.status} ${m.headers.get('content-type')} ${(await m.blob()).size}` }, FLOW.outId)
  console.log('   resultado por URL firmada:', sign, '· en Biblioteca:', /Montaje con material importado/.test(lib))
  await p2.goto(base + '/projects'); await settle(p2)
  FLOW.page = p2; FLOW.ctx = c2
  return String(sign).startsWith('200 video/mp4') && /Montaje con material importado/.test(lib) && (await p2.locator('main').innerText()).includes(PROJ)
})

const OTHER = 'otro-e2e@example.test'
await step('M28 seguridad con dos usuarios: B no puede importar en, leer, modificar ni borrar lo de A (UI/API y cliente real)', async () => {
  const projA = sq(`select id from projects where name='${PROJ}' limit 1`), ownerA = sq(`select owner_id from projects where id='${projA}'`)
  const impA = sq(`select id from assets where source_provider='pexels' order by created_at asc limit 1`), pathA = sq(`select storage_path from assets where id='${impA}'`)
  const assetsA = () => sq(`select count(*) from assets where project_id='${projA}'`)
  const titleA = sq(`select coalesce(provenance->>'title','') from assets where id='${impA}'`)
  const cb = await mkCtx(); const pb = cb.page; await login(pb, OTHER, PW)
  const b = createClient(`http://127.0.0.1:${GW}`, anon, { auth: { persistSession: false } }); const { data: sess } = await b.auth.signInWithPassword({ email: OTHER, password: PW })
  const bId = sess.user.id; const { data: myProj, error: pe } = await b.from('projects').insert({ owner_id: bId, name: 'Proyecto de B' }).select('id').single(); if (pe) throw new Error('B no pudo crear proyecto: ' + pe.message)
  const before = assetsA(); const leaks = []
  const api = (m, u, body) => pb.evaluate(async ([m, u, body]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, body: t.slice(0, 400) } }, [m, u, body])
  const res = {}
  res.import = await api('POST', '/api/stock/import', { source: 'pexels', kind: 'image', id: 'prueba-2', projectId: projA })
  res.signedImp = await api('GET', `/api/assets/${impA}/signed-url`)
  res.signedOut = await api('GET', `/api/assets/${FLOW.outId}/signed-url`)
  res.reuseId = await api('POST', '/api/stock/import', { source: 'pexels', kind: 'image', id: impA, projectId: myProj.id })
  console.log('   respuestas de B:', JSON.stringify({ imp: res.import.status, sImp: res.signedImp.status, sOut: res.signedOut.status, reuse: res.reuseId.status }))
  for (const [k, r] of Object.entries(res)) { if (![401, 403, 404, 400, 502].includes(r.status)) throw new Error(`${k} devolvió ${r.status}`); if (/"url"\s*:\s*"http/.test(r.body)) throw new Error(`${k} filtró una URL`); for (const secret of [projA, ownerA, PROJ, 'editor-e2e', pathA]) if (r.body.includes(secret)) leaks.push(`${k}:${secret}`) }
  if (leaks.length) throw new Error('las respuestas de error filtran datos de A: ' + leaks.join(','))
  if (assetsA() !== before) throw new Error('B creó activos en el proyecto de A')
  // cliente real de Supabase con la sesión de B
  const sel = await b.from('assets').select('id').eq('project_id', projA); if ((sel.data ?? []).length) throw new Error('B lee activos de A')
  const upd = await b.from('assets').update({ provenance: { title: 'HACKEADO' } }).eq('id', impA).select('id'); if ((upd.data ?? []).length) throw new Error('B modificó un activo de A')
  const del = await b.from('assets').delete().eq('id', impA).select('id'); if ((del.data ?? []).length) throw new Error('B borró un activo de A')
  const dl = await b.storage.from('generated-assets').download(pathA); if (!dl.error) throw new Error('B descargó un archivo de A')
  const su = await b.storage.from('generated-assets').createSignedUrl(pathA, 60); if (su.data?.signedUrl) throw new Error('B obtuvo una URL firmada de A')
  const rm = await b.storage.from('generated-assets').remove([pathA]); const still = sq(`select count(*) from storage.objects where name='${pathA}'`); if (still !== '1') throw new Error('B borró el archivo de A')
  const after = sq(`select coalesce(provenance->>'title','') from assets where id='${impA}'`); if (after !== titleA) throw new Error('el activo de A cambió')
  // A conserva sus permisos legítimos
  const pa = FLOW.page
  const mine = await pa.evaluate(async ([id, projId]) => { const s = await fetch(`/api/assets/${id}/signed-url`); const i = await fetch('/api/stock/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'pexels', kind: 'image', id: 'prueba-3', projectId: projId }) }); return [s.status, i.status] }, [impA, projA])
  console.log('   A (firma, importación propia):', mine.join(','))
  await cb.ctx.close()
  return mine[0] === 200 && (mine[1] === 201 || mine[1] === 200)
})
await step('M29 idempotencia y concurrencia: 6 importaciones simultáneas no duplican ni dejan archivos huérfanos', async () => {
  const projA = sq(`select id from projects where name='${PROJ}' limit 1`)
  const pa = FLOW.page
  const orphans = () => Number(sq(`select count(*) from storage.objects o where o.bucket_id='generated-assets' and o.name like '%/import-pexels-%' and not exists (select 1 from assets a where a.storage_path=o.name)`))
  const n0 = Number(sq(`select count(*) from assets where project_id='${projA}' and provenance->>'externalId'='pexels:prueba-2'`)), o0 = orphans()
  const rs = await pa.evaluate(async projId => Promise.all(Array.from({ length: 6 }, () => fetch('/api/stock/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'pexels', kind: 'image', id: 'prueba-2', projectId: projId }) }).then(async r => [r.status, (await r.json().catch(() => ({}))).error ?? '']))), projA)
  console.log('   respuestas:', rs.map(r => r[0]).join(','), rs.filter(r => r[1]).map(r => r[1]).slice(0, 2).join(' / '))
  await new Promise(r => setTimeout(r, 1500))
  const n1 = Number(sq(`select count(*) from assets where project_id='${projA}' and provenance->>'externalId'='pexels:prueba-2'`)), o1 = orphans()
  console.log('   activos prueba-2:', n0, '→', n1, '· huérfanos:', o0, '→', o1)
  // otro proyecto del mismo usuario: debe crear su propio activo, sin cruzar proyectos
  const { data: p2 } = await seed.auth.signInWithPassword({ email: EMAIL, password: PW })
  const { data: np } = await seed.from('projects').insert({ owner_id: p2.user.id, name: 'Proyecto P510 segundo' }).select('id').single()
  const other = await pa.evaluate(async projId => (await fetch('/api/stock/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'pexels', kind: 'image', id: 'prueba-2', projectId: projId }) })).status, np.id)
  const inOther = sq(`select count(*) from assets where project_id='${np.id}' and provenance->>'externalId'='pexels:prueba-2'`), cross = sq(`select count(*) from assets a where provenance->>'externalId'='pexels:prueba-2' and storage_path not like '%/'||project_id||'/%'`)
  console.log('   otro proyecto:', other, 'activos', inOther, '· rutas cruzadas:', cross)
  const codes = rs.map(r => r[0]); const created = codes.filter(c => c === 201).length
  if (codes.some(c => c !== 200 && c !== 201) || created !== 1) throw new Error('las importaciones simultáneas no son idempotentes: ' + codes.join(','))
  return n1 === 1 && o1 === o0 && inOther === '1' && cross === '0'
})

// ---------- P5.11: flujo con VÍDEO importado (no se sustituye por imagen estática) ----------
if (!S.bail && !FLOW.page) { const c0 = await mkCtx(); await login(c0.page, EMAIL, PW); FLOW.page = c0.page; FLOW.ctx = c0.ctx
  // E2E_ONLY: se saltó M26 → se siembra la música «tono.wav» importándola desde el editor
  const P0 = FLOW.page; if (!existsSync(path.join(MEDIA, 'tono.wav'))) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=523:d=40', path.join(MEDIA, 'tono.wav')])
  await P0.goto(base + '/editor/manual'); await settle(P0); await P0.waitForTimeout(1200); await P0.locator('#mp-project').selectOption({ label: PROJ }); await P0.locator('#mp-title').fill('Semilla audio'); await P0.locator('#mp-format').selectOption('16:9')
  await P0.getByRole('button', { name: 'Crear montaje vacío' }).click(); await P0.waitForURL(/\/editor\/manual\?job=/, { timeout: 20000 }); await settle(P0); await P0.waitForTimeout(2500)
  await P0.getByText('Materiales', { exact: true }).first().click(); await P0.waitForTimeout(400); await P0.locator('summary', { hasText: 'Importar o añadir' }).first().click(); await P0.waitForTimeout(300)
  await P0.locator('#ic-files').setInputFiles(path.join(MEDIA, 'tono.wav')); await P0.waitForTimeout(6000) } // sesión propia si se saltaron M26/M27
await step('M30 vídeo: buscar e importar el clip sintético a la Biblioteca (con su audio)', async () => {
  const P = FLOW.page
  await P.goto(base + '/library'); await settle(P); await P.waitForTimeout(1000)
  await P.getByRole('button', { name: 'Buscar fotos y vídeos gratuitos' }).click()
  await P.locator('#stock-project').selectOption({ label: PROJ }); await P.locator('#stock-kind').selectOption('video'); await P.waitForTimeout(500)
  await P.getByLabel('Banco gratuito', { exact: true }).selectOption('pexels')
  await P.getByLabel('Buscar en el banco').fill('azul'); await P.getByRole('button', { name: 'Buscar', exact: true }).click(); await P.waitForTimeout(1500)
  if (!(await P.locator('main').innerText()).includes('DATOS DE PRUEBA')) throw new Error('el clip no se rotula como dato de prueba')
  const n0 = Number(sq(`select count(*) from assets where source_provider='pexels' and asset_type='video'`))
  await P.getByRole('button', { name: 'Importar' }).first().click(); await P.waitForTimeout(3000)
  const n1 = Number(sq(`select count(*) from assets where source_provider='pexels' and asset_type='video'`)); console.log('   vídeos importados:', n0, '→', n1)
  if (n1 !== n0 + 1) throw new Error('el vídeo no se importó')
  FLOW.vid = sq(`select id from assets where source_provider='pexels' and asset_type='video' order by created_at desc limit 1`)
  const f = download(sq(`select storage_path from assets where id='${FLOW.vid}'`).split('/').pop()); const j = probe(f)
  console.log('   fichero importado:', j.streams.map(x => x.codec_name + (x.width ? ' ' + x.width + 'x' + x.height : '')).join(' + '), Number(j.format.duration).toFixed(1) + ' s')
  return j.streams.some(x => x.codec_name === 'h264') && j.streams.some(x => x.codec_type === 'audio')
})
await step('M31 vídeo: plantilla con clip + imagen + clip, recortar y dividir en el editor, música, exportar y verificar', async () => {
  const P = FLOW.page
  await P.goto(base + '/editor/templates'); await settle(P); await P.waitForTimeout(1000)
  await P.getByRole('button', { name: /Plantilla P510/ }).click(); await P.waitForTimeout(600)
  await P.getByLabel('Proyecto', { exact: true }).selectOption({ label: PROJ }); await P.waitForTimeout(1500)
  await P.getByLabel('Título del montaje').fill('Montaje con clip importado')
  const choose = async (n, kind) => { const sel = P.getByLabel(`Archivo para Visual ${n}`); const opts = await sel.locator('option').allInnerTexts(); const o = opts.find(t => t.startsWith(`[${kind}]`) && t.includes('PRUEBA')); if (!o) throw new Error(`no hay ${kind} importado para el hueco ${n}: ` + opts.join('|')); await sel.selectOption({ label: o }) }
  await choose(1, 'video'); await choose(2, 'image'); await choose(3, 'video')
  await P.getByRole('button', { name: 'Crear montaje con esta plantilla' }).click(); await settle(P); await P.waitForTimeout(1500)
  await P.getByRole('link', { name: /Abrir en el editor manual/ }).click(); await P.waitForURL(/\/editor\/manual\?job=/, { timeout: 20000 }); await settle(P); await P.waitForTimeout(2500)
  const job = new URL(P.url()).searchParams.get('job'); FLOW.job2 = job
  const c0 = JSON.parse(sq(`select composition::text from render_jobs where id='${job}'`)); console.log('   plantilla → clips:', c0.clips.map(c => c.durationMs).join(','))
  // recortar: el primer clip empieza en el segundo 2 del vídeo y dura 3 s; dividirlo a 1,5 s
  await P.locator('[title*="Clip sintético"]').first().click(); await P.waitForTimeout(500)
  await P.getByLabel('Inicio en el vídeo (s)').first().fill('2'); await P.waitForTimeout(300)
  await P.getByLabel('Duración (s)', { exact: true }).first().fill('3'); await P.waitForTimeout(300)
  await P.getByLabel('Dividir en (s desde el inicio del clip)').first().fill('1.5'); await P.getByRole('button', { name: 'Dividir', exact: true }).first().click(); await P.waitForTimeout(600)
  // música local
  await P.locator('h1').first().click().catch(() => {}); await P.keyboard.press('Escape'); await P.waitForTimeout(400)
  await P.getByRole('button', { name: /Música y sonidos/ }).first().click().catch(() => {}); await P.waitForTimeout(500)
  const musSel = P.locator('select').filter({ has: P.locator('option', { hasText: 'Sin música' }) }).first()
  if (await musSel.count()) { const mopts2 = await musSel.locator('option').allInnerTexts(); const mo = mopts2.find(t => /tono/i.test(t)); if (!mo) throw new Error('no hay música: ' + mopts2.join('|')); await musSel.selectOption({ label: mo }); await P.waitForTimeout(500) }
  else console.log('   la plantilla ya traía música:', Boolean(c0.musicAssetId), '· audios:', (c0.audioClips ?? []).length)
  await P.getByRole('button', { name: 'Guardar ahora' }).click(); await P.waitForTimeout(2500)
  const comp = JSON.parse(sq(`select composition::text from render_jobs where id='${job}'`))
  const types = comp.clips.map(c => sq(`select asset_type from assets where id='${c.visualAssetId}'`))
  console.log('   editado → clips:', comp.clips.map((c, i) => `${types[i]}:${c.durationMs}@${c.trimInMs ?? 0}`).join(' | '), '· música:', Boolean(comp.musicAssetId), '· audios:', (comp.audioClips ?? []).length)
  if (!(comp.musicAssetId || (comp.audioClips ?? []).length)) throw new Error('el montaje no tiene audio local')
  if (comp.clips.length !== 4 || types.join() !== 'video,video,image,video') throw new Error('estructura inesperada tras recortar y dividir')
  if (!(comp.clips[0].trimInMs >= 2000)) throw new Error('el recorte no se guardó')
  const total = comp.clips.reduce((a, c) => a + c.durationMs, 0) / 1000
  await P.getByRole('button', { name: /^Exportar/ }).first().click(); await P.locator('#ed-export').waitFor({ state: 'visible' })
  const pick = async (l, v) => P.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
  await P.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const t0 = Date.now(); let st = ''
  while (Date.now() - t0 < 270000) { st = sq(`select status from render_jobs where status<>'draft' and composition->>'title'='Montaje con clip importado' order by created_at desc limit 1`); if (st === 'completed' || st === 'failed') break; await P.waitForTimeout(2000) }
  if (st !== 'completed') throw new Error('render: ' + (st || 'sin job') + ' ' + sq(`select coalesce(error,'-') from render_jobs where status<>'draft' order by created_at desc limit 1`))
  const o = sq(`select a.id||'|'||a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' and r.composition->>'title'='Montaje con clip importado' order by r.created_at desc limit 1`).split('|'); FLOW.outId2 = o[0]
  const f = download(o[1].split('/').pop()); const j = probe(f), v = j.streams.find(x => x.codec_type === 'video'), a = j.streams.find(x => x.codec_type === 'audio'), dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  const frame = t => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' })]
  const imgStart = (comp.clips[0].durationMs + comp.clips[1].durationMs) / 1000
  const fv = frame(0.9), fi = frame(imgStart + 1.5)
  const mean = Number((/mean_volume: (-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr) || [])[1])
  console.log('   MP4:', JSON.stringify({ dur, esperada: total, v: v && [v.codec_name, v.width, v.height], a: a && a.codec_name, meanDb: mean, frameClip: fv, frameImagen: fi }))
  if (!v || !a || Math.abs(dur - total) > 1.5 || !(mean > -50)) throw new Error('MP4 incorrecto')
  if (!(fv[2] > 60 && fv[2] > fv[0] * 1.8)) throw new Error('el primer tramo no es el clip de vídeo (azul): ' + fv)
  if (!(fi[1] > 130 && fi[1] > fi[0] + 50)) throw new Error('el tramo de imagen no es la imagen importada (verde): ' + fi)
  return true
})
await step('M32 vídeo: cerrar sesión y volver a entrar recupera el montaje con clip y su MP4', async () => {
  await (FLOW.ctx.ctx ?? FLOW.ctx).close()
  const c3 = await mkCtx(); await login(c3.page, EMAIL, PW); FLOW.page = c3.page; FLOW.ctx = c3.ctx
  const P = c3.page
  await P.goto(base + `/editor/manual?job=${FLOW.job2}`); await settle(P); await P.waitForTimeout(2500)
  const clipsOk = (await P.locator('[title*="Clip sintético"]').count()) >= 2
  const sign = await P.evaluate(async id => { const r = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!j.url) return String(r.status); const m = await fetch(j.url); return `${m.status} ${m.headers.get('content-type')} ${(await m.blob()).size}` }, FLOW.outId2)
  console.log('   montaje en el editor:', clipsOk, '· MP4 por URL firmada:', sign)
  const ext = extNow(); if (ext.length) throw new Error('llamadas externas: ' + ext.join(','))
  return clipsOk && sign.startsWith('200 video/mp4')
})

// ---------- P5.11: auditoría de seguridad ampliada ----------
await step('M33 seguridad: barrido de las 64 rutas API sin sesión (ni 5xx ni datos) y rutas abiertas de la beta con dos usuarios', async () => {
  const { readdirSync, statSync } = await import('node:fs')
  const routes = []; const walk = d => { for (const n of readdirSync(d)) { const f = path.join(d, n); if (statSync(f).isDirectory()) walk(f); else if (n === 'route.ts') routes.push(path.relative(path.join(root, 'app'), path.dirname(f))) } }; walk(path.join(root, 'app/api'))
  const uuid = '00000000-0000-4000-8000-000000000000'
  const urlOf = r => '/' + r.replace(/\[\.\.\.[^\]]+\]/g, 'x').replace(/\[[^\]]+\]/g, uuid)
  const bad = [], notConf = []; const tally = {}
  for (const r of routes) for (const m of ['GET', 'POST', 'DELETE']) {
    let res; try { res = await fetch(base + urlOf(r), { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}', redirect: 'manual', signal: AbortSignal.timeout(20000) }) } catch (e) { bad.push(`${m} ${r}: sin respuesta (${e.message})`); continue }
    const body = (await res.text()).slice(0, 600); tally[res.status] = (tally[res.status] ?? 0) + 1
    if (res.status === 503 && /not configured|no activad|falta la clave|no está configurad|no configurad/i.test(body)) notConf.push(`${m} ${r}`)
    else if (res.status >= 500) bad.push(`${m} ${r}: ${res.status} ${body.slice(0, 120)}`)
    else if (res.status >= 200 && res.status < 300 && !/^(api\/(providers\/status|ios\/|meta\/|oauth\/|cron\/))/.test(r) && !/"configured"|"sources"|"models"|"items"|"ok"/.test(body)) bad.push(`${m} ${r}: ${res.status} sin sesión → ${body.slice(0, 120)}`)
    if (/owner_id|service_role|sk-[A-Za-z0-9]{10}|eyJ[A-Za-z0-9_-]{20}/.test(body)) bad.push(`${m} ${r}: posible filtración → ${body.slice(0, 120)}`)
  }
  console.log('   desactivadas por falta de configuración (503 esperado):', notConf.join(', ')); console.log('   rutas:', routes.length, '· estados sin sesión:', JSON.stringify(tally)); if (bad.length) console.log('   HALLAZGOS:\n     ' + bad.join('\n     '))
  if (bad.length) throw new Error(bad.length + ' hallazgos de barrido')
  // las 4 rutas abiertas en la beta, con dos usuarios reales
  const projA = sq(`select id from projects where name='${PROJ}' limit 1`), ownerA = sq(`select owner_id from projects where id='${projA}'`)
  const cb = await mkCtx(); await login(cb.page, OTHER, PW)
  const b = createClient(`http://127.0.0.1:${GW}`, anon, { auth: { persistSession: false } }); const { data: sess } = await b.auth.signInWithPassword({ email: OTHER, password: PW })
  const api = (m, u, body) => cb.page.evaluate(async ([m, u, body]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: (await r.text()).slice(0, 500) } }, [m, u, body])
  const up = await api('POST', '/api/storage/upload-url', { projectId: projA, folder: 'uploads', ext: 'png', contentType: 'image/png', size: 100 })
  const upLib = await api('POST', '/api/storage/upload-url', { projectId: 'library', folder: 'uploads', ext: 'png', contentType: 'image/png', size: 100 })
  const usageB = await api('GET', '/api/storage/usage'), st = await api('GET', '/api/providers/status')
  console.log('   B → upload-url en proyecto de A:', up.status, '· en su biblioteca:', upLib.status, '· usage:', usageB.status, '· providers/status:', st.status)
  if (up.status !== 404 || up.body.includes(projA) || up.body.includes(ownerA)) throw new Error('B obtuvo una subida en el proyecto de A')
  if (upLib.status !== 200 || !upLib.body.includes(sess.user.id) || upLib.body.includes(ownerA)) throw new Error('la subida de B no está en su propia carpeta')
  if (usageB.body.includes(ownerA)) throw new Error('usage filtra datos de A')
  if (/key|secret|token|sk-/i.test(st.body.replace(/"configured"|"hasKey"/g, '')) && /sk-|eyJ/.test(st.body)) throw new Error('providers/status filtra claves')
  // RLS/Storage directo: B no puede escribir en la carpeta de A ni crear activos en proyectos de A
  const upFile = await b.storage.from('generated-assets').upload(`${ownerA}/${projA}/uploads/intruso.png`, new Uint8Array([137, 80, 78, 71]), { contentType: 'image/png' })
  const before = sq(`select count(*) from assets where project_id='${projA}'`)
  const ins = await b.from('assets').insert({ owner_id: sess.user.id, project_id: projA, asset_type: 'image', storage_path: `${sess.user.id}/x.png`, license_status: 'owned' }).select('id')
  const ins2 = await b.from('assets').insert({ owner_id: ownerA, project_id: projA, asset_type: 'image', storage_path: `${ownerA}/x.png`, license_status: 'owned' }).select('id')
  const after = sq(`select count(*) from assets where project_id='${projA}'`)
  const rj = await b.from('render_jobs').insert({ owner_id: sess.user.id, project_id: projA, output_format: '16:9', status: 'draft', composition: {} }).select('id')
  const jobsA = sq(`select count(*) from render_jobs where project_id='${projA}' and owner_id='${sess.user.id}'`)
  console.log('   B escribe en storage de A:', upFile.error ? 'rechazado' : 'PERMITIDO', '· inserta activo en proyecto de A:', ins.error ? 'rechazado' : 'PERMITIDO', '· como A:', ins2.error ? 'rechazado' : 'PERMITIDO', '· render_job en proyecto de A:', rj.error ? 'rechazado' : 'PERMITIDO', jobsA)
  await cb.ctx.close()
  if (!upFile.error) throw new Error('B escribió un archivo en la carpeta de A')
  if (ins2.error === null) throw new Error('B creó un activo con owner_id de A')
  const vulnerable = !ins.error || after !== before || !rj.error || jobsA !== '0'
  if (process.env.PROPOSAL_OWNERSHIP === '1') { if (vulnerable) throw new Error('con la propuesta aplicada B sigue escribiendo en proyectos de A') ; console.log('   con la propuesta de propiedad de proyecto: B rechazado en activos y render_jobs') }
  else if (vulnerable) console.log('   HALLAZGO CONFIRMADO (esquema actual): un usuario puede crear filas propias que apuntan al proyecto de otro; corrección en supabase/proposed/20261105130000_project_ownership_check.sql (ejecutar con PROPOSAL_OWNERSHIP=1 y SCHEMA_BUNDLE)')
  return true
})

// ---------- P5.11: subtítulos sin IA (texto pegado, SRT, edición, exportación, grabado en el MP4) ----------
await step('M34 subtítulos: pegar transcripción sin tiempos (estimada), editar, exportar SRT, importar SRT y grabarlos en el MP4', async () => {
  const P = FLOW.page
  await P.goto(base + `/editor/manual?job=${FLOW.job2}`); await settle(P); await P.waitForTimeout(2500)
  await P.getByText('Textos', { exact: true }).first().click(); await P.waitForTimeout(500)
  const panel = P.locator('section.panel[aria-label="Subtítulos"]'); await panel.scrollIntoViewIfNeeded().catch(() => {})
  // 1) transcripción pegada, sin tiempos → estimación claramente rotulada
  await panel.locator('summary', { hasText: 'Pegar una transcripción' }).click()
  await panel.getByLabel('Transcripción pegada').fill('Una ciudad que nunca duerme. Cada noche miles de luces se encienden a la vez y nadie sabe por qué. ¿Y tú, qué harías?')
  await panel.getByRole('button', { name: 'Repartir con tiempos estimados' }).click(); await P.waitForTimeout(400)
  if (!/Tiempos ESTIMADOS/.test(await panel.innerText())) throw new Error('no se avisa de que los tiempos son estimados')
  await panel.getByRole('button', { name: 'Colocar en el montaje' }).click(); await P.waitForTimeout(800)
  const rows = await panel.locator('table[aria-label="Lista de subtítulos"] tbody tr').count(); console.log('   subtítulos colocados:', rows)
  if (rows < 3) throw new Error('no se colocaron los subtítulos')
  // 2) editar texto y tiempo de uno, guardar y recuperar
  await panel.getByLabel('Texto del subtítulo 1').fill('Una ciudad que jamás duerme.'); await P.waitForTimeout(300)
  await panel.getByLabel('Fin del subtítulo 1').fill('1.2'); await P.waitForTimeout(300)
  await P.getByRole('button', { name: 'Guardar ahora' }).click(); await P.waitForTimeout(2500)
  await P.reload(); await settle(P); await P.waitForTimeout(2500)
  await P.getByText('Textos', { exact: true }).first().click(); await P.waitForTimeout(500)
  const panel2 = P.locator('section.panel[aria-label="Subtítulos"]')
  const t1 = await panel2.getByLabel('Texto del subtítulo 1').inputValue(), e1 = await panel2.getByLabel('Fin del subtítulo 1').inputValue()
  console.log('   tras recargar:', t1, '· fin', e1); if (t1 !== 'Una ciudad que jamás duerme.' || Number(e1) !== 1.2) throw new Error('la edición no persiste')
  // 3) exportar SRT y comprobarlo
  const [dl] = await Promise.all([P.waitForEvent('download'), panel2.getByRole('button', { name: 'Descargar .srt' }).click()])
  const srtFile = path.join(MEDIA, 'exportado.srt'); await dl.saveAs(srtFile); const srt = rfs(srtFile, 'utf8')
  console.log('   SRT:', JSON.stringify(srt.slice(0, 110)))
  if (!/1\n00:00:00,000 --> 00:00:01,200\nUna ciudad que jamás duerme\./.test(srt.replace(/\r/g, ''))) throw new Error('el SRT exportado no refleja la edición')
  // 4) importar un SRT con tiempos reales: se respetan
  const mine = path.join(MEDIA, 'mio.srt'); writeFileSync(mine, '1\n00:00:01,000 --> 00:00:03,000\nPrimer subtítulo real\n\n2\n00:00:04,000 --> 00:00:06,500\nSegundo subtítulo real\n')
  await panel2.locator('input[type=file]').setInputFiles(mine); await P.waitForTimeout(600)
  if (/Tiempos ESTIMADOS/.test(await panel2.innerText())) throw new Error('un SRT con tiempos se marcó como estimado')
  await panel2.getByRole('button', { name: 'Colocar en el montaje' }).click(); await P.waitForTimeout(800)
  const s2 = await panel2.getByLabel('Inicio del subtítulo 1').inputValue(), x2 = await panel2.getByLabel('Texto del subtítulo 2').inputValue()
  console.log('   SRT importado → inicio 1:', s2, '· texto 2:', x2, '· todos:', JSON.stringify(await panel2.locator('textarea,input[aria-label^="Texto del subt"]').evaluateAll(a=>a.map(x=>x.value)))); if (Number(s2) !== 1 || !/Primer subtítulo real/.test(x2)) throw new Error('el SRT importado no conserva sus tiempos')
  // 4b) un .auto.srt (salida del motor local) se rotula como automático; uno manual no
  const auto = path.join(MEDIA, 'charla.auto.srt'); writeFileSync(auto, '1\n00:00:00,000 --> 00:00:01,000\nHola\n')
  await panel2.locator('input[type=file]').setInputFiles(auto); await P.waitForTimeout(500)
  if (!/GENERADOS AUTOMÁTICAMENTE/.test(await panel2.innerText())) throw new Error('el .auto.srt no se rotula como automático')
  await panel2.getByRole('button', { name: 'Descartar' }).click()
  await panel2.locator('input[type=file]').setInputFiles(mine); await P.waitForTimeout(400)
  if (/GENERADOS AUTOMÁTICAMENTE/.test(await panel2.innerText())) throw new Error('un SRT manual se rotuló como automático')
  await panel2.getByRole('button', { name: 'Descartar' }).click()
  await P.getByRole('button', { name: 'Guardar ahora' }).click(); await P.waitForTimeout(2500)
  // 5) grabado en el MP4 (subtítulos activados) frente al MP4 anterior sin ellos
  await P.getByRole('button', { name: /^Exportar/ }).first().click(); await P.locator('#ed-export').waitFor({ state: 'visible' })
  const pick = async (l, v) => P.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
  const renders0 = Number(sq(`select count(*) from render_jobs where status='completed'`))
  const failed0 = sq(`select count(*) from render_jobs where status='failed'`)
  await P.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const t0 = Date.now(); let n = renders0
  while (Date.now() - t0 < 270000) { n = Number(sq(`select count(*) from render_jobs where status='completed'`)); if (n > renders0 || sq(`select count(*) from render_jobs where status='failed'`) !== failed0) break; await P.waitForTimeout(2000) }
  if (n <= renders0) throw new Error('el render con subtítulos no terminó: ' + sq(`select coalesce(error,'-') from render_jobs where status='failed' limit 1`))
  const o = sq(`select a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' order by r.created_at desc limit 1`)
  const f = download(o.split('/').pop())
  const old = download(sq(`select a.storage_path from assets a where a.id='${FLOW.outId2}'`).split('/').pop())
  const whiteIn = (file, t) => { const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'crop=iw:ih*0.35:0:ih*0.65', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 }); let w = 0; for (let i = 0; i < b.length; i += 3) if (b[i] > 235 && b[i + 1] > 235 && b[i + 2] > 235) w++; return w }
  const withSubs = whiteIn(f, 1.8), without = whiteIn(old, 1.8)
  console.log('   píxeles de texto blanco abajo, con subtítulos:', withSubs, '· MP4 anterior sin subtítulos:', without)
  const j = probe(f); if (!j.streams.some(x => x.codec_type === 'video')) throw new Error('MP4 sin vídeo')
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  return withSubs > 200 && without < 20
})
await step('M35 subtítulos: origen de cada subtítulo (automático / corregido / manual), teclado, axe y móvil', async () => {
  const P = FLOW.page
  await P.goto(base + `/editor/manual?job=${FLOW.job2}`); await settle(P); await P.waitForTimeout(2500)
  await P.getByText('Textos', { exact: true }).first().click(); await P.waitForTimeout(500)
  const panel = P.locator('section.panel[aria-label="Subtítulos"]'); await panel.scrollIntoViewIfNeeded().catch(() => {})
  const f = path.join(MEDIA, 'dos.auto.srt'); writeFileSync(f, '1\n00:00:00,000 --> 00:00:00,700\nprimero auto\n\n2\n00:00:00,800 --> 00:00:01,400\nsegundo auto\n')
  await panel.locator('input[type=file]').setInputFiles(f); await P.waitForTimeout(400)
  await panel.getByRole('button', { name: 'Colocar en el montaje' }).click(); await P.waitForTimeout(800)
  const st = async () => (await panel.locator('[role=status]').first().innerText()).replace(/\s+/g, ' ')
  const s0 = await st(); console.log('   estado inicial:', s0)
  if (!/2 subtítulos automáticos SIN revisar/.test(s0)) throw new Error('los automáticos no constan como sin revisar')
  // corregir uno: el otro sigue sin revisar (el archivo no cuenta como revisado)
  await panel.getByLabel('Texto del subtítulo 1').fill('Primero corregido'); await P.waitForTimeout(300)
  const s1 = await st(); console.log('   tras corregir uno:', s1)
  if (!/1 subtítulos automáticos SIN revisar/.test(s1) || !/1 revisados o corregidos/.test(s1)) throw new Error('corregir un subtítulo no debe dar por revisado el archivo')
  // teclado: Revisado → Inicio → Fin → Texto → Quitar, sin ratón
  await panel.getByLabel('Marcar el subtítulo 2 como revisado').focus()
  const seq = []; for (let i = 0; i < 5; i++) { await P.keyboard.press('Tab'); seq.push(await P.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName)) }
  console.log('   orden de Tab:', JSON.stringify(seq))
  if (seq[0] !== 'Inicio del subtítulo 2' || seq[1] !== 'Fin del subtítulo 2' || seq[2] !== 'Texto del subtítulo 2' || seq[3] !== 'Quitar el subtítulo 2') throw new Error('orden de foco inesperado')
  await panel.getByLabel('Marcar el subtítulo 2 como revisado').focus(); await P.keyboard.press('Enter'); await P.waitForTimeout(300)
  const s2 = await st(); console.log('   tras revisar con teclado:', s2)
  if (!/Todos los subtítulos automáticos están revisados/.test(s2)) throw new Error('Revisado por teclado no funcionó')
  // guardar y recuperar: el origen persiste
  await P.getByRole('button', { name: 'Guardar ahora' }).click(); await P.waitForTimeout(2500); await P.reload(); await settle(P); await P.waitForTimeout(2500)
  await P.getByText('Textos', { exact: true }).first().click(); await P.waitForTimeout(500)
  const rows = await P.locator('section.panel[aria-label="Subtítulos"] table[aria-label="Lista de subtítulos"] tbody tr td:nth-child(2)').allInnerTexts()
  console.log('   orígenes tras recargar:', JSON.stringify(rows.map(r => r.replace(/\s+/g, ' ').trim())))
  if (!rows.slice(0, 2).every(r => /Automático, revisado\/corregido/.test(r))) throw new Error('el origen no persiste')
  // axe en escritorio y en móvil, y sin desbordamiento horizontal
  const axeSrc = (await import('node:fs')).readFileSync('node_modules/axe-core/axe.min.js', 'utf8')
  const axe = async () => { await P.addScriptTag({ content: axeSrc }); return P.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.filter(v => !['document-title', 'html-has-lang'].includes(v.id)).map(v => v.id + ':' + v.nodes.length + ' ' + v.nodes.map(n => n.html.slice(0, 160)).join(' | '))) }
  const vd = await axe(); console.log('   axe escritorio:', JSON.stringify(vd))
  await P.setViewportSize({ width: 390, height: 844 }); await P.waitForTimeout(600)
  const over = await P.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  const vm = await axe(); console.log('   axe móvil:', JSON.stringify(vm), '· desbordamiento horizontal:', over)
  await P.setViewportSize({ width: 1280, height: 800 })
  return vd.length === 0 && vm.length === 0 && over <= 1
})
await step('M36 VÍDEO 3 (P5.14): proyecto vertical 9:16 desde cero con clip + imagen + música, SRT, edición, MP4 con subtítulos visibles y sincronizados', async () => {
  const P = FLOW.page, T0 = Date.now(); let clicks = 0
  const click = async loc => { clicks++; await loc.click() }
  await P.goto(base + '/editor/manual'); await settle(P); await P.waitForTimeout(1200)
  console.log('   URL:', P.url(), '·', (await P.locator('main').innerText()).slice(0, 160).replace(/\n/g, ' / ')); await P.locator('#mp-project').selectOption({ label: PROJ }); await P.locator('#mp-title').fill('Vertical con subtítulos P514'); await P.locator('#mp-format').selectOption('9:16'); clicks += 3
  await click(P.getByRole('button', { name: 'Crear montaje vacío' })); await P.waitForURL(/\/editor\/manual\?job=/, { timeout: 20000 }); await settle(P); await P.waitForTimeout(2500)
  const job = new URL(P.url()).searchParams.get('job')
  await P.getByText('Materiales', { exact: true }).first().click(); await P.waitForTimeout(500); clicks++
  const sm = P.locator('summary', { hasText: 'Importar o añadir' }); if (!(await sm.first().isVisible().catch(() => false))) { await P.screenshot({ path: '/tmp/m36.png' }); console.log('   DEBUG botones:', JSON.stringify((await P.locator('button').allInnerTexts()).map(x => x.trim()).filter(Boolean).slice(0, 60)), '· summaries:', await sm.count(), '· URL', P.url()) }
  await click(sm.first()); await P.waitForTimeout(300)
  const addVisual = async kind => { const sel = P.locator('label', { hasText: 'Clip de imagen o vídeo' }).locator('select'); const opts = await sel.locator('option').allInnerTexts(); const o = opts.find(x => x.startsWith(`[${kind}]`) && (kind === 'video' ? /Clip sint/.test(x) : /PRUEBA|prueba/.test(x))); if (!o) throw new Error('no hay ' + kind + ' en la Biblioteca: ' + opts.join('|')); await sel.selectOption({ label: o }); clicks++; await click(P.getByRole('button', { name: /^Añadir clip/ })); await P.waitForTimeout(1200) }
  await addVisual('video'); await addVisual('image')
  const asel = P.locator('select').filter({ has: P.locator('option', { hasText: /^\[(music|sfx|voice)\]/ }) }).first(); const aopts = await asel.locator('option').allInnerTexts(); const ao = aopts.find(x => /tono|music/i.test(x)); if (!ao) throw new Error('sin audio: ' + aopts.join('|'))
  await asel.selectOption({ label: ao }); clicks++; await P.locator('label', { hasText: /^Pista/ }).locator('select').first().selectOption('music'); clicks++
  await click(P.getByRole('button', { name: /^Añadir (al inicio|en el cabezal)/ })); await P.waitForTimeout(1500)
  const srt = path.join(MEDIA, 'vertical.srt'); writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,500\nHola desde el vertical\n\n2\n00:00:03,000 --> 00:00:05,000\nSegundo subtítulo largo para comprobar que cabe en pantalla\n')
  await click(P.getByText('Textos', { exact: true }).first()); await P.waitForTimeout(500)
  const panel = P.locator('section.panel[aria-label="Subtítulos"]'); await panel.scrollIntoViewIfNeeded().catch(() => {})
  await panel.locator('input[type=file]').setInputFiles(srt); clicks++; await P.waitForTimeout(400)
  await click(panel.getByRole('button', { name: 'Colocar en el montaje' })); await P.waitForTimeout(800)
  await panel.getByLabel('Texto del subtítulo 1').fill('Hola desde el vertical (editado)'); clicks++
  await click(P.getByRole('button', { name: 'Guardar ahora' })); await P.waitForTimeout(2500)
  const comp = JSON.parse(sq(`select composition::text from render_jobs where id='${job}'`))
  console.log('   montaje:', comp.format, comp.clips.length, 'clips ·', (comp.clips.reduce((a, c) => a + c.durationMs, 0) / 1000).toFixed(1), 's · música:', Boolean(comp.musicAssetId) || (comp.audioClips ?? []).length > 0, '· subtítulos:', comp.subtitles)
  if (comp.format !== '9:16' || comp.clips.length !== 2 || !comp.subtitles) throw new Error('montaje vertical incompleto')
  // vista previa: ¿se ve el subtítulo en el visor al colocar el cabezal dentro del primero? (se registra, no se exige)
  await P.getByRole('button', { name: /^Exportar/ }).first().click(); await P.locator('#ed-export').waitFor({ state: 'visible' }); clicks += 2
  const pick = async (l, v) => P.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24'); clicks += 3
  const renders0 = Number(sq(`select count(*) from render_jobs where status='completed'`)), failed0 = sq(`select count(*) from render_jobs where status='failed'`)
  await click(P.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }))
  const tr = Date.now(); let n = renders0
  while (Date.now() - tr < 270000) { n = Number(sq(`select count(*) from render_jobs where status='completed'`)); if (n > renders0 || sq(`select count(*) from render_jobs where status='failed'`) !== failed0) break; await P.waitForTimeout(2000) }
  if (n <= renders0) throw new Error('el render vertical no terminó: ' + sq(`select coalesce(error,'-') from render_jobs where status='failed' order by created_at desc limit 1`))
  const renderS = (Date.now() - tr) / 1000
  const o = sq(`select a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' and r.composition->>'title'='Vertical con subtítulos P514' order by r.created_at desc limit 1`) || sq(`select 'JOB-NO-COMPLETADO|'||string_agg(id||':'||status||':'||coalesce(composition->>'title','-'),',') from render_jobs where updated_at > now() - interval '20 minutes'`)
  const f = download(o.split('/').pop()); const j = probe(f), v = j.streams.find(x => x.codec_type === 'video'), a = j.streams.find(x => x.codec_type === 'audio'), dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  const white = (t, band) => { const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', band, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 }); let c = 0; for (let i = 0; i < b.length; i += 3) if (b[i] > 235 && b[i + 1] > 235 && b[i + 2] > 235) c++; return c }
  const bottom = 'crop=iw:ih*0.4:0:ih*0.6', top = 'crop=iw:ih*0.4:0:0', edge = 'crop=iw*0.03:ih:0:0'
  FLOW.job3 = job; FLOW.mp4v = f
  const w1 = white(1.5, bottom), w2 = white(4.0, bottom), gap = white(2.75, bottom), wTop = white(1.5, top) + white(4.0, top)
  console.log('   MP4 vertical:', JSON.stringify({ dur, v: v && [v.codec_name, v.width, v.height], a: a && a.codec_name }), '· texto blanco abajo en 1,5 s:', w1, '· 4,0 s:', w2, '· entre subtítulos (2,75 s):', gap, '· arriba:', wTop)
  console.log(`   USABILIDAD vídeo 3: ${((Date.now() - T0) / 1000).toFixed(0)} s medidos en total (render ${renderS.toFixed(0)} s), ${clicks} acciones de interfaz, sin tocar BD ni scripts`)
  if (!v || !a || !(v.height > v.width)) throw new Error('MP4 no vertical o sin audio')
  return w1 > 150 && w2 > 150 && gap < w1 / 4 && wTop < 20
})
await step('M37 P5.15: Biblioteca sin exportados por defecto, recorte al añadir, Importar y añadir visible y subtítulos en el visor (9:16) acordes al MP4', async () => {
  const P = FLOW.page
  await P.goto(base + '/editor/manual'); await settle(P); await P.waitForTimeout(1200)
  await P.locator('#mp-project').selectOption({ label: PROJ }); await P.locator('#mp-title').fill('Montaje P515'); await P.locator('#mp-format').selectOption('16:9')
  await P.getByRole('button', { name: 'Crear montaje vacío' }).click(); await P.waitForURL(/\/editor\/manual\?job=/, { timeout: 20000 }); await settle(P); await P.waitForTimeout(2500)
  const job = new URL(P.url()).searchParams.get('job')
  await P.getByText('Materiales', { exact: true }).first().click(); await P.waitForTimeout(400)
  await P.locator('summary', { hasText: 'Importar o añadir' }).first().click(); await P.waitForTimeout(300)
  const sel = P.locator('label', { hasText: 'Clip de imagen o vídeo' }).locator('select')
  const optsOf = async () => (await sel.locator('option').allInnerTexts()).map(x => x.trim())
  const o1 = await optsOf(); console.log('   opciones sin exportados:', o1.length, '· exportados visibles:', o1.some(x => /exportado/.test(x)))
  if (o1.some(x => /exportado|Montaje|Vertical con/.test(x))) throw new Error('los MP4 exportados aparecen mezclados por defecto')
  if (!o1.some(x => /Clip sint/.test(x))) throw new Error('falta el clip importado')
  await P.getByLabel('Incluir mis vídeos exportados').check(); await P.waitForTimeout(300)
  const o2 = await optsOf(); console.log('   con exportados:', o2.length, '· grupo:', await sel.locator('optgroup').evaluateAll(g => g.map(x => x.label)))
  if (!o2.some(x => /exportado/.test(x))) throw new Error('el vídeo exportado no se puede reutilizar al pedirlo')
  await P.getByLabel('Incluir mis vídeos exportados').uncheck()
  // recorte al añadir con validación
  await sel.selectOption({ label: o1.find(x => /Clip sint/.test(x)) }); await P.waitForTimeout(1500)
  await P.getByLabel('Inicio del tramo (s)').fill('3'); await P.getByLabel('Final del tramo (s)').fill('2'); await P.waitForTimeout(200)
  const err = await P.getByRole('alert').filter({ hasText: 'posterior' }).count(); const dis = await P.getByRole('button', { name: /^Añadir clip/ }).isDisabled()
  console.log('   intervalo inválido → aviso:', err, '· botón desactivado:', dis); if (!err || !dis) throw new Error('no valida el intervalo')
  await P.getByLabel('Final del tramo (s)').fill('5.5'); await P.waitForTimeout(200)
  const info = await P.locator('[role=status]', { hasText: 'Duración resultante' }).innerText(); console.log('   ', info)
  await P.getByRole('button', { name: /^Añadir clip/ }).click(); await P.waitForTimeout(800)
  // Importar y añadir: botón visible, sin abrir paneles
  const png = path.join(MEDIA, 'nueva-p515.png'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xdd8800:s=320x180', '-frames:v', '1', png])
  const imports0 = Number(sq(`select count(*) from assets where asset_type='image'`))
  const [chooser] = await Promise.all([P.waitForEvent('filechooser', { timeout: 8000 }), P.getByRole('button', { name: 'Importar y añadir al montaje' }).click()])
  await chooser.setFiles(png); await P.waitForTimeout(6000)
  await P.getByRole('button', { name: 'Guardar ahora' }).click(); await P.waitForTimeout(2500)
  const comp = JSON.parse(sq(`select composition::text from render_jobs where id='${job}'`))
  console.log('   montaje:', comp.clips.map(k => `${k.durationMs}@${k.trimInMs ?? 0}`).join(' | '), '· imágenes en BD:', imports0, '→', sq(`select count(*) from assets where asset_type='image'`))
  if (comp.clips.length !== 2 || comp.clips[0].durationMs !== 2500 || comp.clips[0].trimInMs !== 3000) throw new Error('el recorte al añadir no se aplicó: ' + JSON.stringify(comp.clips.map(k => [k.durationMs, k.trimInMs])))
  // subtítulos en el visor del montaje vertical de M36 frente al MP4 exportado
  await P.goto(base + `/editor/manual?job=${FLOW.job3}`); await settle(P); await P.waitForTimeout(3500)
  const cv = P.locator('canvas.playerCanvas'); const grab = async (key, n) => { await P.locator('h1').first().click().catch(() => {}); await P.keyboard.press('Home'); for (let i = 0; i < n; i++) { await P.keyboard.press('Shift+ArrowRight') } ; await P.waitForTimeout(900); const f = path.join(MEDIA, `visor-${key}.png`); writeFileSync(f, await cv.screenshot()); return f }
  const stat = (file, vf) => { const b = execFileSync('ffmpeg', ['-v', 'error', ...(vf.ss != null ? ['-ss', String(vf.ss)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=240:-1,crop=iw:ih*0.4:0:ih*0.6', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 }); let c = 0, sy = 0; const w = 240, h = Math.floor(b.length / 3 / w); for (let i = 0; i < b.length; i += 3) if (b[i] > 235 && b[i + 1] > 235 && b[i + 2] > 235) { c++; sy += Math.floor(i / 3 / w) / h } return { c, y: c ? sy / c : null } }
  const v0 = stat(await grab('0', 0), {}), v1 = stat(await grab('1', 1), {}), v4 = stat(await grab('4', 4), {})
  const m1 = stat(FLOW.mp4v, { ss: 1 }), m4 = stat(FLOW.mp4v, { ss: 4 })
  console.log('   visor (blanco abajo): 0 s →', v0.c, '· 1 s →', v1.c, '· 4 s →', v4.c, '| MP4: 1 s →', m1.c, '· 4 s →', m4.c, '· posición vertical visor/MP4 (1 s):', v1.y?.toFixed(2), '/', m1.y?.toFixed(2))
  return v0.c < 30 && v1.c > 40 && v4.c > 40 && m1.c > 40 && Math.abs((v1.y ?? 9) - (m1.y ?? 0)) < 0.12
})
await step('M38 conexiones sociales: botón Conectar de Instagram siempre visible y aviso claro si faltan credenciales (sin llamadas externas)', async () => {
  const P = FLOW.page
  await P.goto(base + '/social'); await settle(P); await P.waitForTimeout(1500)
  const btn = P.getByRole('link', { name: /Conectar Instagram/ })
  const vis = await btn.isVisible().catch(() => false), tt = await P.getByRole('link', { name: /Conectar TikTok/ }).isVisible().catch(() => false)
  console.log('   botón Instagram visible:', vis, '· TikTok:', tt)
  if (!vis || !tt) throw new Error('falta el botón Conectar')
  await btn.click(); await P.waitForTimeout(4000); console.log('   URL tras pulsar:', P.url(), '·', (await P.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' / ')); await settle(P)
  const msg = (await P.locator('main').innerText()).replace(/\s+/g, ' ')
  const note = /Instagram[^.]*no está configurado en el servidor/.test(msg)
  console.log('   tras pulsar:', P.url().replace(/^https?:\/\/[^/]+/, ''), '· aviso de credenciales:', note)
  await P.goto(base + '/connectors'); await settle(P); await P.waitForTimeout(1500)
  const yt = (await P.locator('main').innerText()).replace(/\s+/g, ' ')
  const ytState = /todavía no está activada en este servidor/.test(yt) ? 'sin credenciales de Google en este servidor (explicado en pantalla)' : /Conectar canal/.test(yt) ? 'botón Conectar canal visible' : 'estado no reconocido'
  console.log('   YouTube:', ytState)
  const ext = extNow(); if (ext.length) throw new Error('llamadas externas: ' + ext.join(','))
  return note && ytState !== 'estado no reconocido'
})
await step('M39 P5.19/P5.20: fundido y automatización de volumen del sonido propio de un clip de vídeo (UI → persistencia → MP4 medido)', async () => {
  const P = FLOW.page
  await P.goto(base + '/editor/manual'); await settle(P); await P.waitForTimeout(1200)
  await P.locator('#mp-project').selectOption({ label: PROJ }); await P.locator('#mp-title').fill('Automatización sonido P520'); await P.locator('#mp-format').selectOption('16:9')
  await P.getByRole('button', { name: 'Crear montaje vacío' }).click(); await P.waitForURL(/\/editor\/manual\?job=/, { timeout: 20000 }); await settle(P); await P.waitForTimeout(2500)
  const job = new URL(P.url()).searchParams.get('job')
  await P.getByText('Materiales', { exact: true }).first().click(); await P.waitForTimeout(400)
  await P.locator('summary', { hasText: 'Importar o añadir' }).first().click(); await P.waitForTimeout(300)
  const sel = P.locator('label', { hasText: 'Clip de imagen o vídeo' }).locator('select'); const opts = await sel.locator('option').allInnerTexts()
  const o = opts.find(x => x.startsWith('[video]') && /Clip sint/.test(x)); if (!o) throw new Error('sin clip de vídeo')
  await sel.selectOption({ label: o }); await P.getByRole('button', { name: /^Añadir clip/ }).click(); await P.waitForTimeout(1500)
  const openAuto = async () => { await P.locator('[title*="Clip sintético"]').first().click(); await P.waitForTimeout(500); const d = P.locator('details[data-tool="sound-fade"]'); if (!(await d.evaluate(x => x.open))) await d.locator('summary').click(); await P.waitForTimeout(300) }
  await openAuto()
  // fundido de entrada 1 s + puntos: (0 s, 100 %) · (2 s, 100 %) · (6 s, 10 %)  → baja linealmente de 2 s a 6 s
  await P.getByLabel('Entrada gradual (s)').fill('1')
  const add = P.getByRole('button', { name: 'Añadir punto en el cabezal' })
  await add.click(); await P.getByLabel('Tiempo del punto 1').fill('6'); await P.getByLabel('Nivel del punto 1').fill('10')
  await add.click(); await P.getByLabel('Tiempo del punto 1').fill('2')
  await add.click(); await P.waitForTimeout(400)
  const times = await P.locator('input[aria-label^="Tiempo del punto"]').evaluateAll(l => l.map(x => x.value)), levels = await P.locator('input[aria-label^="Nivel del punto"]').evaluateAll(l => l.map(x => x.value))
  console.log('   puntos en pantalla (s / %):', JSON.stringify(times), JSON.stringify(levels))
  await P.getByRole('button', { name: 'Guardar ahora' }).click(); await P.waitForTimeout(2500)
  const comp = JSON.parse(sq(`select composition::text from render_jobs where id='${job}'`)); const k = comp.clips[0]
  console.log('   guardado:', JSON.stringify({ dur: k.durationMs, fi: k.audioFadeInMs, env: k.volumeEnvelope }))
  if (k.audioFadeInMs !== 1000 || !k.volumeEnvelope || k.volumeEnvelope.length !== 3) throw new Error('la automatización no se guardó')
  if (JSON.stringify(k.volumeEnvelope.map(p => p.atMs)) !== '[0,2000,6000]' || JSON.stringify(k.volumeEnvelope.map(p => p.gain)) !== '[1,1,0.1]') throw new Error('puntos inesperados')
  await P.reload(); await settle(P); await P.waitForTimeout(2500); await openAuto()
  const back = await P.locator('input[aria-label^="Tiempo del punto"]').evaluateAll(l => l.map(x => x.value)); console.log('   tras recargar:', JSON.stringify(back)); if (back.length !== 3) throw new Error('no persisten tras recargar')
  await P.getByRole('button', { name: /^Exportar/ }).first().click(); await P.locator('#ed-export').waitFor({ state: 'visible' })
  const pick = async (l, v) => P.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
  const renders0 = Number(sq(`select count(*) from render_jobs where status='completed'`)), failed0 = sq(`select count(*) from render_jobs where status='failed'`)
  await P.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const tr = Date.now(); let n = renders0
  while (Date.now() - tr < 270000) { n = Number(sq(`select count(*) from render_jobs where status='completed'`)); if (n > renders0 || sq(`select count(*) from render_jobs where status='failed'`) !== failed0) break; await P.waitForTimeout(2000) }
  if (n <= renders0) throw new Error('el render no terminó: ' + sq(`select coalesce(error,'-') from render_jobs where status='failed' order by created_at desc limit 1`))
  const rel = sq(`select a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' and r.composition->>'title'='Automatización sonido P520' order by r.created_at desc limit 1`)
  const f = download(rel.split('/').pop()); const j = probe(f), dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  const rms = (ss, t) => { const e = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(ss), '-t', String(t), '-i', f, '-af', 'astats=metadata=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const m = [...e.matchAll(/RMS level dB: (-?[\d.]+|-inf)/g)].map(x => x[1]); const v = m[m.length - 1]; return v === '-inf' ? -120 : Number(v) }
  const r0 = rms(0, 0.2), loud = rms(1.3, 0.6), mid = rms(3.8, 0.4), end = rms(5.5, 0.4)
  console.log('   MP4:', dur.toFixed(2), 's · RMS (dB) 0 s:', r0, '· 1,3 s (pleno):', loud, '· 4 s (≈55 %):', mid, '· 5,7 s (≈15 %):', end, '· esperado respecto al pleno: ≈-5 dB y ≈-16 dB')
  return r0 < loud - 12 && mid < loud - 2 && mid > loud - 10 && end < loud - 11 && loud > -45
})
await step('M40 P5.20: plantilla vertical 9:16 (guardar → rellenar con otros archivos → ajustar duración → audio y subtítulos → MP4), con métricas de calidad y memoria', async () => {
  const P = FLOW.page, T0 = Date.now()
  await P.goto(base + `/editor/manual?job=${FLOW.job3}`); await settle(P); await P.waitForTimeout(2500)
  await P.getByText('IA', { exact: true }).first().click(); await P.waitForTimeout(500)
  await P.getByLabel('Nombre de la plantilla').fill('Plantilla vertical P520'); await P.getByRole('button', { name: 'Guardar como plantilla' }).click(); await P.waitForTimeout(1500)
  if (!/Plantilla «Plantilla vertical P520» guardada/.test(await P.locator('main').innerText())) throw new Error('no se guardó la plantilla')
  const orig = JSON.parse(sq(`select composition::text from render_jobs where id='${FLOW.job3}'`))
  await P.goto(base + '/editor/templates'); await settle(P); await P.waitForTimeout(1000)
  await P.getByRole('button', { name: /Plantilla vertical P520/ }).click(); await P.waitForTimeout(600)
  await P.getByLabel('Proyecto', { exact: true }).selectOption({ label: PROJ }); await P.waitForTimeout(1500)
  await P.getByLabel('Título del montaje').fill('Vertical desde plantilla P520')
  const slotOpts = async n => (await P.getByLabel(`Archivo para Visual ${n}`).locator('option').allInnerTexts()).map(x => x.trim())
  const o1 = await slotOpts(1), o2 = await slotOpts(2)
  const nv = o1.find(x => x.startsWith('[video]') && /clip-a/.test(x)), ni = o2.find(x => x.startsWith('[image]') && /still/.test(x))
  if (!nv || !ni) throw new Error('faltan archivos de sustitución: ' + o1.join('|') + ' // ' + o2.join('|'))
  await P.getByLabel('Archivo para Visual 1').selectOption({ label: nv }); await P.getByLabel('Archivo para Visual 2').selectOption({ label: ni })
  // huecos de audio (música/voz/efectos): se rellenan con el primer archivo que se ofrezca, como haría una persona
  const others = await P.locator('select[aria-label^="Archivo para "]:not([aria-label^="Archivo para Visual"])').evaluateAll(l => l.map(x => ({ label: x.getAttribute('aria-label'), opts: [...x.options].map(o => o.text.trim()).filter(t => t && !t.startsWith('—')) })))
  for (const sl of others) if (sl.opts.length) await P.getByLabel(sl.label, { exact: true }).selectOption({ label: sl.opts[0] })
  console.log('   huecos de audio rellenados:', JSON.stringify(others.map(x => [x.label, x.opts[0] ?? null])), '· en la original:', (orig.audioClips ?? []).length, 'clips de audio, música:', Boolean(orig.musicAssetId))
  await P.getByRole('button', { name: 'Crear montaje con esta plantilla' }).click(); await settle(P); await P.waitForTimeout(1500)
  const job = sq(`select id from render_jobs where composition->>'title'='Vertical desde plantilla P520' order by created_at desc limit 1`)
  const comp = JSON.parse(sq(`select composition::text from render_jobs where id='${job}'`))
  const nm = comp.clips.map(c => sq(`select coalesce(provenance->>'title',storage_path) from assets where id='${c.visualAssetId}'`))
  console.log('   plantilla →', comp.format, comp.clips.length, 'clips:', nm.join(' | '), '· duraciones', comp.clips.map(c => c.durationMs).join(','), '· subtítulos:', comp.subtitles, '· audio:', (comp.audioClips ?? []).length, 'clips +', Boolean(comp.musicAssetId), '· cues:', comp.clips.map(c => (c.cues ?? []).length).join(','), '· freezedetect: una imagen fija es un tramo estático esperado')
  if (comp.format !== '9:16' || comp.clips.length !== orig.clips.length) throw new Error('estructura distinta de la plantilla')
  if (!/clip-a/.test(nm[0]) || !/still/.test(nm[1])) throw new Error('los archivos sustituidos no están en el montaje')
  // navegador NUEVO y aislado para medir la memoria de una exportación sin el resto del E2E (solo hay una página abierta)
  const pidsOf = () => execFileSync('bash', ['-c', "ps -eo pid,args | awk '/chrome/ && !/awk/ {print $1}'"], { encoding: 'utf8' }).split('\n').filter(Boolean)
  const before = new Set(pidsOf()); const bx = await chromium.launch({ executablePath: CHROMIUM_PATH }); const cx = await bx.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const PX = await cx.newPage(); await login(PX, EMAIL, PW)
  await PX.goto(base + `/editor/manual?job=${job}`); await settle(PX); await PX.waitForTimeout(2500)
  await PX.getByRole('button', { name: /^Exportar/ }).first().click(); await PX.locator('#ed-export').waitFor({ state: 'visible' })
  const pick = async (l, v) => PX.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
  await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
  const renders0 = Number(sq(`select count(*) from render_jobs where status='completed'`)), failed0 = sq(`select count(*) from render_jobs where status='failed'`)
  await PX.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
  const chromeMb = () => { try { const mine = new Set(pidsOf().filter(x => !before.has(x))); return Math.round(execFileSync('ps', ['-eo', 'pid,rss'], { encoding: 'utf8' }).split('\n').map(l => l.trim().split(/\s+/)).filter(x => mine.has(x[0])).reduce((t, x) => t + Number(x[1]), 0) / 1024) } catch { return 0 } }
  let peak = chromeMb(), heap = 0; const tr = Date.now(); let n = renders0
  while (Date.now() - tr < 270000) {
    peak = Math.max(peak, chromeMb()); heap = Math.max(heap, await PX.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0)).catch(() => 0))
    n = Number(sq(`select count(*) from render_jobs where status='completed'`)); if (n > renders0 || sq(`select count(*) from render_jobs where status='failed'`) !== failed0) break; await PX.waitForTimeout(500)
  }
  if (n <= renders0) throw new Error('el render no terminó: ' + sq(`select coalesce(error,'-') from render_jobs where status='failed' order by created_at desc limit 1`))
  const renderS = (Date.now() - tr) / 1000; const idleMb = chromeMb(); await bx.close()
  const rel = sq(`select a.storage_path from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' and r.composition->>'title'='Vertical desde plantilla P520' order by r.created_at desc limit 1`)
  const f = download(rel.split('/').pop()); const j = probe(f), v = j.streams.find(x => x.codec_type === 'video'), a = j.streams.find(x => x.codec_type === 'audio'), dur = Number(j.format.duration)
  execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'])
  const expectMs = comp.clips.reduce((x, c) => x + c.durationMs, 0)
  const mean = (file, ss, w) => { const b = execFileSync('ffmpeg', ['-v', 'error', ...(ss != null ? ['-ss', String(ss)] : []), '-i', file, '-frames:v', '1', '-vf', w || 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 24 }); let r = 0, g = 0, bl = 0; const px = b.length / 3; for (let i = 0; i < b.length; i += 3) { r += b[i]; g += b[i + 1]; bl += b[i + 2] } return [r / px, g / px, bl / px].map(Math.round) }
  const dist = (p, q) => Math.round(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]))
  const c1 = comp.clips[0], c2 = comp.clips[1], t1 = (c1.durationMs / 1000) / 2, t2 = c1.durationMs / 1000 + (c2.durationMs / 1000) / 2
  const srcVid = download(sq(`select storage_path from assets where id='${c1.visualAssetId}'`).split('/').pop()), srcImg = download(sq(`select storage_path from assets where id='${c2.visualAssetId}'`).split('/').pop())
  const exp1 = mean(srcVid, ((c1.trimInMs ?? 0) / 1000) + t1 * (c1.speed ?? 1)), exp2 = mean(srcImg, null)
  const got1 = mean(f, t1), got2 = mean(f, t2), oldV = [0, 0, 255], oldI = [0, 255, 0]
  console.log('   color medio: vídeo nuevo esperado', exp1, 'en MP4', got1, '(Δ', dist(exp1, got1) + ') · imagen nueva esperada', exp2, 'en MP4', got2, '(Δ', dist(exp2, got2) + ')')
  // métricas de calidad
  const nb = Number(v.nb_frames), expFrames = Math.round(dur * 24), br = Math.round(Number(j.format.bit_rate) / 1000)
  const vd = Number(v.duration), ad = Number(a?.duration), startDiff = Math.abs(Number(v.start_time || 0) - Number(a?.start_time || 0))
  const dup = (() => { const e = spawnSync('ffmpeg', ['-v', 'info', '-i', f, '-vf', 'mpdecimate', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const m = [...e.matchAll(/frame=\s*(\d+)/g)].map(x => Number(x[1])); return m.length ? m[m.length - 1] : -1 })()
  const frz = (spawnSync('ffmpeg', ['-v', 'info', '-i', f, '-vf', 'freezedetect=n=-60dB:d=0.5', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/freeze_start/g) || []).length
  let ssim = '—'
  try { const ref = path.join(MEDIA, 'ref-still.png'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', srcImg, '-vf', `scale=${v.width}:${v.height}:force_original_aspect_ratio=increase,crop=${v.width}:${v.height}`, '-frames:v', '1', ref]); const fr = path.join(MEDIA, 'frame-still.png'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t2), '-i', f, '-frames:v', '1', fr]); const e = spawnSync('ffmpeg', ['-i', fr, '-i', ref, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; ssim = (e.match(/All:([\d.]+)/) || [])[1] || '—' } catch (e) { ssim = 'n/d' }
  const rmsA = (() => { const e = spawnSync('ffmpeg', ['-v', 'info', '-i', f, '-af', 'astats=metadata=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const m = [...e.matchAll(/RMS level dB: (-?[\d.]+|-inf)/g)].map(x => x[1]); return m.length ? m[m.length - 1] : 'n/d' })()
  console.log('   MP4:', JSON.stringify({ res: v && v.width + 'x' + v.height, v: v && v.codec_name, a: a && a.codec_name, dur: dur.toFixed(2), esperada: (expectMs / 1000).toFixed(2), kbps: br, fotogramas: nb, esperados: expFrames, descartados_mpdecimate: nb - dup, congelados: frz, difInicioAV_s: startDiff.toFixed(3), difDuracionAV_s: (vd - ad).toFixed(3), rmsAudio_dB: rmsA, ssim_vs_imagen_original: ssim }))
  console.log('   RENDIMIENTO: render', renderS.toFixed(1), 's · navegador NUEVO con una sola página (Chromium sin GPU): pico de memoria de todos sus procesos', peak, 'MB · al terminar', idleMb, 'MB · pico del heap JS de la página', Math.round(heap), 'MB · paso completo', ((Date.now() - T0) / 1000).toFixed(0), 's. Nota: ssim solo informativo (la imagen tiene movimiento de cámara y recorte)')
  return Boolean(v && a && v.width < v.height) && dist(exp1, got1) < 60 && dist(exp2, got2) < 60 && (dist(exp1, oldV) > 80 || dist(got1, oldV) > 80) && dist(got2, oldI) > 80 && Math.abs(dur - expectMs / 1000) < 0.6 && Math.abs(nb - expFrames) <= 2 && Math.abs(vd - ad) < 0.3 && startDiff < 0.1 && frz <= 1 && (comp.audioClips ?? []).length + (comp.musicAssetId ? 1 : 0) === (orig.audioClips ?? []).length + (orig.musicAssetId ? 1 : 0) && comp.subtitles === true && comp.clips.some(c => (c.cues ?? []).length > 0)
})
await step('M41 P5.21: memoria de la exportación por tipo de proceso (3 repeticiones, navegador nuevo cada vez), pico, tras exportar y tras descargar la página', async () => {
  const title = 'Vertical desde plantilla P520', job = sq(`select id from render_jobs where composition->>'title'='${title}' and status='draft' order by created_at desc limit 1`) || sq(`select id from render_jobs where composition->>'title'='${title}' order by created_at desc limit 1`)
  if (!job) throw new Error('falta el montaje de M40')
  // PSS (memoria proporcional) = lo que realmente ocupa cada proceso; la suma de RSS cuenta varias veces las bibliotecas compartidas del navegador.
  const snap = () => { const out = { browser: 0, renderer: 0, gpu: 0, utility: 0, other: 0, total: 0, rssTotal: 0, n: 0 }; for (const l of execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n')) { const m = /^\s*(\d+)\s+(.*)$/.exec(l); if (!m || !/chrome/.test(m[2]) || /ps -eo/.test(m[2]) || !mine.has(m[1])) continue; let pss = 0, rss = 0; try { const sm = readFileSync(`/proc/${m[1]}/smaps_rollup`, 'utf8'); pss = Number(/Pss:\s+(\d+)/.exec(sm)[1]) / 1024; rss = Number(/Rss:\s+(\d+)/.exec(sm)[1]) / 1024 } catch { continue } const t = /--type=([\w-]+)/.exec(m[2]); const k = !t ? 'browser' : t[1] === 'renderer' ? 'renderer' : t[1] === 'gpu-process' ? 'gpu' : t[1] === 'utility' ? 'utility' : 'other'; out[k] += pss; out.total += pss; out.rssTotal += rss; out.n++ } for (const k of Object.keys(out)) out[k] = Math.round(out[k]); return out }
  const pidsNow = () => execFileSync('bash', ['-c', "ps -eo pid,args | awk '/chrome/ && !/awk/ {print $1}'"], { encoding: 'utf8' }).split('\n').filter(Boolean)
  let mine = new Set(); const runs = []
  for (let r = 1; r <= 3; r++) {
    const before = new Set(pidsNow()); const bx = await chromium.launch({ executablePath: CHROMIUM_PATH }); const cx = await bx.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const PX = await cx.newPage(); await login(PX, EMAIL, PW)
    const cdp = await cx.newCDPSession(PX); await cdp.send('Performance.enable')
    mine = new Set(pidsNow().filter(x => !before.has(x)))
    await PX.goto(base + `/editor/manual?job=${job}`); await settle(PX); await PX.waitForTimeout(2500); mine = new Set(pidsNow().filter(x => !before.has(x)))
    const idle = snap()
    await PX.getByRole('button', { name: /^Exportar/ }).first().click(); await PX.locator('#ed-export').waitFor({ state: 'visible' })
    const pick = async (l, v) => PX.locator('#ed-export').getByLabel(l, { exact: true }).first().selectOption(v)
    await pick('Resolución', '480'); await pick('Destino', 'library'); await pick('Imágenes por segundo', '24')
    const renders0 = Number(sq(`select count(*) from render_jobs where status='completed'`)), failed0 = sq(`select count(*) from render_jobs where status='failed'`)
    const T = Date.now(); await PX.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click()
    let peak = { total: 0 }, peakJs = 0, n = renders0, workers = 0
    while (Date.now() - T < 270000) {
      mine = new Set(pidsNow().filter(x => !before.has(x))); const sn = snap(); if (sn.total > peak.total) peak = sn
      const m = await cdp.send('Performance.getMetrics').catch(() => null); const js = m ? (m.metrics.find(x => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576 : 0; peakJs = Math.max(peakJs, js)
      n = Number(sq(`select count(*) from render_jobs where status='completed'`)); if (n > renders0 || sq(`select count(*) from render_jobs where status='failed'`) !== failed0) break; await PX.waitForTimeout(150)
    }
    const secs = (Date.now() - T) / 1000; if (n <= renders0) throw new Error('el render no terminó')
    await PX.waitForTimeout(3000); mine = new Set(pidsNow().filter(x => !before.has(x))); const after = snap()
    await PX.goto('about:blank'); await PX.waitForTimeout(3000); mine = new Set(pidsNow().filter(x => !before.has(x))); const blank = snap()
    const size = Number(sq(`select coalesce((a.provenance->>'size_bytes')::bigint, 0) from render_jobs r join assets a on a.id=r.output_asset_id where r.status='completed' and r.composition->>'title'='${title}' order by r.created_at desc limit 1`) || 0)
    runs.push({ r, secs: +secs.toFixed(1), idle, peak, after, blank, peakJsMb: Math.round(peakJs), size })
    console.log('   RUN', r, JSON.stringify(runs[runs.length - 1])); await bx.close(); await new Promise(res => setTimeout(res, 1500))
  }
  // ¿fuga o meseta? tres exportaciones SEGUIDAS en la misma página, sin recargar: memoria (PSS) tras cada una
  {
    const before = new Set(pidsNow()); const bx = await chromium.launch({ executablePath: CHROMIUM_PATH }); const cx = await bx.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const PX = await cx.newPage(); await login(PX, EMAIL, PW)
    await PX.goto(base + `/editor/manual?job=${job}`); await settle(PX); await PX.waitForTimeout(2500); mine = new Set(pidsNow().filter(x => !before.has(x))); const seq = [{ paso: 'inicio', ...snap() }]
    for (let k = 1; k <= 3; k++) {
      if (!(await PX.locator('#ed-export').isVisible().catch(() => false))) { await PX.getByRole('button', { name: /^Exportar/ }).first().click(); await PX.locator('#ed-export').waitFor({ state: 'visible' }) }
      const renders0 = Number(sq(`select count(*) from render_jobs where status='completed'`)); await PX.locator('#ed-export').getByLabel('Resolución', { exact: true }).first().selectOption('480').catch(() => {}); await PX.locator('#ed-export').getByLabel('Destino', { exact: true }).first().selectOption('library').catch(() => {})
      await PX.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click(); const T = Date.now(); let pk = 0
      while (Date.now() - T < 120000) { mine = new Set(pidsNow().filter(x => !before.has(x))); pk = Math.max(pk, snap().renderer); if (Number(sq(`select count(*) from render_jobs where status='completed'`)) > renders0) break; await PX.waitForTimeout(200) }
      await PX.waitForTimeout(2500); mine = new Set(pidsNow().filter(x => !before.has(x))); const a = snap(); seq.push({ paso: 'tras exportación ' + k, picoRenderizador: Math.round(pk), renderizador: a.renderer, total: a.total, tiempo: +((Date.now() - T) / 1000).toFixed(1) })
      await PX.waitForTimeout(500)
    }
    console.log('   SECUENCIA (misma página):', JSON.stringify(seq)); await bx.close()
  }
  // ¿QUÉ COMPONENTE CONSUME? el mismo montaje con una parte quitada cada vez (misma resolución, navegador nuevo, una sola página)
  {
    const base0 = JSON.parse(sq(`select composition::text from render_jobs where id='${job}'`)); const setComp = c => sq(`update render_jobs set composition = $j$${JSON.stringify(c)}$j$::jsonb where id='${job}'`)
    const clone = () => structuredClone(base0)
    const variants = [
      ['completo (vídeo + imagen + música + subtítulos)', c => c],
      ['sin audio (sin música y vídeo silenciado)', c => { c.audioClips = []; c.musicAssetId = null; c.clips[0].muted = true; return c }],
      ['sin vídeo (las dos escenas son la imagen)', c => { c.clips[0].visualAssetId = c.clips[1].visualAssetId; return c }],
      ['sin subtítulos', c => { c.subtitles = false; c.clips.forEach(k => { delete k.cues }); return c }],
      ['solo imágenes y sin audio (codificación de vídeo + lienzo)', c => { c.clips[0].visualAssetId = c.clips[1].visualAssetId; c.audioClips = []; c.musicAssetId = null; c.subtitles = false; return c }],
    ]
    const table = []
    try {
      for (const [name, mut] of variants) {
        setComp(mut(clone()))
        const before = new Set(pidsNow()); const bx = await chromium.launch({ executablePath: CHROMIUM_PATH }); const cx = await bx.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const PX = await cx.newPage(); await login(PX, EMAIL, PW)
        await PX.goto(base + `/editor/manual?job=${job}`); await settle(PX); await PX.waitForTimeout(2500); mine = new Set(pidsNow().filter(x => !before.has(x))); const idle = snap()
        await PX.getByRole('button', { name: /^Exportar/ }).first().click(); await PX.locator('#ed-export').waitFor({ state: 'visible' })
        await PX.locator('#ed-export').getByLabel('Resolución', { exact: true }).first().selectOption('480'); await PX.locator('#ed-export').getByLabel('Destino', { exact: true }).first().selectOption('library')
        const renders0 = Number(sq(`select count(*) from render_jobs where status='completed'`)), T = Date.now(); await PX.locator('#ed-export').getByRole('button', { name: 'Renderizar y guardar', exact: true }).click(); let pk = idle; const series = []
        while (Date.now() - T < 120000) { mine = new Set(pidsNow().filter(x => !before.has(x))); const sn = snap(); series.push(Math.round((Date.now() - T) / 100) / 10 + 's:' + sn.renderer); if (sn.renderer > pk.renderer) pk = sn; if (Number(sq(`select count(*) from render_jobs where status='completed'`)) > renders0) break; await PX.waitForTimeout(120) }
        if (name.startsWith('completo')) console.log('   SERIE renderizador (s:MB): ' + series.join(' '))
        table.push({ variante: name, tiempo_s: +((Date.now() - T) / 1000).toFixed(1), renderizador_inactivo: idle.renderer, renderizador_pico: pk.renderer, aumento_MB: pk.renderer - idle.renderer, total_pico: pk.total })
        await bx.close(); await new Promise(res => setTimeout(res, 1000))
      }
    } finally { setComp(base0) }
    console.log('   ATRIBUCIÓN (PSS en MB):'); for (const t of table) console.log('     ', JSON.stringify(t))
  }
  const med = k => [...runs.map(x => x.peak[k])].sort((a, b) => a - b)[1]
  console.log('   MEDIANA pico PSS (MB): total', med('total'), '· (suma de RSS, sobreestima:', med('rssTotal'), ')', '· navegador', med('browser'), '· renderizadores', med('renderer'), '· GPU', med('gpu'), '· utilidades', med('utility'), '· otros', med('other'))
  return true
})
// A1 (P5.24): AUDITORÍA FUNCIONAL de todas las páginas con sesión real y datos reales (proyecto + vídeos + imagen). No afirma nada: registra evidencia.
await step('A1 auditoría: recorrer todas las páginas en escritorio y móvil (errores, avisos de simulación, desbordes, controles sin nombre)', async () => {
  const { mkdirSync } = await import('node:fs'); mkdirSync('/tmp/audit', { recursive: true })
  const proj = sq(`select id from projects order by created_at desc limit 1`), job = sq(`select id from render_jobs order by updated_at desc limit 1`)
  const paths = ['/', '/projects', `/projects/${proj}`, '/library', '/scripts', '/create', '/editor', '/editor/manual', `/editor/manual?job=${job}`, '/editor/auto', '/editor/style', '/editor/styles', '/editor/templates', '/repurpose', '/shorts', '/thumbnails', '/images', '/audio', '/voices', '/videos', '/studio', '/studio/recreate', '/influencer', '/youtube', '/social', '/connectors', '/calendar', '/campaigns', '/workflows', '/automations', '/queue', '/usage', '/analytics', '/storage', '/add', '/radar', '/opportunities', '/market-intelligence', '/legal/privacidad', '/legal/terminos', '/legal/eliminar-datos']
  const FLAG = /simulaci|próximamente|proximamente|no disponible|datos de prueba|ficticio|mock|not implemented|no está implementad|todavía no|aún no|sin conexi|no configurad|configura (la|el|tu)|requiere (una )?(clave|api|credencial|conexi)|desactivad/i
  const out = []
  for (const vp of [{ n: 'desk', w: 1500, h: 1000 }, { n: 'mov', w: 390, h: 844 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h })
    for (const pth of paths) {
      page.errors.length = 0; page.bad.length = 0
      let status = 0; try { const r = await page.goto(base + pth, { waitUntil: 'domcontentloaded', timeout: 20000 }); status = r?.status() ?? 0 } catch (e) { status = -1 }
      await settle(page)
      const info = await page.evaluate(() => {
        const vis = e => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' }
        const btns = [...document.querySelectorAll('button,[role=button],a[href],input,select,textarea')].filter(vis)
        const name = e => (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('title') || e.getAttribute('placeholder') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.innerText) || e.closest('label')?.innerText || '').trim()
        const unnamed = btns.filter(e => !name(e)).length
        const disabled = [...document.querySelectorAll('button:disabled')].filter(vis).map(e => (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40))
        const main = (document.querySelector('main') || document.body).innerText
        return { url: location.pathname + location.search, h1: (document.querySelector('h1')?.innerText || '').slice(0, 80), controls: btns.length, unnamed, disabled: disabled.slice(0, 8), disabledN: disabled.length, overflowX: document.documentElement.scrollWidth - innerWidth, textLen: main.length, text: main.slice(0, 3000) }
      })
      const flags = [...new Set([...info.text.matchAll(new RegExp(FLAG.source, 'gi'))].map(m => m[0].toLowerCase()))].slice(0, 6)
      const rec = { vp: vp.n, path: pth, status, final: info.url, h1: info.h1, controls: info.controls, unnamed: info.unnamed, disabledN: info.disabledN, disabled: info.disabled, overflowX: info.overflowX, textLen: info.textLen, flags, errors: page.errors.slice(0, 3), bad: [...new Set(page.bad)].slice(0, 4), dialogs: page.dialogs.length }
      out.push(rec); console.log('   AUDIT ' + JSON.stringify(rec))
      if (vp.n === 'desk' || info.overflowX > 4) await page.screenshot({ path: `/tmp/audit/${vp.n}-${pth.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false }).catch(() => {})
    }
  }
  writeFileSync('/tmp/audit/audit.json', JSON.stringify(out, null, 1)); return true
})

// A2 (P5.24): DETECTOR DE CONTROLES MUERTOS. Pulsa cada botón habilitado del contenido de cada página (datos sintéticos, red a terceros bloqueada)
// y registra los que no producen ningún efecto (sin cambio en pantalla, sin petición, sin navegación) o provocan errores. Es evidencia, no un veredicto.
await step('A2 auditoría: pulsar cada botón de cada página y registrar los que no hacen nada o fallan', async () => {
  const { mkdirSync } = await import('node:fs'); mkdirSync('/tmp/audit', { recursive: true })
  const proj = sq(`select id from projects order by created_at desc limit 1`), job = sq(`select id from render_jobs order by updated_at desc limit 1`)
  const paths = (process.env.A2_PATHS ? process.env.A2_PATHS.split(',') : ['/projects', `/projects/${proj}`, '/library', '/scripts', '/create', '/editor', `/editor/manual?job=${job}`, '/editor/auto', '/editor/style', '/editor/styles', '/editor/templates', '/repurpose', '/shorts', '/thumbnails', '/audio', '/studio', '/studio/recreate', '/influencer', '/youtube', '/social', '/connectors', '/calendar', '/campaigns', '/workflows', '/automations', '/usage', '/analytics', '/storage', '/add', '/radar', '/opportunities', '/market-intelligence'])
  const SKIP = /eliminar|borrar|cerrar sesi|salir|cancelar suscri|desconectar|revocar|vaciar|descargar|publicar|subir a youtube|conectar/i
  await page.setViewportSize({ width: 1500, height: 1000 })
  let reqN = 0; page.on('request', () => { reqN++ })
  const res = []
  for (const pth of paths) {
    await page.goto(base + pth, { waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(page)
    const labels = await page.evaluate(() => { const m = document.querySelector('main') || document.body; const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      return [...m.querySelectorAll('button:not(:disabled):not([aria-disabled=true])')].filter(vis).map((e, i) => ({ i, t: (e.innerText || e.getAttribute('aria-label') || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 60) })) })
    const todo = labels.filter(l => !SKIP.test(l.t)).slice(0, 45)
    for (const l of todo) {
      await page.goto(base + pth, { waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(page)
      const btn = page.locator('main button:not(:disabled):not([aria-disabled=true])').nth(l.i)
      if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) continue
      const snap = async () => page.evaluate(() => (document.querySelector('main') || document.body).innerHTML.length + '|' + (document.querySelector('main') || document.body).innerText.length + '|' + location.href + '|' + document.querySelectorAll('[role=dialog],dialog,[aria-modal=true]').length + '|' + document.querySelectorAll('input:checked').length)
      const b4 = await snap(), r0 = reqN, e0 = page.errors.length, d0 = page.dialogs.length; page.bad.length = 0
      await btn.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700)
      const af = await snap(); const changed = af !== b4 || reqN > r0 || page.dialogs.length > d0
      const fails = page.bad.filter(x => /^(5\d\d|4(?!03)\d\d) /.test(x) || /pageerror/.test(x)).slice(0, 2)
      if (!changed || page.errors.length > e0 || fails.length) res.push({ path: pth.replace(proj, ':id').replace(job, ':job'), button: l.t, sinEfecto: !changed, errores: page.errors.slice(e0, e0 + 2), peticiones: fails })
    }
    console.log('   A2 ' + pth.replace(proj, ':id').replace(job, ':job') + ': ' + todo.length + ' botones probados, ' + res.filter(r => r.path === pth.replace(proj, ':id').replace(job, ':job')).length + ' con hallazgo')
  }
  writeFileSync('/tmp/audit/dead-controls.json', JSON.stringify(res, null, 1)); for (const r of res) console.log('   A2HALLAZGO ' + JSON.stringify(r)); return true
})

// A3 (P5.24): ¿qué ve el usuario al pulsar los botones sospechosos? Imprime las líneas de texto NUEVAS tras el clic (y alertas).
await step('A3 auditoría: feedback visible de botones sospechosos', async () => {
  const job = sq(`select id from render_jobs order by updated_at desc limit 1`)
  const cases = [['/projects', 'Crear proyecto'], ['/create', 'Crear storyboard'], ['/editor', 'Renderizar y guardar'], ['/editor', 'Subtítulos .srt'], [`/editor/manual?job=${job}`, 'T+ Texto'], [`/editor/manual?job=${job}`, 'Pegar'], ['/audio', 'Generar con IA'], ['/audio', 'Música'], ['/repurpose', 'Transcribir'], ['/radar', 'Ver tendencias'], ['/market-intelligence', 'Descubrir oportunidades'], ['/shorts', 'Generar Short de prueba (gratis)']]
  await page.setViewportSize({ width: 1500, height: 1000 })
  for (const [pth, label] of cases) {
    await page.goto(base + pth, { waitUntil: 'domcontentloaded' }); await settle(page)
    const txt = async () => (await page.locator('body').innerText().catch(() => '')).split('\n').map(x => x.trim()).filter(Boolean)
    const before = new Set(await txt()); const btn = page.getByRole('button', { name: label, exact: false }).first()
    if (!(await btn.count())) { console.log(`   A3 ${pth} «${label}»: BOTÓN NO ENCONTRADO`); continue }
    const dis = await btn.isDisabled().catch(() => false)
    await btn.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500)
    const nuevo = (await txt()).filter(x => !before.has(x)).slice(0, 6)
    const alerts = await page.locator('[role=alert],[role=status]').allInnerTexts().catch(() => [])
    console.log(`   A3 ${pth.slice(0, 22)} «${label}» disabled=${dis} → nuevo: ${JSON.stringify(nuevo)} · alertas: ${JSON.stringify(alerts.filter(Boolean).slice(0, 3))} · diálogos: ${JSON.stringify(page.dialogs.slice(-2))}`)
    await page.screenshot({ path: `/tmp/audit/a3-${(pth + label).replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png` }).catch(() => {})
  }
  return true
})

// A4 (P5.24, solo con E2E_BETA=1): los módulos abiertos en la V1, ¿degradan con claridad cuando su API está cerrada?
await step('A4 auditoría beta: módulos abiertos y botones cuya API está cerrada', async () => {
  await page.setViewportSize({ width: 1500, height: 1000 })
  const cases = [['/repurpose', 'Transcribir'], ['/editor/auto', 'Transcribir'], ['/thumbnails', 'Generar'], ['/usage', ''], ['/calendar', ''], ['/workflows', ''], ['/editor/templates', ''], ['/editor/style', ''], ['/editor/styles', '']]
  for (const [pth, label] of cases) {
    page.errors.length = 0; page.bad.length = 0
    const r = await page.goto(base + pth, { waitUntil: 'domcontentloaded' }); await settle(page)
    const here = new URL(page.url()).pathname
    const txt = async () => (await page.locator('main').innerText().catch(() => '')).split('\n').map(x => x.trim()).filter(Boolean)
    const before = new Set(await txt()); let after = []
    if (label) { const b = page.getByRole('button', { name: label }).first(); if (await b.count()) { await b.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500); after = (await txt()).filter(x => !before.has(x)).slice(0, 4) } else after = ['(botón no encontrado)'] }
    console.log(`   A4 ${pth} → ${here} ${r?.status()} · errores: ${JSON.stringify(page.errors.slice(0, 2))} · fallos red: ${JSON.stringify([...new Set(page.bad)].filter(x => !/fonts\.g|ERR_ABORTED|channel_connections/.test(x)).slice(0, 3))} · tras pulsar «${label}»: ${JSON.stringify(after)}`)
    await page.screenshot({ path: `/tmp/audit/beta-${pth.replace(/[^a-z0-9]+/gi, '_')}.png` }).catch(() => {})
  }
  return true
})

await finish()
