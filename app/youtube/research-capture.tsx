'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']

/** Manual research capture: saves a YouTube link as an opportunity, never duplicating a saved URL. */
export function ResearchCapture() {
  const supabase = getSupabaseBrowserClient()
  const [query, setQuery] = useState('historias increíbles supervivencia')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState<'success' | 'warning' | 'error'>('success')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setStatus(''); setKind('success')
    let parsed: URL
    try {
      parsed = new URL(url.trim())
      if (!hosts.includes(parsed.hostname) || !['https:', 'http:'].includes(parsed.protocol)) throw new Error('url')
    } catch { setKind('error'); setStatus('Introduce un enlace válido de YouTube.'); return }
    if (!title.trim()) { setKind('error'); setStatus('Indica un título para el hallazgo.'); return }
    setBusy(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) { setKind('error'); setStatus('Inicia sesión para guardar la investigación.'); return }
      const { data: existing, error: lookupError } = await supabase.from('opportunities').select('id').eq('owner_id', user.id).eq('source_platform', 'youtube').eq('source_id', parsed.toString()).limit(1)
      if (lookupError) throw lookupError
      if (existing?.length) { setKind('warning'); setStatus('Este enlace ya está guardado en Oportunidades. No se ha creado un duplicado.'); return }
      const { error: saveError } = await supabase.from('opportunities').insert({
        owner_id: user.id, title: title.trim(), source_platform: 'youtube', source_id: parsed.toString(), query: query.trim() || null, status: 'discovered',
        observed_metrics: {}, calculated_metrics: {}, evidence: [{ url: parsed.toString(), note: note.trim(), captured_at: new Date().toISOString(), source: 'manual' }],
      })
      if (saveError) throw saveError
      setUrl(''); setTitle(''); setNote('')
      setStatus('Hallazgo guardado en Oportunidades. No se han importado métricas automáticamente.')
    } catch (err) {
      setKind('error'); setStatus(err instanceof Error ? err.message : 'No se pudo guardar el hallazgo.')
    } finally { setBusy(false) }
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <h3>Investigación manual</h3>
    <p className="muted small">Abre búsquedas en YouTube y guarda lo que encuentres. Para búsquedas con métricas usa <Link className="open" href="/market-intelligence">Investigación</Link> o el <Link className="open" href="/radar">Radar</Link>.</p>
    <label>Canal, tema o historia<input value={query} onChange={e => setQuery(e.target.value)} maxLength={180} /></label>
    <div className="pageActions">
      <a className="buttonLink ghost" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}&sp=EgIQAg%253D%253D`} target="_blank" rel="noopener noreferrer">Buscar canales ↗</a>
      <a className="buttonLink ghost" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`} target="_blank" rel="noopener noreferrer">Buscar vídeos ↗</a>
    </div>
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field-row">
        <label>Enlace del canal o vídeo<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." required maxLength={2000} /></label>
        <label>Título del hallazgo<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={180} /></label>
      </div>
      <label>Observación o evidencia<textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Qué formato, tema o señal has observado" maxLength={2000} /></label>
      <div><button disabled={busy}>{busy ? 'Guardando…' : 'Guardar hallazgo (sin publicar)'}</button></div>
      {status && <p role={kind === 'error' ? 'alert' : 'status'} aria-live="polite" className={kind === 'error' ? 'error' : 'research-feedback'} data-testid="youtube-research-feedback">{status}</p>}
    </form>
  </section>
}
