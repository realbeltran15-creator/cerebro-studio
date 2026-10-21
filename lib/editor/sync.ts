import { audioStartMs, clipStarts, MIN_CLIP_MS, type AudioClip, type Clip, type Composition } from './composition'
import { sliceCues } from './timeline'

/**
 * Cuts on the beat. Everything here is arithmetic over the beats measured in the music (see beats.ts): nothing is guessed.
 * A «cut» is the boundary between two consecutive clips; moving it makes one clip longer and its neighbour shorter, so the total length never changes.
 */

/** Timeline time of each cut (boundary after clip 0, 1, …); the start and the end of the montage are not cuts. */
export function cutTimes(c: Pick<Composition, 'clips'>): number[] { return clipStarts(c).slice(1) }

/** The measured beat nearest to `ms`, or null when none is within `toleranceMs`. `beats` must be sorted. */
export function nearestBeat(ms: number, beats: readonly number[], toleranceMs: number): number | null {
  let lo = 0, hi = beats.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (beats[mid] < ms) lo = mid + 1; else hi = mid }
  let best: number | null = null
  for (const i of [lo - 1, lo, lo + 1]) { const b = beats[i]; if (b !== undefined && Math.abs(b - ms) <= toleranceMs && (best === null || Math.abs(b - ms) < Math.abs(best - ms))) best = b }
  return best
}

/** Beats of a music file placed on the montage's timeline, honouring where the clip starts and how much of its beginning is trimmed off. */
export function beatsOnTimeline(c: Pick<Composition, 'clips'>, music: AudioClip, beatsInAssetMs: readonly number[]): number[] {
  const start = audioStartMs(c, music)
  return beatsInAssetMs.filter(b => b >= music.trimInMs && b < music.trimInMs + music.durationMs).map(b => Math.round(start + b - music.trimInMs))
}

/** How many of these times fall on a beat, and by how much the others miss. */
export function alignmentOfTimes(times: readonly number[], beats: readonly number[], toleranceMs = 120) {
  const offsets = times.map(t => { const b = nearestBeat(t, beats, 2000); return b === null ? null : b - t })
  const known = offsets.filter((o): o is number => o !== null)
  const on = known.filter(o => Math.abs(o) <= toleranceMs).length
  const sorted = known.map(Math.abs).sort((a, b) => a - b)
  return { cuts: times.length, onBeat: on, share: times.length && known.length ? on / times.length : null, medianMissMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null }
}

/** How many cuts fall on a beat, and by how much the others miss. */
export const cutBeatAlignment = (c: Pick<Composition, 'clips'>, beats: readonly number[], toleranceMs = 120) => alignmentOfTimes(cutTimes(c), beats, toleranceMs)

export type CutMove = { index: number; fromMs: number; toMs: number }
export type SyncResult = { composition: Composition; moved: CutMove[]; alreadyOn: number; skipped: Array<{ index: number; reason: string }> }

const hasVoice = (c: Composition, clip: Clip) => Boolean(clip.voiceAssetId) || (c.audioClips ?? []).some(a => a.kind === 'voice' && a.linkedClipId === clip.id)

/**
 * Moves each cut to the nearest beat within `toleranceMs`. Rules, so the result is always a valid montage:
 *  - both clips keep at least MIN_CLIP_MS; the total length is unchanged;
 *  - a cut next to a clip with a linked voice is left alone (never cut under a voice);
 *  - a video clip that loses its beginning starts later in its source (the footage stays where it was on the timeline); if it would need footage before
 *    the start of the source, the cut is skipped;
 *  - cues (timed captions) of the clip whose start moves are re-timed with it.
 */
export function syncCutsToBeats(input: Composition, beats: readonly number[], opts: { toleranceMs?: number; isVideo?: (clip: Clip) => boolean } = {}): SyncResult {
  const tol = opts.toleranceMs ?? 150, isVideo = opts.isVideo ?? (k => (k.trimInMs ?? 0) > 0)
  const sorted = [...beats].sort((a, b) => a - b)
  const clips = input.clips.map(k => ({ ...k }))
  const moved: CutMove[] = [], skipped: SyncResult['skipped'] = []
  let alreadyOn = 0
  let cut = 0
  for (let i = 1; i < clips.length; i++) {
    cut += clips[i - 1].durationMs
    const target = nearestBeat(cut, sorted, tol)
    if (target === null) continue
    const delta = target - cut
    if (delta === 0) { alreadyOn++; continue }
    const prev = clips[i - 1], cur = clips[i]
    if (hasVoice(input, prev) || hasVoice(input, cur)) { skipped.push({ index: i, reason: 'hay una voz enlazada junto al corte' }); continue }
    if (prev.durationMs + delta < MIN_CLIP_MS || cur.durationMs - delta < MIN_CLIP_MS) { skipped.push({ index: i, reason: 'dejaría un clip más corto que el mínimo' }); continue }
    const trim = (cur.trimInMs ?? 0) + delta
    if (isVideo(cur) && trim < 0) { skipped.push({ index: i, reason: 'el vídeo no tiene material antes de ese punto' }); continue }
    prev.durationMs += delta
    cur.durationMs -= delta
    if (isVideo(cur)) cur.trimInMs = trim
    if (cur.cues) cur.cues = delta > 0 ? sliceCues(cur.cues, delta, cur.durationMs + delta) : cur.cues.map(q => ({ ...q, startMs: q.startMs - delta, endMs: q.endMs - delta }))
    cut = target
    moved.push({ index: i, fromMs: target - delta, toMs: target })
  }
  return { composition: moved.length ? { ...input, clips } : input, moved, alreadyOn, skipped }
}
