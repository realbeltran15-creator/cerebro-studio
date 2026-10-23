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

describe('long videos', () => {
  it('a 95-minute video is laid out as consecutive pieces that play the whole file', async () => {
    const { addVideo } = await import('@/lib/editor/timeline')
    const { emptyComposition, compositionIssues, MAX_CLIP_MS } = await import('@/lib/editor/composition')
    const c = addVideo(emptyComposition('s', 'Largo'), 'vid', 95 * 60_000)
    expect(totalDurationMs(c)).toBe(95 * 60_000)
    expect(c.clips.every(k => k.durationMs <= MAX_CLIP_MS && k.visualAssetId === 'vid')).toBe(true)
    c.clips.forEach((k, i) => { if (i) expect(k.trimInMs).toBe((c.clips[i - 1].trimInMs ?? 0) + c.clips[i - 1].durationMs) })
    expect(c.clips.slice(0, -1).every(k => k.transition === 'cut')).toBe(true)
    const parsed = parseComposition(JSON.parse(JSON.stringify(c)))!
    expect(parsed.clips.at(-1)!.trimInMs).toBe(c.clips.at(-1)!.trimInMs) // trims beyond 60 min survive saving
    const issues = compositionIssues(parsed)
    expect(issues.some(i => i.blocking)).toBe(false)
    expect(issues.find(i => /Montaje largo \(95 min\)/.test(i.message))).toBeTruthy()
  })
})

describe('export plan', () => {
  it('size, bitrate and estimate follow the settings; the Library caps at 50 MB, downloads do not', async () => {
    const { exportPlan, frameSize } = await import('@/lib/editor/composition')
    expect(frameSize('16:9', '1080')).toEqual({ width: 1920, height: 1080 })
    expect(frameSize('9:16', '480')).toEqual({ width: 480, height: 854 })
    const short = { ...comp(), exportSettings: { quality: 'high' as const, resolution: '1080' as const } }
    const p = exportPlan(short)
    expect([p.width, p.height, p.videoBps, p.reduced]).toEqual([1920, 1080, 8_000_000, false])
    expect(p.estimatedBytes).toBe(Math.round((8_000_000 + 128_000) * 20000 / 8000))
    const long = { ...short, clips: short.clips.map(k => ({ ...k, durationMs: 30 * 60_000 })) } // 90 min
    const lib = exportPlan(long)
    expect(lib.reduced).toBe(true); expect(lib.fitsLibrary).toBe(false) // 90 min cannot fit in 50 MB even at the minimum bitrate
    const ten = exportPlan({ ...short, clips: short.clips.map(k => ({ ...k, durationMs: 200_000 })) })
    expect([ten.reduced, ten.fitsLibrary]).toEqual([true, true]); expect(ten.estimatedBytes).toBeLessThanOrEqual(50 * 1024 * 1024)
    const dl = exportPlan({ ...long, exportSettings: { ...long.exportSettings, destination: 'download' as const } })
    expect([dl.videoBps, dl.reduced]).toEqual([8_000_000, false])
    expect(exportPlan({ ...short, exportSettings: { quality: 'normal' as const, videoKbps: 3000, destination: 'download' as const } }).videoBps).toBe(3_000_000)
  })
})

describe('draggable volume points', () => {
  it('positions map to time and level; points never cross; adding keeps them sorted', async () => {
    const { envelopePointAt, moveEnvelopePoint, addEnvelopePoint } = await import('@/lib/editor/timeline')
    expect(envelopePointAt(50, 36, 100, 72, 10000)).toEqual({ atMs: 5000, gain: 1 })
    expect(envelopePointAt(-5, 200, 100, 72, 10000)).toEqual({ atMs: 0, gain: 0 })
    const a = { id: 'm', assetId: 'x', kind: 'music' as const, linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 10000, volume: 1, muted: false, envelope: [{ atMs: 2000, gain: 1 }, { atMs: 6000, gain: 0.5 }] }
    expect(moveEnvelopePoint(a, 0, { atMs: 9000, gain: 3 }).envelope).toEqual([{ atMs: 5990, gain: 2 }, { atMs: 6000, gain: 0.5 }])
    expect(addEnvelopePoint(a, { atMs: 4000, gain: 0.2 }).envelope!.map(p => p.atMs)).toEqual([2000, 4000, 6000])
  })
})

describe('more Spanish instructions', () => {
  it('spans written in the sentence', async () => {
    const { parseSpan } = await import('@/lib/editor/commands')
    expect(parseSpan('corta del minuto 1 al 2')).toEqual({ startMs: 60000, endMs: 120000 })
    expect(parseSpan('quita la voz desde 0:30 hasta 1:00')).toEqual({ startMs: 30000, endMs: 60000 })
    expect(parseSpan('zoom lento entre el segundo 5 y el segundo 10')).toEqual({ startMs: 5000, endMs: 10000 })
    expect(parseSpan('pon esta música desde el minuto 2')).toBeNull()
  })
  it('«corta del 0:06 al 0:09» removes that stretch; «zoom lento del segundo 5 al 15» scopes it', () => {
    const r = run('corta del 0:07 al 0:10')
    expect(r.ok && totalDurationMs(r.composition)).toBe(17000)
    const z = run('haz un zoom lento del segundo 6 al 14')
    expect(z.ok && z.composition.clips.map(k => k.camera?.kind ?? null)).toEqual([null, 'zoom_in', null])
  })
  it('fades, removing and silencing audio, ducking and caption styles', () => {
    const f = run('que la música entre poco a poco y luego fundido de salida de 3 segundos en la música')
    expect(f.ok && f.composition.audioClips![0]).toMatchObject({ fadeInMs: 2000, fadeOutMs: 3000 })
    const q = run('quita la música'); expect(q.ok && q.composition.audioClips).toEqual([])
    const sil = run('silencia la música del segundo 4 al 8')
    expect(sil.ok && sil.composition.audioClips![0].envelope?.filter(p => p.gain === 0).map(p => p.atMs)).toEqual([4000, 8000])
    const qr = run('quita la música del 0:04 al 0:08'); expect(qr.ok && qr.composition.audioClips!.length).toBe(1)
    expect(run('baja la música cuando hable').ok && (run('baja la música cuando hable') as { composition: Composition }).composition.duckMusic).toBe(true)
    const nb = run('no bajes la música'); expect(nb.ok && nb.composition.duckMusic).toBe(false)
    const sub = run('subtítulos palabra a palabra'); expect(sub.ok && [sub.composition.subtitles, sub.composition.captionStyle]).toEqual([true, 'karaoke'])
  })
  it('clip length, moving, navigation and history', () => {
    const d = run('que dure 3 segundos', { selectedClipId: 'b' }); expect(d.ok && d.composition.clips[1].durationMs).toBe(3000)
    const i = run('acorta las imágenes a 2 segundos'); expect(i.ok && i.composition.clips.map(k => k.durationMs)).toEqual([2000, 10000, 2000])
    const m = run('mueve este clip al principio', { selectedClipId: 'c' }); expect(m.ok && m.composition.clips.map(k => k.id)).toEqual(['c', 'a', 'b'])
    const v = run('ve al minuto 0:12'); expect(v.ok && v.playheadMs).toBe(12000)
    const sel = run('selecciona del 0:02 al 0:06'); expect(sel.ok && sel.range).toEqual({ startMs: 2000, endMs: 6000 })
    const u = run('deshaz'); expect(u.ok && u.history).toBe('undo')
  })
  it('effects on the cuts from the materials', () => {
    const r = runInstruction(comp(), 'pon el efecto «whoosh» en los cortes', { ...ctx(), assets: [...ctx().assets, { id: 'wh', label: 'Whoosh rápido', type: 'sfx', durationMs: 800 }] })
    expect(r.ok && r.composition.audioClips!.filter(a => a.origin === 'cut-sfx').length).toBe(2)
    if (!r.ok) return
    const off = runInstruction(r.composition, 'quita los efectos de los cortes', ctx())
    expect(off.ok && off.composition.audioClips!.filter(a => a.origin === 'cut-sfx').length).toBe(0)
  })
})

// The owner's own sentences (Ejercicio E): each one must change the timeline, not just answer.
describe('ejercicio E: órdenes en español del propietario', () => {
  const withVoice = (): Composition => ({ ...comp(), audioClips: [...comp().audioClips!, { id: 'v', assetId: 'vo', kind: 'voice', linkedClipId: null, offsetMs: 0, startMs: 6000, trimInMs: 0, durationMs: 4000, volume: 1, muted: false }] })
  it.each([
    ['Pon una transición suave entre todos los clips', {}],
    ['Haz un zoom lento sobre esta fotografía', { selectedClipId: 'a' }],
    ['Baja la música cuando empieza la voz', {}],
    ['Mueve este vídeo al principio', { selectedClipId: 'b' }],
    ['Duplica esta escena', { selectedClipId: 'c' }],
    ['Pon subtítulos en la parte inferior', {}],
    ['Haz que el vídeo dure exactamente 30 segundos', {}],
  ] as Array<[string, Partial<CommandContext>]>)('«%s»', (text, o) => {
    // Ducking and subtitles start switched off here so the order has something to change.
    const before = { ...withVoice(), duckMusic: false, subtitles: false }
    const r = runInstruction(before, text, ctx(o))
    expect(r.ok ? 'ok' : r.message).toBe('ok')
    expect(r.ok && JSON.stringify(r.composition) !== JSON.stringify(before)).toBe(true)
  })
  it('the results are the ones asked for', () => {
    const base = { ...withVoice(), duckMusic: false, subtitles: false }
    const moved = runInstruction(base, 'Mueve este vídeo al principio', ctx({ selectedClipId: 'b' }))
    expect(moved.ok && moved.composition.clips[0].id).toBe('b')
    const top = runInstruction(base, 'pon los subtítulos arriba', ctx())
    expect(top.ok && [top.composition.subtitles, top.composition.captionPosition]).toEqual([true, 'top'])
    const bottom = runInstruction(top.ok ? top.composition : base, 'Pon subtítulos en la parte inferior', ctx())
    expect(bottom.ok && [bottom.composition.subtitles, bottom.composition.captionPosition ?? 'bottom']).toEqual([true, 'bottom'])
    const dur = runInstruction(base, 'Haz que el vídeo dure exactamente 30 segundos', ctx())
    expect(dur.ok && totalDurationMs(dur.composition)).toBe(30000)
    const already = runInstruction({ ...base, duckMusic: true }, 'Baja la música cuando empieza la voz', ctx())
    expect(already.ok && already.done.join(' ')).toMatch(/ya baja/)
  })
})
