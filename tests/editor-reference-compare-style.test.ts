import { describe, expect, it } from 'vitest'
import { emptyComposition, type Composition } from '@/lib/editor/composition'
import { addClip, toManual } from '@/lib/editor/timeline'
import { measureReference, referenceToStyle } from '@/lib/editor/reference'
import { compareLanes, laneOfComposition, laneOfSnapshot } from '@/lib/editor/compare'
import { applyStyle, learnStyle, mergeStyles } from '@/lib/editor/style'
import { setCutSfx, defaultCutSfx, cutSfxClips } from '@/lib/editor/cut-sfx'
import { cutTimes } from '@/lib/editor/sync'

const FPS = 8
/** SYNTHETIC frame differences: quiet video (0.02 noise) with a hard cut (0.6) at each given time. */
function diffsWithCuts(durationMs: number, cuts: number[]) {
  const n = Math.floor(durationMs / 1000 * FPS)
  const d = Array.from({ length: n }, (_, i) => 0.02 + ((i * 7) % 5) * 0.002)
  for (const t of cuts) d[Math.round(t / 1000 * FPS) - 1] = 0.6
  return d
}
const make = (durs: number[]): Composition => { let c = emptyComposition('sb', 't'); durs.forEach((d, i) => { c = addClip(c, `v${i}`, d, i); c = { ...c, clips: c.clips.map((k, j) => (j === i ? { ...k, id: `c${i}` } : k)) } }); return c }

describe('reference video: only measurable numbers, nothing of the video', () => {
  const cuts = [2000, 4000, 6000, 8000, 10000, 12000, 13000, 14000, 15000, 16000]
  const m = measureReference({ label: '  Mi referencia  ', durationMs: 18000, fps: FPS, diffs: diffsWithCuts(18000, cuts), width: 1080, height: 1920, hasAudio: false }, new Date('2026-10-21T00:00:00Z'))
  it('finds the cuts and the shot rhythm from the frame differences', () => {
    expect(m.cutsMs.length).toBe(10); expect(m.shots.count).toBe(11)
    expect(m.shots.medianMs).toBeGreaterThanOrEqual(1500); expect(m.shots.medianMs).toBeLessThanOrEqual(2000)
    expect(m.shots.cutsPerMinute).toBe(33.3); expect(m.shots.cutsInFirst3s).toBe(1)
    expect(m.shots.accelerating).toBe(true)
    expect(m.video.aspect).toBe('9:16'); expect(m.label).toBe('Mi referencia')
  })
  it('stores no content: the result is plain numbers and notes, with no file name, frames, audio or text', () => {
    const json = JSON.stringify(m)
    expect(json).not.toMatch(/data:|blob:|\.mp4|\.mov|base64/i)
    const walk = (v: unknown): boolean => typeof v === 'number' || typeof v === 'boolean' || v === null || typeof v === 'string' || (Array.isArray(v) ? v.every(walk) : typeof v === 'object' && Object.values(v as object).every(walk))
    expect(walk(m)).toBe(true); expect(m.notes.join(' ')).toMatch(/No se guarda ningún fotograma/)
  })
  it('a video without cuts reports one long shot, not made-up cuts', () => {
    const r = measureReference({ label: 'x', durationMs: 20000, fps: FPS, diffs: diffsWithCuts(20000, []) })
    expect(r.cutsMs).toEqual([]); expect(r.shots.count).toBe(1); expect(r.shots.medianMs).toBe(20000); expect(r.shots.accelerating).toBeNull()
  })
  it('turns into an ordinary style: measured rhythm, hard cuts, neutral for what is not measurable, labelled as a reference', () => {
    const s = referenceToStyle(m)
    expect(s.source).toBe('referencia'); expect(s.version).toBe(1); expect(s.name).toBe('Referencia · Mi referencia')
    expect(s.pacing.medianClipMs).toBeGreaterThanOrEqual(1500); expect(s.transitions.pattern).toBe('cut'); expect(s.sfxOnCuts).toBeNull(); expect(s.format).toBe('9:16')
    expect(s.observations.join(' ')).toMatch(/No medido en una referencia/)
    const applied = applyStyle(make([9000, 9000]), s, () => 'video')
    expect(applied.composition.clips.length).toBeGreaterThan(2)   // long clips are cut to the reference's rhythm
  })
  it('follows the music only when the cuts really are on the beat', () => {
    const beats = { beatsMs: cuts, bpm: 120, confidence: 0.6 }
    expect(referenceToStyle(measureReference({ label: 'b', durationMs: 18000, fps: FPS, diffs: diffsWithCuts(18000, cuts), beats })).sync).toEqual({ snapToBeats: true, toleranceMs: 150 })
    const off = { beatsMs: cuts.map(t => t + 250), bpm: 120, confidence: 0.6 }
    expect(referenceToStyle(measureReference({ label: 'b', durationMs: 18000, fps: FPS, diffs: diffsWithCuts(18000, cuts), beats: off })).sync).toBeUndefined()
  })
})

describe('edit styles: effects on cuts and the beat are saved and replayed', () => {
  const sfxComp = (preMs: number, every: number) => { const c = make([3000, 3000, 3000, 3000, 3000]); return setCutSfx(c, { ...defaultCutSfx('whoosh'), preMs, every, volume: 0.6 }).composition }
  it('learns where the effect sits against the cut and how often, and where the cuts sit against the beat', () => {
    const after = sfxComp(0, 1)
    const s = learnStyle(null, after, () => 'video', 'S', [3000, 6000, 9000, 12000])
    expect(s.sfxOnCuts).toMatchObject({ assetId: 'whoosh', volume: 0.6 }); expect(s.sync).toMatchObject({ snapToBeats: true })
    expect(s.observations.join(' ')).toMatch(/Cortas con el pulso de la música \(4 de 4/)
    const lead = learnStyle(null, sfxComp(400, 1), () => 'video', 'S'); expect(lead.sfxOnCuts?.preMs).toBe(400)
    const alt = learnStyle(null, sfxComp(0, 2), () => 'video', 'S'); expect(alt.sfxOnCuts?.every).toBe(2)
  })
  it('replays them on another montage: cuts move to that montage\'s beats, effects follow the final cuts, and it says what it did', () => {
    const s = learnStyle(null, sfxComp(0, 1), () => 'video', 'S', [3000, 6000, 9000, 12000])
    const target = make([3080, 2950, 3070, 2900, 3000]) // cuts at 3080, 6030, 9100, 12000
    const r = applyStyle(target, { ...s, pacing: { ...s.pacing, splitLong: false, retime: false } }, () => 'image', { beatsMs: [3000, 6000, 9000, 12000] })
    expect(cutTimes(r.composition)).toEqual([3000, 6000, 9000, 12000]); expect(cutSfxClips(r.composition)).toHaveLength(4)
    expect(r.changes.join(' ')).toMatch(/3 cortes movidos al pulso de la música \(1 ya estaban/)
  })
  it('without analysed music it says so instead of pretending', () => {
    const s = learnStyle(null, sfxComp(0, 1), () => 'video', 'S', [3000, 6000, 9000, 12000])
    expect(applyStyle(make([3000, 3000]), s, () => 'image').changes.join(' ')).toMatch(/no tiene música analizada/)
  })
  it('styles saved before these fields existed still apply, and merging keeps the newest sync', () => {
    const base = learnStyle(null, make([3000, 3000, 3000]), () => 'video', 'old')
    const legacy = { ...base }; delete (legacy as { sync?: unknown }).sync
    expect(() => applyStyle(make([3000, 3000]), legacy, () => 'image')).not.toThrow()
    const withSync = learnStyle(null, make([3000, 3000, 3000, 3000]), () => 'video', 'n', [3000, 6000, 9000])
    expect(mergeStyles(legacy, withSync).sync).toEqual(withSync.sync)
  })
})

describe('compare: manual montage vs automatic montage', () => {
  const auto = make([3000, 3000, 3000, 3000])
  const manual = make([2900, 3200, 2800, 1500, 1600])   // cuts 2900, 6100, 8900, 10400
  it('pairs the cuts that coincide (within tolerance) and lists the ones only one montage has', () => {
    const cmp = compareLanes(laneOfComposition(manual, 'Manual'), laneOfComposition(auto, 'Automático'), { toleranceMs: 300 })
    // auto cuts: 3000, 6000, 9000
    expect(cmp.matched).toEqual([{ aMs: 2900, bMs: 3000, deltaMs: 100 }, { aMs: 6100, bMs: 6000, deltaMs: -100 }, { aMs: 8900, bMs: 9000, deltaMs: 100 }])
    expect(cmp.onlyA).toEqual([10400]); expect(cmp.onlyB).toEqual([]); expect(cmp.cutAgreement).toBe(0.86)
    expect(cmp.differences.join(' ')).toMatch(/1 cortes de Manual no existen en Automático/); expect(cmp.differences.join(' ')).toMatch(/3 cortes coinciden pero no exactamente/)
  })
  it('two identical montages agree on every cut and say they are practically equal', () => {
    const cmp = compareLanes(laneOfComposition(auto, 'A'), laneOfComposition(make([3000, 3000, 3000, 3000]), 'B'))
    expect(cmp.cutAgreement).toBe(1); expect(cmp.onlyA).toEqual([]); expect(cmp.differences).toEqual(['Los dos montajes son prácticamente iguales en lo que se mide.'])
  })
  it('reports concrete differences with numbers: clips, typical length, effects, text, music', () => {
    const a = setCutSfx(manual, defaultCutSfx('w')).composition
    const d = compareLanes(laneOfComposition(a, 'Manual'), laneOfComposition(auto, 'Automático')).differences.join(' ')
    expect(d).toMatch(/5 clips y Automático 4/); expect(d).toMatch(/Efectos de sonido: 4 en Manual y 0 en Automático/)
  })
  it('the automatic side can come from the snapshot taken when the montage first became manual', () => {
    const c = make([3000, 3000, 3000]); const manualised = toManual(c)
    expect(manualised.autoSnapshot?.clips.map(k => k.durationMs)).toEqual([3000, 3000, 3000])
    const edited = { ...manualised, clips: manualised.clips.map((k, i) => (i === 0 ? { ...k, durationMs: 4000 } : k)) }
    expect(toManual(edited).autoSnapshot).toBe(manualised.autoSnapshot)   // taken once
    const cmp = compareLanes(laneOfComposition(edited, 'Manual'), laneOfSnapshot(edited.autoSnapshot!, 'Automático'))
    expect(cmp.a.totalMs).toBe(10000); expect(cmp.b.totalMs).toBe(9000); expect(cmp.differences.join(' ')).toMatch(/La duración total es 10 s frente a 9 s/)
  })
  it('compares how well each montage follows the music when beats are given', () => {
    const beats = [3000, 6000, 9000]
    const cmp = compareLanes(laneOfComposition(make([3000, 3000, 3000, 3000]), 'Auto'), laneOfComposition(make([2400, 3300, 2300, 3500]), 'Manual'), { beats })
    expect(cmp.beats).toEqual({ a: 1, b: 0 }); expect(cmp.differences.join(' ')).toMatch(/Cortes en el pulso de la música: 100 % en Auto y 0 % en Manual/)
  })
})
