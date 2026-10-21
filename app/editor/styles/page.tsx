'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { CAMERA_MOVES, CAPTION_STYLES, TEXT_ANIMATIONS, TEXT_FONTS, TRANSITIONS, type CameraKind, type CaptionStyle, type TextAnimation, type TextFont, type Transition } from '@/lib/editor/composition'
import { newProfileId, parseProfile, presetProfiles, profileDifferences, restoreVersion, reviseProfile, type EditProfile } from '@/lib/editor/profile'
import { loadProfiles, MAX_PROFILES, saveProfiles } from '@/lib/editor/profiles-store'

/**
 * Biblioteca de estilos: every editing style the owner has, with ALL its parameters editable.
 * Saving shows exactly which parameters change and creates a new version; earlier versions can be restored. Nothing is overwritten silently.
 */
export default function StylesLibraryPage() {
  const supabase = getSupabaseBrowserClient()
  const [profiles, setProfiles] = useState<EditProfile[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<EditProfile | null>(null)
  const [confirm, setConfirm] = useState<'save' | 'delete' | `restore:${number}` | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try { const s = await loadProfiles(supabase); setProfiles(s.profiles); setUpdatedAt(s.updatedAt); setSelected(x => x || s.profiles[0]?.id || '') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron leer tus estilos.') }
  }, [supabase])
  useEffect(() => { void reload() }, [reload])

  const current = profiles.find(p => p.id === selected) ?? null
  useEffect(() => { setDraft(current ? structuredClone(current) : null); setConfirm(null) }, [current])
  const diffs = current && draft ? profileDifferences(current, draft).concat(current.name !== draft.name ? [{ path: 'name', label: 'Nombre', before: current.name, after: draft.name, value: draft.name }] : []).concat(current.description !== draft.description ? [{ path: 'description', label: 'Descripción', before: current.description || '—', after: draft.description || '—', value: draft.description }] : []) : []

  async function persist(next: EditProfile[], message: string, select?: string) {
    setBusy(true); setError(''); setNotice('')
    try { const at = await saveProfiles(supabase, next, updatedAt); setProfiles(next); setUpdatedAt(at); if (select !== undefined) setSelected(select); setNotice(message); setConfirm(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setBusy(false) }
  }

  function addFrom(p: EditProfile) {
    if (profiles.length >= MAX_PROFILES) { setError(`Puedes guardar hasta ${MAX_PROFILES} estilos.`); return }
    let name = p.source === 'preset' ? p.name : `${p.name} (copia)`
    for (let n = 2; profiles.some(x => x.name.toLowerCase() === name.toLowerCase()); n++) name = `${p.source === 'preset' ? p.name : `${p.name} (copia)`} ${n}`
    const copy = parseProfile({ ...p, id: p.source === 'preset' && !profiles.some(x => x.id === p.id) ? p.id : newProfileId(), name, version: 1, source: 'custom', sessions: 0, createdAt: new Date().toISOString(), history: [{ version: 1, at: new Date().toISOString(), summary: `Creado a partir de «${p.name}».` }], previous: [] })!
    void persist([copy, ...profiles], `Estilo «${copy.name}» creado. Ajusta sus parámetros y guarda.`, copy.id)
  }

  const set = (path: string, value: unknown) => { setConfirm(null); setDraft(d => {
    if (!d) return d
    const n = structuredClone(d) as unknown as Record<string, unknown>
    const keys = path.split('.')
    let o = n
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>
    o[keys[keys.length - 1]] = value
    return n as unknown as EditProfile
  }) }
  const num = (path: string, v: string, scale = 1) => { const x = Number(v.replace(',', '.')); if (Number.isFinite(x)) set(path, Math.round(x * scale * 100) / 100) }

  return <StudioShell title="Mis estilos de edición" eyebrow="POSTPRODUCCIÓN" actions={<><Link className="buttonLink ghost" href="/editor/style">Editar con mi estilo</Link><Link className="buttonLink ghost" href="/editor/manual">Editor manual</Link></>}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <p className="muted">Un estilo guarda decisiones de edición (ritmo, transiciones, cámara, volúmenes, textos, subtítulos, inicio y cierre, formato), no un vídeo. Lo creas desde una plantilla, midiendo un montaje tuyo en el editor manual («Guardar como estilo de edición») o corrigiendo un montaje automático. Cerebro aplica estas reglas tal cual: no aprende nada por su cuenta.</p>

    <div className="editorLayout" style={{ gridTemplateColumns: '280px minmax(0,1fr)' }}>
      <aside className="panel" aria-label="Lista de estilos">
        <h3>Mis estilos ({profiles.length})</h3>
        <ul className="plainList">{profiles.map(p => <li key={p.id}><button type="button" className={p.id === selected ? 'small' : 'ghost small'} aria-pressed={p.id === selected} onClick={() => setSelected(p.id)} style={{ width: '100%', textAlign: 'left' }}>{p.name} · v{p.version}</button></li>)}</ul>
        {!profiles.length && <p className="muted small">Todavía no tienes estilos.</p>}
        <h4 style={{ marginTop: 14 }}>Crear desde una plantilla</h4>
        <ul className="plainList">{presetProfiles().map(p => <li key={p.id}><button type="button" className="ghost small" onClick={() => addFrom(p)} disabled={busy} title={p.description} style={{ width: '100%', textAlign: 'left' }}>+ {p.name}</button></li>)}</ul>
      </aside>

      {draft && current ? <section className="panel" aria-label={`Parámetros de ${current.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="cardHead"><h3>{current.name} <span className="muted small">v{current.version} · {current.source === 'learned' ? `medido de ${current.sessions} montaje${current.sessions === 1 ? '' : 's'}` : current.source === 'custom' ? 'personalizado' : 'plantilla'}</span></h3>
          <div className="pageActions"><button type="button" className="ghost small" onClick={() => addFrom(current)} disabled={busy}>Duplicar</button>{confirm === 'delete' ? <><button type="button" className="small" onClick={() => void persist(profiles.filter(p => p.id !== current.id), `Estilo «${current.name}» borrado.`, profiles.find(p => p.id !== current.id)?.id ?? '')}>Confirmar borrado</button><button type="button" className="ghost small" onClick={() => setConfirm(null)}>Cancelar</button></> : <button type="button" className="ghost small" onClick={() => setConfirm('delete')}>Borrar</button>}</div>
        </div>
        <div className="field-row"><label>Nombre<input aria-label="Nombre" value={draft.name} maxLength={60} onChange={e => set('name', e.target.value)} /></label><label>Descripción<input aria-label="Descripción" value={draft.description} maxLength={300} onChange={e => set('description', e.target.value)} /></label></div>

        <Group title="Formato y exportación">
          <Sel label="Formato" value={draft.format} options={{ '16:9': '16:9 horizontal', '9:16': '9:16 vertical', '1:1': '1:1 cuadrado' }} onChange={v => set('format', v)} />
          <Sel label="Calidad de exportación" value={draft.export.quality} options={{ normal: 'Normal', high: 'Alta' }} onChange={v => set('export.quality', v)} />
        </Group>
        <Group title="Ritmo">
          <Num label="Clips de vídeo (s)" value={draft.pacing.videoClipMs / 1000} onChange={v => num('pacing.videoClipMs', v, 1000)} />
          <Num label="Imágenes (s)" value={draft.pacing.imageClipMs / 1000} onChange={v => num('pacing.imageClipMs', v, 1000)} />
          <Num label="Clip mínimo (s)" value={draft.pacing.minClipMs / 1000} onChange={v => num('pacing.minClipMs', v, 1000)} />
          <Num label="Clip máximo (s)" value={draft.pacing.maxClipMs / 1000} onChange={v => num('pacing.maxClipMs', v, 1000)} />
          <Check label="Dividir tomas largas" value={draft.pacing.splitLong} onChange={v => set('pacing.splitLong', v)} />
          <Check label="Quitar silencios" value={draft.pacing.removeSilences} onChange={v => set('pacing.removeSilences', v)} />
          <Check label="Cortar en cambios de plano" value={draft.pacing.cutOnShots} onChange={v => set('pacing.cutOnShots', v)} />
          <Check label="Ajustar a la narración" value={draft.pacing.fitToVoice} onChange={v => set('pacing.fitToVoice', v)} />
          <Check label="Cortes al ritmo de la música" value={draft.rhythm.syncToMusic} onChange={v => set('rhythm.syncToMusic', v)} />
          <Num label="Pulsos por corte" value={draft.rhythm.beatsPerCut} onChange={v => num('rhythm.beatsPerCut', v)} />
        </Group>
        <Group title="Transiciones">
          <Sel label="Entre materiales" value={draft.transitions.betweenMaterials} options={TRANSITIONS} onChange={v => set('transitions.betweenMaterials', v as Transition)} />
          <Sel label="Dentro de una toma" value={draft.transitions.withinTake} options={TRANSITIONS} onChange={v => set('transitions.withinTake', v as Transition)} />
          <Sel label="En cambio de plano" value={draft.transitions.onShotChange} options={TRANSITIONS} onChange={v => set('transitions.onShotChange', v as Transition)} />
          <Num label="Duración (ms)" value={draft.transitions.durationMs} onChange={v => num('transitions.durationMs', v)} />
        </Group>
        <Group title="Cámara y velocidad">
          <Sel label="Imágenes" value={draft.camera.images} options={CAMERA_MOVES} onChange={v => set('camera.images', v as CameraKind)} />
          <Sel label="Vídeos" value={draft.camera.videos} options={CAMERA_MOVES} onChange={v => set('camera.videos', v as CameraKind)} />
          <Num label="Intensidad (%)" value={Math.round(draft.camera.amount * 100)} onChange={v => num('camera.amount', v, 0.01)} />
          <Check label="Alternar dirección" value={draft.camera.alternate} onChange={v => set('camera.alternate', v)} />
          <Num label="Velocidad de vídeos (×)" value={draft.speed.video} onChange={v => num('speed.video', v)} />
        </Group>
        <Group title="Audio">
          <Num label="Audio de los vídeos (%)" value={Math.round(draft.audio.videoVolume * 100)} onChange={v => num('audio.videoVolume', v, 0.01)} />
          <Check label="Silenciar audio de vídeos" value={draft.audio.muteVideo} onChange={v => set('audio.muteVideo', v)} />
          <Num label="Música (%)" value={Math.round(draft.audio.musicVolume * 100)} onChange={v => num('audio.musicVolume', v, 0.01)} />
          <Num label="Voz (%)" value={Math.round(draft.audio.voiceVolume * 100)} onChange={v => num('audio.voiceVolume', v, 0.01)} />
          <Num label="Efectos (%)" value={Math.round(draft.audio.sfxVolume * 100)} onChange={v => num('audio.sfxVolume', v, 0.01)} />
          <Check label="Música baja bajo la voz" value={draft.audio.duckMusic} onChange={v => set('audio.duckMusic', v)} />
          <Check label="Repetir la música" value={draft.audio.loopMusic} onChange={v => set('audio.loopMusic', v)} />
        </Group>
        <Group title="Textos y subtítulos">
          <Sel label="Tipografía" value={draft.text.font} options={Object.fromEntries(Object.entries(TEXT_FONTS).map(([k, v]) => [k, v.label]))} onChange={v => set('text.font', v as TextFont)} />
          <label>Color<input type="color" aria-label="Color del texto" value={draft.text.color} onChange={e => set('text.color', e.target.value)} /></label>
          <Sel label="Posición" value={draft.text.position} options={{ top: 'Arriba', center: 'Centro', bottom: 'Abajo' }} onChange={v => set('text.position', v)} />
          <Num label="Tamaño (%)" value={draft.text.sizePct} onChange={v => num('text.sizePct', v)} />
          <Sel label="Animación" value={draft.text.animation} options={TEXT_ANIMATIONS} onChange={v => set('text.animation', v as TextAnimation)} />
          <Check label="Subtítulos" value={draft.subtitles.enabled} onChange={v => set('subtitles.enabled', v)} />
          <Sel label="Estilo de subtítulos" value={draft.subtitles.style} options={CAPTION_STYLES} onChange={v => set('subtitles.style', v as CaptionStyle)} />
        </Group>
        <Group title="Inicio y cierre">
          <Check label="Título inicial" value={draft.structure.intro.title} onChange={v => set('structure.intro.title', v)} />
          <Num label="Duración del título (s)" value={draft.structure.intro.titleMs / 1000} onChange={v => num('structure.intro.titleMs', v, 1000)} />
          <Check label="Gancho en pantalla" value={draft.structure.intro.hook} onChange={v => set('structure.intro.hook', v)} />
          <Num label="Duración del gancho (s)" value={draft.structure.intro.hookMs / 1000} onChange={v => num('structure.intro.hookMs', v, 1000)} />
          <Check label="Texto de cierre" value={draft.structure.outro.endCard} onChange={v => set('structure.outro.endCard', v)} />
          <label>Texto<input aria-label="Texto de cierre" value={draft.structure.outro.endCardText} maxLength={120} onChange={e => set('structure.outro.endCardText', e.target.value)} /></label>
          <Num label="Duración del cierre (s)" value={draft.structure.outro.endCardMs / 1000} onChange={v => num('structure.outro.endCardMs', v, 1000)} />
        </Group>

        {diffs.length > 0 && <div className="styleBox" aria-label="Cambios sin guardar">
          <b>{diffs.length} cambio{diffs.length === 1 ? '' : 's'} sin guardar:</b>
          <ul className="small" style={{ margin: '4px 0 6px 18px' }}>{diffs.map(d => <li key={d.path}>{d.label}: <s>{d.before}</s> → <b>{d.after}</b></li>)}</ul>
          {confirm === 'save'
            ? <div className="pageActions"><span className="small">Se guardará como versión {current.version + 1}; la versión {current.version} se conserva.</span><button type="button" disabled={busy} onClick={() => { const parsed = parseProfile(draft); if (!parsed) { setError('Algún valor no es válido.'); return } const next = reviseProfile(current, parsed, `Parámetros editados: ${diffs.map(d => d.label).join(', ')}.`); void persist(profiles.map(p => (p.id === current.id ? next : p)), `«${next.name}» guardado como versión ${next.version}.`) }}>Confirmar</button><button type="button" className="ghost" onClick={() => setConfirm(null)}>Cancelar</button></div>
            : <div className="pageActions"><button type="button" onClick={() => setConfirm('save')}>Guardar cambios</button><button type="button" className="ghost" onClick={() => setDraft(structuredClone(current))}>Descartar</button></div>}
        </div>}

        {current.notes.length > 0 && <details><summary><b>Lo que se midió</b></summary><ul className="small" style={{ margin: '6px 0 0 18px' }}>{current.notes.map(n => <li key={n}>{n}</li>)}</ul></details>}
        <details open><summary><b>Historial de versiones</b></summary>
          <ul className="plainList small" style={{ marginTop: 6 }}>{[...current.history].reverse().map((h, i) => {
            const canRestore = (current.previous ?? []).some(v => v.version === h.version)
            return <li key={`${h.version}-${i}`}>v{h.version} · {h.at ? new Date(h.at).toLocaleString() : ''} · {h.summary}{canRestore && (confirm === `restore:${h.version}`
              ? <> <button type="button" className="small" onClick={() => { const next = restoreVersion(current, h.version); void persist(profiles.map(p => (p.id === current.id ? next : p)), `Restaurada la versión ${h.version} como versión ${next.version}.`) }}>Confirmar restaurar</button> <button type="button" className="ghost small" onClick={() => setConfirm(null)}>Cancelar</button></>
              : <> <button type="button" className="ghost small" onClick={() => setConfirm(`restore:${h.version}`)}>Restaurar</button></>)}</li>
          })}</ul>
        </details>
      </section> : <section className="panel"><p className="muted">Crea un estilo desde una plantilla o guarda uno desde el editor manual.</p></section>}
    </div>
  </StudioShell>
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="styleBox"><legend><b>{title}</b></legend><div className="field-row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>{children}</div></fieldset>
}
function Sel({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) {
  return <label>{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
}
function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return <label>{label}<input aria-label={label} type="number" step="any" value={value} onChange={e => onChange(e.target.value)} style={{ width: 110 }} /></label>
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} /> {label}</label>
}
