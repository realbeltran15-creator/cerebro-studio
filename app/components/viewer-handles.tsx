'use client'

import { useRef, useState } from 'react'
import { clipStarts, type Composition, type TextOverlay } from '@/lib/editor/composition'
import { boxRect, textLayout } from '@/lib/editor/draw'
import { transformAt } from '@/lib/editor/motion'
import type { EditorPlayer } from '@/lib/editor/player'
import { frameAt, mainClipAt, type KindOf, type VisualOp } from '@/lib/editor/scene'
import { setClipKeyframe, setKeyframe, updateOverlay, type ItemRef } from '@/lib/editor/tracks'
import { updateClip, updateTextClip } from '@/lib/editor/timeline'

type Box = { cx: number; cy: number; w: number; h: number; rotation: number }
type Hit = { ref: ItemRef; box: Box; kind: 'overlay' | 'text' | 'cliptext' | 'main' }
type Drag = { hit: Hit; mode: 'move' | 'scale' | 'rotate'; x0: number; y0: number; base: Composition; scaleK: number }

const measure = (() => { let g: CanvasRenderingContext2D | null = null; return () => (g ??= document.createElement('canvas').getContext('2d')) })()

/**
 * Direct manipulation on the viewer: click a layer to select it; drag to move it, drag the corner to resize, the round handle to rotate.
 * Works for overlays (position, size, rotation; with keyframes it sets the keyframe at the playhead), texts (free position and size)
 * and the main picture (framing: which part stays in view, and zoom). Every drag is one undoable step.
 */
export function ViewerHandles({ comp, player, kindOf, playheadMs, selection, onSelect, begin, live, end }: {
  comp: Composition
  player: EditorPlayer | null
  kindOf: KindOf
  playheadMs: number
  selection: ItemRef | null
  onSelect: (r: ItemRef | null) => void
  begin: () => void; live: (c: Composition) => void; end: () => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [, force] = useState(0)
  const w = player?.width ?? 960, h = player?.height ?? 540
  const t = Math.min(playheadMs, Math.max(0, (player?.state.durationMs ?? 1) - 1))
  if (player?.state.playing) return null

  // Everything that can be grabbed at this instant, topmost last.
  const hits: Hit[] = []
  const ops = frameAt(comp, t, kindOf)
  const g = measure()
  const starts = clipStarts(comp)
  const mi = mainClipAt(comp, t, starts)
  for (const op of ops) {
    if (op.type === 'visual' && op.slot.startsWith('ov:')) {
      const r = boxRect(op, player?.sourceSize(op) ?? null, w, h)
      if (r) hits.push({ ref: { kind: 'overlay', id: op.slot.slice(3) }, box: { cx: r.cx, cy: r.cy, w: r.w, h: r.h, rotation: r.rotation }, kind: 'overlay' })
    } else if (op.type === 'visual' && op.fit === 'cover' && mi >= 0 && op.slot === comp.clips[mi].id) {
      hits.unshift({ ref: { kind: 'clip', id: op.slot }, box: { cx: w / 2, cy: h / 2, w, h, rotation: 0 }, kind: 'main' })
    } else if (op.type === 'text' && g) {
      const L = textLayout(g, op.text, w, h)
      const tc = (comp.textClips ?? []).find(x => x === op.text || (x.content === op.text.content && x.startMs <= t && t < x.startMs + x.durationMs))
      const ref: ItemRef | null = tc ? { kind: 'text', id: tc.id } : mi >= 0 && comp.clips[mi].text === op.text ? { kind: 'clip', id: comp.clips[mi].id } : null
      if (ref) hits.push({ ref, box: { cx: L.cx, cy: L.top + L.blockH / 2, w: L.blockW + L.size * 0.4, h: L.blockH, rotation: 0 }, kind: tc ? 'text' : 'cliptext' })
    }
  }
  const selHits = hits.filter(x => selection && x.ref.kind === selection.kind && x.ref.id === selection.id)
  // A clip can be both the main picture and own a text: show the text box when the text was grabbed last, otherwise the picture.
  const shown = selHits.length ? selHits[selHits.length - 1] : null

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width * w, y: (e.clientY - r.top) / r.height * h, k: w / r.width }
  }
  const inside = (b: Box, x: number, y: number) => {
    const a = -b.rotation * Math.PI / 180, dx = x - b.cx, dy = y - b.cy
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a)
    return Math.abs(rx) <= b.w / 2 && Math.abs(ry) <= b.h / 2
  }

  function down(e: React.PointerEvent, mode: Drag['mode'], hit?: Hit) {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = toCanvas(e)
    let target = hit
    if (!target) {
      // Topmost layer under the pointer (texts and overlays before the main picture).
      target = [...hits].reverse().find(x => inside(x.box, p.x, p.y))
      if (!target) { onSelect(null); return }
      onSelect(target.ref)
    }
    if (target.kind !== 'main' && isLockedTrack(comp, target)) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    begin()
    drag.current = { hit: target, mode, x0: p.x, y0: p.y, base: comp, scaleK: p.k }
    force(n => n + 1)
  }
  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const p = toCanvas(e)
    const dx = p.x - d.x0, dy = p.y - d.y0
    const c = d.base
    const { hit } = d
    if (hit.kind === 'overlay') {
      const o = (c.overlays ?? []).find(x => x.id === hit.ref.id)
      if (!o) return
      const local = Math.min(Math.max(t - o.startMs, 0), o.durationMs)
      const now = transformAt({ ...o.transform }, o.keyframes, local)
      let patch: Partial<typeof now> = {}
      if (d.mode === 'move') patch = { x: now.x + dx / w, y: now.y + dy / h }
      else if (d.mode === 'scale') {
        const r0 = Math.hypot(d.x0 - hit.box.cx, d.y0 - hit.box.cy), r1 = Math.hypot(p.x - hit.box.cx, p.y - hit.box.cy)
        patch = { scale: Math.min(4, Math.max(0.03, now.scale * (r1 / Math.max(1, r0)))) }
      } else {
        const a0 = Math.atan2(d.y0 - hit.box.cy, d.x0 - hit.box.cx), a1 = Math.atan2(p.y - hit.box.cy, p.x - hit.box.cx)
        let rot = now.rotation + (a1 - a0) * 180 / Math.PI
        if (e.shiftKey) rot = Math.round(rot / 15) * 15
        patch = { rotation: Math.round(rot * 10) / 10 }
      }
      // Snap the centre to the middle of the frame (within 1 %).
      if (patch.x !== undefined && Math.abs(patch.x - 0.5) < 0.01) patch.x = 0.5
      if (patch.y !== undefined && Math.abs(patch.y - 0.5) < 0.01) patch.y = 0.5
      live(o.keyframes?.length ? setKeyframe(c, o.id, local, { ...now, ...patch }) : updateOverlay(c, o.id, { transform: { ...o.transform, ...patch } }))
    } else if (hit.kind === 'text' || hit.kind === 'cliptext') {
      const text: TextOverlay | undefined = hit.kind === 'text' ? (c.textClips ?? []).find(x => x.id === hit.ref.id) : c.clips.find(k => k.id === hit.ref.id)?.text ?? undefined
      if (!text) return
      let patch: Partial<TextOverlay>
      if (d.mode === 'scale') {
        const r0 = Math.hypot(d.x0 - hit.box.cx, d.y0 - hit.box.cy), r1 = Math.hypot(p.x - hit.box.cx, p.y - hit.box.cy)
        patch = { sizePct: Math.round(Math.min(15, Math.max(2, text.sizePct * r1 / Math.max(1, r0))) * 10) / 10 }
      } else patch = { x: Math.min(1, Math.max(0, hit.box.cx / w + dx / w)), y: Math.min(1, Math.max(0, hit.box.cy / h + dy / h)) }
      live(hit.kind === 'text' ? updateTextClip(c, hit.ref.id, patch) : updateClip(c, hit.ref.id, { text: { ...text, ...patch } }))
    } else {
      const k = c.clips.find(x => x.id === hit.ref.id)
      if (!k) return
      const local = Math.min(Math.max(t - (clipStarts(c)[c.clips.indexOf(k)] ?? 0), 0), k.durationMs)
      const now = transformAt({ zoom: k.zoom ?? 1, focusX: k.focusX ?? 0.5, focusY: k.focusY ?? 0.5, rotation: k.rotation ?? 0, opacity: k.opacity ?? 1 }, k.keyframes, local)
      // Framing: dragging the picture right shows more of its left side; the corner zooms. With keyframes it sets the one at the playhead.
      const patch = d.mode === 'scale'
        ? { zoom: Math.min(3, Math.max(1, now.zoom * Math.hypot(p.x - w / 2, p.y - h / 2) / Math.max(1, Math.hypot(d.x0 - w / 2, d.y0 - h / 2)))) }
        : { focusX: Math.min(1, Math.max(0, now.focusX - dx / w)), focusY: Math.min(1, Math.max(0, now.focusY - dy / h)) }
      live(k.keyframes?.length ? setClipKeyframe(c, k.id, local, { ...now, ...patch }) : updateClip(c, k.id, patch))
    }
  }
  function up() { if (drag.current) { drag.current = null; end(); force(n => n + 1) } }

  const pct = (v: number, of: number) => `${v / of * 100}%`
  return <div ref={layer} className="viewerHandles" style={{ position: 'absolute', inset: 0, cursor: 'default', touchAction: 'none' }}
    onPointerDown={e => down(e, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    onDoubleClick={() => player?.toggle()} aria-label="Capas del visor" role="application">
    {shown && <div className="viewerBox" aria-label={`Seleccionado en el visor: ${shown.kind === 'main' ? 'imagen principal' : shown.kind === 'overlay' ? 'superposición' : 'texto'}`}
      style={{ position: 'absolute', left: pct(shown.box.cx - shown.box.w / 2, w), top: pct(shown.box.cy - shown.box.h / 2, h), width: pct(shown.box.w, w), height: pct(shown.box.h, h), transform: `rotate(${shown.box.rotation}deg)`, outline: '2px solid #ffd23f', boxShadow: '0 0 0 1px rgba(0,0,0,.6)', pointerEvents: 'none' }}>
      <span role="button" aria-label="Redimensionar" onPointerDown={e => down(e, 'scale', shown)} style={{ position: 'absolute', right: -7, bottom: -7, width: 14, height: 14, background: '#ffd23f', border: '1px solid #000', borderRadius: 3, cursor: 'nwse-resize', pointerEvents: 'auto' }} />
      {shown.kind === 'overlay' && <span role="button" aria-label="Girar" onPointerDown={e => down(e, 'rotate', shown)} style={{ position: 'absolute', left: '50%', top: -26, width: 14, height: 14, marginLeft: -7, background: '#ffd23f', border: '1px solid #000', borderRadius: '50%', cursor: 'grab', pointerEvents: 'auto' }} />}
    </div>}
  </div>
}

function isLockedTrack(c: Composition, hit: Hit) {
  const id = hit.kind === 'overlay' ? (c.overlays ?? []).find(o => o.id === hit.ref.id)?.trackId : hit.kind === 'text' ? ((c.textClips ?? []).find(x => x.id === hit.ref.id)?.trackId ?? 'text') : 'main'
  return !!(c.tracks ?? []).find(t => t.id === id)?.locked
}

export type { VisualOp }
