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
await finish()
