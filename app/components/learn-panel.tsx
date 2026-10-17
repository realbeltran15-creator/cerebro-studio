'use client'

import { useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Composition } from '@/lib/editor/composition'
import { applyStyle, describeChange, learnStyle, mergeStyles, type EditStyle, type VisualKind } from '@/lib/editor/style'
import { loadStyles, saveStyles } from '@/lib/editor/styles-store'

/**
 * "Aprende de mí": records what the owner does in the editor, turns it into a reusable style,
 * and applies that style to other edits in one click (undoable). It replays measured habits —
 * it does not invent content or decide creatively.
 */
export function LearnPanel({ composition, kindOf, onApply }: { composition: Composition; kindOf: (id: string | null) => VisualKind; onApply: (next: Composition, changes: string[]) => void }) {
  const supabase = getSupabaseBrowserClient()
  const [styles, setStyles] = useState<EditStyle[]>([])
  const [recording, setRecording] = useState(false)
  const [log, setLog] = useState<Array<{ at: number; what: string }>>([])
  const [learned, setLearned] = useState<EditStyle | null>(null)
  const [name, setName] = useState('Mi estilo')
  const [target, setTarget] = useState('')
  const [chosen, setChosen] = useState('')
  const [msg, setMsg] = useState('')
  const start = useRef<Composition | null>(null)
  const last = useRef<Composition>(composition)

  useEffect(() => { void loadStyles(supabase).then(s => { setStyles(s); setChosen(s[0]?.name ?? '') }) }, [supabase])

  useEffect(() => {
    if (recording && composition !== last.current) {
      const what = describeChange(last.current, composition)
      if (what) setLog(l => [...l.slice(-49), { at: Date.now(), what }])
    }
    last.current = composition
  }, [composition, recording])

  function startRec() { start.current = composition; last.current = composition; setLog([]); setLearned(null); setMsg(''); setRecording(true) }
  function stopRec() {
    setRecording(false)
    if (!start.current) return
    const s = learnStyle(start.current, composition, kindOf, name)
    setLearned(s); setTarget(styles[0]?.name ?? '')
  }

  async function keep(mode: 'new' | 'merge') {
    if (!learned) return
    try {
      const next = mode === 'merge' && target
        ? styles.map(s => (s.name === target ? mergeStyles(s, learned) : s))
        : [{ ...learned, name: name.trim() || 'Mi estilo' }, ...styles.filter(s => s.name !== (name.trim() || 'Mi estilo'))]
      await saveStyles(supabase, next)
      setStyles(next); setChosen(mode === 'merge' ? target : name.trim() || 'Mi estilo'); setLearned(null)
      setMsg(mode === 'merge' ? `Aprendido: «${target}» ya suma ${next.find(s => s.name === target)?.samples} sesiones.` : 'Estilo guardado en tu cuenta.')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'No se pudo guardar.') }
  }

  async function remove(n: string) {
    const next = styles.filter(s => s.name !== n)
    try { await saveStyles(supabase, next); setStyles(next); setChosen(next[0]?.name ?? '') } catch (e) { setMsg(e instanceof Error ? e.message : 'No se pudo borrar.') }
  }

  function applyChosen() {
    const s = styles.find(x => x.name === chosen)
    if (!s) return
    const r = applyStyle(composition, s, kindOf)
    onApply(r.composition, r.changes)
  }

  const current = styles.find(s => s.name === chosen)
  return <section className="panel" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Aprende de mí">
    <div className="cardHead" style={{ marginBottom: 0 }}><h3>Aprende de mí</h3>{recording ? <span className="pill warn">● Grabando · {log.length} acciones</span> : <span className="pill">{styles.length} estilos</span>}</div>
    <p className="muted small">Pulsa grabar, edita como siempre y termina: Cerebro mide lo que haces (duración de los cortes, transiciones, zoom, textos, volúmenes, efectos en los cortes) y lo repite igual en otros montajes. Graba varias sesiones en el mismo estilo para afinarlo.</p>
    <div className="pageActions">
      {!recording ? <button type="button" onClick={startRec}>● Grabar mi forma de editar</button> : <button type="button" onClick={stopRec}>■ Terminar y aprender</button>}
      {recording && log.length > 0 && <span className="muted small">Último: {log[log.length - 1].what}</span>}
    </div>

    {learned && <div className="panel" style={{ background: 'transparent' }}>
      <b>Esto es lo que he visto:</b>
      <ul className="small" style={{ margin: '6px 0 8px 18px' }}>{learned.observations.map(o => <li key={o}>{o}</li>)}</ul>
      <div className="field-row" style={{ alignItems: 'end' }}>
        <label>Nombre del estilo<input value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
        <button type="button" onClick={() => void keep('new')}>Guardar como estilo</button>
        {styles.length > 0 && <><label>o sumar a<select value={target} onChange={e => setTarget(e.target.value)}>{styles.map(s => <option key={s.name}>{s.name}</option>)}</select></label>
          <button type="button" className="ghost" onClick={() => void keep('merge')}>Sumar sesión</button></>}
        <button type="button" className="ghost" onClick={() => setLearned(null)}>Descartar</button>
      </div>
    </div>}

    {styles.length > 0 && <div className="field-row" style={{ alignItems: 'end' }}>
      <label>Estilo<select value={chosen} onChange={e => setChosen(e.target.value)}>{styles.map(s => <option key={s.name} value={s.name}>{s.name} · {s.samples} sesión{s.samples === 1 ? '' : 'es'}</option>)}</select></label>
      <button type="button" disabled={!current || recording} onClick={applyChosen}>Aplicar a este montaje</button>
      <button type="button" className="ghost" disabled={!current} onClick={() => current && void remove(current.name)}>Borrar estilo</button>
    </div>}
    {current && <details className="small"><summary>Qué hace «{current.name}»</summary><ul style={{ margin: '6px 0 0 18px' }}>{current.observations.map(o => <li key={o}>{o}</li>)}</ul></details>}
    {msg && <p className="notice small" role="status">{msg}</p>}
  </section>
}
