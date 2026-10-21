import { type AudioClip, type Composition } from './composition'
import { addAudioClip } from './timeline'

/**
 * Sound effects on the cuts. Each effect is an ordinary audio clip LINKED to a visual clip, so it follows the cut when clips are moved or split (a lead-in effect, preMs > 0, is linked to the previous clip and keeps its distance to that clip's start, so it needs a refresh if that clip is retimed).
 * They are tagged `origin: 'cut-sfx'` so they can be replaced or removed without touching the sound effects placed by hand.
 */
export type CutSfx = {
  assetId: string
  volume: number
  durationMs: number
  /** Milliseconds after the cut at which the effect starts (≥ 0). */
  offsetMs: number
  /** Milliseconds the effect starts BEFORE the cut (a «whoosh» that leads the new shot). Wins over offsetMs when > 0. */
  preMs: number
  /** 1 = every cut, 2 = every second cut, … */
  every: number
}

export const defaultCutSfx = (assetId: string): CutSfx => ({ assetId, volume: 0.8, durationMs: 1000, offsetMs: 0, preMs: 0, every: 1 })

export const cutSfxClips = (c: Pick<Composition, 'audioClips'>): AudioClip[] => (c.audioClips ?? []).filter(a => a.kind === 'sfx' && a.origin === 'cut-sfx')

/** Removes the effects placed by this feature; hand-placed effects stay. */
export function removeCutSfx(c: Composition): Composition {
  const keep = (c.audioClips ?? []).filter(a => !(a.kind === 'sfx' && a.origin === 'cut-sfx'))
  return keep.length === (c.audioClips ?? []).length ? c : { ...c, audioClips: keep }
}

/** Puts the effect on the cuts, replacing the ones this feature placed earlier. Returns how many were added. */
export function setCutSfx(input: Composition, o: CutSfx, skipClipIds: ReadonlySet<string> = new Set()): { composition: Composition; added: number } {
  let c = removeCutSfx(input)
  const every = Math.max(1, Math.round(o.every)), pre = Math.max(0, Math.round(o.preMs)), off = Math.max(0, Math.round(o.offsetMs))
  const dur = Math.max(100, Math.round(o.durationMs)), vol = Math.min(2, Math.max(0, o.volume))
  let added = 0
  for (let i = 1; i < c.clips.length; i++) {
    if ((i - 1) % every !== 0) continue
    const prev = c.clips[i - 1], cur = c.clips[i]
    if (skipClipIds.has(cur.id)) continue
    const lead = pre > 0 && prev.durationMs > pre
    c = addAudioClip(c, { assetId: o.assetId, kind: 'sfx', origin: 'cut-sfx', linkedClipId: lead ? prev.id : cur.id, offsetMs: lead ? prev.durationMs - pre : off, startMs: 0, trimInMs: 0, durationMs: dur, volume: vol, muted: false })
    added++
  }
  return { composition: c, added }
}
