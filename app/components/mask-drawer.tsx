'use client'

import { useRef, useState } from 'react'
import { MAX_MASK_POINTS, type Composition } from '@/lib/editor/composition'
import { boxRect } from '@/lib/editor/draw'
import type { EditorPlayer } from '@/lib/editor/player'
import { frameAt, type KindOf } from '@/lib/editor/scene'
import type { ItemRef } from '@/lib/editor/tracks'

type Pt = [number, number]

/** The layer's box on the frame (px): an overlay's box at this instant, or the whole frame for the main picture. */
export function maskBox(comp: Composition, player: EditorPlayer | null, kindOf: KindOf, t: number, target: ItemRef, w: number, h: number) {
  if (target.kind === 'overlay') {
    const op = frameAt(comp, t, kindOf).find(o => o.type === 'visual' && o.slot === `ov:${target.id}`)
    if (!op || op.type !== 'visual') return null
    const r = boxRect(op, player?.sourceSize(op) ?? null, w, h)
    return r ? { x: r.cx - r.w / 2, y: r.cy - r.h / 2, w: r.w, h: r.h } : null
  }
  return { x: 0, y: 0, w, h }
}

/**
 * «Dibujar máscara»: the owner clicks round the zone to change (the water, the sky…) and each click adds a corner; corners can be dragged.
 * The shape is kept in fractions of the layer, so it follows the layer if it is moved. «Terminar» saves it (one undoable step).
 */
export function MaskDrawer({ comp, player, kindOf, playheadMs, target, initial, onDone }: {
  comp: Composition
  player: EditorPlayer | null
  kindOf: KindOf
  playheadMs: number
  target: ItemRef
  initial: Pt[] | null
  onDone: (points: Pt[] | null) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [pts, setPts] = useState<Pt[]>(initial ?? [])
  const dragging = useRef<number | null>(null)
  const w = player?.width ?? 960, h = player?.height ?? 540
  const t = Math.min(playheadMs, Math.max(0, (player?.state.durationMs ?? 1) - 1))
  const box = maskBox(comp, player, kindOf, t, target, w, h)
  if (!box) return <div className="maskDrawer" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.4)', color: '#fff' }}>
    <p style={{ margin: 0, padding: 12, textAlign: 'center' }}>Coloca el cabezal sobre la capa para dibujar su máscara.<br /><button type="button" className="ghost small" onClick={() => onDone(null)}>Cerrar</button></p>
  </div>

  const toFrac = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width * w, y = (e.clientY - r.top) / r.height * h
    const fx = (x - box.x) / box.w, fy = (y - box.y) / box.h
    return [Math.round(Math.min(1, Math.max(0, fx)) * 1e4) / 1e4, Math.round(Math.min(1, Math.max(0, fy)) * 1e4) / 1e4]
  }
  const toPx = ([fx, fy]: Pt) => [box.x + fx * box.w, box.y + fy * box.h]
  const poly = pts.map(p => toPx(p).join(',')).join(' ')
  const r = Math.max(5, Math.min(w, h) * 0.012)

  return <div className="maskDrawer" style={{ position: 'absolute', inset: 0 }} role="application" aria-label="Dibujar máscara: haz clic alrededor de la zona que quieres cambiar">
    <svg ref={svg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={e => {
        if (e.button !== 0 || dragging.current !== null) return
        if (pts.length >= MAX_MASK_POINTS) return
        setPts(p => [...p, toFrac(e)])
      }}
      onPointerMove={e => { const i = dragging.current; if (i === null) return; const p = toFrac(e); setPts(list => list.map((q, j) => (j === i ? p : q))) }}
      onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="#ffd23f" strokeDasharray="8 6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {pts.length >= 3 && <polygon points={poly} fill="rgba(255,210,63,.25)" stroke="#ffd23f" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      {pts.length > 0 && pts.length < 3 && <polyline points={poly} fill="none" stroke="#ffd23f" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      {pts.map((p, i) => { const [x, y] = toPx(p); return <circle key={i} cx={x} cy={y} r={r} fill={i === 0 ? '#ff5d5d' : '#ffd23f'} stroke="#000" strokeWidth={1}
        style={{ cursor: 'grab' }} aria-label={`Punto ${i + 1}`}
        onPointerDown={e => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); dragging.current = i }}
        onDoubleClick={e => { e.stopPropagation(); setPts(list => list.filter((_, j) => j !== i)) }} /> })}
    </svg>
    <div role="toolbar" aria-label="Máscara" style={{ position: 'absolute', left: 8, top: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', background: 'rgba(0,0,0,.7)', color: '#fff', padding: '6px 8px', borderRadius: 8, fontSize: 12, maxWidth: 'calc(100% - 16px)' }}>
      <span>Haz clic alrededor de la zona · arrastra los puntos · doble clic en un punto lo borra ({pts.length})</span>
      <button type="button" className="primary small" disabled={pts.length < 3} onClick={() => onDone(pts)}>Terminar</button>
      <button type="button" className="ghost small" disabled={!pts.length} onClick={() => setPts(p => p.slice(0, -1))}>Deshacer punto</button>
      <button type="button" className="ghost small" disabled={!pts.length} onClick={() => setPts([])}>Borrar todo</button>
      <button type="button" className="ghost small" onClick={() => onDone(null)}>Cancelar</button>
    </div>
  </div>
}
