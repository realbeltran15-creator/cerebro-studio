import { describe, expect, it } from 'vitest'
import { applyPatches, applyProfile, buildFromProfile, diffMontages, extractProfile, parseProfile, presetProfiles, restoreVersion, reviseProfile, snapToBeats, fromLegacyStyle, type EditProfile } from '@/lib/editor/profile'
import { parseComposition, totalDurationMs, type Composition } from '@/lib/editor/composition'
import { musicBeats } from '@/lib/editor/auto-edit'
import { setSpeed, splitClip, updateClip, updateTextClip } from '@/lib/editor/timeline'

const kinds: Record<string, 'video' | 'image'> = { v1: 'video', v2: 'video', i1: 'image', i2: 'image', i3: 'image' }
const kindOf = (id: string | null) => (id ? kinds[id] ?? 'other' : 'other')
const preset = (id: string) => presetProfiles().find(p => p.id === id)!

describe('presets', () => {
  it('three editable starting points that survive a parse round-trip', () => {
    const ps = presetProfiles()
    expect(ps.map(p => p.name)).toEqual(['Lo-fi / Relax Music', 'Historias y documentales', 'Shorts / Reels / TikTok'])
    for (const p of ps) expect(parseProfile(JSON.parse(JSON.stringify(p)))).toEqual(p)
    expect(preset('preset-shorts').format).toBe('9:16')
  })
  it('clamps garbage and rejects non-profiles', () => {
    expect(parseProfile({ kind: 'x' })).toBeNull()
    const p = parseProfile({ ...preset('preset-lofi'), pacing: { minClipMs: 5, maxClipMs: 1e9, videoClipMs: -1 }, transitions: { betweenMaterials: 'spin' }, camera: { amount: 9 } })!
    expect(p.pacing.minClipMs).toBe(1000); expect(p.pacing.maxClipMs).toBe(120000)
    expect(p.transitions.betweenMaterials).toBe('dissolve'); expect(p.camera.amount).toBe(0.5)
  })
})

describe('build a montage from my materials with a style', () => {
  const materials = [
    { kind: 'video' as const, assetId: 'v1', durationMs: 20000, shots: [8000], silences: [{ start: 12000, end: 15000 }] },
    { kind: 'image' as const, assetId: 'i1' }, { kind: 'image' as const, assetId: 'i2' },
  ]
  it('follows pacing, transitions, camera, audio and structure rules', () => {
    const p = { ...preset('preset-docu'), pacing: { ...preset('preset-docu').pacing, removeSilences: true, fitToVoice: false }, structure: { intro: { title: true, titleMs: 3000, hook: false, hookMs: 3000 }, outro: { endCard: true, endCardText: 'Suscríbete', endCardMs: 2000 } } }
    const { composition: c, report } = buildFromProfile({ title: 'Mi historia', materials, music: { assetId: 'm1', durationMs: 10000 } }, p)
    const vids = c.clips.filter(k => k.visualAssetId === 'v1')
    expect(vids.every(k => k.durationMs <= p.pacing.videoClipMs + 1)).toBe(true)
    expect(vids.reduce((s, k) => s + k.durationMs, 0)).toBeLessThan(20000) // silence removed
    expect(c.clips.filter(k => k.visualAssetId?.startsWith('i')).every(k => k.durationMs === p.pacing.imageClipMs)).toBe(true)
    expect(c.clips[vids.length - 1].transition).toBe(p.transitions.betweenMaterials)
    const imgCams = c.clips.filter(k => k.visualAssetId?.startsWith('i')).map(k => k.camera?.kind)
    expect(new Set(imgCams).size).toBe(2)
    expect(c.audioClips!.filter(a => a.kind === 'music').length).toBeGreaterThan(1) // looped to cover
    expect(c.textClips!.map(t => t.content)).toEqual(['Mi historia', 'Suscríbete'])
    expect(c.textClips![1].startMs + c.textClips![1].durationMs).toBe(totalDurationMs(c))
    expect(c.styleRef?.profileId).toBe(p.id); expect(c.styleRef?.baseline?.clips.length).toBe(c.clips.length)
    expect(report[0]).toMatch(/clips/)
    expect(parseComposition(JSON.parse(JSON.stringify(c)))?.styleRef?.baseline?.textClips?.length).toBe(2)
  })
  it('fits the visuals to a narration by stretching images, then repeating', () => {
    const p = preset('preset-docu')
    const { composition: c } = buildFromProfile({ title: 't', materials: [{ kind: 'image', assetId: 'i1' }, { kind: 'image', assetId: 'i2' }], voice: { assetId: 'vo', durationMs: 60000 } }, p)
    expect(Math.abs(totalDurationMs(c) - 60500)).toBeLessThan(1000)
    expect(c.clips.length).toBeGreaterThan(2)
    expect(c.audioClips!.find(a => a.kind === 'voice')?.volume).toBe(p.audio.voiceVolume)
  })
  it('snaps cuts to music beats', () => {
    expect(snapToBeats([1900, 2100, 2000], [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000], 2, 1000, [true, true, true])).toEqual([2000, 2000, 2000])
    const beats = musicBeats(Array.from({ length: 200 }, (_, i) => (i % 10 === 0 ? 1 : 0.1)), 50)
    expect(beats.slice(0, 3)).toEqual([500, 1000, 1500])
  })
  it('subtitles come from the transcript of each video, timed to the clip and its speed', () => {
    const p = { ...preset('preset-shorts'), speed: { video: 2 }, pacing: { ...preset('preset-shorts').pacing, removeSilences: false, cutOnShots: false, splitLong: false } }
    const { composition: c } = buildFromProfile({ title: 't', materials: [{ kind: 'video', assetId: 'v1', durationMs: 8000, captions: [{ start: 2000, end: 4000, text: 'hola' }] }] }, p)
    expect(c.clips[0]).toMatchObject({ durationMs: 4000, speed: 2 })
    expect(c.clips[0].cues).toEqual([{ text: 'hola', startMs: 1000, endMs: 2000 }])
    expect(c.subtitles).toBe(true); expect(c.captionStyle).toBe('karaoke')
  })
})

describe('learn from a manual edit and from corrections', () => {
  const manual = (): Composition => {
    const { composition } = buildFromProfile({ title: 'Base', materials: [{ kind: 'image', assetId: 'i1' }, { kind: 'image', assetId: 'i2' }, { kind: 'image', assetId: 'i3' }, { kind: 'video', assetId: 'v1', durationMs: 9000 }] }, preset('preset-docu'))
    return composition
  }
  it('measures my decisions into a structured profile', () => {
    let c = manual()
    c = { ...c, fadeMs: 900, format: '1:1', clips: c.clips.map(k => (kindOf(k.visualAssetId) === 'image' ? { ...k, durationMs: 3000, transition: 'slide', camera: { kind: 'pan_right', amount: 0.2 } } : { ...k, muted: true })) }
    c = { ...c, textClips: [{ id: 't', content: 'Título', startMs: 0, durationMs: 2500, position: 'top', sizePct: 8, font: 'serif', color: '#ffcc00', animation: 'typewriter' }] }
    const p = extractProfile(c, kindOf, 'Mi estilo')
    expect(p).toMatchObject({ name: 'Mi estilo', source: 'learned', format: '1:1', pacing: { imageClipMs: 3000 }, transitions: { betweenMaterials: 'slide', durationMs: 900 }, camera: { images: 'pan_right', amount: 0.2 }, audio: { muteVideo: true } })
    expect(p.text).toMatchObject({ font: 'serif', color: '#ffcc00', position: 'top', animation: 'typewriter' })
    expect(p.structure.intro).toMatchObject({ title: true, titleMs: 2500 })
    expect(p.notes.length).toBeGreaterThan(4)
  })
  it('lists my corrections against the automatic baseline and applies only the accepted ones', () => {
    const p = preset('preset-docu')
    const auto = manual()
    let fixed = auto
    for (const k of fixed.clips.filter(x => kindOf(x.visualAssetId) === 'image')) fixed = updateClip(fixed, k.id, { durationMs: 4000, transition: 'wipe' })
    const v = fixed.clips.find(x => x.visualAssetId === 'v1')!
    fixed = setSpeed(fixed, v.id, 1.5)
    fixed = { ...fixed, fadeMs: 300, captionStyle: 'bold', subtitles: true }
    fixed = splitClip(fixed, fixed.clips.find(x => x.visualAssetId === 'v1')!.id, 1200)
    const diffs = diffMontages(auto.styleRef!.baseline!, fixed, p, kindOf)
    const ids = diffs.map(d => d.id)
    expect(ids).toEqual(expect.arrayContaining(['content', 'image-ms', 'tr-between', 'tr-ms', 'speed']))
    expect(diffs.find(d => d.id === 'content')!.patches).toEqual([])
    const accepted = diffs.filter(d => d.id === 'image-ms' || d.id === 'speed')
    const next = applyPatches(p, accepted)
    expect(next.version).toBe(p.version + 1)
    expect(next.pacing.imageClipMs).toBe(4000); expect(next.speed.video).toBe(1.5)
    expect(next.transitions).toEqual(p.transitions) // not accepted → unchanged
    expect(next.previous?.at(-1)?.version).toBe(p.version)
    expect(next.history.at(-1)?.summary).toMatch(/Acortaste|Alargaste/)
    const back = restoreVersion(next, p.version)
    expect(back.version).toBe(p.version + 2); expect(back.pacing.imageClipMs).toBe(p.pacing.imageClipMs)
  })
  it('re-styles an existing montage without changing content and records the baseline', () => {
    const c = manual()
    const r = applyProfile(c, preset('preset-shorts'), kindOf)
    expect(r.composition.clips.map(k => k.visualAssetId)).toEqual(c.clips.map(k => k.visualAssetId))
    expect(r.composition.format).toBe('9:16')
    expect(r.composition.styleRef?.profileName).toBe('Shorts / Reels / TikTok')
    expect(diffMontages(r.composition.styleRef!.baseline!, r.composition, preset('preset-shorts'), kindOf)).toEqual([])
  })
  it('manual parameter edits and legacy styles become versions', () => {
    const p = preset('preset-lofi')
    const e = reviseProfile(p, { ...p, name: 'Mi lo-fi', audio: { ...p.audio, musicVolume: 0.7 } } as EditProfile, 'Música más baja')
    expect(e).toMatchObject({ id: p.id, version: 2, source: 'custom', audio: { musicVolume: 0.7 } })
    const legacy = fromLegacyStyle({ version: 1, name: 'Viejo', samples: 3, learnedAt: '', format: '9:16', pacing: { medianClipMs: 2500, minClipMs: 1200, maxClipMs: 4000, splitLong: true, retime: false }, transitions: { pattern: 'cut', fadeMs: 0 }, framing: { motion: 'none', zoom: 1, focusY: null }, text: { narrationAsText: false, position: 'center', sizePct: 8 }, clipAudio: { muteVideo: false, volume: 1 }, mix: { musicVolume: 0.3, duckMusic: true, subtitles: true, hookMs: null }, sfxOnCuts: null, observations: ['x'] })
    expect(legacy).toMatchObject({ name: 'Viejo', sessions: 3, format: '9:16', transitions: { betweenMaterials: 'cut' }, notes: ['x'] })
  })
})

describe('timeline additions', () => {
  it('speed keeps the same stretch of source; text clips clamp', () => {
    const c = parseComposition({ version: 1, storyboardId: 's', clips: [{ id: 'a', sceneId: 'a', position: 1, durationMs: 4000, visualAssetId: 'v1' }], textClips: [{ id: 't', content: 'hola', startMs: 0, durationMs: 1000 }] })!
    expect(setSpeed(c, 'a', 2).clips[0]).toMatchObject({ durationMs: 2000, speed: 2 })
    expect(updateTextClip(c, 't', { startMs: -5, durationMs: 10 }).textClips![0]).toMatchObject({ startMs: 0, durationMs: 300 })
    expect(splitClip(setSpeed(c, 'a', 2), 'a', 1000).clips[1].trimInMs).toBe(2000)
  })
})
