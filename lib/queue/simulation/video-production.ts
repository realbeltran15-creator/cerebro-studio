/**
 * Trabajo de produccion SIMULADO (Fase 4B.2): Proyecto → Guion → Storyboard → Montaje → Render → QC → Preparacion.
 * Todo es local: el «render» es un MP4 de prueba generado con ffmpeg y el QC inspecciona ese archivo real.
 * Ningun paso llama a YouTube, a modelos de IA ni a endpoints de Cerebro Studio (contador `externalCalls` siempre 0).
 */
import path from 'node:path'
import { emptyComposition } from '@/lib/editor/composition'
import { runMediaQc, sha256File } from '@/lib/qc/media'
import { compositionFingerprint } from '@/lib/qc/fingerprint'
import { corruptMiddle, makeTestVideo } from '@/lib/qc/testmedia'
import type { SceneSpan } from '@/lib/qc/validators'
import type { Registry, StepDef } from '@/lib/queue/executor'
import { StepError } from '@/lib/queue/policy'

export type Scenario = 'ok' | 'cancel_mid' | 'corrupt' | 'no_audio' | 'silent_narration' | 'black_review' | 'dark_ok' | 'missing_material' | 'duplicate'
export const SCENARIOS: Scenario[] = ['ok', 'cancel_mid', 'corrupt', 'no_audio', 'silent_narration', 'black_review', 'dark_ok', 'missing_material', 'duplicate']
export const KIND = 'video_production'

export type SimContext = {
  workDir: string
  rendersSeen: Array<{ renderId: string; fingerprint: string }>
  /** Llamadas a servicios externos: debe quedar en 0. */
  externalCalls: { count: number }
  requestCancel(jobId: string, ownerId: string): Promise<unknown>
  /** Pausa artificial dentro de «render» (para demostrar la recuperacion tras una caida). */
  renderGate?: Promise<void>
}

type P = { scenario: Scenario; seed?: number; projectName?: string }
const payloadOf = (p: Record<string, unknown>): P => ({ scenario: 'ok', ...(p as Partial<P>) } as P)

const SCENES_SHORT: SceneSpan[] = [
  { sceneId: 's1', startMs: 0, endMs: 1500, hasVisual: true }, { sceneId: 's2', startMs: 1500, endMs: 3000, hasVisual: true }, { sceneId: 's3', startMs: 3000, endMs: 4000, hasVisual: true },
]
const SCENES_BLACK: SceneSpan[] = [
  { sceneId: 's1', startMs: 0, endMs: 2000, hasVisual: true }, { sceneId: 's2', startMs: 2000, endMs: 6000, hasVisual: true }, { sceneId: 's3', startMs: 6000, endMs: 10000, hasVisual: true },
]

export function buildRegistry(ctx: SimContext): Registry {
  const steps: StepDef[] = [
    { name: 'script', kind: 'safe', run: async ({ job }) => ({ result: { title: payloadOf(job.payload).projectName ?? 'Proyecto de prueba', sections: 3 } }) },
    {
      name: 'storyboard', kind: 'safe', dependsOn: ['script'],
      run: async ({ job }) => {
        if (payloadOf(job.payload).scenario === 'cancel_mid') await ctx.requestCancel(job.id, job.ownerId)   // el usuario cancela a mitad
        return { result: { scenes: 3 } }
      },
    },
    {
      name: 'montage', kind: 'safe', dependsOn: ['storyboard'],
      run: async ({ job }) => {
        const p = payloadOf(job.payload)
        const c = emptyComposition('sim-storyboard', 'Montaje de prueba')
        c.clips = [1, 2, 3].map(i => ({ id: `c${i}`, sceneId: `s${i}`, position: i, narration: p.scenario === 'silent_narration' ? 'texto de narración' : null,
          visualAssetId: p.scenario === 'missing_material' && i === 2 ? null : `asset-${p.seed ?? 0}-${i}`, voiceAssetId: null, durationMs: 1000 + i * 100, motion: 'none' as const }))
        return { result: { fingerprint: compositionFingerprint(c), clips: c.clips.map(k => ({ id: k.id, visualAssetId: k.visualAssetId, narration: k.narration, voiceAssetId: k.voiceAssetId })) } }
      },
    },
    // Paso de pago SIMULADO: en dry_run nunca se ejecuta; solo declara su coste estimado.
    { name: 'generate_assets', kind: 'irreversible', provider: 'simulated-generator', requiresApproval: 'spend', dependsOn: ['storyboard'],
      estimate: () => ({ credits: 5 }), run: async () => { ctx.externalCalls.count++; return { result: 'nunca-en-dry-run' } } },
    {
      name: 'render', kind: 'safe', dependsOn: ['montage'], timeoutMs: 60_000,
      run: async ({ job }) => {
        const p = payloadOf(job.payload)
        if (ctx.renderGate) await ctx.renderGate
        const file = path.join(ctx.workDir, `${job.id}.mp4`)
        const black = p.scenario === 'black_review' || p.scenario === 'dark_ok'
        await makeTestVideo(file, { durationSec: black ? 10 : 4, audio: p.scenario === 'no_audio' ? 'none' : p.scenario === 'silent_narration' ? 'silent' : 'tone', black: black ? { from: 2, to: 6 } : undefined, seed: p.seed ?? 0 })
        const sha256 = await sha256File(file)                                         // huella del render limpio
        if (p.scenario === 'corrupt') await corruptMiddle(file, 600)                   // daño posterior (almacenamiento)
        return { result: { file, renderId: `render-${job.id.slice(0, 8)}`, sha256 } }
      },
    },
    {
      name: 'qc', kind: 'safe', dependsOn: ['render', 'montage'],
      run: async ({ job, previous }) => {
        const p = payloadOf(job.payload)
        const render = previous.render as { file: string; renderId: string; sha256: string }
        const montage = previous.montage as { fingerprint: string; clips: Array<{ id: string; visualAssetId: string | null; narration: string | null; voiceAssetId: string | null }> }
        const black = p.scenario === 'black_review' || p.scenario === 'dark_ok'
        const scenes = (black ? SCENES_BLACK : SCENES_SHORT).map(s => ({ ...s, hasVisual: !(p.scenario === 'missing_material' && s.sceneId === 's2'), intentionalDark: p.scenario === 'dark_ok' && s.sceneId === 's2' }))
        const report = await runMediaQc({
          file: render.file, expectedSha256: render.sha256, spec: { expectedDurationMs: black ? 10000 : 4000, width: 320, height: 180 },
          narrationExpected: p.scenario === 'silent_narration' || p.scenario === 'no_audio', audioExpected: true,
          scenes, provenance: { incomplete: p.scenario === 'missing_material' }, clips: montage.clips,
          fingerprint: montage.fingerprint, previousRenders: ctx.rendersSeen,
        })
        const summary = { verdict: report.verdict, findings: report.findings, meta: report.info?.meta ?? null }
        if (report.verdict === 'fail') throw new StepError(`QC no apto: ${report.findings.filter(f => f.severity === 'fail').map(f => f.code).join(', ')}`, { httpStatus: 422, code: 'qc_failed' })
        ctx.rendersSeen.push({ renderId: render.renderId, fingerprint: montage.fingerprint })
        if (report.verdict === 'review') return { result: summary, hold: { reason: 'qc_review_required' } }   // una persona decide
        return { result: summary }
      },
    },
    {
      name: 'prepare_publication', kind: 'safe', dependsOn: ['qc'],
      run: async ({ job, previous }) => {
        const qc = previous.qc as { verdict: string } | undefined
        if (!qc || !['pass', 'warn', 'review'].includes(qc.verdict)) throw new StepError('Sin QC apto no se prepara la publicación', { httpStatus: 422, code: 'qc_missing' })
        return { result: { draft: { title: `[SIMULADO] ${payloadOf(job.payload).projectName ?? 'Proyecto de prueba'}`, privacy: 'private', status: 'prepared', uploaded: false } } }
      },
    },
    { name: 'publish', kind: 'irreversible', provider: 'youtube', requiresApproval: 'publish', dependsOn: ['prepare_publication'],
      run: async () => { ctx.externalCalls.count++; return { result: 'nunca-en-dry-run' } } },
  ]
  return { [KIND]: steps }
}
