'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { exportPlan, type Composition } from '@/lib/editor/composition'
import { EditorPlayer, type LoopRange, type PlayerState } from '@/lib/editor/player'
import type { KindOf } from '@/lib/editor/scene'

/** h:mm:ss.ff (ff = frame at 30 fps), or mm:ss.ff under an hour. */
export function timecode(ms: number, fps = 30) {
  const t = Math.max(0, ms)
  const h = Math.floor(t / 3_600_000), m = Math.floor((t % 3_600_000) / 60_000), s = Math.floor((t % 60_000) / 1000), f = Math.floor((t % 1000) / (1000 / fps))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${h ? `${h}:${two(m)}` : two(m)}:${two(s)}.${two(f)}`
}

/** Parses «1:30», «90», «1:02:03.5» or «45m» into ms (null if it is not a time). */
export function parseTimecode(text: string): number | null {
  const v = text.trim().toLowerCase().replace(',', '.')
  const unit = v.match(/^(\d+(?:\.\d+)?)\s*(h|m|min|s)?$/)
  if (unit) { const n = Number(unit[1]); return Math.round(n * (unit[2] === 'h' ? 3_600_000 : unit[2] === 'm' || unit[2] === 'min' ? 60_000 : 1000)) }
  const parts = v.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null
  const n = parts.map(Number)
  return Math.round((parts.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1]) * 1000)
}

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  return !!e && (e.isContentEditable || !!e.closest?.('input,textarea,select,[contenteditable="true"]'))
}

/**
 * The editor's viewer: a real player over the same timeline that is being edited. Play, pause, stop, jump anywhere,
 * frame by frame, loop a fragment, speed, volume, full screen and keyboard shortcuts. Changes to the montage show at once.
 */
export function EditorPlayerView({ composition, kindOf, resolveUrl, loop, onTime, onPlayer, overlay, children }: {
  composition: Composition
  kindOf: KindOf
  resolveUrl: (assetId: string, refresh?: boolean) => Promise<string>
  /** Fragment marked on the timeline (for «repetir fragmento»). */
  loop: LoopRange | null
  onTime?: (ms: number, playing: boolean) => void
  onPlayer?: (p: EditorPlayer | null) => void
  /** Drawn over the picture (handles to move and resize layers). */
  overlay?: ReactNode
  children?: ReactNode
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const player = useRef<EditorPlayer | null>(null)
  const [st, setSt] = useState<PlayerState>({ playing: false, timeMs: 0, durationMs: 0, waiting: false, rate: 1, volume: 1, muted: false, loop: null })
  const [time, setTime] = useState(0)
  const [looping, setLooping] = useState(false)
  const [error, setError] = useState('')
  const [full, setFull] = useState(false)
  const [jump, setJump] = useState('')
  const scrubbing = useRef(false)
  const onTimeRef = useRef(onTime)
  useEffect(() => { onTimeRef.current = onTime }, [onTime])
  const kindRef = useRef(kindOf)
  const urlRef = useRef(resolveUrl)
  useEffect(() => { kindRef.current = kindOf; urlRef.current = resolveUrl }, [kindOf, resolveUrl])

  // Preview resolution: the export's aspect, at most 960 px on the long side (texts and effects are relative, so they look the same).
  const plan = exportPlan(composition)
  const k = Math.min(1, 960 / Math.max(plan.width, plan.height))
  const pw = Math.round(plan.width * k / 2) * 2, ph = Math.round(plan.height * k / 2) * 2

  useEffect(() => {
    if (!canvas.current) return
    let last = 0
    const p = new EditorPlayer({
      canvas: canvas.current,
      resolveUrl: (id, refresh) => urlRef.current(id, refresh),
      kindOf: id => kindRef.current(id),
      onState: s => setSt(s),
      onError: m => setError(m),
      onTime: ms => {
        const now = performance.now()
        // The clock text updates ~12 times a second while playing; the timeline playhead follows every frame through onTime.
        if (!p.state.playing || now - last > 80) { last = now; setTime(ms) }
        onTimeRef.current?.(ms, p.state.playing)
      },
    })
    player.current = p
    onPlayer?.(p)
    return () => { onPlayer?.(null); p.destroy(); player.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { player.current?.setComposition(composition) }, [composition, pw, ph])
  useEffect(() => { player.current?.setLoop(looping ? loop : null) }, [looping, loop])
  useEffect(() => { if (!st.playing) setTime(st.timeMs) }, [st])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = player.current
      if (!p || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const target = e.target as HTMLElement | null
      // A button reached with the keyboard keeps its normal Space; one that was clicked with the mouse does not steal the player's Space.
      const keyboardFocusedControl = !!target?.closest?.('button,a,[role="slider"],[role="option"],[role="tab"]') && target.matches?.(':focus-visible')
      switch (e.key) {
        case ' ': case 'Spacebar':
          if (keyboardFocusedControl) return
          e.preventDefault(); p.toggle(); return
        case 'k': case 'K': e.preventDefault(); p.pause(); return
        case 'j': case 'J': e.preventDefault(); p.skip(-10_000); return
        case 'l': case 'L': e.preventDefault(); p.skip(10_000); return
        case 'ArrowLeft': if (keyboardFocusedControl && target?.getAttribute('role') === 'slider') return; e.preventDefault(); if (e.shiftKey) p.skip(-1000); else p.step(-1); return
        case 'ArrowRight': if (keyboardFocusedControl && target?.getAttribute('role') === 'slider') return; e.preventDefault(); if (e.shiftKey) p.skip(1000); else p.step(1); return
        case 'Home': e.preventDefault(); p.seek(0); return
        case 'End': e.preventDefault(); p.seek(p.state.durationMs); return
        case 'f': case 'F': e.preventDefault(); void toggleFull(); return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  async function toggleFull() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await box.current?.requestFullscreen() } catch { setError('El navegador no permite la pantalla completa aquí.') }
  }

  const p = player.current
  const dur = st.durationMs
  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    p?.seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur)
  }
  const pct = dur ? Math.min(100, time / dur * 100) : 0

  return <section className={`panel playerPanel${full ? ' isFull' : ''}`} aria-label="Reproductor">
    <div ref={box} className="playerStage" style={{ aspectRatio: `${pw} / ${ph}`, position: 'relative', background: '#000', overflow: 'hidden', width: `min(100%, calc(var(--ed-viewer, 62vh) * ${pw / ph}))`, maxHeight: 'none', marginInline: 'auto' }}>
      <canvas ref={canvas} width={pw} height={ph} className="playerCanvas" style={{ display: 'block', width: '100%', height: '100%' }} aria-label={`Visor del montaje, ${timecode(time)}`} onDoubleClick={() => void toggleFull()} onClick={e => { if (e.target === canvas.current && !overlay) p?.toggle() }} />
      {overlay}
      {st.waiting && <span className="playerWaiting" role="status">Cargando…</span>}
    </div>
    <div className="playerScrub" role="slider" tabIndex={0} aria-label="Posición" aria-valuemin={0} aria-valuemax={Math.round(dur / 1000)} aria-valuenow={Math.round(time / 1000)} aria-valuetext={`${timecode(time)} de ${timecode(dur)}`}
      onPointerDown={e => { scrubbing.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekFromPointer(e) }}
      onPointerMove={e => { if (scrubbing.current) seekFromPointer(e) }}
      onPointerUp={() => { scrubbing.current = false }}
      onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); p?.skip(e.shiftKey ? -10_000 : -1000) } if (e.key === 'ArrowRight') { e.preventDefault(); p?.skip(e.shiftKey ? 10_000 : 1000) } }}>
      {loop && <span className="playerLoopBand" style={{ left: `${loop.startMs / Math.max(1, dur) * 100}%`, width: `${(loop.endMs - loop.startMs) / Math.max(1, dur) * 100}%`, opacity: looping ? 0.9 : 0.35 }} aria-hidden />}
      <span className="playerScrubFill" style={{ width: `${pct}%` }} aria-hidden />
      <span className="playerScrubKnob" style={{ left: `${pct}%` }} aria-hidden />
    </div>
    <div className="playerControls" role="toolbar" aria-label="Controles de reproducción">
      <button type="button" className="ghost small" onClick={() => p?.seek(0)} aria-label="Ir al inicio" title="Inicio (Inicio)">⏮</button>
      <button type="button" className="ghost small" onClick={() => p?.skip(-10_000)} aria-label="Retroceder 10 segundos" title="−10 s (J)">−10s</button>
      <button type="button" className="ghost small" onClick={() => p?.step(-1)} aria-label="Fotograma anterior" title="Fotograma anterior (←)">◀︎|</button>
      <button type="button" className="playerPlay" onClick={() => p?.toggle()} aria-label={st.playing ? 'Pausa' : 'Reproducir'} title="Reproducir / pausa (Espacio)">{st.playing ? '❚❚' : '▶'}</button>
      <button type="button" className="ghost small" onClick={() => p?.stop()} aria-label="Detener" title="Detener">■</button>
      <button type="button" className="ghost small" onClick={() => p?.step(1)} aria-label="Fotograma siguiente" title="Fotograma siguiente (→)">|▶︎</button>
      <button type="button" className="ghost small" onClick={() => p?.skip(10_000)} aria-label="Avanzar 10 segundos" title="+10 s (L)">+10s</button>
      <button type="button" className="ghost small" onClick={() => p?.seek(dur)} aria-label="Ir al final" title="Final (Fin)">⏭</button>
      <span className="playerTime" aria-live="off"><b>{timecode(time)}</b> / {timecode(dur)}</span>
      <button type="button" className={looping ? 'small' : 'ghost small'} aria-pressed={looping} disabled={!loop} onClick={() => setLooping(v => !v)} title={loop ? 'Repetir el fragmento marcado' : 'Marca un fragmento (I / O o Mayús+arrastrar en la regla) para repetirlo'}>⟲ Bucle</button>
      <label className="small playerRate" title="Velocidad de reproducción"><span aria-hidden>Vel.</span>
        <select value={String(st.rate)} onChange={e => p?.setRate(Number(e.target.value))} aria-label="Velocidad de reproducción">
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(r => <option key={r} value={String(r)}>{r}×</option>)}
        </select>
      </label>
      <button type="button" className="ghost small" onClick={() => p?.setMuted(!st.muted)} aria-pressed={st.muted} aria-label={st.muted ? 'Activar sonido' : 'Silenciar'} title="Silenciar la vista previa">{st.muted ? '🔇' : '🔊'}</button>
      <input type="range" min={0} max={1} step={0.05} value={st.volume} aria-label="Volumen" onChange={e => p?.setVolume(Number(e.target.value))} className="playerVolume" />
      <button type="button" className="ghost small" onClick={() => void toggleFull()} aria-label="Pantalla completa" title="Pantalla completa (F)">⛶</button>
      <form className="playerJump" onSubmit={e => { e.preventDefault(); const ms = parseTimecode(jump); if (ms === null) { setError('Escribe un tiempo como 45:00, 1:02:30 o 90s.'); return } setError(''); p?.seek(ms); setJump('') }}>
        <input value={jump} onChange={e => setJump(e.target.value)} placeholder="Ir a… 45:00" aria-label="Ir a un tiempo" />
      </form>
    </div>
    {error && <p className="error small" role="alert">{error}</p>}
    {children}
  </section>
}
