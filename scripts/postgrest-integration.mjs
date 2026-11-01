// Pruebas de integración contra PostgREST REAL con el cliente @supabase/postgrest-js (el que usa supabase-js para .from()/.rpc()).
// Auth: JWT HS256 firmados aquí con un secreto de prueba -> NO valida Supabase Auth (GoTrue). Datos sintéticos. Sin Storage/Realtime.
import { PostgrestClient } from '@supabase/postgrest-js'
import { createHmac, randomUUID } from 'node:crypto'
const URL_ = process.env.PGRST_URL, SECRET = process.env.JWT_SECRET
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const jwt = (claims, secret = SECRET) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims); return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}` }
const now = Math.floor(Date.now() / 1000)
const tok = (sub, role = 'authenticated', exp = now + 3600, secret) => jwt({ sub, role, aud: 'authenticated', exp }, secret)
const client = (token) => new PostgrestClient(URL_, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
const A = randomUUID(), B = randomUUID()
const cA = client(tok(A)), cB = client(tok(B)), cAnon = client(null), cSvc = client(tok(randomUUID(), 'service_role'))
let pass = 0, fail = 0
const t = async (name, fn) => { try { const r = await fn(); if (r === true) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name, '->', r) } } catch (e) { fail++; console.log('FAIL ', name, '-> excepción', e.message) } }
const sq = async (sql) => { const { execFileSync } = await import('node:child_process'); return execFileSync('psql', ['-h', process.env.PGDIR, '-p', process.env.PGPORT, '-U', 'postgres', '-X', '-q', '-t', '-A', 'postgres', '-c', sql], { encoding: 'utf8' }).trim() }
await sq(`insert into auth.users values ('${A}'),('${B}')`)

console.log('== autenticación JWT en PostgREST real ==')
await t('sin token (anon) no lee proyectos', async () => { const r = await cAnon.from('projects').select('*'); return (r.data?.length ?? 0) === 0 })
await t('token con secreto equivocado -> 401', async () => { const r = await client(tok(A, 'authenticated', now + 3600, 'otro-secreto-distinto-xxxxxxxxxxxxxxxxxxxxxxxx')).from('projects').select('*'); return r.status === 401 })
await t('token caducado -> 401', async () => { const r = await client(tok(A, 'authenticated', now - 60)).from('projects').select('*'); return r.status === 401 })
await t('role=service_role en el JWT no se confunde con authenticated (sin pasar por RLS de usuario)', async () => { const r = await cSvc.from('projects').select('id'); return !r.error })

console.log('== RLS y aislamiento entre usuarios ==')
const pA = (await cA.from('projects').insert({ owner_id: A, name: 'pA' }).select().single()).data
const pB = (await cB.from('projects').insert({ owner_id: B, name: 'pB' }).select().single()).data
await t('A crea su proyecto', async () => !!pA?.id)
await t('B NO ve proyectos de A', async () => { const r = await cB.from('projects').select('id'); return r.data.length === 1 && r.data[0].id === pB.id })
await t('B no puede insertar con owner_id de A (RLS with check) -> 42501', async () => { const r = await cB.from('projects').insert({ owner_id: A, name: 'robo' }); return r.error?.code === '42501' })
await t('B no puede modificar el proyecto de A (0 filas)', async () => { const r = await cB.from('projects').update({ name: 'hack' }).eq('id', pA.id).select(); return !r.error && r.data.length === 0 })
await t('B no puede borrar el proyecto de A (0 filas)', async () => { const r = await cB.from('projects').delete().eq('id', pA.id).select(); return !r.error && r.data.length === 0 })
await t('el proyecto de A sigue intacto', async () => (await sq(`select name from projects where id='${pA.id}'`)) === 'pA')
await t('anon no puede insertar', async () => { const r = await cAnon.from('projects').insert({ owner_id: A, name: 'x' }); return !!r.error })

console.log('== libro de gasto (server-owned) ==')
await t('authenticated NO puede insertar en generation_spend', async () => { const r = await cA.from('generation_spend').insert({ owner_id: A, request_id: 'x', provider: 'p', model: 'm', tier: 't', estimate_usd: 0 }); return !!r.error })
await t('authenticated NO puede llamar a reserve_generation_spend por RPC', async () => { const r = await cA.rpc('reserve_generation_spend', { p_owner: A, p_request: 'h', p_provider: 'p', p_model: 'm', p_tier: 't', p_estimate: 1, p_daily_cap: 5, p_monthly_cap: 50 }); return !!r.error && [401, 403, 404].includes(r.status) })
await t('anon tampoco', async () => { const r = await cAnon.rpc('reserve_generation_spend', { p_owner: A, p_request: 'h', p_provider: 'p', p_model: 'm', p_tier: 't', p_estimate: 1, p_daily_cap: 5, p_monthly_cap: 50 }); return !!r.error })
const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => cSvc.rpc('reserve_generation_spend', { p_owner: A, p_request: `r${i}`, p_provider: 'p', p_model: 'm', p_tier: 't', p_estimate: 1, p_daily_cap: 5, p_monthly_cap: 100 })))
await t('service_role vía HTTP: 20 reservas simultáneas, tope 5 -> exactamente 5', async () => { const n = rs.filter((r) => r.data === 'reserved').length; return n === 5 || `reservadas=${n}` })
await t('A ve solo su gasto y B ninguno (RLS de lectura)', async () => { const a = await cA.from('generation_spend').select('id'); const b = await cB.from('generation_spend').select('id'); return a.data.length === 5 && b.data.length === 0 })
await t('transcription_locks no es accesible ni visible para authenticated', async () => { const r = await cA.from('transcription_locks').select('*'); return !!r.error })

console.log('== guiones / storyboards / escenas por HTTP ==')
const sc = (await cA.from('scripts').insert({ owner_id: A, project_id: pA.id, title: 'G1' }).select().single()).data
const secs = [{ position: 1, duration_ms: 4000, narration: 'hook', metadata: { script_section_id: 's1' } }, { position: 2, duration_ms: 6000, narration: 'cuerpo', metadata: { script_section_id: 's2' } }]
await t('crear scripts con versión duplicada en el mismo proyecto -> 23505', async () => { const r = await cA.from('scripts').insert({ owner_id: A, project_id: pA.id, title: 'G1bis', version: 1 }); return r.error?.code === '23505' })
const outs = await Promise.all(Array.from({ length: 10 }, () => cA.rpc('create_storyboard_from_script', { p_script_id: sc.id, p_scenes: secs })))
await t('10 llamadas HTTP concurrentes a create_storyboard_from_script -> 1 storyboard y 2 escenas', async () => { const ids = new Set(outs.map((o) => o.data)); const n = await sq(`select count(*) from scenes s join storyboards b on b.id=s.storyboard_id where b.script_id='${sc.id}'`); return (ids.size === 1 && !outs.some((o) => o.error) && n === '2') || `ids=${ids.size} escenas=${n} err=${outs.find((o) => o.error)?.error?.message}` })
const sb = outs[0].data
await t('B no puede crear storyboard sobre el guion de A (script_not_found)', async () => { const r = await cB.rpc('create_storyboard_from_script', { p_script_id: sc.id, p_scenes: secs }); return /script_not_found/.test(r.error?.message ?? '') })
await t('B no ve storyboards ni escenas de A', async () => { const a = await cB.from('storyboards').select('id'); const b = await cB.from('scenes').select('id'); return a.data.length === 0 && b.data.length === 0 })
const scenes = (await cA.from('scenes').select('id,position').eq('storyboard_id', sb).order('position')).data
await t('reorder_scenes por HTTP invierte el orden', async () => { const r = await cA.rpc('reorder_scenes', { p_storyboard: sb, p_ids: scenes.map((s) => s.id).reverse() }); const o = (await cA.from('scenes').select('id,position').eq('storyboard_id', sb).order('position')).data; return !r.error && o[0].id === scenes[1].id })
await t('reorder_scenes con conjunto incompleto -> error scene_set_mismatch y no cambia nada', async () => { const before = await sq(`select string_agg(id::text||':'||position,',' order by position) from scenes where storyboard_id='${sb}'`); const r = await cA.rpc('reorder_scenes', { p_storyboard: sb, p_ids: [scenes[0].id] }); const after = await sq(`select string_agg(id::text||':'||position,',' order by position) from scenes where storyboard_id='${sb}'`); return (/scene_set_mismatch/.test(r.error?.message ?? '') && before === after) || r.error?.message })
await t('B no puede reordenar escenas de A', async () => { const r = await cB.rpc('reorder_scenes', { p_storyboard: sb, p_ids: scenes.map((s) => s.id) }); return /scene_set_mismatch/.test(r.error?.message ?? '') })
await t('B no puede borrar escenas de A (0 filas)', async () => { const r = await cB.from('scenes').delete().eq('storyboard_id', sb).select(); return !r.error && r.data.length === 0 })
await t('A borra una escena y las demás conservan posiciones únicas', async () => { const r = await cA.from('scenes').delete().eq('id', scenes[0].id).select(); const left = await sq(`select count(*) from scenes where storyboard_id='${sb}'`); return r.data.length === 1 && left === '1' })
await t('A borra el storyboard y se van las escenas (cascade)', async () => { await cA.from('storyboards').delete().eq('id', sb); return (await sq(`select count(*) from scenes where storyboard_id='${sb}'`)) === '0' })
await t('borrar el guion no rompe nada (FK SET NULL)', async () => { const r = await cA.from('scripts').delete().eq('id', sc.id).select(); return !r.error && r.data.length === 1 })
await t('subtítulo único por origen vía HTTP (5 inserts simultáneos -> 1)', async () => { const rs = await Promise.all(Array.from({ length: 5 }, () => cA.from('assets').insert({ owner_id: A, asset_type: 'subtitle', provenance: { sourceAssetId: 'srcX' } }))); const ok = rs.filter((r) => !r.error).length; const dup = rs.filter((r) => r.error?.code === '23505').length; return (ok === 1 && dup === 4) || `ok=${ok} dup=${dup}` })

console.log(`\nRESUMEN: ejecutadas ${pass + fail} · pasan ${pass} · fallan ${fail} · (PostgREST real + postgrest-js real; JWT firmados por el test, NO Supabase Auth; sin Storage/Realtime)`)
process.exit(fail ? 1 : 0)
