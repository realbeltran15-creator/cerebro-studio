/**
 * Quick self-test of an export (a few seconds of the montage, the same codec / container / writing mode as the real export, written
 * to nowhere): it finds in seconds what would otherwise fail minutes or hours in, and it checks what a real destination needs
 * (a fragmented MP4 must grow strictly in order). Pure helpers; the page wires them to the exporter.
 */
import { MIN_CLIP_MS, type Composition } from './composition'

/** The first `ms` of a montage (same settings, same tracks), cut at clip boundaries; the last clip and every timed item are trimmed to fit. */
export function headOfComposition(c: Composition, ms: number): Composition {
  let at = 0
  const clips: Composition['clips'] = []
  for (const k of c.clips) {
    if (at >= ms) break
    const left = ms - at
    clips.push(k.durationMs <= left ? k : { ...k, durationMs: Math.max(MIN_CLIP_MS, left), transition: 'fade', transitionMs: undefined, transitionOpts: undefined })
    at += k.durationMs
  }
  const cut = <T extends { startMs: number; durationMs: number }>(items: T[] | undefined) => (items ?? []).filter(i => i.startMs < ms).map(i => ({ ...i, durationMs: Math.min(i.durationMs, ms - i.startMs) }))
  return { ...c, clips, audioClips: cut(c.audioClips), overlays: cut(c.overlays), textClips: cut(c.textClips) }
}

export type SelfTestStats = { bytes: number; writes: number; sequential: boolean; firstBadAt: number | null }

/** A destination that stores nothing and checks the order of what is written (append-only: each chunk starts where the last ended). */
export function checkingSink(): { stream: WritableStream<{ type: 'write'; data: Uint8Array; position: number }>; stats: () => SelfTestStats } {
  const st: SelfTestStats = { bytes: 0, writes: 0, sequential: true, firstBadAt: null }
  const stream = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write(chunk) {
      st.writes++
      if (chunk.position !== st.bytes && st.firstBadAt === null) { st.sequential = false; st.firstBadAt = chunk.position }
      st.bytes = Math.max(st.bytes, chunk.position + chunk.data.byteLength)
    },
  })
  return { stream, stats: () => ({ ...st }) }
}
