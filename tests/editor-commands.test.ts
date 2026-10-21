import { describe, expect, it } from 'vitest'
import { parseTime, runInstruction, type CommandContext } from '@/lib/editor/commands'
import { deleteRange, isolateRange } from '@/lib/editor/range'
import { audioStartMs, clipStarts, parseComposition, totalDurationMs, type Composition } from '@/lib/editor/composition'

const comp = (): Composition => parseComposition({
  version: 1, storyboardId: 's', format: '16:9',
  clips: [
    { id: 'a', sceneId: 'a', position: 1, durationMs: 5000, visualAssetId: 'img1', motion: 'none' },
    { id: 'b', sceneId: 'b', position: 2, durationMs: 10000, visualAssetId: 'vid1', motion: 'none' },
    { id: 'c', sceneId: 'c', position: 3, durationMs: 5000, visualAssetId: 'img2', motion: 'none' },
  ],
  audioClips: [{ id: 'm', assetId: 'mus1', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 20000, volume: 0.5, muted: false }],
})!
const ctx = (o: Partial<CommandContext> = {}): CommandContext => ({
  playheadMs: 7000, range: null, selectedClipId: null, selectedAssetId: null, beatsMs: [],
  assets: [{ id: 'mus1', label: 'Lluvia suave', type: 'music', durationMs: 60000 }, { id: 'mus2', label: 'Tambores épicos', type: 'music', durationMs: 30000 }, { id: 'vo', label: 'Narración capítulo', type: 'voice', durationMs: 8000 }],
  isVideo: k => k.visualAssetId?.startsWith('vid') ?? false, ...o,
})
const run = (t: string, o?: Partial<CommandContext>, c = comp()) => runInstruction(c, t, ctx(o))

describe('times', () => {
  it.each([['1:23', 83000], ['minuto 2', 120000], ['minuto 2 y 30', 150000], ['2 minutos 30 segundos', 150000], ['segundo 12', 12000], ['0,5 segundos', 500], ['12 s', 12000]])('%s', (t, ms) => expect(parseTime(t)).toBe(ms))
})

describe('instructions', () => {
  it('«corta aquí» splits the clip under the playhead; «corta en 0:12» at that time', () => {
    const r = run('corta aquí'); expect(r.ok && r.composition.clips.length).toBe(4)
    const r2 = run('corta en 0:12'); expect(r2.ok && clipStarts(r2.composition)).toEqual([0, 5000, 12000, 15000])
    expect(run('corta en 5,5 segundos').ok).toBe(false) // would leave < 1 s
  })
  it('«pon esta música desde el minuto 2» adds the selected music at that time, capped to the montage', () => {
    const long = { ...comp(), clips: comp().clips.map(k => ({ ...k, durationMs: 60000 })) }
    const r = run('pon esta música desde el minuto 2', { selectedAssetId: 'mus2' }, long)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const added = r.composition.audioClips!.at(-1)!
    expect(added).toMatchObject({ assetId: 'mus2', kind: 'music', startMs: 120000, durationMs: 30000, volume: 0.3 })
    const r2 = run('pon la música «lluvia» desde 0:02 hasta 0:10 al 40 %')
    expect(r2.ok && r2.composition.audioClips!.at(-1)).toMatchObject({ assetId: 'mus1', startMs: 2000, durationMs: 8000, volume: 0.4 })
    const r3 = run('pon la voz de la narración desde el segundo 3')
    expect(r3.ok && r3.composition.audioClips!.at(-1)).toMatchObject({ kind: 'voice', assetId: 'vo', startMs: 3000 })
  })
  it('volume instructions', () => {
    const r = run('baja la música al 20 %'); expect(r.ok && r.composition.audioClips![0].volume).toBe(0.2)
    const r2 = run('sube la música'); expect(r2.ok && r2.composition.audioClips![0].volume).toBeCloseTo(0.65)
    const r3 = run('silencia el vídeo en todo'); expect(r3.ok && r3.composition.clips.find(k => k.id === 'b')!.muted).toBe(true)
  })
  it('«haz un zoom lento» on the clip under the playhead; «en todas las imágenes» widens it', () => {
    const r = run('haz un zoom lento'); expect(r.ok && r.composition.clips.map(k => k.camera?.kind ?? null)).toEqual([null, 'zoom_in', null])
    expect(r.ok && r.composition.clips[1].camera?.amount).toBe(0.08)
    const r2 = run('panorámica a la izquierda rápida en todas las imágenes'); expect(r2.ok && r2.composition.clips.map(k => k.camera?.kind ?? null)).toEqual(['pan_left', null, 'pan_left'])
  })
  it('«cambia de imagen siguiendo el ritmo» puts the cuts on beats', () => {
    const beats = Array.from({ length: 80 }, (_, i) => i * 500)
    const r = run('cambia de imagen siguiendo el ritmo', { beatsMs: beats })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const t of clipStarts(r.composition).slice(1)) expect(t % 500).toBe(0)
    expect(r.composition.clips.find(k => k.id === 'a')!.durationMs).toBe(1000)
    expect(run('cambia de imagen siguiendo el ritmo').ok).toBe(false) // no beats yet
  })
  it('a marked fragment scopes the instruction', () => {
    const r = run('transición de disolvencia', { range: { startMs: 4000, endMs: 9000 } })
    expect(r.ok && r.composition.clips.map(k => k.transition)).toEqual(['dissolve', 'dissolve', 'fade'])
    const r2 = run('corta aquí', { range: { startMs: 7000, endMs: 12000 } })
    expect(r2.ok && clipStarts(r2.composition)).toEqual([0, 5000, 7000, 12000, 15000])
  })
  it('speed, texts, format, subtitles, chains and unknowns', () => {
    const r = run('cámara lenta en todo'); expect(r.ok && r.composition.clips.find(k => k.id === 'b')).toMatchObject({ speed: 0.5, durationMs: 20000 })
    const t = run('pon el título «Capítulo 1» en el segundo 2 durante 3 segundos arriba'); expect(t.ok && t.composition.textClips![0]).toMatchObject({ content: 'Capítulo 1', startMs: 2000, durationMs: 3000, position: 'top' })
    const ch = run('formato vertical y luego quita los subtítulos'); expect(ch.ok && [ch.composition.format, ch.composition.subtitles]).toEqual(['9:16', false])
    expect(ch.ok && ch.done.length).toBe(2)
    const bad = run('haz magia'); expect(bad.ok).toBe(false)
  })
})

describe('fragments', () => {
  it('isolate splits at the edges and snaps when an edge is too close to a boundary', () => {
    const r = isolateRange(comp(), { startMs: 7000, endMs: 14500 })
    expect(clipStarts(r.composition)).toEqual([0, 5000, 7000, 15000])
    expect(r.range).toEqual({ startMs: 7000, endMs: 15000 })
  })
  it('deleting a fragment closes the gap and keeps the music in sync on both sides', () => {
    const c = { ...comp(), textClips: [{ id: 't', content: 'x', startMs: 16000, durationMs: 2000, position: 'center' as const, sizePct: 6 }] }
    const r = deleteRange(c, { startMs: 7000, endMs: 12000 })
    expect(r.removedMs).toBe(5000)
    expect(totalDurationMs(r.composition)).toBe(15000)
    const music = r.composition.audioClips!.filter(a => a.kind === 'music').map(a => [audioStartMs(r.composition, a), a.durationMs, a.trimInMs])
    expect(music).toEqual([[0, 7000, 0], [7000, 8000, 12000]])
    expect(r.composition.textClips![0].startMs).toBe(11000)
  })
})

describe('audio mix and automation', () => {
  it('solo and mute decide each track level', async () => {
    const { trackGains } = await import('@/lib/editor/composition')
    expect(trackGains(undefined)).toEqual({ video: 1, voice: 1, music: 1, sfx: 1 })
    expect(trackGains({ music: { gain: 0.5, muted: false, solo: false }, sfx: { gain: 1, muted: true, solo: false } })).toEqual({ video: 1, voice: 1, music: 0.5, sfx: 0 })
    expect(trackGains({ voice: { gain: 1.2, muted: false, solo: true } })).toEqual({ video: 0, voice: 1.2, music: 0, sfx: 0 })
  })
  it('fades and envelope points combine; breakpoints follow them', async () => {
    const { envelopeAt, envelopeBreakpoints } = await import('@/lib/editor/composition')
    const a = { durationMs: 10000, fadeInMs: 1000, fadeOutMs: 2000, envelope: [{ atMs: 4000, gain: 1 }, { atMs: 6000, gain: 0.5 }] }
    expect(envelopeAt(a, 500)).toBeCloseTo(0.5)
    expect(envelopeAt(a, 5000)).toBeCloseTo(0.75)
    expect(envelopeAt(a, 9000)).toBeCloseTo(0.25)
    expect(envelopeBreakpoints(a).map(p => p.atMs)).toEqual([0, 1000, 4000, 6000, 8000, 10000])
  })
  it('«baja la música al 20 % en el fragmento» automates only that stretch', () => {
    const r = run('baja la música al 20 %', { range: { startMs: 5000, endMs: 9000 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const m = r.composition.audioClips![0]
    expect(m.volume).toBe(0.5) // the clip's own level is unchanged
    expect(m.envelope).toEqual([{ atMs: 4700, gain: 1 }, { atMs: 5000, gain: 0.4 }, { atMs: 9000, gain: 0.4 }, { atMs: 9300, gain: 1 }])
  })
})

describe('preferences learned from corrections (with confirmation)', () => {
  it('an instruction is watched; a deliberate correction becomes a proposal; accepting changes the next result', async () => {
    const { detectCorrection, acceptProposal, DEFAULT_PREFS, parsePrefs } = await import('@/lib/editor/preferences')
    const r = run('haz un zoom lento', { selectedClipId: 'a' })
    expect(r.ok && r.watch).toEqual([{ key: 'zoomSlow', value: 0.08, target: { kind: 'clips', ids: ['a'] } }])
    if (!r.ok) return
    expect(detectCorrection(r.composition, r.watch![0])).toBeNull()
    const corrected = { ...r.composition, clips: r.composition.clips.map(k => (k.id === 'a' ? { ...k, camera: { kind: 'zoom_in' as const, amount: 0.05 } } : k)) }
    const p = detectCorrection(corrected, r.watch![0])!
    expect(p).toMatchObject({ key: 'zoomSlow', from: 0.08, to: 0.05 })
    const prefs = acceptProposal(DEFAULT_PREFS, p, 't')
    expect(prefs.zoomSlow).toBe(0.05); expect(prefs.history).toEqual([{ at: 't', key: 'zoomSlow', from: 0.08, to: 0.05 }])
    const again = run('haz un zoom lento', { selectedClipId: 'c', prefs })
    expect(again.ok && again.composition.clips.find(k => k.id === 'c')!.camera?.amount).toBe(0.05)
    expect(parsePrefs({ zoomSlow: 9, musicVolume: 'x' })).toMatchObject({ zoomSlow: 0.5, musicVolume: 0.3 })
  })
  it('music placed without a volume is watched, with a volume it is not', () => {
    const a = run('pon esta música desde el segundo 1', { selectedAssetId: 'mus2' })
    expect(a.ok && a.watch?.[0]).toMatchObject({ key: 'musicVolume', value: 0.3, target: { kind: 'audio' } })
    const b = run('pon esta música desde el segundo 1 al 50 %', { selectedAssetId: 'mus2' })
    expect(b.ok && b.watch).toEqual([])
  })
})
