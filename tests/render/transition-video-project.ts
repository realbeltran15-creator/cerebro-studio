/**
 * Two clearly different real videos side by side on the main track with a centred cross dissolve: A = first 4 s of file 1, B = seconds 2–6 of
 * file 2 (so each file has material on both sides of the cut). Used by scripts/transition-video-test.mjs to check, in the engine and in the
 * editor's player, that both videos are on screen during the transition and that the picture is continuous.
 */
import { emptyComposition, type Composition } from '../../lib/editor/composition'
import { addClip, updateClip } from '../../lib/editor/timeline'

export const TV_MEDIA: Record<string, { kind: 'video'; file: string }> = { va: { kind: 'video', file: 'va.webm' }, vs: { kind: 'video', file: 'vs.webm' }, vb: { kind: 'video', file: 'vb.webm' } }
export const TV_FILE_MS = 10000
export const CUT_MS = 4000, WINDOW_MS = 1000, B_TRIM_MS = 2000

export function dissolveProject(handles: boolean, align: 'center' | 'before' | 'after' = 'center'): Composition {
  let c: Composition = { ...emptyComposition('tv', 'Dos vídeos'), editedManually: true, fadeMs: 0, subtitles: false, duckMusic: false }
  // 'vs' = the same video but only 4 s long: nothing after A's end
  c = addClip(c, handles ? 'va' : 'vs', CUT_MS); c = addClip(c, 'vb', 4000); c = addClip(c, 'vb', 4000)
  c = updateClip(c, c.clips[0].id, { trimInMs: 0, sourceDurationMs: handles ? TV_FILE_MS : CUT_MS, muted: true, transition: 'dissolve', transitionMs: WINDOW_MS, transitionOpts: { easing: 'linear', align } })
  c = updateClip(c, c.clips[1].id, { trimInMs: B_TRIM_MS, sourceDurationMs: TV_FILE_MS, muted: true })
  return { ...c, exportSettings: { quality: 'normal', resolution: '720', destination: 'download' } }
}
/** Moments around the cut (ms): before the window, its first and last frame, 25 %, 50 %, 75 %, after the window. */
export const TV_TIMES = [3400, 3510, 3750, 4000, 4250, 4490, 4600]
