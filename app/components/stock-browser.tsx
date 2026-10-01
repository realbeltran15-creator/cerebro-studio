'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Icon } from './studio-icon'

type Kind = 'image' | 'video' | 'audio'
type Source = 'freesound' | 'pexels' | 'pixabay'
type Item = {
  source: Source; id: string; kind: Kind; title: string; author: string; authorUrl: string | null; pageUrl: string
  license: string; licenseUrl: string | null; licenseStatus: string; attribution: string; thumbUrl: string | null; previewUrl: string | null
  durationSeconds: number | null; width: number | null; height: number | null
}

const sourceLabels: Record<Source, string> = { freesound: 'Freesound', pexels: 'Pexels', pixabay: 'Pixabay' }
const sourceSite: Record<Source, string> = { freesound: 'https://freesound.org', pexels: 'https://www.pexels.com', pixabay: 'https://pixabay.com' }
const licenseClass = (s: string) => (s === 'public_domain' ? 'pill ok' : s === 'restricted' ? 'pill warn' : 'pill info')

/**
 * Search free media banks and import into the project Biblioteca with license and author recorded.
 * Search results are previews from the bank; nothing is stored until "Importar" is pressed.
 */
export function StockBrowser({ kind, projectId, sceneId, defaultQuery = '', importAs, onImported }: {
  kind: Kind; projectId: string; sceneId?: string | null; defaultQuery?: string; importAs?: 'music' | 'sfx'
  onImported?: (assetId: string) => void
}) {
  const [sources, setSources] = useState<Array<{ id: Source; configured: boolean; kinds: Kind[] }>>([])
  const [source, setSource] = useState<Source | ''>('')
  const [q, setQ] = useState(defaultQuery)
  const [cc0, setCc0] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/stock/search', { cache: 'no-store' }).then(r => r.ok ? r.json() : { sources: [] }).then(j => {
      const list = (j.sources ?? []) as Array<{ id: Source; configured: boolean; kinds: Kind[] }>
      setSources(list)
      const first = list.find(s => s.configured && s.kinds.includes(kind)) ?? list.find(s => s.kinds.includes(kind))
      if (first) setSource(first.id)
    }).catch(() => {})
  }, [kind])
  useEffect(() => { setQ(defaultQuery) }, [defaultQuery])

  const available = sources.filter(s => s.kinds.includes(kind))
  const current = sources.find(s => s.id === source)

  async function search(e?: FormEvent) {
    e?.preventDefault()
    if (!source || !q.trim()) return
    setBusy(true); setMessage('')
    const params = new URLSearchParams({ source, kind, q: q.trim(), ...(cc0 ? { cc0: '1' } : {}) })
    const r = await fetch(`/api/stock/search?${params}`)
    const j = await r.json().catch(() => ({})) as { items?: Item[]; error?: string }
    setBusy(false)
    if (!r.ok) { setMessage(j.error ?? 'Búsqueda no disponible.'); setItems([]); return }
    setItems(j.items ?? [])
    if (!j.items?.length) setMessage('Sin resultados. Prueba en inglés o con menos palabras.')
  }

  async function importItem(item: Item) {
    if (!projectId) { setMessage('Elige un proyecto antes de importar.'); return }
    setImporting(item.id); setMessage('')
    const r = await fetch('/api/stock/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: item.source, kind: item.kind, id: item.id, projectId, sceneId: sceneId || null, as: importAs }) })
    const j = await r.json().catch(() => ({})) as { asset?: { id: string }; duplicate?: boolean; error?: string }
    setImporting('')
    if (!r.ok || !j.asset) { setMessage(j.error ?? 'No se pudo importar.'); return }
    setMessage(j.duplicate ? 'Ya estaba en la Biblioteca de este proyecto.' : `Importado con su licencia (${item.license}).`)
    onImported?.(j.asset.id)
  }

  return (
    <div className="stockBrowser">
      <form className="stockBar" onSubmit={search}>
        <select aria-label="Banco gratuito" value={source} onChange={e => { setSource(e.target.value as Source); setItems([]) }}>
          {available.map(s => <option key={s.id} value={s.id}>{sourceLabels[s.id]}{s.configured ? '' : ' (sin clave)'}</option>)}
        </select>
        <input aria-label="Buscar en el banco" value={q} onChange={e => setQ(e.target.value)} placeholder={kind === 'audio' ? 'rain jungle night, thunder…' : 'jungle aerial, airplane cabin 1970s…'} />
        <button type="submit" className="ghost" disabled={busy || !current?.configured || !q.trim()}><Icon name="search" size={14} />{busy ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {kind === 'audio' && <label className="toggle small"><input type="checkbox" checked={cc0} onChange={e => setCc0(e.target.checked)} /> Solo dominio público (CC0, sin atribución)</label>}
      {current && !current.configured && <p className="muted small">Configura {current.id === 'freesound' ? 'FREESOUND_API_KEY' : current.id === 'pexels' ? 'PEXELS_API_KEY' : 'PIXABAY_API_KEY'} en Vercel (clave gratuita del sitio).</p>}
      {message && <p className="muted small" role="status">{message}</p>}
      {items.length > 0 && (
        <div className={kind === 'audio' ? 'stockList' : 'stockGrid'}>
          {items.map(item => (
            <div key={`${item.source}-${item.id}`} className="stockItem">
              {item.kind === 'image' && item.thumbUrl && <img src={item.thumbUrl} alt={item.title} loading="lazy" />}
              {item.kind === 'video' && <video src={item.previewUrl ?? undefined} poster={item.thumbUrl ?? undefined} muted playsInline preload="none" controls />}
              {item.kind === 'audio' && <audio src={item.previewUrl ?? undefined} controls preload="none" />}
              <div className="stockMeta">
                <b title={item.title}>{item.title}</b>
                <span>{item.author}{item.durationSeconds ? ` · ${Math.round(item.durationSeconds)} s` : ''}{item.width ? ` · ${item.width}×${item.height}` : ''}</span>
                <span className={licenseClass(item.licenseStatus)} title={item.attribution}>{item.license}</span>
              </div>
              <div className="pageActions">
                <a className="buttonLink ghost small" href={item.pageUrl} target="_blank" rel="noopener noreferrer">Ver</a>
                <button type="button" className="small" disabled={Boolean(importing)} onClick={() => void importItem(item)}>{importing === item.id ? 'Importando…' : 'Importar'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {source && <p className="muted small">Contenido de <a className="open" href={sourceSite[source as Source]} target="_blank" rel="noopener noreferrer">{sourceLabels[source as Source]}</a>. Se guarda la licencia y el autor de cada archivo.</p>}
    </div>
  )
}
