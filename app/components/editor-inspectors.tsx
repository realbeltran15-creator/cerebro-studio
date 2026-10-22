'use client'

import { CAMERA_MOVES, FILTER_PRESETS, NO_FILTERS, type CameraKind, type Composition, type Crop, type Filters, type OverlayClip } from '@/lib/editor/composition'
import { assetLabel, type EditorAsset } from '@/lib/editor/client'
import { transformAt } from '@/lib/editor/motion'
import { removeKeyframe, setKeyframe } from '@/lib/editor/tracks'
import { canvasFiltersSupported } from '@/lib/editor/draw'

const secs = (ms: number) => Math.round(ms / 100) / 10
const pct = (n: number) => Math.round(n * 100)

/** Picture adjustments shared by main clips and overlays: filter presets, brightness/contrast/saturation/blur, crop, rotation, opacity. */
export function VisualFields({ filters, crop, rotation, opacity, onChange, label = 'Imagen' }: {
  filters: Filters | null | undefined; crop: Crop | null | undefined; rotation?: number; opacity?: number
  onChange: (p: { filters?: Filters | null; crop?: Crop | null; rotation?: number; opacity?: number }) => void
  label?: string
}) {
  const f = filters ?? NO_FILTERS
  const c = crop ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const setF = (p: Partial<Filters>) => { const n = { ...f, ...p }; onChange({ filters: n.brightness === 1 && n.contrast === 1 && n.saturation === 1 && n.blur === 0 ? null : n }) }
  const setC = (p: Partial<Crop>) => { const n = { ...c, ...p }; onChange({ crop: n.left || n.top || n.right || n.bottom ? n : null }) }
  const preset = Object.entries(FILTER_PRESETS).find(([, v]) => JSON.stringify(v.f) === JSON.stringify(f))?.[0] ?? ''
  return <details className="small" open={!!filters || !!crop || !!rotation || (opacity !== undefined && opacity < 1)}>
    <summary><b>{label}: filtros, recorte, rotación y opacidad</b></summary>
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
  </details>
}

/** A layer above the main track: picture, timing, position/size/rotation/opacity, keyframes, Ken Burns, fades, sound, filters and crop. */
export function OverlayInspector({ o, visuals, isVideo, playheadMs, onChange, apply, onDelete, onDuplicate }: {
  o: OverlayClip; visuals: EditorAsset[]; isVideo: boolean; playheadMs: number
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
    <label>Imagen o vídeo<select aria-label="Material de la superposición" value={o.assetId} onChange={e => onChange({ assetId: e.target.value, trimInMs: 0 })}>{visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select></label>
    <div className="field-row">
      <label>Aparece en (s)<input type="number" aria-label="Inicio de la superposición" min={0} step={0.1} value={secs(o.startMs)} onChange={e => onChange({ startMs: Number(e.target.value) * 1000 })} /></label>
      <label>Dura (s)<input type="number" aria-label="Duración de la superposición" min={0.1} step={0.1} value={secs(o.durationMs)} onChange={e => onChange({ durationMs: Number(e.target.value) * 1000 })} /></label>
      {isVideo && <label>Inicio en el vídeo (s)<input type="number" min={0} step={0.1} value={secs(o.trimInMs)} onChange={e => onChange({ trimInMs: Number(e.target.value) * 1000 })} /></label>}
    </div>
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
    <details className="small" open={keyed}>
      <summary><b>Animación con fotogramas clave</b> {keyed ? `(${o.keyframes!.length})` : ''}</summary>
      <p className="muted">Coloca el cabezal, pon la capa como la quieres y pulsa «Fotograma clave». Entre dos fotogramas clave la posición, el tamaño, la rotación y la opacidad cambian suavemente.</p>
      <div className="pageActions">
        <button type="button" className="ghost small" disabled={!inside} onClick={() => apply(c => setKeyframe(c, o.id, local, now))}>◆ Fotograma clave en el cabezal ({secs(local)} s)</button>
        {keyed && <button type="button" className="ghost small" onClick={() => onChange({ keyframes: undefined })}>Quitar todos</button>}
      </div>
      {keyed && <ul className="plainList">{o.keyframes!.map(k => <li key={k.atMs}>◆ {secs(k.atMs)} s · {k.x !== undefined ? `x ${pct(k.x)} % ` : ''}{k.y !== undefined ? `y ${pct(k.y)} % ` : ''}{k.scale !== undefined ? `tamaño ${pct(k.scale)} % ` : ''}{k.rotation !== undefined ? `${Math.round(k.rotation)}° ` : ''}{k.opacity !== undefined ? `opacidad ${pct(k.opacity)} %` : ''}
        <button type="button" className="ghost small" aria-label={`Quitar fotograma clave de ${secs(k.atMs)} s`} onClick={() => apply(c => removeKeyframe(c, o.id, k.atMs))}>✕</button></li>)}</ul>}
    </details>
    <div className="field-row">
      <label>Movimiento (Ken Burns)<select value={o.camera?.kind ?? 'none'} onChange={e => onChange({ camera: e.target.value === 'none' ? null : { kind: e.target.value as CameraKind, amount: o.camera?.amount ?? 0.12 } })}>{(Object.keys(CAMERA_MOVES) as CameraKind[]).map(k => <option key={k} value={k}>{CAMERA_MOVES[k]}</option>)}</select></label>
      <label>Entrada gradual (s)<input type="number" min={0} max={10} step={0.1} value={secs(o.fadeInMs ?? 0)} onChange={e => onChange({ fadeInMs: Math.max(0, Number(e.target.value) * 1000) || undefined })} /></label>
      <label>Salida gradual (s)<input type="number" min={0} max={10} step={0.1} value={secs(o.fadeOutMs ?? 0)} onChange={e => onChange({ fadeOutMs: Math.max(0, Number(e.target.value) * 1000) || undefined })} /></label>
    </div>
    {isVideo && <div className="field-row">
      <label>Velocidad<select value={String(o.speed ?? 1)} onChange={e => { const v = Number(e.target.value); onChange({ speed: v, durationMs: o.durationMs * (o.speed ?? 1) / v }) }}>{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(v => <option key={v} value={String(v)}>{v}×</option>)}</select></label>
      <label>Volumen ({pct(o.volume ?? 1)} %)<input type="range" min={0} max={2} step={0.05} value={o.volume ?? 1} onChange={e => onChange({ volume: Number(e.target.value) })} /></label>
      <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={o.muted === true} onChange={e => onChange({ muted: e.target.checked })} /> Silenciar</label>
    </div>}
    <VisualFields filters={o.filters} crop={o.crop} onChange={p => onChange(p as Partial<OverlayClip>)} label="Capa" />
    <div className="pageActions">
      <button type="button" className="ghost" onClick={onDuplicate}>Duplicar</button>
      <button type="button" className="ghost" onClick={onDelete}>Eliminar</button>
    </div>
  </>
}
