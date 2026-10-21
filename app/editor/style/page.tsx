'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { RenderPanel } from '../../components/render-panel'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { assetLabel, audioDurationMs, signedUrl, type EditorAsset } from '@/lib/editor/client'
import { detectShots, findSilences, musicBeats } from '@/lib/editor/auto-edit'
import { frameDifferences, loudness } from '@/lib/editor/analyze'
import { buildFromProfile, presetProfiles, type EditProfile, type Material } from '@/lib/editor/profile'
import { loadProfiles } from '@/lib/editor/profiles-store'
import { CAMERA_MOVES, TRANSITIONS, type Composition } from '@/lib/editor/composition'
import { uploadProjectMedia, validateUpload, type UploadKind } from '@/lib/media-upload'

type Project = { id: string; name: string }
const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
const ASSET_COLS = 'id,asset_type,storage_path,license_status,source_provider,provenance,created_at'

/**
 * «Editar automáticamente con mi estilo»: the owner's own materials + one of their styles → a montage built by fixed rules,
 * saved as a draft and opened in the manual editor to correct. Everything runs in the browser; nothing is generated or paid for.
 */
export default function StyleEditPage() {
  const supabase = getSupabaseBrowserClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [profiles, setProfiles] = useState<EditProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [order, setOrder] = useState<string[]>([])
  const [musicId, setMusicId] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [sfxId, setSfxId] = useState('')
  const [title, setTitle] = useState('')
  const [hook, setHook] = useState('')
  const [progress, setProgress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ jobId: string; comp: Composition; report: string[] } | null>(null)

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('project')
    void (async () => {
      const { data } = await supabase.from('projects').select('id,name').order('updated_at', { ascending: false })
      const rows = (data ?? []) as Project[]
      setProjects(rows); setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
      const st = await loadProfiles(supabase).catch(() => null)
      const mine = st?.profiles ?? []
      const all = [...mine, ...presetProfiles().filter(p => !mine.some(m => m.id === p.id))]
      setProfiles(all); setProfileId(all[0]?.id ?? '')
    })()
  }, [supabase])

  const loadAssets = useCallback(async (pid: string) => {
    const { data } = await supabase.from('assets').select(ASSET_COLS).eq('project_id', pid).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
    setAssets((data ?? []) as EditorAsset[])
  }, [supabase])
  useEffect(() => { if (projectId) { setOrder([]); setResult(null); void loadAssets(projectId) } }, [projectId, loadAssets])

  const visuals = useMemo(() => assets.filter(a => a.asset_type === 'video' || a.asset_type === 'image'), [assets])
  const music = assets.filter(a => a.asset_type === 'music' || a.asset_type === 'audio')
  const voices = assets.filter(a => a.asset_type === 'voice' || a.asset_type === 'audio')
  const sfx = assets.filter(a => a.asset_type === 'sfx')
  const profile = profiles.find(p => p.id === profileId) ?? null
  const byId = (id: string) => assets.find(a => a.id === id)

  async function upload(files: File[]) {
    if (!projectId || !files.length) return
    setBusy(true); setError('')
    const problems: string[] = []
    const added: string[] = []
    for (const file of files) {
      const kind: UploadKind | null = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'music' : null
      if (!kind) { problems.push(`${file.name}: solo vídeo, imagen o audio.`); continue }
      const bad = validateUpload(kind, file)
      if (bad) { problems.push(`${file.name}: ${bad}`); continue }
      try {
        setProgress(`Subiendo ${file.name}…`)
        const saved = await uploadProjectMedia(supabase, { projectId, kind, file, title: file.name.replace(/\.[^.]+$/, ''), license: 'owned', licenseNotes: null })
        if (kind !== 'music') added.push(saved.id)
      } catch (e) { problems.push(`${file.name}: ${e instanceof Error ? e.message : 'no se pudo subir.'}`) }
    }
    await loadAssets(projectId)
    setOrder(o => [...o, ...added]); setProgress('')
    if (problems.length) setError(problems.join(' '))
    setBusy(false)
  }

  const toggle = (id: string) => setOrder(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]))
  const move = (id: string, d: -1 | 1) => setOrder(o => { const i = o.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= o.length) return o; const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n })

  async function build() {
    if (!profile || !order.length) return
    setBusy(true); setError(''); setResult(null)
    try {
      const materials: Material[] = []
      for (const [n, id] of order.entries()) {
        const a = byId(id)
        if (!a) continue
        if (a.asset_type === 'image') { materials.push({ kind: 'image', assetId: id, label: assetLabel(a) }); continue }
        setProgress(`Analizando ${assetLabel(a)} (${n + 1}/${order.length})…`)
        const blob = await (await fetch(await signedUrl(id))).blob()
        const needAudio = profile.pacing.removeSilences
        const au = needAudio ? await loudness(blob, 50) : { rms: [] as number[], durationMs: 0 }
        const fr = profile.pacing.cutOnShots ? await frameDifferences(blob, 4, p => setProgress(`Buscando cambios de plano en ${assetLabel(a)}… ${Math.round(p * 100)} %`)) : { diffs: [] as number[], durationMs: 0 }
        const durationMs = fr.durationMs || au.durationMs || (await audioDurationMs(id).catch(() => 0)) || 5000
        const sub = assets.find(x => x.asset_type === 'subtitle' && x.provenance?.sourceAssetId === id)
        const segs = Array.isArray(sub?.provenance?.segments) ? sub!.provenance!.segments as Array<{ start: number; end: number; text: string }> : []
        materials.push({ kind: 'video', assetId: id, label: assetLabel(a), durationMs, silences: au.rms.length ? findSilences(au.rms, 50, 0.06, 600) : [], shots: fr.diffs.length ? detectShots(fr.diffs, 4) : [], captions: segs.map(s => ({ start: s.start * 1000, end: s.end * 1000, text: s.text })) })
      }
      let musicIn: { assetId: string; durationMs: number; beats?: number[] } | null = null
      if (musicId) {
        setProgress('Midiendo la música…')
        if (profile.rhythm.syncToMusic) { const b = await (await fetch(await signedUrl(musicId))).blob(); const l = await loudness(b, 50); musicIn = { assetId: musicId, durationMs: l.durationMs, beats: musicBeats(l.rms, 50) } }
        else musicIn = { assetId: musicId, durationMs: await audioDurationMs(musicId).catch(() => 60000) }
      }
      const voiceIn = voiceId ? { assetId: voiceId, durationMs: await audioDurationMs(voiceId).catch(() => 0) } : null
      const sfxIn = sfxId ? { assetId: sfxId, durationMs: await audioDurationMs(sfxId).catch(() => 1000) } : null
      setProgress('Montando con tu estilo…')
      const { composition, report } = buildFromProfile({ title: title.trim() || 'Montaje con mi estilo', hookText: hook, materials, music: musicIn, voice: voiceIn && voiceIn.durationMs > 0 ? voiceIn : null, sfxOnCuts: sfxIn }, profile)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user.id, project_id: projectId, output_format: composition.format, status: 'draft', composition }).select('id').single()
      if (e) throw new Error(e.message)
      setResult({ jobId: (data as { id: string }).id, comp: composition, report })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo montar.') } finally { setBusy(false); setProgress('') }
  }

  return <StudioShell title="Editar con mi estilo" eyebrow="POSTPRODUCCIÓN" actions={<><Link className="buttonLink ghost" href="/editor/styles">Mis estilos</Link><Link className="buttonLink ghost" href="/editor/manual">Editor manual</Link></>}>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="muted">Elige tus materiales en el orden en que quieres verlos y uno de tus estilos. Cerebro mide cada vídeo en tu navegador (silencios, cambios de plano, pulso de la música) y monta con las reglas del estilo. Después lo corriges en el editor manual y puedes llevar tus correcciones al estilo.</p>

    <div className="field-row" style={{ marginBottom: 12 }}>
      <label>Proyecto<select aria-label="Proyecto" value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Estilo<select aria-label="Estilo" value={profileId} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.source === 'preset' ? ' (plantilla)' : ` · v${p.version}`}</option>)}</select></label>
      <label>Título<input aria-label="Título" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="Se usa como título inicial si el estilo lo tiene" /></label>
      {profile?.structure.intro.hook && <label>Gancho en pantalla<input aria-label="Gancho" value={hook} maxLength={120} onChange={e => setHook(e.target.value)} /></label>}
    </div>
    {profile && <p className="muted small">«{profile.name}»: {profile.format}, vídeos en trozos de {secs(profile.pacing.videoClipMs)}, imágenes {secs(profile.pacing.imageClipMs)}, {TRANSITIONS[profile.transitions.betweenMaterials].toLowerCase()} entre materiales, cámara «{CAMERA_MOVES[profile.camera.images].toLowerCase()}»{profile.pacing.removeSilences ? ', quita silencios' : ''}{profile.rhythm.syncToMusic ? ', corta al ritmo de la música' : ''}{profile.pacing.fitToVoice ? ', se ajusta a la narración' : ''}. <Link className="open" href="/editor/styles">Cambiar parámetros</Link></p>}

    <div className="editorLayout" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <section className="panel" aria-label="Materiales del proyecto">
        <div className="cardHead"><h3>Materiales</h3><label className="buttonLink ghost small" style={{ cursor: 'pointer' }}>Subir archivos<input type="file" multiple accept="video/*,image/*,audio/*" hidden disabled={busy} onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void upload(f) }} /></label></div>
        <p className="muted small">El audio que subas aquí se guarda como música; para voces o efectos usa el editor manual o la Biblioteca.</p>
        <ul className="plainList">{visuals.map(a => <li key={a.id}><label><input type="checkbox" checked={order.includes(a.id)} onChange={() => toggle(a.id)} /> [{a.asset_type === 'video' ? 'vídeo' : 'imagen'}] {assetLabel(a)}</label></li>)}</ul>
        {!visuals.length && <p className="muted small">Este proyecto no tiene vídeos ni imágenes todavía: súbelos aquí.</p>}
      </section>
      <section className="panel" aria-label="Orden del montaje">
        <h3>Orden ({order.length})</h3>
        <ol className="small" style={{ marginLeft: 18 }}>{order.map((id, i) => { const a = byId(id); return <li key={id} style={{ marginBottom: 4 }}>{a ? assetLabel(a) : id} <button type="button" className="ghost small" aria-label={`Subir ${a ? assetLabel(a) : id}`} disabled={i === 0} onClick={() => move(id, -1)}>↑</button><button type="button" className="ghost small" aria-label={`Bajar ${a ? assetLabel(a) : id}`} disabled={i === order.length - 1} onClick={() => move(id, 1)}>↓</button></li> })}</ol>
        <div className="field-row">
          <label>Música<select aria-label="Música" value={musicId} onChange={e => setMusicId(e.target.value)}><option value="">— Sin música</option>{music.map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select></label>
          <label>Voz / narración<select aria-label="Voz" value={voiceId} onChange={e => setVoiceId(e.target.value)}><option value="">— Sin voz</option>{voices.map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select></label>
          <label>Efecto en los cortes<select aria-label="Efecto en los cortes" value={sfxId} onChange={e => setSfxId(e.target.value)}><option value="">— Ninguno</option>{sfx.map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select></label>
        </div>
        <button type="button" disabled={busy || !order.length || !profile} onClick={() => void build()}>{busy && progress ? progress : 'Editar automáticamente con mi estilo'}</button>
      </section>
    </div>

    {result && <section className="panel" aria-label="Resultado" style={{ marginTop: 12 }}>
      <p className="notice" role="status">Montaje creado con «{profile?.name}» y guardado como borrador. <Link className="open" href={`/editor/manual?job=${result.jobId}`}>Abrir en el editor manual para corregirlo →</Link></p>
      <ul className="small" style={{ marginLeft: 18 }}>{result.report.map(r => <li key={r}>{r}</li>)}</ul>
      <RenderPanel projectId={projectId} composition={result.comp} assets={assets} previewOnly />
    </section>}
  </StudioShell>
}
