import { LocalOnlyError } from '@/lib/queue/local-guard'
import { runSimulation } from '@/lib/queue/simulation/run'
import { SCENARIOS, type Scenario } from '@/lib/queue/simulation/video-production'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

if (flag('help')) {
  console.log(`npm run queue:simulate -- [opciones]
  (sin opciones)         1 trabajo correcto
  --concurrent           3 trabajos a la vez: correcto + cancelado + bloqueado por QC (MP4 corrupto)
  --fail                 añade escenarios de fallo: sin audio, sin material, negro a revisar, negro intencionado, silencio, duplicado
  --scenarios a,b,c      lista explícita (${SCENARIOS.join(', ')})
  --recover              demuestra la recuperación tras la caída de un ejecutor
  --json                 informe en JSON
Siempre dry_run=true, solo PostgreSQL local desechable, sin red ni servicios externos.`)
  process.exit(0)
}
if (argv.some(a => /^--(no-dry-run|live|dry-run=false|dryrun=false)$/.test(a))) {
  console.error('RECHAZADO: el runner solo funciona con dry_run=true.'); process.exit(2)
}
let scenarios: Scenario[] = ['ok']
if (flag('concurrent')) scenarios = ['ok', 'cancel_mid', 'corrupt']
if (flag('fail')) scenarios = [...new Set<Scenario>([...scenarios, 'ok', 'no_audio', 'missing_material', 'black_review', 'dark_ok', 'silent_narration', 'corrupt', 'cancel_mid', 'duplicate'])]
const sc = val('scenarios'); if (sc) scenarios = sc.split(',') as Scenario[]
const bad = scenarios.filter(s => !SCENARIOS.includes(s)); if (bad.length) { console.error(`Escenario desconocido: ${bad.join(', ')}`); process.exit(2) }

try {
  const r = await runSimulation({ scenarios, recover: flag('recover'), env: process.env, dryRun: true })
  if (flag('json')) console.log(JSON.stringify(r, null, 2))
  else {
    console.log(`SIMULACIÓN (dry_run) · ${r.jobs.length} trabajos · ${r.ok ? 'INVARIANTES OK' : 'INVARIANTES ROTOS'}`)
    for (const j of r.jobs) {
      console.log(`\n[${j.scenario}] ${j.jobId.slice(0, 8)} → ${j.status}${j.awaitingReason ? ` (${j.awaitingReason})` : ''}${j.error ? ` · ${JSON.stringify(j.error)}` : ''}${j.qc ? ` · QC ${j.qc.verdict} ${j.qc.codes.join(',')}` : ''}`)
      for (const s of j.steps) console.log(`   ${s.name.padEnd(20)} ${s.status.padEnd(10)} ${String(s.durationMs ?? '-').padStart(6)} ms  dep: ${s.dependsOn.join(',') || '-'}${s.error ? `  ERR ${JSON.stringify(s.error)}` : ''}`)
    }
    if (r.recovery) console.log(`\nRecuperación: A=${r.recovery.aOutcome}, B=${r.recovery.bOutcome}, final=${r.recovery.finalStatus}, intentos=${r.recovery.attempts}, ejecuciones de A=${JSON.stringify(r.recovery.aStepRuns)}`)
    console.log(`\nCoste: estimado ${JSON.stringify(r.cost.estimated)} · reservado ${r.cost.reserved} · confirmado ${r.cost.confirmed} — ${r.cost.note}`)
    console.log(`Invariantes: ${JSON.stringify(r.invariants)}`)
  }
  process.exit(r.ok ? 0 : 1)
} catch (e) {
  if (e instanceof LocalOnlyError) { console.error(`RECHAZADO: ${e.message}`); process.exit(2) }
  throw e
}
