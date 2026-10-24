import { describe, expect, it } from 'vitest'
import { emptyComposition, parseComposition, projectDurationMs, tracksOf, type Composition } from '@/lib/editor/composition'
import { addClip, addAudioClip, addTextClip } from '@/lib/editor/timeline'
import { addMarker, addOverlay, addTrack, copyItems, deleteItems, deleteTrack, duplicateItems, duplicateTrack, expandGroups, groupItems, itemsInRange, moveItems, moveToTrack, moveTrack, pasteItems, setKeyframe, setItemEnd, snap, snapBlock, snapPoints, splitAt, trimItemStart, ungroupItems, updateTrack } from '@/lib/editor/tracks'
import { audioTrackFactors, audioVoices, frameAt, voiceGainAt, voiceWindows, type VisualOp } from '@/lib/editor/scene'
import { transformAt } from '@/lib/editor/motion'

const base = (): Composition => {
  let c: Composition = { ...emptyComposition('sb', 'T'), editedManually: true, fadeMs: 0 }
  c = addClip(c, 'img', 4000); c = addClip(c, 'vid', 6000)
  return c
}
const kind = (id: string) => (id.startsWith('vid') ? 'video' as const : id.startsWith('img') ? 'image' as const : 'audio' as const)

describe('tracks', () => {
  it('a legacy montage gets the default tracks; stored tracks are authoritative', () => {
    const c = base()
    expect(tracksOf(c).map(t => t.id)).toEqual(['main', 'text', 'voice', 'music', 'sfx'])
    const d = deleteTrack({ ...c, tracks: tracksOf(c) }, 'sfx')
    expect(tracksOf(d).some(t => t.id === 'sfx')).toBe(false)
    expect(deleteTrack(c, 'main')).toBe(c)
  })
  it('add, rename, lock, hide, duplicate, reorder', () => {
    let c = base()
    const r = addTrack(c, 'overlay'); c = r.composition
    expect(tracksOf(c)[0]).toMatchObject({ id: r.trackId, type: 'overlay' })
    c = addOverlay(c, { assetId: 'img2', startMs: 1000, durationMs: 2000, trackId: r.trackId }).composition
    c = updateTrack(c, r.trackId, { name: 'Logo', locked: true })
    expect(tracksOf(c)[0]).toMatchObject({ name: 'Logo', locked: true })
    c = updateTrack(c, r.trackId, { locked: false })
    c = duplicateTrack(c, r.trackId)
    expect(c.overlays).toHaveLength(2)
    expect(new Set(c.overlays!.map(o => o.trackId)).size).toBe(2)
    const ids = tracksOf(c).map(t => t.id)
    c = moveTrack(c, ids[0], 1)
    expect(tracksOf(c).map(t => t.id).slice(0, 2)).toEqual([ids[1], ids[0]])
    // Overlays never go below the main track.
    expect(moveTrack(c, ids[0], 1)).toBe(c)
    // Hidden overlay tracks are not drawn.
    const hid = updateTrack(c, ids[0], { hidden: true })
    expect(frameAt(hid, 1500, kind).filter(o => o.type === 'visual' && (o as VisualOp).slot.startsWith('ov:'))).toHaveLength(1)
  })
  it('deleting a track deletes its clips', () => {
    let c = base()
    c = addAudioClip(c, { assetId: 'aud', kind: 'sfx', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 500, volume: 1, muted: false })
    c = deleteTrack(c, 'sfx')
    expect(c.audioClips).toHaveLength(0)
  })
})

describe('overlays in the frame', () => {
  it('drawn above the main clip, in the order of their tracks, with keyframed position', () => {
    let c = base()
    const a = addTrack(c, 'overlay'); c = a.composition
    const b = addTrack(c, 'overlay'); c = b.composition // b is now the top track
    c = addOverlay(c, { assetId: 'img-low', startMs: 0, durationMs: 4000, trackId: a.trackId }).composition
    const top = addOverlay(c, { assetId: 'vid-top', startMs: 0, durationMs: 4000, trackId: b.trackId, trimInMs: 500 }); c = top.composition
    c = setKeyframe(c, top.id, 0, { x: 0.2 }); c = setKeyframe(c, top.id, 2000, { x: 0.8 })
    const ops = frameAt(c, 1000, kind).filter((o): o is VisualOp => o.type === 'visual')
    expect(ops.map(o => o.assetId)).toEqual(['img', 'img-low', 'vid-top'])
    expect(ops[2].box!.x).toBeCloseTo(0.5, 1)
    expect(ops[2].sourceMs).toBe(1500)
  })
  it('keyframes ease between values and hold outside them', () => {
    const kf = [{ atMs: 1000, x: 0 }, { atMs: 3000, x: 1 }]
    expect(transformAt({ x: 0.5, y: 0.5 }, kf, 0).x).toBe(0)
    expect(transformAt({ x: 0.5, y: 0.5 }, kf, 2000).x).toBeCloseTo(0.5)
    expect(transformAt({ x: 0.5, y: 0.5 }, kf, 5000)).toEqual({ x: 1, y: 0.5 })
  })
  it('the project lasts until the last item ends, not only the main track', () => {
    let c = base()
    c = addOverlay(c, { assetId: 'img', startMs: 9000, durationMs: 3000 }).composition
    expect(projectDurationMs(c)).toBe(12000)
    c = addTextClip(c, { content: 'x', startMs: 14000, durationMs: 1000, position: 'top', sizePct: 5 })
    expect(projectDurationMs(c)).toBe(15000)
  })
  it('round-trips through the stored form', () => {
    let c = base()
    c = addOverlay(c, { assetId: 'img', startMs: 500, durationMs: 1500, transform: { x: 0.3, y: 0.7, scale: 0.25, rotation: 12, opacity: 0.8 } }).composition
    c = { ...c, overlays: c.overlays!.map(o => ({ ...o, crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 }, filters: { brightness: 1.2, contrast: 1, saturation: 0, blur: 0 } })), markers: [{ id: 'm', atMs: 900, label: 'Aquí' }], format: 'custom', customSize: { width: 1001, height: 501 } }
    const p = parseComposition(JSON.parse(JSON.stringify(c)))!
    expect(p.overlays![0]).toMatchObject({ startMs: 500, transform: { x: 0.3, rotation: 12, opacity: 0.8 }, crop: { left: 0.1, bottom: 0.2 }, filters: { saturation: 0 } })
    expect(p.markers).toEqual([{ id: 'm', atMs: 900, label: 'Aquí' }])
    expect(p.customSize).toEqual({ width: 1002, height: 502 })
    expect(p.tracks?.some(t => t.type === 'overlay')).toBe(true)
  })
})

describe('items: select, group, move, copy/paste, split, trim', () => {
  const setup = () => {
    let c = base()
    const o = addOverlay(c, { assetId: 'img', startMs: 1000, durationMs: 2000 }); c = o.composition
    c = addAudioClip(c, { assetId: 'aud', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 500, trimInMs: 0, durationMs: 5000, volume: 1, muted: false })
    c = addTextClip(c, { content: 'Hola', startMs: 2000, durationMs: 1000, position: 'top', sizePct: 5 })
    return { c, ov: o.id, au: c.audioClips![0].id, tx: c.textClips![0].id }
  }
  it('groups move together and can be ungrouped', () => {
    const { c, ov, au } = setup()
    const g = groupItems(c, [{ kind: 'overlay', id: ov }, { kind: 'audio', id: au }])
    expect(expandGroups(g, [{ kind: 'overlay', id: ov }])).toHaveLength(2)
    const moved = moveItems(g, expandGroups(g, [{ kind: 'overlay', id: ov }]), 1000)
    expect(moved.overlays![0].startMs).toBe(2000); expect(moved.audioClips![0].startMs).toBe(1500)
    expect(expandGroups(ungroupItems(g, [{ kind: 'audio', id: au }]), [{ kind: 'overlay', id: ov }])).toHaveLength(1)
    // Never before zero, and the whole block keeps its spacing.
    const back = moveItems(g, [{ kind: 'overlay', id: ov }, { kind: 'audio', id: au }], -5000)
    expect([back.overlays![0].startMs, back.audioClips![0].startMs]).toEqual([500, 0])
  })
  it('copy and paste keep relative timing and tracks; duplicate puts the copy after', () => {
    const { c, ov, tx } = setup()
    const cb = copyItems(c, [{ kind: 'overlay', id: ov }, { kind: 'text', id: tx }])!
    const p = pasteItems(c, cb, 10_000)
    expect(p.refs).toHaveLength(2)
    expect(p.composition.overlays![1]).toMatchObject({ startMs: 10_000, trackId: c.overlays![0].trackId })
    expect(p.composition.textClips![1].startMs).toBe(11_000)
    const d = duplicateItems(c, [{ kind: 'overlay', id: ov }])
    expect(d.composition.overlays![1].startMs).toBe(3000)
    // A main clip is pasted into the main track.
    const m = pasteItems(c, copyItems(c, [{ kind: 'clip', id: c.clips[0].id }])!, 9_999)
    expect(m.composition.clips).toHaveLength(3)
  })
  it('split at the playhead cuts every item under it (or only the selection) keeping the source position', () => {
    const { c, ov } = setup()
    const s = splitAt(c, 2500)
    expect(s.cut).toBe(4) // main clip 1, overlay, music, text
    const o2 = s.composition.overlays!.find(o => o.startMs === 2500)!
    expect(o2).toMatchObject({ durationMs: 500, trimInMs: 1500 })
    const only = splitAt(c, 2500, [{ kind: 'overlay', id: ov }])
    expect(only.cut).toBe(1)
  })
  it('locked tracks are not edited', () => {
    const { c, ov } = setup()
    const locked = updateTrack(c, c.overlays![0].trackId, { locked: true })
    expect(deleteItems(locked, [{ kind: 'overlay', id: ov }]).overlays).toHaveLength(1)
    expect(moveItems(locked, [{ kind: 'overlay', id: ov }], 100)).toBe(locked)
    expect(splitAt(locked, 2500, [{ kind: 'overlay', id: ov }]).cut).toBe(0)
  })
  it('trimming the left edge moves the start and the source position; the right edge changes the length', () => {
    const { c, ov, au } = setup()
    const t = trimItemStart(c, { kind: 'overlay', id: ov }, 400)
    expect(t.overlays![0]).toMatchObject({ startMs: 1400, durationMs: 1600, trimInMs: 400 })
    const a = trimItemStart(c, { kind: 'audio', id: au }, -1000)
    expect(a.audioClips![0]).toMatchObject({ startMs: 500, trimInMs: 0 })
    expect(setItemEnd(c, { kind: 'overlay', id: ov }, 5000).overlays![0].durationMs).toBe(4000)
  })
  it('moves audio and overlays between compatible tracks', () => {
    const { c, au } = setup()
    const r = addTrack(c, 'voice')
    const m = moveToTrack(r.composition, { kind: 'audio', id: au }, r.trackId)
    expect(m.audioClips![0]).toMatchObject({ kind: 'voice', trackId: r.trackId })
    expect(moveToTrack(c, { kind: 'audio', id: au }, 'main')).toBe(c)
  })
  it('snapping to clip edges, markers and the playhead', () => {
    const { c, ov } = setup()
    const withM = addMarker(c, 7777)
    const pts = snapPoints(withM, [{ kind: 'overlay', id: ov }], [3333])
    expect(pts).toContain(4000); expect(pts).toContain(7777); expect(pts).toContain(3333); expect(pts).not.toContain(1000)
    expect(snap(3950, pts, 100)).toBe(4000)
    expect(snap(3800, pts, 100)).toBe(3800)
    expect(snapBlock(3950, 2000, pts, 100)).toBe(4000)
    expect(snapBlock(5760, 2000, pts, 100)).toBe(5777)
    expect(itemsInRange(c, 2100, 2200).map(r => r.kind).sort()).toEqual(['audio', 'overlay', 'text'].concat('clip').sort())
  })
})

describe('sound per track', () => {
  it('track mute and solo, pan and the music ducking under a voice', () => {
    let c = base()
    c = addAudioClip(c, { assetId: 'mus', kind: 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: 8000, volume: 0.8, muted: false, pan: -0.5 })
    c = addAudioClip(c, { assetId: 'vo', kind: 'voice', linkedClipId: null, offsetMs: 0, startMs: 2000, trimInMs: 0, durationMs: 2000, volume: 1, muted: false })
    const voices = audioVoices(c)
    const w = voiceWindows(voices)
    const music = voices.find(v => v.bus === 'music')!
    expect(music.pan).toBe(-0.5)
    expect(voiceGainAt(music, 1000, w, 10_000)).toBeCloseTo(0.8)
    expect(voiceGainAt(music, 3000, w, 10_000)).toBeCloseTo(0.8 * 0.35)
    const soloVoice = updateTrack(c, 'voice', { solo: true })
    const f = audioTrackFactors(soloVoice)
    expect([f.get('voice'), f.get('music')]).toEqual([1, 0])
    expect(audioTrackFactors(updateTrack(c, 'music', { muted: true })).get('music')).toBe(0)
  })
})

describe('instructions on the same engine (overlays, filters, markers, ducking wording)', async () => {
  const { runInstruction } = await import('@/lib/editor/commands')
  const ctx = (c: Composition, extra: Partial<Parameters<typeof runInstruction>[2]> = {}) => ({ playheadMs: 1000, range: null, selectedClipId: null, selectedAssetId: 'logo', assets: [{ id: 'logo', label: 'Logo rojo', type: 'image' }, { id: 'mus', label: 'Canción', type: 'music', durationMs: 9000 }], beatsMs: [], isVideo: (k: { visualAssetId: string | null }) => k.visualAssetId === 'vid', ...extra })
  it('«pon esta imagen encima del vídeo durante 8 segundos»', () => {
    const r = runInstruction(base(), 'pon esta imagen encima del vídeo durante 8 segundos', ctx(base()))
    expect(r.ok && r.composition.overlays?.[0]).toMatchObject({ assetId: 'logo', startMs: 1000, durationMs: 8000 })
  })
  it('in a corner, then bigger, then moving left to right', () => {
    const r = runInstruction(base(), 'pon esta imagen en la esquina superior derecha encima del vídeo', ctx(base()))
    if (!r.ok) throw new Error(r.message)
    const o = r.composition.overlays![0]
    expect(o.transform).toMatchObject({ x: 0.8, y: 0.22, scale: 0.3 })
    const sel = { selectedItems: [{ kind: 'overlay' as const, id: o.id }] }
    const g = runInstruction(r.composition, 'haz la capa más grande', ctx(r.composition, sel))
    expect(g.ok && g.composition.overlays![0].transform.scale).toBeCloseTo(0.39)
    const m = runInstruction(r.composition, 'que la capa vaya de izquierda a derecha', ctx(r.composition, sel))
    expect(m.ok && m.composition.overlays![0].keyframes?.map(k => k.x)).toEqual([0.15, 0.85])
    const d = runInstruction(r.composition, 'duplica esta capa', ctx(r.composition, sel))
    expect(d.ok && d.composition.overlays).toHaveLength(2)
  })
  it('filters, markers, a soft transition and ducking «mientras habla»', () => {
    const c = base()
    const bw = runInstruction(c, 'blanco y negro en todo', ctx(c))
    expect(bw.ok && bw.composition.clips.every(k => k.filters?.saturation === 0)).toBe(true)
    const br = runInstruction(c, 'más brillo', ctx(c))
    expect(br.ok && br.composition.clips[0].filters?.brightness).toBeCloseTo(1.2)
    const mk = runInstruction(c, 'pon un marcador «Intro»', ctx(c))
    expect(mk.ok && mk.composition.markers?.[0]).toMatchObject({ atMs: 1000, label: 'Intro' })
    const tr = runInstruction(c, 'añade una transición suave', ctx(c, { selectedClipId: c.clips[0].id }))
    expect(tr.ok && tr.composition.clips[0].transition).toBe('dissolve')
    const bl = runInstruction(c, 'transición de desenfoque en todo', ctx(c))
    expect(bl.ok && bl.composition.clips[0].transition).toBe('blur')
    const du = runInstruction({ ...c, duckMusic: false }, 'baja la música mientras habla la persona', ctx(c))
    expect(du.ok && du.composition.duckMusic).toBe(true)
    const long = addClip(addClip(c, 'img', 120000), 'img', 120000)
    const sel = runInstruction(long, 'selecciona del minuto 2 al minuto 3', ctx(long))
    expect(sel.ok && sel.range).toEqual({ startMs: 120000, endMs: 180000 })
  })
})

describe('transitions: options, handles and crossfade', async () => {
  const { transitionFrame, transformAt, splitKeyframes } = await import('@/lib/editor/motion')
  const { videoVoices } = await import('@/lib/editor/scene')
  const { updateClip: upd } = await import('@/lib/editor/timeline')
  it('direction, intensity and easing change the frame', () => {
    expect(transitionFrame('slide', 0.5, { direction: 'right', easing: 'linear' }).bOffsetX).toBeCloseTo(-0.5)
    expect(transitionFrame('slide', 0.5, { direction: 'down', easing: 'linear' }).bOffsetY).toBeCloseTo(-0.5)
    expect(transitionFrame('wipe', 0.3, { direction: 'left', easing: 'linear' })).toMatchObject({ bReveal: 0.3, bRevealFrom: 'right' })
    expect(transitionFrame('wipe', 0.3, { direction: 'up', easing: 'linear' })).toMatchObject({ bRevealY: 0.3, bRevealFrom: 'bottom' })
    expect(transitionFrame('zoom', 1, { intensity: 2 }).aScale).toBeCloseTo(1.7)
    expect(transitionFrame('zoom_out', 0, {}).bScale).toBeCloseTo(1.35)
    expect(transitionFrame('flash', 0.5, {}).white).toBeCloseTo(1)
    expect(transitionFrame('flash', 0.49, { easing: 'linear' }).bAlpha).toBe(0)
    expect(transitionFrame('dissolve', 0.25, { easing: 'in' }).bAlpha).toBeCloseTo(0.0625)
  })
  it('the incoming video plays during the transition when it has material before its start, and the sound crossfades', () => {
    let c = base()
    c = upd(c, c.clips[0].id, { transition: 'dissolve', transitionMs: 1000 })
    c = upd(c, c.clips[1].id, { trimInMs: 3000 })
    const mid = frameAt(c, 3500, kind).filter((o): o is VisualOp => o.type === 'visual')
    expect(mid[1]).toMatchObject({ assetId: 'vid', live: true, sourceMs: 2500 })
    expect(mid[1].volume).toBeCloseTo(0.5); expect(mid[0].volume).toBeCloseTo(0.5)
    const vv = videoVoices(c, kind).find(v => v.assetId === 'vid')!
    expect(vv).toMatchObject({ startMs: 3000, sourceStartMs: 2000 })
    // Without a handle it holds its first frame and stays silent until its turn.
    const held = frameAt(upd(c, c.clips[1].id, { trimInMs: 0 }), 3500, kind).filter((o): o is VisualOp => o.type === 'visual')
    expect(held[1]).toMatchObject({ live: false, sourceMs: 0, volume: 0 })
  })
  it('white dips and keyframe curves', () => {
    let c = base()
    c = upd(c, c.clips[0].id, { transition: 'fade_white', transitionMs: 1000 })
    expect(frameAt(c, 3800, kind).some(o => o.type === 'fill' && o.color === '#fff' && o.alpha > 0.7)).toBe(true)
    expect(transformAt({ z: 0 }, [{ atMs: 0, z: 0 }, { atMs: 1000, z: 1, easing: 'hold' }], 900).z).toBe(0)
    expect(transformAt({ z: 0 }, [{ atMs: 0, z: 0 }, { atMs: 1000, z: 1, easing: 'linear' }], 250).z).toBeCloseTo(0.25)
    const [a, b] = splitKeyframes([{ atMs: 0, z: 0 }, { atMs: 1000, z: 1, easing: 'linear' }], { z: 0 }, 400)
    expect(a?.[a.length - 1]).toMatchObject({ atMs: 400, z: 0.4 }); expect(b?.[0]).toMatchObject({ atMs: 0, z: 0.4 }); expect(b?.[1]).toMatchObject({ atMs: 600, z: 1 })
    // A linear movement split in two stays linear (same speed) in the first half too: no slow-down at each cut.
    expect(a?.[a.length - 1].easing).toBe('linear')
    expect(transformAt({ z: 0 }, a as never, 200).z).toBeCloseTo(0.2)
    expect(transformAt({ z: 0 }, b as never, 300).z).toBeCloseTo(0.7)
  })
  it('main-clip keyframes animate the framing of a photo', () => {
    let c = base()
    c = upd(c, c.clips[0].id, { keyframes: [{ atMs: 0, zoom: 1 }, { atMs: 4000, zoom: 1.2, easing: 'linear' }] })
    const op = frameAt(c, 2000, kind).find((o): o is VisualOp => o.type === 'visual')!
    expect(op.zoom).toBeCloseTo(1.1)
  })
})

describe('instructions for transitions, animation and styles', async () => {
  const { runInstruction } = await import('@/lib/editor/commands')
  const ctx = (c: Composition, extra = {}) => ({ playheadMs: 500, range: null, selectedClipId: null, selectedAssetId: null, assets: [], beatsMs: [], isVideo: (k: { visualAssetId: string | null }) => k.visualAssetId === 'vid', ...extra })
  it('«pon una disolvencia de dos segundos entre estas fotografías»', () => {
    let c = addClip(base(), 'img', 4000)
    const sel = c.clips.filter(k => k.visualAssetId === 'img').map(k => ({ kind: 'clip' as const, id: k.id }))
    const r = runInstruction(c, 'pon una disolvencia de dos segundos entre estas fotografías', ctx(c, { selectedItems: sel, selectedClipId: sel[1].id }))
    if (!r.ok) throw new Error(r.message)
    c = r.composition
    expect(c.clips.filter(k => k.transition === 'dissolve' && k.transitionMs === 2000).map(k => k.id)).toEqual([sel[0].id])
  })
  it('«aplica una transición suave a todos los cambios de imagen» and «haz un zoom lento durante ocho segundos»', () => {
    const c = base()
    const a = runInstruction(c, 'aplica una transición suave a todos los cambios de imagen', ctx(c))
    expect(a.ok && a.composition.clips.every(k => k.transition === 'dissolve')).toBe(true)
    const z = runInstruction(c, 'haz un zoom lento durante ocho segundos', ctx(c))
    expect(z.ok && z.composition.clips[0]).toMatchObject({ durationMs: 8000, camera: { kind: 'zoom_in' } })
  })
  it('«baja la música cuando comienza la voz», «guarda este estilo», and honesty about animating one object', () => {
    const c = { ...base(), duckMusic: false }
    const d = runInstruction(c, 'baja la música cuando comienza la voz', ctx(c))
    expect(d.ok && d.composition.duckMusic).toBe(true)
    const st = runInstruction(c, 'guarda este estilo como «Lofi suave»', ctx(c))
    expect(st.ok && st.saveStyle).toBe('Lofi suave')
    const v = runInstruction(c, 'anima solamente la luz de las velas', ctx(c))
    expect(v.ok).toBe(false)
    expect(!v.ok && v.message).toMatch(/no se puede con transformaciones/)
    const fl = runInstruction(c, 'transición de destello de luz en todo', ctx(c))
    expect(fl.ok && fl.composition.clips[0].transition).toBe('flash')
  })
})

describe('igualar imagen (grade)', async () => {
  const { effectiveGrade, parseGrade } = await import('@/lib/editor/composition')
  it('strength scales the correction; off or zero strength draws the original', () => {
    expect(effectiveGrade({ brightness: 1.4, contrast: 1.2, saturation: 1, warmth: 0.5, strength: 0.5 })).toEqual({ brightness: 1.2, contrast: 1.1, saturation: 1, warmth: 0.25 })
    expect(effectiveGrade({ brightness: 1.4, contrast: 1, saturation: 1, warmth: 0, strength: 1, enabled: false })).toBeNull()
    expect(effectiveGrade({ brightness: 1.4, contrast: 1, saturation: 1, warmth: 0, strength: 0 })).toBeNull()
    expect(parseGrade({ brightness: 9, warmth: -3 })).toMatchObject({ brightness: 3, warmth: -1, strength: 1 })
  })
  it('the viewer and the exporter receive the correction with each picture', () => {
    const c = { ...emptyComposition('s', 't'), clips: [] } as Composition
    const withClip = addClip(c, 'img1', 3000)
    const g = { ...withClip, clips: withClip.clips.map(k => ({ ...k, grade: { brightness: 1.3, contrast: 1, saturation: 1, warmth: 0.2, strength: 1 } })) }
    const op = frameAt(g, 1500, () => 'image').find((o): o is VisualOp => o.type === 'visual')!
    expect(op.grade).toEqual({ brightness: 1.3, contrast: 1, saturation: 1, warmth: 0.2 })
  })
})
