'use client'

import { useRef, useState } from 'react'
import { CAMERA_MOVES, FILTER_PRESETS, NO_FILTERS, TRANSITIONS, type CameraKind, type Clip, type Composition, type Crop, type Filters, type KeyEasing, type OverlayClip, type TransitionOptions } from '@/lib/editor/composition'
import { DIRECTIONS, EASINGS, HAS_DIRECTION, HAS_INTENSITY, type TransitionDirection, type TransitionEasing } from '@/lib/editor/motion'
import type { AnimationPreset, TransitionPreset } from '@/lib/editor/presets'
import { assetLabel, type EditorAsset } from '@/lib/editor/client'
import { transformAt } from '@/lib/editor/motion'
import { setKeyframe } from '@/lib/editor/tracks'
import { canvasFiltersSupported } from '@/lib/editor/draw'
import { Section } from './editor-workspace'

const secs = (ms: number) => Math.round(ms / 100) / 10
const pct = (n: number) => Math.round(n * 100)

/** Picture adjustments shared by main clips and overlays: filter presets, brightness/contrast/saturation/blur, crop, rotation, opacity. */
/** A fold of its own, or (inside a property group) just its content. */
function Fold({ bare, open, summary, children }: { bare: boolean; open: boolean; summary: React.ReactNode; children: React.ReactNode }) {
  return bare ? <div className="small foldBare">{children}</div> : <details className="small" open={open}><summary>{summary}</summary>{children}</details>
}

export function VisualFields({ filters, crop, rotation, opacity, onChange, label = 'Imagen', bare = false }: {
  filters: Filters | null | undefined; crop: Crop | null | undefined; rotation?: number; opacity?: number
  /** Inside a property group: no fold of its own. */
  bare?: boolean
  onChange: (p: { filters?: Filters | null; crop?: Crop | null; rotation?: number; opacity?: number }) => void
  label?: string
}) {
  const f = filters ?? NO_FILTERS
  const c = crop ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const setF = (p: Partial<Filters>) => { const n = { ...f, ...p }; onChange({ filters: n.brightness === 1 && n.contrast === 1 && n.saturation === 1 && n.blur === 0 ? null : n }) }
  const setC = (p: Partial<Crop>) => { const n = { ...c, ...p }; onChange({ crop: n.left || n.top || n.right || n.bottom ? n : null }) }
  const preset = Object.entries(FILTER_PRESETS).find(([, v]) => JSON.stringify(v.f) === JSON.stringify(f))?.[0] ?? ''
  return <Fold bare={bare} open={!!filters || !!crop || !!rotation || (opacity !== undefined && opacity < 1)} summary={<b>{label}: filtros, recorte, rotación y opacidad</b>}>
    {!canvasFiltersSupported() && <p className="warnBox small">Este navegador no aplica filtros al lienzo (Safari): se verán y exportarán en Chrome o Edge.</p>}
    <div className="field-row" style={{ marginTop: 6 }}>
      <label>Filtro<select aria-label="Filtro" value={preset} onChange={e => { const v = FILTER_PRESETS[e.target.value]; if (v) onChange({ filters: e.target.value === 'none' ? null : v.f }) }}>{preset === '' && <option value="">Personalizado</option>}{Object.entries(FILTER_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      <label>Brillo ({pct(f.brightness)} %)<input type="range" aria-label="Brillo" min={0.2} max={2} step={0.05} value={f.brightness} onChange={e => setF({ brightness: Number(e.target.value) })} /></label>
      <label>Contraste ({pct(f.contrast)} %)<input type="range" aria-label="Contraste" min={0.2} max={2} step={0.05} value={f.contrast} onChange={e => setF({ contrast: Number(e.target.value) })} /></label>
      <label>Saturación ({pct(f.saturation)} %)<input type="range" aria-label="Saturación" min={0} max={2.5} step={0.05} value={f.saturation} onChange={e => setF({ saturation: Number(e.target.value) })} /></label>
      <label>Desenfoque ({f.blur.toFixed(1)})<input type="range" aria-label="Desenfoque" min={0} max={5} step={0.1} value={f.blur} onChange={e => setF({ blur: Number(e.target.value) })} /></label>
    </div>
    <div className="field-row">
      {(['left', 'right', 'top', 'bottom'] as const).map(k => <label key={k}>Recorte {k === 'left' ? 'izq.' : k === 'right' ? 'der.' : k === 'top' ? 'arriba' : 'abajo'} ({pct(c[k])} %)<input type="range" aria-label={`Recorte ${k}`} min={0} max={0.45} step={0.01} value={c[k]} onChange={e => setC({ [k]: Number(e.target.value) })} /></label>)}
    </div>
    <div className="field-row">
      {rotation !== undefined && <label>Rotación ({Math.round(rotation)}°)<input type="range" aria-label="Rotación" min={-180} max={180} step={1} value={rotation} onChange={e => onChange({ rotation: Number(e.target.value) })} /></label>}
      {opacity !== undefined && <label>Opacidad ({pct(opacity)} %)<input type="range" aria-label="Opacidad" min={0} max={1} step={0.01} value={opacity} onChange={e => onChange({ opacity: Number(e.target.value) })} /></label>}
      <button type="button" className="ghost small" onClick={() => onChange({ filters: null, crop: null, ...(rotation !== undefined ? { rotation: 0 } : {}), ...(opacity !== undefined ? { opacity: 1 } : {}) })}>Restablecer</button>
    </div>
  </Fold>
}

/** A layer above the main track: picture, timing, position/size/rotation/opacity, keyframes, Ken Burns, fades, sound, filters and crop. */
export function OverlayInspector({ o, visuals, isVideo, playheadMs, onChange, apply, onDelete, onDuplicate, animation }: {
  o: OverlayClip; visuals: EditorAsset[]; isVideo: boolean; playheadMs: number
  /** The keyframe editor for this layer. */
  animation?: React.ReactNode
  onChange: (p: Partial<OverlayClip>) => void
  apply: (fn: (c: Composition) => Composition) => void
  onDelete: () => void; onDuplicate: () => void
}) {
  const local = Math.min(Math.max(playheadMs - o.startMs, 0), o.durationMs)
  const inside = playheadMs >= o.startMs && playheadMs <= o.startMs + o.durationMs
  const now = transformAt({ ...o.transform }, o.keyframes, local)
  const keyed = (o.keyframes?.length ?? 0) > 0
  // With keyframes, a change at the playhead becomes (or updates) the keyframe there; without them it changes the whole layer.
  const setT = (p: Partial<OverlayClip['transform']>) => {
    if (keyed && inside) apply(c => setKeyframe(c, o.id, local, { ...now, ...p }))
    else onChange({ transform: { ...o.transform, ...p } })
  }
  return <>
    <Section id="layer-basic" title={isVideo ? 'Vídeo superpuesto' : 'Foto superpuesta'} defaultOpen>
    <label>Imagen o vídeo<select aria-label="Material de la superposición" value={o.assetId} onChange={e => onChange({ assetId: e.target.value, trimInMs: 0 })}>{visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select></label>
    <div className="field-row">
      <label>Aparece en (s)<input type="number" aria-label="Inicio de la superposición" min={0} step={0.1} value={secs(o.startMs)} onChange={e => onChange({ startMs: Number(e.target.value) * 1000 })} /></label>
      <label>Dura (s)<input type="number" aria-label="Duración de la superposición" min={0.1} step={0.1} value={secs(o.durationMs)} onChange={e => onChange({ durationMs: Number(e.target.value) * 1000 })} /></label>
      {isVideo && <label>Inicio en el vídeo (s)<input type="number" min={0} step={0.1} value={secs(o.trimInMs)} onChange={e => onChange({ trimInMs: Number(e.target.value) * 1000 })} /></label>}
    </div>
    <div className="pageActions">
      <button type="button" className="ghost" onClick={onDuplicate}>Duplicar</button>
      <button type="button" className="ghost" onClick={onDelete}>Eliminar</button>
    </div>
    </Section>
    <Section id="layer-transform" title="Posición y tamaño" defaultOpen>
    <div className="field-row">
      <label>Horizontal ({pct(now.x)} %)<input type="range" aria-label="Posición horizontal de la superposición" min={-0.5} max={1.5} step={0.01} value={now.x} onChange={e => setT({ x: Number(e.target.value) })} /></label>
      <label>Vertical ({pct(now.y)} %)<input type="range" aria-label="Posición vertical de la superposición" min={-0.5} max={1.5} step={0.01} value={now.y} onChange={e => setT({ y: Number(e.target.value) })} /></label>
      <label>Tamaño ({pct(now.scale)} %)<input type="range" aria-label="Tamaño de la superposición" min={0.05} max={2} step={0.01} value={now.scale} onChange={e => setT({ scale: Number(e.target.value) })} /></label>
      <label>Rotación ({Math.round(now.rotation)}°)<input type="range" aria-label="Rotación de la superposición" min={-180} max={180} step={1} value={now.rotation} onChange={e => setT({ rotation: Number(e.target.value) })} /></label>
      <label>Opacidad ({pct(now.opacity)} %)<input type="range" aria-label="Opacidad de la superposición" min={0} max={1} step={0.01} value={now.opacity} onChange={e => setT({ opacity: Number(e.target.value) })} /></label>
    </div>
    <div className="pageActions">
      <button type="button" className="ghost small" onClick={() => setT({ x: 0.5, y: 0.5, scale: 1, rotation: 0 })}>Pantalla completa</button>
      <button type="button" className="ghost small" onClick={() => setT({ x: 0.8, y: 0.78, scale: 0.3, rotation: 0 })}>Esquina (PiP)</button>
      <button type="button" className="ghost small" onClick={() => setT({ x: 0.5, y: 0.5 })}>Centrar</button>
    </div>
    </Section>
    <Section id="layer-anim" title="Animación y movimiento" defaultOpen={(o.keyframes?.length ?? 0) > 0}>
    {animation}
    <div className="field-row">
      <label>Movimiento (Ken Burns)<select value={o.camera?.kind ?? 'none'} onChange={e => onChange({ camera: e.target.value === 'none' ? null : { kind: e.target.value as CameraKind, amount: o.camera?.amount ?? 0.12 } })}>{(Object.keys(CAMERA_MOVES) as CameraKind[]).map(k => <option key={k} value={k}>{CAMERA_MOVES[k]}</option>)}</select></label>
      <label>Entrada gradual (s)<input type="number" min={0} max={10} step={0.1} value={secs(o.fadeInMs ?? 0)} onChange={e => onChange({ fadeInMs: Math.max(0, Number(e.target.value) * 1000) || undefined })} /></label>
      <label>Salida gradual (s)<input type="number" min={0} max={10} step={0.1} value={secs(o.fadeOutMs ?? 0)} onChange={e => onChange({ fadeOutMs: Math.max(0, Number(e.target.value) * 1000) || undefined })} /></label>
    </div>
    </Section>
    {isVideo && <Section id="layer-sound" title="Velocidad y sonido" defaultOpen>
    <div className="field-row">
      <label>Velocidad<select value={String(o.speed ?? 1)} onChange={e => { const v = Number(e.target.value); onChange({ speed: v, durationMs: o.durationMs * (o.speed ?? 1) / v }) }}>{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(v => <option key={v} value={String(v)}>{v}×</option>)}</select></label>
      <label>Volumen ({pct(o.volume ?? 1)} %)<input type="range" min={0} max={2} step={0.05} value={o.volume ?? 1} onChange={e => onChange({ volume: Number(e.target.value) })} /></label>
      <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={o.muted === true} onChange={e => onChange({ muted: e.target.checked })} /> Silenciar</label>
    </div>
    </Section>}
    <Section id="layer-color" title="Color y efectos" defaultOpen={!!o.filters || !!o.crop}>
    <VisualFields bare filters={o.filters} crop={o.crop} onChange={p => onChange(p as Partial<OverlayClip>)} label="Capa" />
    </Section>
  </>
}

/**
 * Everything about the transition out of a clip, beyond its type and length: direction, intensity, easing, preview, copy/paste,
 * remove, apply to the other selected cuts, and favourites saved in the account (usable in every montage).
 */
export function TransitionTools({ clip, defaultMs, onChange, canPaste, onCopy, onPaste, onPreview, others, onApplyToOthers, presets, onSavePreset, onDeletePreset, bare = false, cuts = 0, onApplyToAll, live }: {
  clip: Clip; defaultMs: number; bare?: boolean
  onChange: (p: Partial<Clip>) => void
  canPaste: boolean; onCopy: () => void; onPaste: () => void; onPreview: () => void
  /** Other main clips selected (their cut gets the same transition). */
  others: number; onApplyToOthers: () => void
  /** Number of cuts in the montage and «apply to all of them». */
  cuts?: number; onApplyToAll?: () => void
  /** Live changes while dragging a slider (one undo step per drag). */
  live?: { begin: () => void; change: (p: Partial<Clip>) => void; end: () => void }
  presets: TransitionPreset[]; onSavePreset: (name: string) => void; onDeletePreset: (id: string) => void
}) {
  const [name, setName] = useState('')
  const kind = clip.transition ?? 'fade'
  const o = clip.transitionOpts ?? {}
  const setO = (p: Partial<TransitionOptions>) => onChange({ transitionOpts: { ...o, ...p } })
  return <Fold bare={bare} open={!!clip.transitionOpts || presets.length > 0} summary={<><b>Ajustes de la transición</b> <span className="muted">({TRANSITIONS[kind]}, {clip.transitionMs ?? defaultMs} ms)</span></>}>
    <div className="field-row" style={{ marginTop: 6 }}>
      {HAS_DIRECTION.has(kind) && <label>Dirección<select aria-label="Dirección de la transición" value={o.direction ?? (kind === 'slide_up' ? 'up' : kind === 'wipe_down' ? 'down' : kind === 'wipe' ? 'right' : 'left')} onChange={e => setO({ direction: e.target.value as TransitionDirection })}>{(Object.keys(DIRECTIONS) as TransitionDirection[]).map(d => <option key={d} value={d}>{DIRECTIONS[d]}</option>)}</select></label>}
      {HAS_INTENSITY.has(kind) && <SliderField label="Intensidad" ariaLabel="Intensidad de la transición" value={Math.round((o.intensity ?? 1) * 100)} min={20} max={300} step={5} unit="%" decimals={0}
        onChange={v => setO({ intensity: v / 100 })} drag={live && { begin: live.begin, live: v => live.change({ transitionOpts: { ...o, intensity: v / 100 } }), end: live.end }} />}
      {kind !== 'cut' && <label>Curva<select aria-label="Curva de la transición" value={o.easing ?? 'smooth'} onChange={e => setO({ easing: e.target.value as TransitionEasing })}>{(Object.keys(EASINGS) as TransitionEasing[]).map(k => <option key={k} value={k}>{EASINGS[k]}</option>)}</select></label>}
    </div>
    <div className="pageActions">
      <button type="button" className="ghost small" onClick={onPreview} disabled={kind === 'cut'}>▶ Ver la transición</button>
      <button type="button" className="ghost small" onClick={onCopy}>Copiar transición</button>
      <button type="button" className="ghost small" onClick={onPaste} disabled={!canPaste}>Pegar transición</button>
      <button type="button" className="ghost small" onClick={() => onChange({ transition: 'cut', transitionOpts: undefined, transitionMs: undefined })} disabled={kind === 'cut'}>Quitar transición</button>
      {others > 0 && <button type="button" className="ghost small" onClick={onApplyToOthers}>Aplicar a los {others} cortes seleccionados</button>}
      {onApplyToAll && cuts > 1 && <button type="button" className="ghost small" onClick={onApplyToAll}>Aplicar a todos los cortes ({cuts})</button>}
    </div>
    <div className="field-row" style={{ alignItems: 'end' }}>
      <label>Guardar como favorita<input aria-label="Nombre de la transición favorita" value={name} maxLength={40} placeholder="p. ej. Disolvencia lenta" onChange={e => setName(e.target.value)} /></label>
      <button type="button" className="ghost small" disabled={!name.trim() || kind === 'cut'} onClick={() => { onSavePreset(name.trim()); setName('') }}>Guardar</button>
    </div>
    {presets.length > 0 && <div className="pageActions" role="group" aria-label="Transiciones favoritas">
      {presets.map(p => <span key={p.id} className="pill small"><button type="button" className="ghost small" onClick={() => onChange({ transition: p.transition, transitionMs: p.ms, transitionOpts: Object.keys(p.opts).length ? p.opts : undefined })} title={`${TRANSITIONS[p.transition]} · ${p.ms} ms`}>★ {p.name}</button><button type="button" className="ghost small" aria-label={`Borrar la favorita ${p.name}`} onClick={() => onDeletePreset(p.id)}>✕</button></span>)}
    </div>}
  </Fold>
}

export type AnimProp = { key: string; label: string; min: number; max: number; step: number; show: (v: number) => string }
export const LAYER_PROPS: AnimProp[] = [
  { key: 'x', label: 'Horizontal', min: -0.5, max: 1.5, step: 0.01, show: v => `${Math.round(v * 100)} %` },
  { key: 'y', label: 'Vertical', min: -0.5, max: 1.5, step: 0.01, show: v => `${Math.round(v * 100)} %` },
  { key: 'scale', label: 'Tamaño', min: 0.02, max: 4, step: 0.01, show: v => `${Math.round(v * 100)} %` },
  { key: 'rotation', label: 'Rotación', min: -720, max: 720, step: 1, show: v => `${Math.round(v)}°` },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, show: v => `${Math.round(v * 100)} %` },
]
export const CLIP_PROPS: AnimProp[] = [
  { key: 'zoom', label: 'Zoom', min: 0.2, max: 5, step: 0.01, show: v => `${v.toFixed(2)}×` },
  { key: 'focusX', label: 'Encuadre horizontal', min: 0, max: 1, step: 0.01, show: v => `${Math.round(v * 100)} %` },
  { key: 'focusY', label: 'Encuadre vertical', min: 0, max: 1, step: 0.01, show: v => `${Math.round(v * 100)} %` },
  { key: 'rotation', label: 'Rotación', min: -720, max: 720, step: 1, show: v => `${Math.round(v)}°` },
  { key: 'opacity', label: 'Opacidad', min: 0, max: 1, step: 0.01, show: v => `${Math.round(v * 100)} %` },
]
export const KEY_EASINGS: Record<KeyEasing, string> = { smooth: 'Suave', linear: 'Lineal', in: 'Acelera', out: 'Frena', hold: 'Salto (sin transición)' }
type AnyKey = { atMs: number; easing?: KeyEasing } & Record<string, number | string | undefined>

/**
 * Keyframes of a clip or layer: add one at the playhead with the current values, edit time / values / curve of each, remove,
 * copy and paste to another clip, apply ready-made movements (smooth moves on still photos for lo-fi videos) and save your own.
 */
export function KeyframeEditor({ title, props, keys, current, localMs, durationMs, inside, onKeys, canPaste, onCopy, onPaste, presets, onApplyPreset, onSavePreset, onDeletePreset, bare = false }: {
  title: string; props: AnimProp[]; bare?: boolean
  keys: AnyKey[] | undefined; current: Record<string, number>; localMs: number; durationMs: number; inside: boolean
  onKeys: (next: AnyKey[] | undefined) => void
  canPaste: boolean; onCopy: () => void; onPaste: () => void
  presets: AnimationPreset[]; onApplyPreset: (p: AnimationPreset) => void; onSavePreset: (name: string) => void; onDeletePreset: (id: string) => void
}) {
  const [name, setName] = useState('')
  const list = keys ?? []
  const setKey = (i: number, patch: Partial<AnyKey>) => onKeys(list.map((k, n) => (n === i ? cleanKey({ ...k, ...patch }) : k)).sort((a, b) => a.atMs - b.atMs))
  const addHere = () => {
    const at = Math.round(Math.min(Math.max(localMs, 0), durationMs))
    const rest = list.filter(k => Math.abs(k.atMs - at) > 20)
    onKeys([...rest, { atMs: at, ...Object.fromEntries(props.map(p => [p.key, Math.round(current[p.key] * 1000) / 1000])) }].sort((a, b) => a.atMs - b.atMs))
  }
  return <Fold bare={bare} open={list.length > 0} summary={<><b>{title}</b> {list.length ? `(${list.length} fotogramas clave)` : ''}</>}>
    <p className="muted">Pon el cabezal donde quieras, ajusta los valores (aquí o en el visor) y pulsa «Fotograma clave». Entre dos fotogramas clave los valores cambian con la curva del segundo. Son efectos de edición: mueven, escalan, giran o atenúan la imagen entera; no animan objetos dentro de una foto.</p>
    <div className="pageActions">
      <button type="button" className="ghost small" disabled={!inside} onClick={addHere}>◆ Fotograma clave en el cabezal ({Math.round(localMs / 100) / 10} s)</button>
      <button type="button" className="ghost small" disabled={!list.length} onClick={onCopy}>Copiar animación</button>
      <button type="button" className="ghost small" disabled={!canPaste} onClick={onPaste}>Pegar animación</button>
      {list.length > 0 && <button type="button" className="ghost small" onClick={() => onKeys(undefined)}>Quitar todos</button>}
    </div>
    {list.length > 0 && <div className="tableWrap"><table className="table small" aria-label={`Fotogramas clave de ${title}`}><thead><tr><th>Tiempo (s)</th>{props.map(p => <th key={p.key}>{p.label}</th>)}<th>Curva</th><th /></tr></thead><tbody>
      {list.map((k, i) => <tr key={`${k.atMs}-${i}`}>
        <td><input type="number" aria-label={`Tiempo del fotograma clave ${i + 1}`} min={0} max={durationMs / 1000} step={0.1} defaultValue={Math.round(k.atMs / 100) / 10} onBlur={e => setKey(i, { atMs: Math.round(Math.min(durationMs, Math.max(0, Number(e.target.value) * 1000))) })} style={{ width: 64 }} /></td>
        {props.map(p => <td key={p.key}><input type="number" aria-label={`${p.label} del fotograma clave ${i + 1}`} min={p.min} max={p.max} step={p.step} defaultValue={k[p.key] === undefined ? '' : String(k[p.key])} placeholder="—" onBlur={e => setKey(i, { [p.key]: e.target.value === '' ? undefined : Math.min(p.max, Math.max(p.min, Number(e.target.value))) })} style={{ width: 70 }} /></td>)}
        <td><select aria-label={`Curva del fotograma clave ${i + 1}`} value={k.easing ?? 'smooth'} onChange={e => setKey(i, { easing: e.target.value === 'smooth' ? undefined : e.target.value as KeyEasing })}>{(Object.keys(KEY_EASINGS) as KeyEasing[]).map(x => <option key={x} value={x}>{KEY_EASINGS[x]}</option>)}</select></td>
        <td><button type="button" className="ghost small" aria-label={`Quitar el fotograma clave ${i + 1}`} onClick={() => onKeys(list.filter((_, n) => n !== i))}>✕</button></td>
      </tr>)}
    </tbody></table></div>}
    {presets.length > 0 && <div className="pageActions" role="group" aria-label={`Movimientos para ${title}`}>
      {presets.map(p => <span key={p.id} className="pill small"><button type="button" className="ghost small" onClick={() => onApplyPreset(p)}>{p.id.startsWith('b-') ? '' : '★ '}{p.name}</button>{!p.id.startsWith('b-') && <button type="button" className="ghost small" aria-label={`Borrar la animación ${p.name}`} onClick={() => onDeletePreset(p.id)}>✕</button>}</span>)}
    </div>}
    <div className="field-row" style={{ alignItems: 'end' }}>
      <label>Guardar esta animación<input aria-label="Nombre de la animación" value={name} maxLength={40} placeholder="p. ej. Zoom lofi" onChange={e => setName(e.target.value)} /></label>
      <button type="button" className="ghost small" disabled={!name.trim() || !list.length} onClick={() => { onSavePreset(name.trim()); setName('') }}>Guardar</button>
    </div>
  </Fold>
}
const cleanKey = (k: AnyKey): AnyKey => Object.fromEntries(Object.entries(k).filter(([, v]) => v !== undefined)) as AnyKey

export type SliderDrag = { begin: () => void; live: (v: number) => void; end: () => void }
/**
 * A slider with its value written beside it (editable for an exact value) and its unit.
 * Dragging is one undo step (`drag`); typing a value is another. The range comes from the real limits of what it changes.
 */
export function SliderField({ label, value, min, max, step, unit, show, onChange, drag, ariaLabel, decimals = 2 }: {
  label: string; value: number; min: number; max: number; step: number; unit: string
  /** How the value is written for people (e.g. «1,50 s»). */
  show?: (v: number) => string
  onChange: (v: number) => void; drag?: SliderDrag; ariaLabel?: string; decimals?: number
}) {
  const clampV = (v: number) => Math.min(max, Math.max(min, v))
  const dragging = useRef(false)
  const startDrag = () => { if (drag && !dragging.current) { dragging.current = true; drag.begin() } }
  const stopDrag = () => { if (drag && dragging.current) { dragging.current = false; drag.end() } }
  const name = ariaLabel ?? label
  return <div className="sliderField" role="group" aria-label={label}>
    <span className="sliderLabel">{label} <b>{show ? show(value) : `${value.toLocaleString('es-ES', { maximumFractionDigits: decimals })} ${unit}`}</b></span>
    <span className="sliderRow">
      <input type="range" aria-label={`${name} (deslizador)`} min={min} max={max} step={step} value={clampV(value)} aria-valuetext={show ? show(value) : `${value} ${unit}`}
        onPointerDown={startDrag} onPointerUp={stopDrag} onKeyDown={e => { if (/^(Arrow|Page|Home|End)/.test(e.key) && !e.ctrlKey && !e.metaKey) startDrag() }} onKeyUp={stopDrag} onBlur={stopDrag}
        onChange={e => { const v = clampV(Number(e.target.value)); if (drag && dragging.current) drag.live(v); else onChange(v) }} />
      <input type="number" aria-label={name} min={min} max={max} step={step} value={Number(value.toFixed(decimals))}
        onChange={e => { if (e.target.value === '') return; onChange(clampV(Number(e.target.value))) }} style={{ width: 72 }} />
      <span className="muted small">{unit}</span>
    </span>
  </div>
}
