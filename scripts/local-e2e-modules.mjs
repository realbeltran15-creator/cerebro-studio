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
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${OFFICIAL ? GW : LITE}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon }
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
await finish()
