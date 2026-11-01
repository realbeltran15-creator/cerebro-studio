import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { pgAvailable } from '@/lib/queue/dev/pg-local'
import { LocalOnlyError } from '@/lib/queue/local-guard'
import { runSimulation } from '@/lib/queue/simulation/run'
import type { Scenario } from '@/lib/queue/simulation/video-production'

const ready = pgAvailable() && spawnSync('ffmpeg', ['-version']).status === 0

describe.skipIf(!ready)('simulación integral (PostgreSQL local + ffmpeg real, dry_run)', () => {
  it('todos los escenarios: cada trabajo termina donde debe y no hay cargos, publicaciones ni duplicados', async () => {
    const all: Scenario[] = ['ok', 'cancel_mid', 'corrupt', 'no_audio', 'silent_narration', 'missing_material', 'black_review', 'dark_ok', 'duplicate']
    const r = await runSimulation({ scenarios: all, recover: true, env: {} })
    const by = (s: Scenario) => r.jobs.filter(j => j.scenario === s)[0]
    const qcCodes = (s: Scenario) => by(s).qc?.codes ?? []

    expect(by('ok')).toMatchObject({ status: 'completed', qc: { verdict: 'pass' } })
    expect(by('ok').steps.map(s => `${s.name}:${s.status}`)).toEqual([
      'script:completed', 'storyboard:completed', 'montage:completed', 'generate_assets:skipped', 'render:completed', 'qc:completed', 'prepare_publication:completed', 'publish:skipped'])
    expect(by('ok').steps.find(s => s.name === 'qc')?.dependsOn).toEqual(['render', 'montage'])
    expect(by('ok').steps.find(s => s.name === 'render')?.durationMs).toBeGreaterThan(0)

    expect(by('cancel_mid')).toMatchObject({ status: 'cancelled' })
    expect(by('cancel_mid').steps.filter(s => s.status === 'completed').map(s => s.name)).toEqual(['script', 'storyboard'])

    for (const s of ['corrupt', 'no_audio', 'silent_narration', 'missing_material'] as Scenario[]) {
      expect(by(s).status, s).toBe('failed')
      expect(by(s).steps.find(x => x.name === 'prepare_publication')?.status, `${s} no llega a Preparado`).toBe('pending')
    }
    expect(JSON.stringify(by('corrupt').steps.find(x => x.name === 'qc')?.error)).toContain('integrity_hash_mismatch')
    expect(qcCodes('no_audio')).toEqual([])        // el fallo se registra en el error del paso, no como resultado
    expect(JSON.stringify(by('no_audio').steps.find(x => x.name === 'qc')?.error)).toContain('audio_missing')
    expect(by('no_audio').steps.find(x => x.name === 'qc')?.error).toMatchObject({ code: 'qc_failed' })
    expect(JSON.stringify(by('silent_narration').steps.find(x => x.name === 'qc')?.error)).toContain('audio_silent')
    expect(JSON.stringify(by('missing_material').steps.find(x => x.name === 'qc')?.error)).toMatch(/clips_without_visual|render_marked_incomplete/)

    expect(by('black_review')).toMatchObject({ status: 'awaiting_approval', awaitingReason: 'qc_review_required', qc: { verdict: 'review' } })
    expect(by('black_review').steps.find(x => x.name === 'prepare_publication')?.status).toBe('pending')   // espera a una persona
    expect(by('dark_ok')).toMatchObject({ status: 'completed', qc: { verdict: 'pass' } })                   // negro intencionado no se rechaza
    expect(by('duplicate')).toMatchObject({ status: 'completed', qc: { verdict: 'warn', codes: ['warn:possible_duplicate'] } })

    expect(r.recovery).toMatchObject({ aOutcome: 'lease_lost', bOutcome: 'completed', finalStatus: 'completed', attempts: 2 })
    expect(r.recovery?.aStepRuns).toEqual({ script: 1, storyboard: 1, montage: 1, render: 1 })

    expect(r.invariants).toMatchObject({ externalCalls: 0, budgetEntries: 0, publishedOrSpent: 0, duplicateJobRows: 0 })
    expect(r.cost).toMatchObject({ reserved: 0, confirmed: 0 })
    expect(r.ok).toBe(true)
  }, 180_000)

  it('rechaza dry_run=false y entornos con variables de Production antes de arrancar nada', async () => {
    await expect(runSimulation({ scenarios: ['ok'], env: {}, dryRun: false })).rejects.toBeInstanceOf(LocalOnlyError)
    await expect(runSimulation({ scenarios: ['ok'], env: { SUPABASE_SERVICE_ROLE_KEY: 'x', VERCEL_ENV: 'production' } })).rejects.toBeInstanceOf(LocalOnlyError)
  })
})
