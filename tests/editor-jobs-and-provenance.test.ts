import { describe, expect, it } from 'vitest'
import { draftSummary, draftsForStoryboard, isStaleRender, STALE_RENDER_MS } from '@/lib/editor/jobs'
import { generationProvenance } from '@/lib/providers/provenance'

const clip = (sceneId: string, extra: Record<string, unknown> = {}) => ({ sceneId, position: 1, durationMs: 5000, narration: 'x', visualAssetId: null, voiceAssetId: null, motion: 'kenburns', focusX: 0.5, ...extra })
const comp = (storyboardId: string, clips: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, storyboardId, title: 't', format: '16:9', fadeMs: 300, subtitles: true, duckMusic: true, musicVolume: 0.25, musicAssetId: null, origin: null, clips, ...extra })

describe('saved edits (render_jobs drafts)', () => {
  it('lists every saved version of a storyboard, newest first, so duplicates are visible', () => {
    const rows = [
      { id: 'old-with-assets', updated_at: '2026-09-27T09:50:07Z', composition: comp('sb1', [clip('a', { visualAssetId: 'img', voiceAssetId: 'voz' })]) },
      { id: 'new-empty', updated_at: '2026-09-27T12:51:14Z', composition: comp('sb1', [clip('a')]) },
      { id: 'other-board', updated_at: '2026-09-27T13:00:00Z', composition: comp('sb2', [clip('a')]) },
      { id: 'short', updated_at: '2026-09-27T13:00:00Z', composition: comp('sb1', [clip('a')], { format: '9:16', origin: { kind: 'repurpose', sourceJobId: 'x', createdAt: '2026-09-27T13:00:00Z' } }) },
    ]
    const drafts = draftsForStoryboard(rows, 'sb1')
    expect(drafts.map(d => d.id)).toEqual(['new-empty', 'old-with-assets'])
    expect(draftSummary(drafts[1].comp)).toBe('1 escenas · 1 con imagen/vídeo · 1 con voz')
    expect(draftSummary(drafts[0].comp)).toBe('1 escenas · 0 con imagen/vídeo · 0 con voz')
  })

  it('treats a render still "rendering" after an hour without output as interrupted', () => {
    const now = Date.parse('2026-09-27T14:00:00Z')
    const job = (status: string, ago: number, out: string | null = null) => ({ status, output_asset_id: out, updated_at: new Date(now - ago).toISOString() })
    expect(isStaleRender(job('rendering', STALE_RENDER_MS + 1000), now)).toBe(true)
    expect(isStaleRender(job('rendering', 5 * 60_000), now)).toBe(false)
    expect(isStaleRender(job('completed', STALE_RENDER_MS * 3, 'asset'), now)).toBe(false)
    expect(isStaleRender(job('draft', STALE_RENDER_MS * 3), now)).toBe(false)
  })
})

describe('generated asset provenance', () => {
  it('records provider, model, date, project, usage and an explicit unreported cost', () => {
    const p = generationProvenance({ provider: 'openai-image', requestId: 'r1', projectId: 'p1', mimeType: 'image/png', metadata: { model: 'gpt-image-1', size: '1024x1024', usage: { total_tokens: 10 } }, now: new Date('2026-09-27T10:00:00Z') })
    expect(p).toMatchObject({ provider: 'openai-image', model: 'gpt-image-1', generatedAt: '2026-09-27T10:00:00.000Z', projectId: 'p1', requestId: 'r1', usage: { total_tokens: 10 }, cost: { amount: null, currency: null, reported: false } })
  })

  it('keeps a cost only when the provider reported one and never stores secrets from metadata keys', () => {
    const p = generationProvenance({ provider: 'x', requestId: 'r', projectId: 'p', mimeType: 'audio/mpeg', metadata: { cost: { amount: 0.02, currency: 'USD', reported: true } } })
    expect(p.cost).toEqual({ amount: 0.02, currency: 'USD', reported: true })
    expect(JSON.stringify(p)).not.toMatch(/api[_-]?key|authorization|bearer/i)
  })
})

import { musicGainPlan, DUCK_RATIO } from '@/lib/editor/audio-plan'

describe('music ducking plan', () => {
  const valueAfter = (events: ReturnType<typeof musicGainPlan>, t: number) => [...events].filter(e => e.time <= t).pop()?.value
  it('ducks a voice that starts at 0 s (the fade-in lands on the ducked level)', () => {
    const ev = musicGainPlan({ base: 0.25, t0: 10, end: 90, duck: true, voices: [{ start: 10, end: 14.5 }] })
    expect(ev.find(e => e.type === 'ramp')).toEqual({ type: 'ramp', value: 0.25 * DUCK_RATIO, time: 11 })
    expect(valueAfter(ev, 12)).toBeCloseTo(0.25 * DUCK_RATIO)
    expect(valueAfter(ev, 20)).toBe(0.25)
  })
  it('ducks later voices and restores after each', () => {
    const ev = musicGainPlan({ base: 0.3, t0: 0, end: 60, duck: true, voices: [{ start: 20, end: 25 }] })
    expect(valueAfter(ev, 5)).toBe(0.3)
    expect(valueAfter(ev, 22)).toBeCloseTo(0.3 * DUCK_RATIO)
    expect(valueAfter(ev, 26)).toBe(0.3)
    expect(ev.at(-1)).toMatchObject({ value: 0, time: 58.8 })
  })
  it('keeps events chronological and does not duck when disabled', () => {
    const ev = musicGainPlan({ base: 0.3, t0: 0, end: 30, duck: false, voices: [{ start: 0, end: 5 }] })
    expect(ev.map(e => e.value)).toEqual([0, 0.3, 0])
    expect(ev.map(e => e.time)).toEqual([...ev.map(e => e.time)].sort((a, b) => a - b))
  })
})
