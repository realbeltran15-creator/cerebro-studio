import { describe, expect, it, vi } from 'vitest'
import { bibleIssues, parseBible } from '@/lib/virtual-influencer/bible'
import { identityReadiness, nextVersionNumber, parseTraits, traitFields } from '@/lib/virtual-influencer/identity'
import { applyAutomated, avSyncCheck, checksFor, decide, flickerCheck, newReport, overall, resolutionCheck } from '@/lib/virtual-influencer/quality'
import { adapterById, adapterReport, adapterStatus } from '@/lib/virtual-influencer/providers'
import { canTransition, preflight } from '@/lib/virtual-influencer/preflight'
import { approveIdentityVersion, createJob, dispatchJob, reviewJob } from '@/lib/virtual-influencer/server'
import { fakeDb } from './helpers/fake-db'

const goodBible = {
  summary: 'Guía de montaña que documenta expediciones reales', apparentAge: 29, languages: ['es'], personality: 'Serena, curiosa, meticulosa con la seguridad',
  tone: 'Cercano y preciso', contentPillars: ['Expediciones'], dontList: ['Nunca promociona conductas peligrosas'], originalLikenessConfirmed: true,
}
const fullTraits = Object.fromEntries(traitFields.map(f => [f.key, 'descrito']))
const refs = (extra: Array<{ category: string; approved: boolean }> = []) => [
  ...['face_front', 'face_front', 'face_three_quarter', 'face_three_quarter', 'face_profile', 'expression', 'expression', 'body', 'hands', 'teeth'].map(category => ({ category, approved: true })),
  ...extra,
]

describe('Persona Bible', () => {
  it('forces AI disclosure on and requires an adult, original persona', () => {
    const b = parseBible({ ...goodBible, aiDisclosure: false, apparentAge: 16, originalLikenessConfirmed: false })
    expect(b.aiDisclosure).toBe(true)
    const blocking = bibleIssues(b).filter(i => i.blocking).map(i => i.field)
    expect(blocking).toEqual(expect.arrayContaining(['apparentAge', 'originalLikenessConfirmed']))
  })
  it('accepts a complete bible and splits list fields', () => {
    const b = parseBible({ ...goodBible, contentPillars: 'Expediciones, Rescate\nSupervivencia' })
    expect(b.contentPillars).toEqual(['Expediciones', 'Rescate', 'Supervivencia'])
    expect(bibleIssues(b).filter(i => i.blocking)).toEqual([])
  })
})

describe('identity versioning', () => {
  it('counts only approved references per category', () => {
    const r = identityReadiness({ bible: parseBible(goodBible), traits: parseTraits(fullTraits), references: refs().map((x, i) => (i === 0 ? { ...x, approved: false } : x)) })
    expect(r.ready).toBe(false)
    expect(r.missing.join(' ')).toContain('Rostro de frente')
    expect(identityReadiness({ bible: parseBible(goodBible), traits: parseTraits(fullTraits), references: refs() }).ready).toBe(true)
  })
  it('numbers versions sequentially', () => { expect(nextVersionNumber([{ version: 1 }, { version: 3 }])).toBe(4); expect(nextVersionNumber([])).toBe(1) })
})

describe('quality reports', () => {
  it('never passes while any check is pending and fails on any failure', () => {
    let r = newReport('image')
    expect(overall(r)).toBe('pending')
    for (const c of r.filter(c => c.method === 'human')) r = decide(r, c.id, 'pass', null)
    expect(overall(r)).toBe('pending') // the automated resolution check is still unmeasured
    r = applyAutomated(r, [resolutionCheck('image', 1024, 1536)])
    expect(overall(r)).toBe('pass')
    r = decide(r, 'hands', 'fail', 'Seis dedos en la mano izquierda')
    expect(overall(r)).toBe('fail')
  })
  it('does not allow hand-marking automated checks', () => {
    expect(() => decide(newReport('video'), 'frame_stability', 'pass', null)).toThrow()
  })
  it('measures real values for automated checks', () => {
    expect(resolutionCheck('video', 640, 480).status).toBe('fail')
    expect(avSyncCheck(5000, 5080).status).toBe('pass')
    expect(avSyncCheck(5000, 5400).status).toBe('fail')
    expect(avSyncCheck(5000, null).status).toBe('fail')
    expect(flickerCheck([100, 101, 100, 102]).status).toBe('pass')
    expect(flickerCheck([100, 140, 90, 150]).status).toBe('fail')
    expect(flickerCheck([100]).status).toBe('pending')
  })
  it('applies lip sync and voice checks only where relevant', () => {
    expect(checksFor('image').map(c => c.id)).not.toContain('lip_sync')
    expect(checksFor('lipsync').map(c => c.id)).toEqual(expect.arrayContaining(['lip_sync', 'voice_identity', 'av_sync', 'blink_gaze']))
  })
})

describe('provider adapters', () => {
  it('reports NOT_CONNECTED without credentials and never exposes values', () => {
    const env = { OPENAI_API_KEY: 'sk-secret-value' }
    expect(adapterStatus(adapterById('openai-image')!, env)).toBe('CONNECTED')
    const report = adapterReport(env)
    expect(report.find(a => a.id === 'lipsync')).toMatchObject({ status: 'NOT_CONNECTED', missing: ['VI_LIPSYNC_ENDPOINT', 'VI_LIPSYNC_API_KEY'] })
    expect(JSON.stringify(report)).not.toContain('sk-secret-value')
  })
})

describe('preflight and budget', () => {
  const base = { adapterStatus: 'CONNECTED' as const, budgetEur: 0, spentEur: 0, estimatedCostEur: 0.05, identityApproved: true, approvedReferenceCount: 10, prompt: 'Saludo en el refugio' }
  it('blocks every paid job while the budget is 0 EUR', () => {
    expect(preflight({ ...base, adapter: adapterById('elevenlabs-voice'), voiceProfileApproved: true })).toContain('Presupuesto de 0 EUR: no se generan contenidos de pago.')
  })
  it('blocks unknown cost, over-budget and reference-less providers', () => {
    expect(preflight({ ...base, budgetEur: 10, estimatedCostEur: null, adapter: adapterById('elevenlabs-voice'), voiceProfileApproved: true }).join()).toContain('Coste no estimable')
    expect(preflight({ ...base, budgetEur: 1, spentEur: 0.99, adapter: adapterById('elevenlabs-voice'), voiceProfileApproved: true }).join()).toContain('supera el presupuesto')
    expect(preflight({ ...base, budgetEur: 10, adapter: adapterById('openai-image') }).join()).toContain('no puede garantizar la identidad')
  })
  it('passes a connected, approved, budgeted job', () => {
    expect(preflight({ ...base, budgetEur: 1, adapter: adapterById('elevenlabs-voice'), voiceProfileApproved: true })).toEqual([])
  })
  it('only allows valid status transitions', () => {
    expect(canTransition('queued', 'running')).toBe(true)
    expect(canTransition('draft', 'approved')).toBe(false)
    expect(canTransition('needs_review', 'approved')).toBe(true)
    expect(canTransition('approved', 'draft')).toBe(false)
  })
})

describe('server flows (in-memory database)', () => {
  const persona = (over: Record<string, unknown> = {}) => ({ id: 'p1', owner_id: 'u1', project_id: 'proj', name: 'Nora', status: 'draft', bible: goodBible, current_identity_version: null, budget_eur: 0, spent_eur: 0, ...over })

  it('stores a blocked job with its reasons when the budget is 0 (nothing is dispatched)', async () => {
    const db = fakeDb({ vi_personas: [persona({ current_identity_version: 1 })], vi_voice_profiles: [{ id: 'vp', owner_id: 'u1', status: 'approved' }] })
    const job = await createJob(db, 'u1', 'p1', { kind: 'voice', adapterId: 'elevenlabs-voice', prompt: 'Hola', inputs: { voiceProfileId: 'vp' }, estimatedCostEur: 0.02 }, { ELEVENLABS_API_KEY: 'k' })
    expect(job.status).toBe('blocked')
    expect(job.blocked_reasons).toContain('Presupuesto de 0 EUR: no se generan contenidos de pago.')
  })

  it('dispatches a queued job once, reserves its cost and leaves it pending human review', async () => {
    const db = fakeDb({
      vi_personas: [persona({ budget_eur: 1, spent_eur: 0 })],
      vi_generation_jobs: [{ id: 'j1', owner_id: 'u1', persona_id: 'p1', kind: 'voice', provider: 'elevenlabs-voice', status: 'queued', prompt: 'Hola', inputs: {}, estimated_cost_eur: 0.02 }],
    })
    const generate = vi.fn(async () => ({ provider: 'mock', mimeType: 'audio/mpeg', uri: 'data:audio/mpeg;base64,AA==' }))
    const out = await dispatchJob(db, 'u1', 'j1', generate, async () => ({ id: 'asset-9' }))
    expect(out).toEqual({ status: 'needs_review', assetId: 'asset-9' })
    expect(db.tables.vi_personas[0].spent_eur).toBe(0.02)
    await expect(dispatchJob(db, 'u1', 'j1', generate, async () => ({ id: 'x' }))).rejects.toThrow('no está en cola')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('refuses to approve a result whose quality review has not passed, then approves with a record', async () => {
    const db = fakeDb({ vi_generation_jobs: [{ id: 'j1', owner_id: 'u1', persona_id: 'p1', status: 'needs_review' }] })
    await expect(reviewJob(db, 'u1', 'j1', 'approved', null)).rejects.toThrow('calidad')
    db.tables.vi_quality_reports = [{ subject_type: 'generation_job', subject_id: 'j1', checks: [{ id: 'x', status: 'pass', method: 'human' }], overall: 'pass' }]
    await reviewJob(db, 'u1', 'j1', 'approved', 'Revisado')
    expect(db.tables.approvals[0]).toMatchObject({ action_type: 'vi_output', entity_id: 'j1', status: 'approved' })
    expect(db.tables.vi_generation_jobs[0].status).toBe('approved')
  })

  it('approves an identity version only when ready and reviewed, superseding the previous one', async () => {
    const db = fakeDb({
      vi_personas: [persona()],
      vi_identity_versions: [
        { id: 'v1', owner_id: 'u1', persona_id: 'p1', version: 1, status: 'approved', traits: fullTraits },
        { id: 'v2', owner_id: 'u1', persona_id: 'p1', version: 2, status: 'draft', traits: fullTraits },
      ],
      vi_references: refs().map((r, i) => ({ ...r, owner_id: 'u1', persona_id: 'p1', asset_id: `a${i}` })),
    })
    await expect(approveIdentityVersion(db, 'u1', 'p1', 'v2')).rejects.toThrow('calidad')
    db.tables.vi_quality_reports = [{ subject_type: 'identity_version', subject_id: 'v2', checks: newReport('identity').map(c => ({ ...c, status: 'pass' })), overall: 'pass' }]
    const res = await approveIdentityVersion(db, 'u1', 'p1', 'v2')
    expect(res.version).toBe(2)
    expect(db.tables.vi_identity_versions.map((v: any) => v.status)).toEqual(['superseded', 'approved'])
    expect(db.tables.vi_personas[0]).toMatchObject({ current_identity_version: 2, status: 'approved' })
    await expect(approveIdentityVersion(db, 'u1', 'p1', 'v2')).rejects.toThrow('borrador')
  })
})
