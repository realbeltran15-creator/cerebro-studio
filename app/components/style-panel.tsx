'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Composition } from '@/lib/editor/composition'
import { applyPatches, applyProfile, diffMontages, extractProfile, presetProfiles, profileDifferences, type Correction, type EditProfile, type VisualKind } from '@/lib/editor/profile'
import { loadProfiles, saveProfiles, type ProfilesState } from '@/lib/editor/profiles-store'

/**
 * Estilos de edición inside the manual editor:
 *  · «Guardar como estilo de edición»: measures the decisions of this montage (not the video) into a new style, or into an existing one after showing every parameter that would change.
 *  · «Aplicar estilo»: re-styles this montage (undoable).
 *  · «Comparar con el montaje automático»: when this montage was built or re-styled by a style, lists what the owner corrected; only the corrections they tick are added to the style.
 * Rules and measurements only: nothing is learned behind the owner's back.
 */
export function StylePanel({ composition, kindOf, onApply, refreshKey = 0, sessionStart = null }: { composition: Composition; kindOf: (id: string | null) => VisualKind; onApply: (next: Composition, changes: string[]) => void; /** Changes when another panel saved a style (reload). */ refreshKey?: number; /** The montage as it was when opened: corrections can be compared with it when there is no automatic version. */ sessionStart?: Composition | null }) {
  const supabase = getSupabaseBrowserClient()
  const [state, setState] = useState<ProfilesState>({ profiles: [], updatedAt: null, external: [], legacy: false })
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Save as style
  const [name, setName] = useState('Mi estilo')
  const [target, setTarget] = useState('new')
  const [measured, setMeasured] = useState<EditProfile | null>(null)
  const [diffPick, setDiffPick] = useState<Record<string, boolean>>({})
  // Apply
  const [applyId, setApplyId] = useState('')
  // Compare
  const [corrPick, setCorrPick] = useState<Record<string, boolean>>({})
  const [confirmIncorporate, setConfirmIncorporate] = useState(false)
  const [learnInto, setLearnInto] = useState('')

  const reload = useCallback(async () => {
    try { const s = await loadProfiles(supabase); setState(s); setLoaded(true) } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudieron leer tus estilos.') }
  }, [supabase])
  useEffect(() => { void reload() }, [reload, refreshKey])

  const presets = useMemo(() => presetProfiles().filter(p => !state.profiles.some(s => s.id === p.id)), [state.profiles])
  const all = [...state.profiles, ...state.external, ...presets]
  const targetProfile = state.profiles.find(p => p.id === target) ?? null
  const differences = measured && targetProfile ? profileDifferences(targetProfile, measured) : []

  async function persist(next: EditProfile[], message: string) {
    setBusy(true); setErr(''); setMsg('')
    try { const at = await saveProfiles(supabase, next, state.updatedAt); setState(st => ({ ...st, profiles: next, updatedAt: at, legacy: false })); setMsg(message); return true }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar.'); return false }
    finally { setBusy(false) }
  }

  function measure() {
    setMsg(''); setErr('')
    const seed = targetProfile ?? undefined
    const p = extractProfile(composition, kindOf, (name.trim() || 'Mi estilo').slice(0, 60), seed)
    setMeasured(p)
    if (seed) setDiffPick(Object.fromEntries(profileDifferences(seed, p).map(d => [d.path, true])))
  }

  async function saveMeasured() {
    if (!measured) return
    if (!targetProfile) {
      if (state.profiles.some(p => p.name.toLowerCase() === measured.name.toLowerCase())) { setErr(`Ya tienes un estilo «${measured.name}». Elige otro nombre o actualízalo.`); return }
      if (await persist([measured, ...state.profiles], `Estilo «${measured.name}» guardado.`)) setMeasured(null)
      return
    }
    const chosen = differences.filter(d => diffPick[d.path])
    if (!chosen.length) { setErr('No has elegido ningún cambio.'); return }
    const corrections: Correction[] = chosen.map(d => ({ id: d.path, area: 'ritmo', description: `${d.label}: ${d.before} → ${d.after}.`, patches: [{ path: d.path, value: d.value }] }))
    const updated = applyPatches(targetProfile, corrections, `Actualizado con «${composition.title || 'un montaje'}»`)
    if (await persist(state.profiles.map(p => (p.id === updated.id ? updated : p)), `«${updated.name}» actualizado a la versión ${updated.version} (${chosen.length} cambios).`)) setMeasured(null)
  }

  function applyChosen() {
    const p = all.find(x => x.id === applyId)
    if (!p) return
    const r = applyProfile(composition, p, kindOf)
    onApply(r.composition, [`Estilo «${p.name}» aplicado.`, ...r.changes])
  }

  // Compare with the automatic version this montage started from.
  const ref = composition.styleRef
  // Without a style-built automatic version, the owner compares with the montage as it was when opened, and picks the style to teach.
  const openRef = !ref && sessionStart ? { profileId: learnInto, profileName: all.find(p => p.id === learnInto)?.name ?? '', version: all.find(p => p.id === learnInto)?.version ?? 1, appliedAt: '', baseline: sessionStart } : null
  const cmp = ref ?? openRef
  const refProfile = cmp ? all.find(p => p.id === cmp.profileId) ?? null : null
  const corrections = useMemo(() => (cmp?.baseline && refProfile ? diffMontages(cmp.baseline, composition, refProfile, kindOf) : []), [cmp?.baseline, refProfile, composition, kindOf])
  const learnable = corrections.filter(c => c.patches.length)
  const picked = learnable.filter(c => corrPick[c.id])

  async function incorporate() {
    if (!refProfile || !picked.length) return
    const updated = applyPatches(refProfile, picked)
    const exists = state.profiles.some(p => p.id === updated.id)
    const ok = await persist(exists ? state.profiles.map(p => (p.id === updated.id ? updated : p)) : [updated, ...state.profiles], `«${updated.name}» actualizado a la versión ${updated.version}: ${picked.length} corrección${picked.length === 1 ? '' : 'es'} incorporada${picked.length === 1 ? '' : 's'}.`)
    if (ok) { setConfirmIncorporate(false); setCorrPick({}) }
  }

  return <section className="panel stylePanel" aria-label="Estilos de edición">
    <div className="cardHead" style={{ marginBottom: 0 }}><h3>Estilos de edición</h3><Link className="open small" href="/editor/styles">Biblioteca de estilos →</Link></div>
    {err && <p className="error small" role="alert">{err}</p>}
    {msg && <p className="notice small" role="status">{msg}</p>}

    <div className="styleGrid">
      <div className="styleBox" aria-label="Guardar como estilo de edición">
        <h4>Guardar como estilo de edición</h4>
        <p className="muted small">Mide las decisiones de este montaje (duración de los clips, cortes, transiciones, cámara, velocidad, volúmenes, textos, subtítulos, inicio y cierre, formato). No guarda el vídeo.</p>
        <div className="field-row" style={{ alignItems: 'end' }}>
          <label>Guardar en<select aria-label="Guardar en" value={target} onChange={e => { setTarget(e.target.value); setMeasured(null) }}><option value="new">Un estilo nuevo</option>{state.profiles.map(p => <option key={p.id} value={p.id}>Actualizar «{p.name}»</option>)}</select></label>
          {target === 'new' && <label>Nombre<input aria-label="Nombre del estilo" value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>}
          <button type="button" onClick={measure} disabled={!loaded || composition.clips.length === 0}>Medir este montaje</button>
        </div>
        {measured && !targetProfile && <div className="styleResult">
          <b>Esto es lo que he medido:</b>
          <ul className="small">{measured.notes.map(n => <li key={n}>{n}</li>)}</ul>
          <div className="pageActions"><button type="button" disabled={busy} onClick={() => void saveMeasured()}>Guardar «{measured.name}»</button><button type="button" className="ghost" onClick={() => setMeasured(null)}>Descartar</button></div>
        </div>}
        {measured && targetProfile && <div className="styleResult">
          {differences.length ? <>
            <b>Cambios respecto a «{targetProfile.name}» (v{targetProfile.version}). Elige cuáles guardar:</b>
            <ul className="plainList small">{differences.map(d => <li key={d.path}><label><input type="checkbox" checked={Boolean(diffPick[d.path])} onChange={e => setDiffPick(x => ({ ...x, [d.path]: e.target.checked }))} /> {d.label}: <s>{d.before}</s> → <b>{d.after}</b></label></li>)}</ul>
            <div className="pageActions"><button type="button" disabled={busy} onClick={() => void saveMeasured()}>Guardar como versión {targetProfile.version + 1}</button><button type="button" className="ghost" onClick={() => setMeasured(null)}>Descartar</button></div>
          </> : <p className="muted small">Este montaje sigue exactamente «{targetProfile.name}»: no hay nada que actualizar.</p>}
        </div>}
      </div>

      <div className="styleBox" aria-label="Aplicar estilo">
        <h4>Aplicar un estilo a este montaje</h4>
        <p className="muted small">Cambia transiciones, cámara, volúmenes, textos, subtítulos y formato; mantiene tus clips y su orden. Se puede deshacer.</p>
        <div className="field-row" style={{ alignItems: 'end' }}>
          <label>Estilo<select aria-label="Estilo a aplicar" value={applyId} onChange={e => setApplyId(e.target.value)}><option value="">— Elige</option>
            {state.profiles.length > 0 && <optgroup label="Mis estilos">{state.profiles.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}</optgroup>}
            {state.external.length > 0 && <optgroup label="Grabados o de referencia">{state.external.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
            <optgroup label="Plantillas iniciales">{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          </select></label>
          <button type="button" disabled={!applyId} onClick={applyChosen}>Aplicar estilo</button>
        </div>
      </div>
    </div>

    {cmp === openRef && sessionStart && <div className="styleBox" aria-label="Aprender de mis correcciones" style={{ marginTop: 12 }}>
      <h4>Aprender de mis correcciones</h4>
      <p className="muted small">Compara este montaje con cómo estaba al abrirlo y lleva a un estilo solo los cambios que marques.</p>
      <label>Estilo al que enseñar<select aria-label="Estilo al que enseñar" value={learnInto} onChange={e => { setLearnInto(e.target.value); setCorrPick({}); setConfirmIncorporate(false) }}><option value="">— Elige</option>{[...state.profiles, ...presets].map(p => <option key={p.id} value={p.id}>{p.name}{p.source === 'preset' ? ' (plantilla)' : ` · v${p.version}`}</option>)}</select></label>
    </div>}
    {cmp && (cmp === ref || learnInto) && <div className="styleBox" aria-label="Comparar con el montaje automático" style={{ marginTop: 12 }}>
      <h4>{cmp === ref ? 'Comparar con el montaje automático' : 'Mis correcciones desde que lo abrí'}</h4>
      {cmp === ref && <p className="muted small">Montaje creado con «{ref.profileName}» v{ref.version} el {new Date(ref.appliedAt).toLocaleString()}. Estos son tus cambios desde entonces; solo se añaden al estilo los que marques.</p>}
      {!cmp.baseline ? <p className="muted small">No se guardó el montaje automático de partida.</p>
        : !refProfile ? <p className="muted small">El estilo «{cmp.profileName}» ya no existe.</p>
        : corrections.length === 0 ? <p className="muted small">Todavía no has corregido nada.</p>
        : <>
          <ul className="plainList small">{corrections.map(c => <li key={c.id}>
            {c.patches.length ? <label><input type="checkbox" checked={Boolean(corrPick[c.id])} onChange={e => { setCorrPick(x => ({ ...x, [c.id]: e.target.checked })); setConfirmIncorporate(false) }} /> <span className="pill">{c.area}</span> {c.description}</label>
              : <span className="muted"><span className="pill">{c.area}</span> {c.description}</span>}
          </li>)}</ul>
          {!confirmIncorporate
            ? <button type="button" disabled={!picked.length || busy} onClick={() => setConfirmIncorporate(true)}>Incorporar {picked.length || ''} al estilo «{refProfile.name}»</button>
            : <div className="pageActions" role="group" aria-label="Confirmar">
              <span className="small">Se guardará «{refProfile.name}» como versión {refProfile.version + 1} (la versión {refProfile.version} se conserva para restaurarla).</span>
              <button type="button" disabled={busy} onClick={() => void incorporate()}>Confirmar</button>
              <button type="button" className="ghost" onClick={() => setConfirmIncorporate(false)}>Cancelar</button>
            </div>}
        </>}
    </div>}
  </section>
}
