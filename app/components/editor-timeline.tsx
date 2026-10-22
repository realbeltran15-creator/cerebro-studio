'use client'

import { useRef, type ReactNode } from 'react'
import { audioStartMs, audioTrackId, clipStarts, envelopeBreakpoints, projectDurationMs, textTrackId, tracksOf, TRANSITIONS, type Composition, type TrackMeta, type Transition } from '@/lib/editor/composition'
import { expandGroups, isLocked, moveItems, moveToTrack, setItemEnd, snap, snapBlock, snapPoints, trimItemStart, type ItemRef } from '@/lib/editor/tracks'
import { updateClip } from '@/lib/editor/timeline'
import { normRange, type Range } from '@/lib/editor/range'
import type { Waveform } from '@/lib/editor/waveform'
import { WaveformSvg } from './waveform-view'

export const ASSET_MIME = 'application/x-cerebro-asset'
export const TRANSITION_MIME = 'application/x-cerebro-transition'
export const TRANSITION_ICONS: Record<Transition, string> = { fade: '◐', dissolve: '◑', slide: '⇢', slide_up: '⇡', wipe: '▶', wipe_down: '▼', zoom: '⊕', blur: '≋', cut: '|' }
// Track colours keep white text at >= 4.5:1 (WCAG AA).
export const kindColor: Record<string, string> = { image: '#2f62c4', video: '#7c4fe0', none: '#444', voice: '#23805a', music: '#9a5b0f', sfx: '#b03a2e', text: '#8a3a8f', overlay: '#1f6f86' }
const secs = (ms: number) => Math.round(ms / 100) / 10
const ROW_H: Record<TrackMeta['type'], number> = { main: 64, overlay: 44, text: 30, voice: 34, music: 34, sfx: 34 }
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
const stamp = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}${s % 1 ? '.5' : ''}` }
const same = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id

type Drag =
  | { mode: 'move'; refs: ItemRef[]; primary: ItemRef; startX: number; base: Composition; span: { startMs: number; durationMs: number }; trackId: string | null }
  | { mode: 'trimStart' | 'end'; ref: ItemRef; startX: number; base: Composition; span: { startMs: number; durationMs: number } }
  | { mode: 'resizeMain'; id: string; startX: number; base: Composition; clipStart: number; dur: number }

export type TimelineProps = {
  comp: Composition
  selection: ItemRef[]
  onSelect: (refs: ItemRef[]) => void
  pxPerSec: number
  trackScale: number
  playheadMs: number
  onSeek: (ms: number) => void
  range: Range | null
  setRange: (r: Range | null) => void
  markIn: number | null
  magnet: boolean
  beatsMs: number[]
  showBeats: boolean
  waveformOf: (assetId: string) => Waveform | null | 'loading'
  thumbOf: (assetId: string | null) => string | undefined
  labelOf: (assetId: string | null) => string
  typeOf: (assetId: string | null) => string
  /** One undoable step for a whole drag: begin, then live updates replacing the present, then end. */
  begin: () => void
  live: (next: Composition) => void
  end: () => void
  apply: (fn: (c: Composition) => Composition) => void
  onReorderMain: (id: string, toIndex: number) => void
  /** A transition dropped near a cut: it goes on the clip that ends there. */
  onDropTransition: (clipId: string, t: Transition) => void
  onDropAsset: (assetId: string, track: TrackMeta, atMs: number) => void
  onDropFiles: (files: File[]) => void
  onTrackAction: (track: TrackMeta, action: 'up' | 'down' | 'duplicate' | 'delete' | 'rename', value?: string) => void
  onTrackFlag: (track: TrackMeta, flag: 'locked' | 'hidden' | 'muted' | 'solo') => void
  scrollerRef: React.RefObject<HTMLElement | null>
  playheadRef: React.RefObject<HTMLDivElement | null>
  view: { left: number; width: number }
  onScroll: () => void
  children?: ReactNode
}

/**
 * The multitrack timeline: a header per track (name, lock, hide, mute, solo, order, duplicate, delete) and a row per track with its clips.
 * Free items (overlays, audio, texts) move with the pointer, snap to edges/playhead/markers/beats, change track by dragging up or down,
 * and are trimmed from either edge. Main-track clips are sequential: drag to reorder, drag the right edge to change their length.
 */
export function EditorTimeline({ scrollerRef, playheadRef, ...p }: TimelineProps) {
  const { comp, pxPerSec, trackScale } = p
  const drag = useRef<Drag | null>(null)
  const rangeDrag = useRef<{ startMs: number; left: number } | null>(null)
  const scrubbing = useRef<number | null>(null)
  const dragMain = useRef<string | null>(null)
  const tracks = tracksOf(comp)
  const total = projectDurationMs(comp)
  const width = Math.max(total / 1000 * pxPerSec + 200, 600)
  const starts = clipStarts(comp)
  const rowH = (t: TrackMeta) => Math.round(ROW_H[t.type] * trackScale)
  const toMs = (px: number) => px / pxPerSec * 1000
  const loMs = toMs(p.view.left - 300), hiMs = toMs(p.view.left + p.view.width + 300)
  const many = comp.clips.length > 120 || (comp.audioClips?.length ?? 0) > 150 || (comp.textClips?.length ?? 0) > 150 || (comp.overlays?.length ?? 0) > 150
  const onScreen = (s: number, d: number) => !many || (s + d >= loMs - 30_000 && s <= hiMs + 30_000)
  const isSel = (r: ItemRef) => p.selection.some(x => same(x, r))
  const tolMs = Math.min(250, 10 / pxPerSec * 1000)

  // Long montages: only the main clips on screen (plus a margin) are drawn; spacers keep the timeline the same length.
  const windowed = (() => {
    if (comp.clips.length <= 120) return { from: 0, to: comp.clips.length, before: 0, after: 0 }
    const margin = 600, lo = toMs(p.view.left - margin), hi = toMs(p.view.left + p.view.width + margin)
    let from = 0, to = comp.clips.length
    while (from < to - 1 && starts[from] + comp.clips[from].durationMs < lo) from++
    while (to > from + 1 && starts[to - 1] > hi) to--
    const px = (a: number, b: number) => (b > a ? (starts[b - 1] + comp.clips[b - 1].durationMs - starts[a]) / 1000 * pxPerSec : 0)
    return { from, to, before: px(0, from), after: px(to, comp.clips.length) }
  })()

  // Ruler ticks: a step that leaves ~70 px between labels, only for the visible stretch.
  const step = RULER_STEPS.find(s => s * pxPerSec >= 70) ?? 3600
  const firstTick = Math.max(0, Math.floor(toMs(p.view.left - 100) / 1000 / step) * step)
  const lastTick = Math.min(total / 1000 + step, toMs(p.view.left + p.view.width + 100) / 1000)
  const ticks: number[] = []
  for (let s = firstTick; s <= lastTick && ticks.length < 400; s += step) ticks.push(Math.round(s * 10) / 10)

  function select(e: React.PointerEvent | React.MouseEvent, ref: ItemRef) {
    const add = e.shiftKey || e.ctrlKey || e.metaKey
    const refs = expandGroups(comp, [ref])
    if (add) {
      const has = isSel(ref)
      p.onSelect(has ? p.selection.filter(x => !refs.some(r => same(r, x))) : [...p.selection, ...refs.filter(r => !isSel(r))])
      return has ? null : [...p.selection, ...refs]
    }
    const keep = isSel(ref) && p.selection.length > 1 ? p.selection : refs
    p.onSelect(keep)
    return keep
  }

  function startItem(e: React.PointerEvent, ref: ItemRef, mode: 'move' | 'trimStart' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation()
    const chosen = mode === 'move' ? select(e, ref) : (p.onSelect(expandGroups(comp, [ref])), [ref])
    if (!chosen || isLocked(comp, ref)) return
    const span = spanOf(ref)
    if (!span) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    p.begin()
    drag.current = mode === 'move'
      ? { mode, refs: chosen.filter(r => r.kind !== 'clip'), primary: ref, startX: e.clientX, base: comp, span, trackId: null }
      : { mode, ref, startX: e.clientX, base: comp, span }
  }
  function spanOf(r: ItemRef) {
    if (r.kind === 'overlay') { const o = (comp.overlays ?? []).find(x => x.id === r.id); return o ? { startMs: o.startMs, durationMs: o.durationMs } : null }
    if (r.kind === 'audio') { const a = (comp.audioClips ?? []).find(x => x.id === r.id); return a ? { startMs: audioStartMs(comp, a), durationMs: a.durationMs } : null }
    if (r.kind === 'text') { const t = (comp.textClips ?? []).find(x => x.id === r.id); return t ? { startMs: t.startMs, durationMs: t.durationMs } : null }
    const i = comp.clips.findIndex(k => k.id === r.id); return i < 0 ? null : { startMs: starts[i], durationMs: comp.clips[i].durationMs }
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const delta = toMs(e.clientX - d.startX)
    const exclude = d.mode === 'move' ? d.refs : d.mode === 'resizeMain' ? [{ kind: 'clip' as const, id: d.id }] : [d.ref]
    const pts = p.magnet ? snapPoints(d.base, exclude, [p.playheadMs, ...(p.showBeats ? p.beatsMs : [])]) : []
    if (d.mode === 'move') {
      const want = d.span.startMs + delta
      const start = p.magnet ? snapBlock(want, d.span.durationMs, pts, tolMs) : want
      let next = moveItems(d.base, d.refs, start - d.span.startMs)
      // A single item can change track: the row under the pointer, when it takes this kind of clip.
      if (d.refs.length === 1) {
        const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-track-id]') as HTMLElement | null
        const tid = row?.dataset.trackId
        if (tid) next = moveToTrack(next, d.refs[0], tid)
      }
      p.live(next)
    } else if (d.mode === 'trimStart') {
      const want = d.span.startMs + delta
      const at = p.magnet ? snap(want, pts, tolMs) : want
      p.live(trimItemStart(d.base, d.ref, at - d.span.startMs))
    } else if (d.mode === 'end') {
      const want = d.span.startMs + d.span.durationMs + delta
      p.live(setItemEnd(d.base, d.ref, p.magnet ? snap(want, pts, tolMs) : want))
    } else if (d.mode === 'resizeMain') {
      const want = d.clipStart + d.dur + delta
      const end = p.magnet ? snap(want, pts, tolMs) : want
      p.live(updateClip(d.base, d.id, { durationMs: end - d.clipStart }))
    }
  }
  function onUp() { if (drag.current) { drag.current = null; p.end() } }

  const ruler = <div className="muted small timelineRuler" style={{ position: 'relative', height: 20, cursor: 'pointer' }} title="Clic: mover el cabezal · Mayús + arrastrar: marcar un fragmento"
    onPointerDown={e => { const left = e.currentTarget.getBoundingClientRect().left; const ms = Math.max(0, Math.min(total, toMs(e.clientX - left))); if (e.shiftKey) { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); rangeDrag.current = { startMs: ms, left }; p.setRange(null) } else { (e.target as HTMLElement).setPointerCapture(e.pointerId); rangeDrag.current = null; p.onSeek(ms); scrubbing.current = left } }}
    onPointerMove={e => { const d = rangeDrag.current; if (d) { e.stopPropagation(); p.setRange(normRange({ startMs: d.startMs, endMs: Math.max(0, Math.min(total, toMs(e.clientX - d.left))) }, total)); return } if (scrubbing.current !== null && e.buttons) p.onSeek(Math.max(0, Math.min(total, toMs(e.clientX - scrubbing.current)))) }}
    onPointerUp={e => { if (rangeDrag.current) { e.stopPropagation(); rangeDrag.current = null } scrubbing.current = null }}>
    {ticks.map(s => <span key={s} style={{ position: 'absolute', left: s * pxPerSec, borderLeft: '1px solid rgba(255,255,255,.25)', paddingLeft: 3 }}>{stamp(s)}</span>)}
    {(comp.markers ?? []).filter(m => m.atMs >= loMs && m.atMs <= hiMs).map(m => <button key={m.id} type="button" className="tlMarker" style={{ left: m.atMs / 1000 * pxPerSec, background: m.color ?? '#ffb000' }} title={`${m.label} · ${secs(m.atMs)} s`} aria-label={`Marcador ${m.label}`} onPointerDown={e => { e.stopPropagation(); p.onSeek(m.atMs) }} />)}
  </div>

  const itemStyle = (left: number, w: number, top: number, h: number, color: string, ref: ItemRef, extra: React.CSSProperties = {}): React.CSSProperties => ({
    position: 'absolute', left, width: Math.max(w, 8), top, height: h, background: color, borderRadius: 5, color: '#fff', fontSize: 11, padding: '3px 8px', overflow: 'hidden', cursor: isLocked(comp, ref) ? 'not-allowed' : 'grab', whiteSpace: 'nowrap', touchAction: 'none',
    outline: isSel(ref) ? '2px solid #fff' : undefined, boxShadow: isSel(ref) ? '0 0 0 4px rgba(255,255,255,.18)' : undefined, ...extra,
  })
  const edgeStyle = (side: 'left' | 'right'): React.CSSProperties => ({ position: 'absolute', top: 0, bottom: 0, [side]: 0, width: 7, cursor: 'ew-resize', background: 'rgba(255,255,255,.3)', zIndex: 2 })
  const edges = (ref: ItemRef, what: string) => isLocked(comp, ref) ? null : <>
    <span className="tlEdge left" style={edgeStyle('left')} onPointerDown={e => startItem(e, ref, 'trimStart')} role="separator" aria-orientation="vertical" aria-label={`Recortar inicio ${what}`} />
    <span className="tlEdge right" style={edgeStyle('right')} onPointerDown={e => startItem(e, ref, 'end')} role="separator" aria-orientation="vertical" aria-label={`Cambiar duración ${what}`} />
  </>
  const groupMark = (g?: string) => (g ? <span className="tlGroup" title="Agrupado" aria-label="Agrupado">⛓</span> : null)

  function row(t: TrackMeta) {
    const h = rowH(t)
    const common = {
      'data-track-id': t.id, role: 'group', className: `tlRow${t.hidden ? ' isHidden' : ''}${t.locked ? ' isLocked' : ''}`,
      onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(ASSET_MIME) || e.dataTransfer.types.includes(TRANSITION_MIME)) e.preventDefault() },
      onDrop: (e: React.DragEvent) => { const id = e.dataTransfer.getData(ASSET_MIME); if (!id) return; e.preventDefault(); e.stopPropagation(); p.onDropAsset(id, t, Math.max(0, toMs(e.clientX - e.currentTarget.getBoundingClientRect().left))) },
      onPointerDown: (e: React.PointerEvent) => { if (e.target === e.currentTarget && !e.shiftKey) p.onSelect([]) },
    }
    if (t.type === 'main') {
      return <div key={t.id} {...common} aria-label="Pista de vídeo" style={{ display: 'flex', height: h, marginTop: 6, position: 'relative' }}>
        {windowed.before > 0 && <div aria-hidden style={{ width: windowed.before, flex: 'none' }} />}
        {comp.clips.map((clip, i) => {
          if (i < windowed.from || i >= windowed.to) return null
          const ref = { kind: 'clip' as const, id: clip.id }
          const thumb = p.thumbOf(clip.visualAssetId)
          return <div key={clip.id} draggable={!t.locked}
            onDragStart={e => { if (drag.current || t.locked) { e.preventDefault(); return } dragMain.current = clip.id }} onDragOver={e => e.preventDefault()}
            onDrop={e => {
              if (e.dataTransfer.types.includes(ASSET_MIME)) return
              const tr = e.dataTransfer.getData(TRANSITION_MIME) as Transition
              if (tr) {
                // Left half of a clip = the cut before it; right half = the cut after it.
                e.preventDefault(); e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                const target = e.clientX - r.left < r.width / 2 ? i - 1 : i
                if (target >= 0 && target < comp.clips.length - 1) p.onDropTransition(comp.clips[target].id, tr)
                return
              }
              if (dragMain.current && dragMain.current !== clip.id) p.onReorderMain(dragMain.current, i); dragMain.current = null
            }}
            onClick={e => select(e, ref)}
            style={{ width: clip.durationMs / 1000 * pxPerSec, minWidth: 12, position: 'relative', flex: 'none', background: thumb ? `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${thumb}) center / cover` : kindColor[p.typeOf(clip.visualAssetId)] ?? '#555', borderRadius: 6, marginRight: 2, padding: '4px 6px', overflow: 'hidden', cursor: t.locked ? 'not-allowed' : 'grab', outline: isSel(ref) ? '2px solid #fff' : 'none', color: '#fff', fontSize: 11 }}
            title={`${p.labelOf(clip.visualAssetId)} · ${secs(clip.durationMs)} s`}>
            <b>{i + 1}</b> {p.labelOf(clip.visualAssetId)}{groupMark(clip.groupId)}<br />{secs(clip.durationMs)} s{clip.speed && clip.speed !== 1 ? ` · ${clip.speed}×` : ''}{clip.transition && clip.transition !== 'fade' ? ` · ${TRANSITIONS[clip.transition].toLowerCase()}` : ''}{clip.text ? ' · T' : ''}{clip.muted ? ' · 🔇' : ''}{clip.filters ? ' · fx' : ''}
            {i < comp.clips.length - 1 && (clip.transition ?? 'fade') !== 'cut' && <span className="tlTransition" aria-label={`Transición ${TRANSITIONS[clip.transition ?? 'fade']}`} title={`${TRANSITIONS[clip.transition ?? 'fade']} · ${clip.transitionMs ?? comp.fadeMs} ms`} style={{ position: 'absolute', right: 10, bottom: 3, fontSize: 12, background: 'rgba(0,0,0,.55)', borderRadius: 3, padding: '0 3px', pointerEvents: 'none' }}>{TRANSITION_ICONS[clip.transition ?? 'fade']}</span>}
            {!t.locked && <span onMouseDown={e => { e.preventDefault(); e.stopPropagation() }} onPointerDown={e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); p.begin(); drag.current = { mode: 'resizeMain', id: clip.id, startX: e.clientX, base: comp, clipStart: starts[i], dur: clip.durationMs } }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: 'rgba(255,255,255,0.35)' }} role="separator" aria-orientation="vertical" aria-label="Cambiar duración" />}
          </div>
        })}
        {windowed.after > 0 && <div aria-hidden style={{ width: windowed.after, flex: 'none' }} />}
      </div>
    }
    if (t.type === 'overlay') {
      return <div key={t.id} {...common} aria-label={`Pista de ${t.name}`} style={{ position: 'relative', height: h, marginTop: 6 }}>
        {(comp.overlays ?? []).filter(o => o.trackId === t.id && onScreen(o.startMs, o.durationMs)).map(o => {
          const ref = { kind: 'overlay' as const, id: o.id }
          const thumb = p.thumbOf(o.assetId)
          return <div key={o.id} onPointerDown={e => startItem(e, ref, 'move')} title={`${p.labelOf(o.assetId)} · ${secs(o.startMs)}–${secs(o.startMs + o.durationMs)} s`}
            style={itemStyle(o.startMs / 1000 * pxPerSec, o.durationMs / 1000 * pxPerSec, 3, h - 6, thumb ? `linear-gradient(rgba(0,40,60,.55), rgba(0,40,60,.55)), url(${thumb}) center / cover` : kindColor.overlay, ref)}>
            ▣ {p.labelOf(o.assetId)}{o.keyframes?.length ? ` · ◆${o.keyframes.length}` : ''}{groupMark(o.groupId)}
            {o.keyframes?.map(k => <i key={k.atMs} className="tlKey" style={{ left: k.atMs / 1000 * pxPerSec }} aria-hidden />)}
            {edges(ref, 'de la superposición')}
          </div>
        })}
      </div>
    }
    if (t.type === 'text') {
      return <div key={t.id} {...common} aria-label={`Pista de ${t.name}`} style={{ position: 'relative', height: h, marginTop: 6, background: 'var(--bg-2)', borderRadius: 6 }}>
        {(comp.textClips ?? []).filter(x => textTrackId(x) === t.id && onScreen(x.startMs, x.durationMs)).map(x => {
          const ref = { kind: 'text' as const, id: x.id }
          return <div key={x.id} onPointerDown={e => startItem(e, ref, 'move')} onClick={e => e.stopPropagation()} title={`${x.content} · ${secs(x.startMs)}–${secs(x.startMs + x.durationMs)} s`}
            style={itemStyle(x.startMs / 1000 * pxPerSec, x.durationMs / 1000 * pxPerSec, 3, h - 6, kindColor.text, ref)}>
            T {x.content}{groupMark(x.groupId)}
            {edges(ref, 'del texto')}
          </div>
        })}
      </div>
    }
    const kind = t.type
    return <div key={t.id} {...common} aria-label={`Pista de ${t.name}`} style={{ position: 'relative', height: h, marginTop: 6, background: 'var(--bg-2)', borderRadius: 6 }}>
      {kind === 'music' && p.showBeats && p.beatsMs.filter(b => b >= loMs && b <= hiMs).slice(0, 1500).map(b => <span key={b} data-beat="true" aria-hidden style={{ position: 'absolute', left: b / 1000 * pxPerSec, top: 0, bottom: 0, width: 1, background: '#8ab4ff', opacity: 0.7, pointerEvents: 'none', zIndex: 3 }} />)}
      {(comp.audioClips ?? []).filter(a => audioTrackId(a) === t.id).map(a => {
        const start = audioStartMs(comp, a)
        if (!onScreen(start, a.durationMs)) return null
        const ref = { kind: 'audio' as const, id: a.id }
        const wf = p.waveformOf(a.assetId)
        const w = Math.max(a.durationMs / 1000 * pxPerSec, 8)
        return <div key={a.id} onPointerDown={e => startItem(e, ref, 'move')} title={`${p.labelOf(a.assetId)} · ${secs(start)}–${secs(start + a.durationMs)} s${a.linkedClipId ? ' · enlazado a su clip' : ''}`}
          style={itemStyle(start / 1000 * pxPerSec, w, 3, h - 6, kindColor[a.kind], ref, { opacity: a.muted ? 0.4 : 1, padding: '6px 8px' })}>
          {wf && wf !== 'loading' && <WaveformSvg w={wf} fromMs={a.trimInMs} toMs={a.trimInMs + a.durationMs} width={w} height={h - 6} />}
          {(a.envelope?.length || a.fadeInMs || a.fadeOutMs) ? <svg aria-label="Automatización de volumen" width={w} height={h - 6} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}><polyline fill="none" stroke="#ffe08a" strokeWidth={1.5} points={envelopeBreakpoints(a).map(pt => `${pt.atMs / 1000 * pxPerSec},${h - 8 - Math.min(2, pt.gain) / 2 * (h - 10)}`).join(' ')} /></svg> : null}
          <span style={{ position: 'relative' }}>{a.linkedClipId ? '🔗 ' : ''}{p.labelOf(a.assetId)}{a.pan ? ` · ${a.pan < 0 ? 'I' : 'D'}${Math.round(Math.abs(a.pan) * 100)}` : ''}{wf === 'loading' ? ' · midiendo…' : ''}</span>{groupMark(a.groupId)}
          {edges(ref, 'del audio')}
        </div>
      })}
    </div>
  }

  const flagBtn = (t: TrackMeta, flag: 'locked' | 'hidden' | 'muted' | 'solo', label: string, text: string) =>
    <button type="button" className={t[flag] ? 'tlFlag on' : 'tlFlag'} aria-pressed={!!t[flag]} aria-label={`${label} ${t.name}`} title={label} onClick={() => p.onTrackFlag(t, flag)}>{text}</button>

  return <div className="tlGrid" style={{ display: 'grid', gridTemplateColumns: 'var(--tl-head, 190px) minmax(0, 1fr)', gap: 6, alignItems: 'start' }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
    <div className="tlHeads" aria-label="Pistas">
      <div style={{ height: 20 }} />
      {tracks.map(t => <div key={t.id} className={`tlHead type-${t.type}`} style={{ height: rowH(t), marginTop: 6, overflow: 'hidden', boxSizing: 'border-box' }} role="group" aria-label={`Controles de ${t.name}`}>
        <input className="tlName" defaultValue={t.name} key={t.name} aria-label={`Nombre de la pista ${t.name}`} onBlur={e => { if (e.target.value.trim() && e.target.value !== t.name) p.onTrackAction(t, 'rename', e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <div className="tlFlags">
          {flagBtn(t, 'locked', 'Bloquear', '🔒')}
          {(t.type === 'main' || t.type === 'overlay' || t.type === 'text') && flagBtn(t, 'hidden', 'Ocultar', '👁')}
          {t.type !== 'text' && flagBtn(t, 'muted', 'Silenciar', 'M')}
          {t.type !== 'text' && flagBtn(t, 'solo', 'Solo', 'S')}
          {t.type !== 'main' && <details className="tlMenu"><summary aria-label={`Más opciones de ${t.name}`}>⋯</summary>
            <div className="tlMenuBody">
              <button type="button" className="ghost small" onClick={() => p.onTrackAction(t, 'up')}>Subir</button>
              <button type="button" className="ghost small" onClick={() => p.onTrackAction(t, 'down')}>Bajar</button>
              <button type="button" className="ghost small" onClick={() => p.onTrackAction(t, 'duplicate')}>Duplicar pista</button>
              <button type="button" className="ghost small" onClick={() => p.onTrackAction(t, 'delete')}>Eliminar pista</button>
            </div>
          </details>}
        </div>
      </div>)}
    </div>
    <section ref={scrollerRef} onScroll={p.onScroll} className="tlScroll" style={{ overflowX: 'auto', overflowY: 'hidden', position: 'relative', minWidth: 0 }} aria-label="Línea de tiempo"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); p.onDropFiles(Array.from(e.dataTransfer.files)) } }}>
      <div style={{ width, position: 'relative', paddingBottom: 6 }}>
        {ruler}
        <div className="playhead" ref={playheadRef} style={{ left: p.playheadMs / 1000 * pxPerSec }} aria-hidden="true" />
        {p.range && <div className="rangeOverlay" style={{ position: 'absolute', top: 0, bottom: 0, left: p.range.startMs / 1000 * pxPerSec, width: (p.range.endMs - p.range.startMs) / 1000 * pxPerSec }} aria-label={`Fragmento marcado ${secs(p.range.startMs)}–${secs(p.range.endMs)} s`} />}
        {!p.range && p.markIn !== null && <div className="markIn" style={{ left: p.markIn / 1000 * pxPerSec }} aria-hidden="true" />}
        {(comp.markers ?? []).filter(m => m.atMs >= loMs && m.atMs <= hiMs).map(m => <div key={m.id} className="tlMarkerLine" style={{ left: m.atMs / 1000 * pxPerSec, borderColor: m.color ?? '#ffb000' }} aria-hidden />)}
        {tracks.map(row)}
        {p.children}
      </div>
    </section>
  </div>
}
