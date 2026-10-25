'use client'
import { useDeferredValue, useMemo, useState } from 'react'
import { MAX_TIMELINE_MS, TRANSITIONS, totalDurationMs, type Composition, type Transition, type TransitionAlign } from '@/lib/editor/composition'
import { ALIGNS, type MediaKindOf } from '@/lib/editor/transition-window'
import { cutsOf, describePlan, planBatchTransitions, selectedCutClipIds, type BatchOptions, type CutScope, type FailurePolicy, type TransitionSettings } from '@/lib/editor/batch-transitions'
import { fmt, maxRepeats, planRepeat, type RepeatRequest } from '@/lib/editor/repeat'

const shell = { position: 'fixed' as const, right: 12, top: 72, zIndex: 80, width: 'min(560px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 90px)', overflow: 'auto' as const, boxShadow: '0 18px 40px #000a' }
const MIN = 60_000

/** One transition configuration, shared by the repetition dialog and the bulk-transition dialog. */
function SettingsForm({ s, onChange, idp }: { s: TransitionSettings; onChange: (s: TransitionSettings) => void; idp: string }) {
  const set = (p: Partial<TransitionSettings>) => onChange({ ...s, ...p })
  return <div className="field-row" style={{ flexWrap: 'wrap' }}>
    <label>Tipo<select aria-label="Tipo de transición en lote" value={s.transition} onChange={e => set({ transition: e.target.value as Transition })}>
      {(Object.keys(TRANSITIONS) as Transition[]).filter(t => t !== 'cut').map(t => <option key={t} value={t}>{TRANSITIONS[t]}</option>)}</select></label>
    <label>Duración (s)<input id={`${idp}-ms`} type="number" min={0.1} max={10} step={0.1} aria-label="Duración de la transición en lote" value={s.ms / 1000} onChange={e => set({ ms: Math.round(Math.min(10, Math.max(0.1, Number(e.target.value) || 1)) * 1000) })} /></label>
    <label>Alineación<select aria-label="Alineación de la transición en lote" value={s.align} onChange={e => set({ align: e.target.value as TransitionAlign })}>{(Object.keys(ALIGNS) as TransitionAlign[]).map(a => <option key={a} value={a}>{ALIGNS[a]}</option>)}</select></label>
    <label>Intensidad<input type="number" min={0.1} max={3} step={0.1} aria-label="Intensidad de la transición en lote" value={s.intensity ?? 1} onChange={e => set({ intensity: Math.min(3, Math.max(0.1, Number(e.target.value) || 1)) })} /></label>
    <label>Dirección<select aria-label="Dirección de la transición en lote" value={s.direction ?? ''} onChange={e => set({ direction: (e.target.value || undefined) as TransitionSettings['direction'] })}><option value="">Automática</option><option value="left">Izquierda</option><option value="right">Derecha</option><option value="up">Arriba</option><option value="down">Abajo</option></select></label>
    <label>Curva<select aria-label="Curva de la transición en lote" value={s.easing ?? 'smooth'} onChange={e => set({ easing: e.target.value as TransitionSettings['easing'] })}><option value="smooth">Suave</option><option value="linear">Lineal</option><option value="in">Acelera</option><option value="out">Frena</option></select></label>
  </div>
}
const DEFAULT_SETTINGS: TransitionSettings = { transition: 'dissolve', ms: 1000, align: 'center', easing: 'linear' }

function Policy({ allowTrim, setAllowTrim, onFail, setOnFail }: { allowTrim: boolean; setAllowTrim: (v: boolean) => void; onFail: FailurePolicy; setOnFail: (v: FailurePolicy) => void }) {
  return <div className="small" style={{ display: 'grid', gap: 4 }}>
    <label className="pill small"><input type="checkbox" checked={allowTrim} onChange={e => setAllowTrim(e.target.checked)} /> Recortar los extremos de los clips cuando falte material (así los dos vídeos se mueven; se muestra cuánto antes de confirmar)</label>
    <label>Si un corte no admite esa duración sin congelar un fotograma
      <select aria-label="Qué hacer con los cortes que no caben" value={onFail} onChange={e => setOnFail(e.target.value as FailurePolicy)}><option value="reduce">Usar la transición más larga que quepa</option><option value="cut">Dejar ese corte sin transición</option></select></label>
  </div>
}

/** A strip that shows the first and last repetitions and how the cuts with transitions are spread. */
function Strip({ comp, ids, joined }: { comp: Composition; ids: string[]; joined: boolean }) {
  const set = new Set(ids)
  const idx: number[] = []
  comp.clips.forEach((k, i) => { if (set.has(k.id)) idx.push(i) })
  const first = idx.length ? Math.max(0, idx[0] - 1) : 0, last = idx.length ? idx[idx.length - 1] : 0
  const n = last - first + 1, shown = Math.min(n, 48), step = n / shown
  return <div aria-label="Vista previa de la secuencia" role="img" style={{ display: 'flex', height: 22, borderRadius: 4, overflow: 'hidden', border: '1px solid #3a3f55' }}>
    {Array.from({ length: shown }, (_, j) => { const k = comp.clips[first + Math.floor(j * step)]; return <span key={j} title={`Repetición ${Math.floor(j * step) + 1}`} style={{ flex: 1, background: j % 2 ? '#4a5aa8' : '#5d6fc4', borderRight: joined && k?.transition && k.transition !== 'cut' ? '2px solid #b49cff' : '1px solid #1b1e2e' }} /> })}
  </div>
}

export function RepeatDialog({ comp, clipId, kindOf, onApply, onClose }: { comp: Composition; clipId: string; kindOf: MediaKindOf; onApply: (next: Composition, message: string, ids: string[]) => void; onClose: () => void }) {
  const clip = comp.clips.find(k => k.id === clipId)
  const [mode, setMode] = useState<'count' | 'target'>('count')
  const [count, setCount] = useState(10)
  const [minutes, setMinutes] = useState(90)
  const [exact, setExact] = useState(true)
  const [join, setJoin] = useState(false)
  const [settings, setSettings] = useState<TransitionSettings>(DEFAULT_SETTINGS)
  const [allowTrim, setAllowTrim] = useState(true)
  const [onFail, setOnFail] = useState<FailurePolicy>('reduce')
  const req: RepeatRequest = useDeferredValue(mode === 'count' ? { mode: 'count', count } : { mode: 'target', targetMs: Math.round(minutes * MIN), exact })
  const tr = useDeferredValue(join ? { settings, allowTrim, onFail } : null)
  const cap = maxRepeats(comp, clipId)
  const plan = useMemo(() => (clip ? planRepeat(comp, clipId, req, tr, kindOf) : null), [comp, clipId, req, tr, kindOf, clip])
  if (!clip || !plan) return null
  const pending = !!clip.visualAssetId && kindOf(clip.visualAssetId) === 'video' && !clip.sourceDurationMs
  const lines = plan.plan ? describePlan(plan.plan, { action: 'apply', settings }).filter(l => !/duración del proyecto/i.test(l)) : []
  return <section className="panel" role="dialog" aria-label="Repetir el clip" style={shell} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
    <div className="cardHead" style={{ marginBottom: 6 }}><h3>Repetir el clip</h3><button type="button" className="ghost small" onClick={onClose} aria-label="Cerrar repetir">✕</button></div>
    <p className="small muted">Las repeticiones son clips independientes que usan el mismo archivo (no se copia ningún vídeo), así que cada una se puede editar sola. Ctrl+Z deshace todo de una vez.</p>
    <fieldset className="small" style={{ border: 0, padding: 0, margin: '6px 0' }}>
      <label className="pill small"><input type="radio" name="rp-mode" checked={mode === 'count'} onChange={() => setMode('count')} /> Repetir un número de veces</label>
      {mode === 'count' && <div className="field-row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        {[10, 100, 200, 300].map(n => <button key={n} type="button" className={count === n ? 'small' : 'ghost small'} onClick={() => setCount(n)}>×{n}</button>)}
        <label>Veces en total (el original cuenta como la primera)<input type="number" min={1} max={cap} aria-label="Veces en total" value={count} onChange={e => setCount(Math.min(cap, Math.max(1, Math.floor(Number(e.target.value) || 1))))} /></label>
      </div>}
      <label className="pill small"><input type="radio" name="rp-mode" checked={mode === 'target'} onChange={() => setMode('target')} /> Repetir hasta alcanzar una duración</label>
      {mode === 'target' && <div className="field-row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        {[60, 90, 120, 180, 300].map(m => <button key={m} type="button" className={minutes === m ? 'small' : 'ghost small'} onClick={() => setMinutes(m)}>{m} min</button>)}
        <label>Personalizada (min)<input type="number" min={1} max={MAX_TIMELINE_MS / MIN} aria-label="Duración objetivo en minutos" value={minutes} onChange={e => setMinutes(Math.min(MAX_TIMELINE_MS / MIN, Math.max(1, Number(e.target.value) || 1)))} /></label>
        <label className="pill small"><input type="checkbox" checked={exact} onChange={e => setExact(e.target.checked)} /> Ajustar el último clip a la duración exacta (sin tocar la transición)</label>
      </div>}
    </fieldset>
    <p className="small muted">Las copias se colocan seguidas, justo después del clip seleccionado.</p>
    <label className="pill small"><input type="checkbox" checked={join} onChange={e => setJoin(e.target.checked)} aria-label="Unir las repeticiones con una transición" /> Unir las repeticiones con una transición (en todos los cortes entre ellas)</label>
    {join && <><SettingsForm s={settings} onChange={setSettings} idp="rp" /><Policy allowTrim={allowTrim} setAllowTrim={setAllowTrim} onFail={onFail} setOnFail={setOnFail} /></>}
    <div className="panel" data-testid="repeat-preview" style={{ marginTop: 8, padding: 8, background: '#10131f' }} aria-live="polite">
      <b>Vista previa</b>
      <Strip comp={plan.composition} ids={plan.ids} joined={join} />
      <ul className="small" style={{ margin: '6px 0 0 16px' }}>
        <li>{plan.total} clips en total ({plan.total === 1 ? 'solo el original' : `el original + ${plan.total - 1} copias`}), todos con el mismo archivo.</li>
        <li>Duración del proyecto: {fmt(plan.beforeMs)} → <b>{fmt(plan.finalMs)}</b>{mode === 'target' ? ` (objetivo ${fmt(Math.round(minutes * MIN))})` : ''}.</li>
        {plan.adjustedMs > 0 && <li>El último clip se acorta {fmt(plan.adjustedMs)} para llegar a la duración exacta; no se corta ninguna transición.</li>}
        {lines.map((l, i) => <li key={i}>{l}</li>)}
        {plan.warnings.map((w, i) => <li key={`w${i}`} style={{ color: '#ffb000' }}>{w}</li>)}
      </ul>
    </div>
    {pending && join && <p className="small" style={{ color: '#ffb000' }} role="status">Midiendo la duración del archivo de vídeo… (hace falta para calcular el material de las transiciones).</p>}
    <div className="row" style={{ marginTop: 8, gap: 8 }}>
      <button type="button" disabled={!plan.ok || plan.total < 2 || (pending && join)} onClick={() => { onApply(plan.composition, `Repetido ${plan.total} veces: ${plan.total - 1} copias nuevas${plan.plan ? ` unidas con ${plan.plan.applied} transiciones` : ''}. El proyecto dura ${fmt(plan.finalMs)}. Ctrl+Z lo deshace todo.`, plan.ids); onClose() }}>Crear {plan.total} repeticiones</button>
      <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
    </div>
  </section>
}

export function BatchTransitionsDialog({ comp, selectedClipIds, selectedTransition, kindOf, onApply, onClose }: { comp: Composition; selectedClipIds: string[]; selectedTransition: string | null; kindOf: MediaKindOf; onApply: (next: Composition, message: string) => void; onClose: () => void }) {
  const cuts = Math.max(0, comp.clips.length - 1)
  const [action, setAction] = useState<'apply' | 'remove'>('apply')
  const [kind, setKind] = useState<CutScope['kind']>('all')
  const [from, setFrom] = useState(1), [to, setTo] = useState(Math.max(1, cuts))
  const [n, setN] = useState(5)
  const [settings, setSettings] = useState<TransitionSettings>(DEFAULT_SETTINGS)
  const [allowTrim, setAllowTrim] = useState(true)
  const [onFail, setOnFail] = useState<FailurePolicy>('reduce')
  const selIds = useMemo(() => selectedCutClipIds(comp, selectedClipIds, selectedTransition), [comp, selectedClipIds, selectedTransition])
  const scope: CutScope = kind === 'all' ? { kind } : kind === 'selected' ? { kind, clipIds: selIds } : kind === 'range' ? { kind, from, to } : { kind: 'every', n, from, to }
  const dScope = useDeferredValue(scope), dSettings = useDeferredValue(settings)
  const opts: BatchOptions = { action, settings: dSettings, allowTrim, onFail }
  const plan = useMemo(() => planBatchTransitions(comp, dScope, opts, kindOf), [comp, JSON.stringify(dScope), JSON.stringify(opts), kindOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = describePlan(plan, opts)
  const pending = action === 'apply' && plan.chosen.some(i => { const k = comp.clips[i]; return !!k.visualAssetId && kindOf(k.visualAssetId) === 'video' && !k.sourceDurationMs })
  const num = (v: number, set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Math.min(Math.max(1, cuts), Math.max(1, Math.floor(Number(e.target.value) || 1))))
  return <section className="panel" role="dialog" aria-label="Transiciones en lote" style={shell} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
    <div className="cardHead" style={{ marginBottom: 6 }}><h3>Transiciones en lote</h3><button type="button" className="ghost small" onClick={onClose} aria-label="Cerrar transiciones en lote">✕</button></div>
    <p className="small muted">Son las mismas transiciones reales entre dos clips (se mezclan fotogramas de los dos vídeos). Después puedes cambiar cualquiera sola. Nada se modifica hasta que confirmes.</p>
    <div className="field-row" style={{ flexWrap: 'wrap' }}>
      <label>Acción<select aria-label="Acción en lote" value={action} onChange={e => setAction(e.target.value as 'apply' | 'remove')}><option value="apply">Aplicar esta transición</option><option value="remove">Quitar transiciones (corte directo)</option></select></label>
      <label>Dónde<select aria-label="Cortes afectados" value={kind} onChange={e => setKind(e.target.value as CutScope['kind'])}>
        <option value="all">Todos los cortes de la pista ({cuts})</option><option value="selected">Solo los cortes seleccionados ({selIds.length})</option><option value="range">Un rango de cortes</option><option value="every">Cada N cortes</option></select></label>
      {(kind === 'range' || kind === 'every') && <><label>Desde el corte<input type="number" min={1} max={cuts} aria-label="Desde el corte" value={from} onChange={num(from, setFrom)} /></label>
        <label>{kind === 'range' ? 'Hasta el corte' : 'Hasta el corte (opcional)'}<input type="number" min={1} max={cuts} aria-label="Hasta el corte" value={to} onChange={num(to, setTo)} /></label></>}
      {kind === 'every' && <label>Cada N<input type="number" min={1} aria-label="Cada N cortes" value={n} onChange={e => setN(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />{[5, 10].map(v => <button key={v} type="button" className="ghost small" onClick={() => setN(v)}>cada {v}</button>)}</label>}
    </div>
    {kind === 'selected' && selIds.length === 0 && <p className="small" style={{ color: '#ffb000' }}>Selecciona una transición (clic en su icono) o varios clips seguidos para elegir esos cortes.</p>}
    {action === 'apply' && <><SettingsForm s={settings} onChange={setSettings} idp="bt" /><Policy allowTrim={allowTrim} setAllowTrim={setAllowTrim} onFail={onFail} setOnFail={setOnFail} /></>}
    <div className="panel" data-testid="batch-preview" style={{ marginTop: 8, padding: 8, background: '#10131f' }} aria-live="polite">
      <b>Vista previa</b>
      <ul className="small" style={{ margin: '6px 0 0 16px' }}>{lines.map((l, i) => <li key={i} style={plan.needsDecision && i >= lines.length - 2 ? { color: '#ffb000' } : undefined}>{l}</li>)}</ul>
    </div>
    {pending && <p className="small" style={{ color: '#ffb000' }} role="status">Midiendo la duración de los archivos de vídeo… (hace falta para calcular el material de las transiciones).</p>}
    <div className="row" style={{ marginTop: 8, gap: 8 }}>
      <button type="button" disabled={pending || !plan.chosen.length || (action === 'apply' ? plan.applied === 0 : plan.removed === 0)} onClick={() => { onApply(plan.composition, `${action === 'apply' ? `Transición aplicada a ${plan.applied} cortes` : `Transición quitada de ${plan.removed} cortes`}. ${lines.slice(1).join(' ')} Ctrl+Z lo deshace todo.`); onClose() }}>{action === 'apply' ? `Aplicar a ${plan.applied} cortes` : `Quitar de ${plan.removed} cortes`}</button>
      <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
    </div>
  </section>
}

export { cutsOf, totalDurationMs }
