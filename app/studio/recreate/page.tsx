'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { uploadProjectMedia } from '@/lib/media-upload'
import { animationSheet } from '@/lib/recreate/build'
import { characterRequest, matchClipsToScenes, sceneImageRequest, voiceRequest, type GenerateBody } from '@/lib/recreate/batch'
import type { Plan, VideoAnalysis } from '@/lib/recreate/types'
import type { ProjectRow } from '@/lib/types/database'

type Analyzed = { analysis: VideoAnalysis; via: string; source: string | null; plan: Plan; originality: { narrationOverlap: number; ok: boolean; problems: string[] }; textModel: string }
type Saved = { storyboardId: string; scenes: Array<{ id: string; position: number }> }
type Step = { key: string; label: string; state: 'wait' | 'run' | 'done' | 'failed'; note?: string }

const post = async <T,>(url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({})) as T & { error?: string }
  return { ok: r.ok, status: r.status, j }
}

export default function RecreatePage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [url, setUrl] = useState('')
  const [transcript, setTranscript] = useState('')
  const [idea, setIdea] = useState('')
  const [consistent, setConsistent] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<Analyzed | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [steps, setSteps] = useState<Step[]>([])

  useEffect(() => {
    void supabase.from('projects').select('*').order('updated_at', { ascending: false }).then(({ data }: { data: unknown[] | null }) => {
      const rows = (data ?? []) as ProjectRow[]
      setProjects(rows); setProjectId(id => id || rows[0]?.id || '')
    })
  }, [supabase])

  async function analyse() {
    setBusy(true); setError(''); setNotice(''); setResult(null); setSaved(null); setSteps([])
    const r = await post<Analyzed>('/api/recreate/analyze', { projectId, url, transcript, idea, consistent })
    setBusy(false)
    if (!r.ok) { setError(r.j.error ?? 'No se pudo analizar.'); return }
    setResult(r.j)
  }

  async function save() {
    if (!result) return
    setBusy(true); setError('')
    const r = await post<Saved>('/api/recreate/save', { projectId, plan: result.plan, consistent: result.plan.consistent, source: result.source })
    setBusy(false)
    if (!r.ok) { setError(r.j.error ?? 'No se pudo guardar.'); return }
    setSaved(r.j); setNotice('Guardado como storyboard vertical 9:16. Ya puedes generar el material gratis.')
  }

  const setStep = (key: string, patch: Partial<Step>) => setSteps(list => list.map(s => s.key === key ? { ...s, ...patch } : s))

  /** Characters → scene images → voices, one request at a time, free models only. The first refusal stops the batch. */
  async function runBatch() {
    if (!result || !saved) return
    const plan = result.plan
    const list: Step[] = [
      ...plan.characters.map(c => ({ key: `c:${c.name}`, label: `Personaje · ${c.name}`, state: 'wait' as const })),
      ...plan.scenes.flatMap((_, i) => [{ key: `i:${i}`, label: `Escena ${i + 1} · imagen`, state: 'wait' as const }, { key: `v:${i}`, label: `Escena ${i + 1} · voz`, state: 'wait' as const }]),
    ]
    setSteps(list); setBusy(true); setError('')
    const refs: Record<string, string> = {}
    const run = async (key: string, body: GenerateBody) => {
      setStep(key, { state: 'run' })
      const r = await post<{ assets?: Array<{ id: string }> }>('/api/studio/generate', body)
      if (!r.ok) { setStep(key, { state: 'failed', note: r.j.error }); setError(`${r.j.error ?? 'Falló la generación.'} Se detuvo el lote; no se cambió a ningún modelo de pago.`); return null }
      setStep(key, { state: 'done' })
      return r.j.assets?.[0]?.id ?? null
    }
    for (const c of plan.characters) {
      const id = await run(`c:${c.name}`, characterRequest(projectId, c))
      if (!id) { setBusy(false); return }
      refs[c.name.toLowerCase()] = id
      const { data } = await supabase.from('assets').select('provenance').eq('id', id).maybeSingle()
      await supabase.from('assets').update({ provenance: { ...(data?.provenance ?? {}), role: 'character_reference', characterName: c.name.slice(0, 60), characterIdentity: c.appearance.slice(0, 600) } }).eq('id', id)
    }
    for (let i = 0; i < plan.scenes.length; i++) {
      const sceneId = saved.scenes.find(s => s.position === i + 1)?.id
      if (!sceneId) continue
      if (!(await run(`i:${i}`, sceneImageRequest(projectId, plan, plan.scenes[i], sceneId, refs)))) { setBusy(false); return }
      if (!(await run(`v:${i}`, voiceRequest(projectId, plan.scenes[i], sceneId)))) { setBusy(false); return }
    }
    setBusy(false); setNotice('Imágenes y voces listas. Falta animar (pestaña de abajo) y montar en el editor.')
  }

  async function importClips(files: FileList | null) {
    if (!files?.length || !saved || !result) return
    const names = [...files].map(f => f.name)
    const match = matchClipsToScenes(names, result.plan.scenes.length)
    setBusy(true); setError('')
    let ok = 0
    for (let i = 0; i < files.length; i++) {
      const n = match[i]; const sceneId = n ? saved.scenes.find(s => s.position === n)?.id : null
      if (!n || !sceneId) { setError(`No sé a qué escena pertenece «${names[i]}»: nómbralo con el número (escena-3.mp4).`); continue }
      try {
        await uploadProjectMedia(supabase, { projectId, kind: 'video', file: files[i], title: `Escena ${n} animada`, license: 'restricted', licenseNotes: 'Clip animado fuera de Cerebro; revisa los términos de la herramienta usada.', extra: { sceneId, role: 'animated_scene' } })
        ok++
      } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo subir el clip.') }
    }
    setBusy(false); if (ok) setNotice(`${ok} clip(s) animados añadidos a sus escenas.`)
  }

  async function copySheet() {
    if (!result) return
    try { await navigator.clipboard.writeText(animationSheet(result.plan)); setNotice('Prompts de animación copiados.') } catch { setError('No se pudo copiar; selecciona el texto a mano.') }
  }

  const plan = result?.plan
  const total = plan ? plan.scenes.reduce((n, s) => n + s.seconds, 0) : 0

  return (
    <StudioShell title="Short desde referencia" eyebrow="AUTOMATIZACIÓN" actions={
      <select aria-label="Proyecto" value={projectId} onChange={e => setProjectId(e.target.value)} style={{ width: 'auto', minWidth: 200 }}>
        {projects.length === 0 && <option value="">Sin proyectos</option>}
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    }>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <section className="panel stack">
        <h2>1 · Vídeo de referencia</h2>
        <p className="muted small">Gemini (cupo gratuito) ve el vídeo público de YouTube y extrae solo su estructura: gancho, ritmo y emoción. No se descarga ni se reutiliza su contenido; la historia que sale es nueva.</p>
        <label htmlFor="rc-url">Enlace de YouTube</label>
        <input id="rc-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/shorts/…" />
        <label htmlFor="rc-tr">…o transcripción (si el vídeo no es accesible)</label>
        <textarea id="rc-tr" rows={3} value={transcript} onChange={e => setTranscript(e.target.value)} maxLength={12000} />
        <label htmlFor="rc-idea">Tema o idea propia (opcional)</label>
        <input id="rc-idea" value={idea} onChange={e => setIdea(e.target.value)} maxLength={500} placeholder="Si lo dejas vacío, elijo un tema original del mismo nicho" />
        <label className="toggle"><input type="checkbox" checked={consistent} onChange={e => setConsistent(e.target.checked)} /> Con personajes consistentes (imagen de referencia por personaje)</label>
        <button type="button" disabled={busy || !projectId || (!url.trim() && !transcript.trim())} onClick={() => void analyse()}>{busy && !result ? 'Analizando…' : 'Analizar y crear plan'}</button>
      </section>

      {plan && result && (
        <section className="panel stack">
          <h2>2 · Plan original</h2>
          <p><strong>{plan.title}</strong></p>
          <p className="muted">{plan.description}</p>
          <p className="pill info">{plan.scenes.length} escenas · {total.toFixed(1)} s · 9:16 · texto: {result.textModel} · repite {Math.round(result.originality.narrationOverlap * 100)} % del original</p>
          <p className="muted small">Gancho del vídeo de referencia: {result.analysis.hook}</p>
          {plan.characters.map(c => <details key={c.name}><summary>{c.name} · {c.age}</summary><p className="small">{c.personality}. {c.appearance}. {c.outfit}. {c.unique_traits}</p><p className="small muted">{c.prompt_en}</p></details>)}
          <ol>{plan.scenes.map((s, i) => <li key={i}><span className="small muted">{s.seconds} s{s.characters.length ? ` · ${s.characters.join(', ')}` : ''}</span><br />{s.narration}</li>)}</ol>
          {!saved && <button type="button" disabled={busy} onClick={() => void save()}>Guardar como storyboard</button>}
        </section>
      )}

      {saved && plan && (
        <section className="panel stack">
          <h2>3 · Imágenes y voces gratis</h2>
          <p className="muted small">Solo FLUX.2 klein (cupo diario de Cloudflare) y Gemini TTS (cupo gratuito). Si un cupo se agota, el lote se detiene: nunca pasa a un modelo de pago.</p>
          <button type="button" disabled={busy} onClick={() => void runBatch()}>Generar material gratis</button>
          {steps.length > 0 && <ul aria-label="Progreso del lote">{steps.map(s => <li key={s.key}>{s.label}: {s.state === 'wait' ? 'pendiente' : s.state === 'run' ? 'generando…' : s.state === 'done' ? 'listo' : `error${s.note ? ` — ${s.note}` : ''}`}</li>)}</ul>}
        </section>
      )}

      {saved && plan && (
        <section className="panel stack">
          <h2>4 · Animar y montar</h2>
          <p className="muted small">Cerebro no automatiza Meta AI, Flow ni Canva (no tienen API oficial y la automatización por extensión puede infringir sus condiciones). Copia estos prompts a la herramienta de animación que tengas permitida, descarga los clips y súbelos aquí con el número de escena en el nombre.</p>
          <button type="button" className="ghost" onClick={() => void copySheet()}>Copiar prompts de animación</button>
          <label htmlFor="rc-clips">Clips animados (escena-1.mp4, escena-2.mp4…)</label>
          <input id="rc-clips" type="file" accept="video/*" multiple disabled={busy} onChange={e => void importClips(e.target.files)} />
          <Link className="buttonLink" href={`/editor?project=${projectId}`}>Abrir en el editor</Link>
        </section>
      )}
    </StudioShell>
  )
}
