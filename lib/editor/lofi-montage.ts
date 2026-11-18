import { MAX_TIMELINE_MS, MIN_CLIP_MS, type Clip, type Composition } from './composition'

// Hundreds of clips are created at once: a counter keeps every id unique.
let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * «Música en fila y vídeo en bucle»: the owner's way of making a long lo-fi video.
 * - The songs go one after another on the music track, each one overlapping the previous by `crossfadeMs` with a soft fade out/in
 *   (no silence between songs, no jump in volume).
 * - The clips already on the timeline are the pattern (how he cut and joined them): that block is repeated, with the same cuts and
 *   a `transitionMs` dissolve between every clip, until it lasts exactly as long as the music. The last clip is shortened to fit.
 * Deterministic and free (no AI). The video's own sound is left as it was (muted or not) — the music is added on its own track.
 */
export type LofiSong = { assetId: string; durationMs: number }
export type LofiOptions = {
  songs: LofiSong[]; crossfadeMs?: number; transitionMs?: number; volume?: number; fadeEdgesMs?: number
  /** «Bucle perfecto»: every clip plays its whole file, from the first frame to the last, so each cut joins the end of the file with its
   *  start (the loop seam of a first/last-frame video). The pattern is then each different file once, in timeline order. */
  wholeClips?: boolean
}
// 1.65 s: the transition the owner chose by eye for his lo-fi loops (18-11-2026).
export const LOFI_DEFAULTS = { crossfadeMs: 5000, transitionMs: 1650, volume: 1, fadeEdgesMs: 3000 }

export function buildLofiMontage(c: Composition, o: LofiOptions): { composition: Composition; totalMs: number; clips: number; warnings: string[] } {
  const warnings: string[] = []
  const songs = o.songs.filter(s => s.durationMs > 1000)
  if (!songs.length) throw new Error('No hay canciones con duración conocida.')
  if (songs.length < o.songs.length) warnings.push(`${o.songs.length - songs.length} canción(es) sin duración conocida se han saltado.`)
  const visual = c.clips.filter(k => k.visualAssetId)
  const pattern = o.wholeClips
    ? visual.filter((k, i) => visual.findIndex(x => x.visualAssetId === k.visualAssetId) === i)
      .map(k => ({ ...k, trimInMs: 0, durationMs: k.sourceDurationMs && k.sourceDurationMs >= MIN_CLIP_MS ? Math.round(k.sourceDurationMs / (k.speed ?? 1)) : k.durationMs }))
    : visual
  if (!pattern.length) throw new Error('Pon primero en la línea de tiempo el clip (o los clips) que se repetirán.')
  const xf = Math.max(0, Math.round(o.crossfadeMs ?? LOFI_DEFAULTS.crossfadeMs))
  const tMs = Math.max(0, Math.round(o.transitionMs ?? LOFI_DEFAULTS.transitionMs))
  const edge = Math.max(0, Math.round(o.fadeEdgesMs ?? LOFI_DEFAULTS.fadeEdgesMs))
  const vol = o.volume ?? LOFI_DEFAULTS.volume

  // ---- Music: in a row, overlapping by the crossfade (never more than half of the shorter song).
  const audioClips = (c.audioClips ?? []).filter(a => a.kind !== 'music')
  let at = 0
  songs.forEach((s, i) => {
    const prev = songs[i - 1]
    const overlap = i === 0 ? 0 : Math.min(xf, Math.floor(Math.min(prev.durationMs, s.durationMs) / 2))
    at = i === 0 ? 0 : at - overlap
    const next = songs[i + 1]
    const outOverlap = next ? Math.min(xf, Math.floor(Math.min(s.durationMs, next.durationMs) / 2)) : 0
    audioClips.push({
      id: newId('music'), assetId: s.assetId, kind: 'music', linkedClipId: null, offsetMs: 0, startMs: at, trimInMs: 0, durationMs: s.durationMs, volume: vol, muted: false,
      fadeInMs: i === 0 ? Math.min(edge, s.durationMs / 4) : overlap, fadeOutMs: next ? outOverlap : Math.min(edge, s.durationMs / 4),
    })
    at += s.durationMs
  })
  let total = at
  if (total > MAX_TIMELINE_MS) { warnings.push(`El editor admite hasta ${MAX_TIMELINE_MS / 3600_000} h: se ha acortado.`); total = MAX_TIMELINE_MS }

  // ---- Picture: the pattern block repeated until it covers the music.
  const clips: Clip[] = []
  let t = 0
  for (let i = 0; t < total; i++) {
    const src = pattern[i % pattern.length]
    let len = Math.min(src.durationMs, total - t)
    if (len < MIN_CLIP_MS && clips.length) { const last = clips[clips.length - 1]; last.durationMs += len; t += len; break }
    len = Math.max(len, Math.min(MIN_CLIP_MS, total - t))
    clips.push({ ...src, id: newId('clip'), position: clips.length + 1, durationMs: len, transition: 'dissolve', transitionMs: tMs })
    t += len
  }
  if (clips.length) clips[clips.length - 1] = { ...clips[clips.length - 1], transition: 'fade' }
  const composition: Composition = { ...c, clips, audioClips, musicAssetId: null, duckMusic: false, fadeMs: edge, editedManually: true }
  return { composition, totalMs: total, clips: clips.length, warnings }
}
