import { audioStartMs, audioTrackId, clipStarts, textTrackId, type Composition } from './composition'
import { expandGroups, type ItemRef } from './tracks'

/** A track row as laid out on screen: vertical extent in the same coordinates as the marquee. */
export type RowBox = { id: string; type: string; top: number; bottom: number }
export type MarqueeBox = { x0: number; y0: number; x1: number; y1: number }

export const normBox = (b: MarqueeBox) => ({ left: Math.min(b.x0, b.x1), right: Math.max(b.x0, b.x1), top: Math.min(b.y0, b.y1), bottom: Math.max(b.y0, b.y1) })

/**
 * The items touched by a rectangle drawn on the timeline (x in px from the start, y as `rows` say).
 * Works from the data, not the DOM, so clips that are not drawn (long montages are windowed) are still selected while the view scrolls.
 */
export function itemsInMarquee(comp: Composition, rows: RowBox[], box: MarqueeBox, pxPerSec: number): ItemRef[] {
  const b = normBox(box)
  const t0 = b.left / pxPerSec * 1000, t1 = b.right / pxPerSec * 1000
  const hit = rows.filter(r => r.bottom > b.top && r.top < b.bottom)
  if (!hit.length) return []
  const ids = new Set(hit.map(r => r.id))
  const out: ItemRef[] = []
  const touches = (s: number, d: number) => s + d >= t0 && s <= t1
  if (hit.some(r => r.type === 'main')) {
    const starts = clipStarts(comp)
    comp.clips.forEach((c, i) => { if (starts[i] > t1) return; if (touches(starts[i], c.durationMs)) out.push({ kind: 'clip', id: c.id }) })
  }
  for (const o of comp.overlays ?? []) if (o.trackId && ids.has(o.trackId) && touches(o.startMs, o.durationMs)) out.push({ kind: 'overlay', id: o.id })
  for (const x of comp.textClips ?? []) if (ids.has(textTrackId(x)) && touches(x.startMs, x.durationMs)) out.push({ kind: 'text', id: x.id })
  for (const a of comp.audioClips ?? []) if (ids.has(audioTrackId(a)) && touches(audioStartMs(comp, a), a.durationMs)) out.push({ kind: 'audio', id: a.id })
  return out
}

/** Selection while a marquee is open: the items inside (groups expanded), added to the selection held at the start when `additive`. */
export function marqueeSelection(comp: Composition, rows: RowBox[], box: MarqueeBox, pxPerSec: number, base: ItemRef[], additive: boolean): ItemRef[] {
  const inside = expandGroups(comp, itemsInMarquee(comp, rows, box, pxPerSec))
  if (!additive) return inside
  const key = (r: ItemRef) => `${r.kind}:${r.id}`
  const seen = new Set(base.map(key))
  return [...base, ...inside.filter(r => !seen.has(key(r)))]
}
