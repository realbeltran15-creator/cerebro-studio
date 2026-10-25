/** One real 6 s video with visible motion, used whole and repeated N times with a 1 s centred dissolve at every cut (the 90-minute workflow in miniature). */
import { emptyComposition, totalDurationMs, type Composition } from '../../lib/editor/composition'
import { addClip, updateClip } from '../../lib/editor/timeline'
import { planRepeat } from '../../lib/editor/repeat'

export const RV_MEDIA: Record<string, { kind: 'video'; file: string }> = { rv: { kind: 'video', file: 'rv.webm' } }
export const RV_FILE_MS = 6000

export function repeatProject(n: number, join = true): { composition: Composition; finalMs: number; plan: ReturnType<typeof planRepeat> } {
  let c: Composition = { ...emptyComposition('rv', 'Repetición'), editedManually: true, fadeMs: 0, subtitles: false, duckMusic: false }
  c = addClip(c, 'rv', RV_FILE_MS)
  c = updateClip(c, c.clips[0].id, { trimInMs: 0, sourceDurationMs: RV_FILE_MS, muted: true })
  const plan = planRepeat(c, c.clips[0].id, { mode: 'count', count: n }, join ? { settings: { transition: 'dissolve', ms: 1000, align: 'center', easing: 'linear' } } : null, () => 'video')
  const composition = { ...plan.composition, exportSettings: { quality: 'normal' as const, resolution: '720' as const, destination: 'download' as const } }
  return { composition, finalMs: totalDurationMs(composition), plan }
}
