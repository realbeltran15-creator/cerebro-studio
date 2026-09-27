'use client'

import { useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

type Connector = { id: string; provider: string; capability: string; enabled: boolean; updated_at: string }
type Runtime = { id: string; capability: string; enabled: boolean; health: string }
type Channel = { id: string; external_account_name: string | null; status: string; scopes: string[]; updated_at: string }

const oauthMessages: Record<string, [string, 'notice' | 'error']> = {
  connected: ['Canal de YouTube conectado.', 'notice'],
  denied: ['Cancelaste la autorización en Google.', 'error'],
  invalid_state: ['La autorización caducó o no coincide con tu sesión. Vuelve a intentarlo.', 'error'],
  no_channel: ['La cuenta de Google elegida no tiene canal de YouTube.', 'error'],
  exchange_failed: ['Google no aceptó la autorización. Revisa que la URI de redirección esté registrada en el cliente OAuth.', 'error'],
  save_failed: ['No se pudo guardar la conexión.', 'error'],
  not_configured: ['La conexión con YouTube no está configurada en el servidor.', 'error'],
}

const capabilityLabels: Record<string, string> = { image: 'Imagen', video: 'Vídeo', voice: 'Voz', render: 'Render', text: 'Texto', research: 'Investigación', automation: 'Automatización', channel: 'Canal' }
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'

export default function ConnectorsPage() {
  const supabase = getSupabaseBrowserClient()
  const [rows, setRows] = useState<Connector[]>([])
  const [runtime, setRuntime] = useState<Runtime[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [db, res, ch] = await Promise.all([
      supabase.from('connector_configs').select('id,provider,capability,enabled,updated_at').order('provider'),
      fetch('/api/providers/status', { cache: 'no-store' }),
      supabase.from('channel_connections').select('id,external_account_name,status,scopes,updated_at').eq('provider', 'youtube').order('updated_at', { ascending: false }),
    ])
    if (db.error) setError(db.error.message); else setRows((db.data ?? []) as Connector[])
    if (res.ok) { const json = await res.json() as { providers?: Runtime[] }; setRuntime(json.providers ?? []) } else setError(v => v || 'No se pudo leer el estado de proveedores.')
    setChannels((ch.data ?? []) as Channel[])
  }, [supabase])

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('youtube')
    if (status && oauthMessages[status]) {
      const [msg, kind] = oauthMessages[status]
      if (kind === 'notice') setNotice(msg); else setError(msg)
      window.history.replaceState(null, '', '/connectors')
    }
    void load()
  }, [load])

  async function disconnect() {
    if (!window.confirm('¿Desconectar el canal? Se revocará el acceso en Google y se borrarán las credenciales guardadas.')) return
    const r = await fetch('/api/oauth/youtube/disconnect', { method: 'POST' })
    if (!r.ok) setError('No se pudo desconectar.'); else { setNotice('Canal desconectado.'); await load() }
  }

  const oauthReady = runtime.some(p => p.id === 'youtube-oauth' && p.enabled)
  const connected = channels.find(c => c.status === 'connected')
  const ready = runtime.filter(p => p.health === 'ready' && p.enabled).length

  return <StudioShell title="Conectores">
    <div className="hero"><div><small>INTEGRACIONES</small><h2>Estado real de proveedores</h2><p>Estado de ejecución leído desde el servidor. Las credenciales y tokens permanecen exclusivamente en variables seguras del servidor o cifrados en la base de datos.</p></div><div className="status"><b>{ready}/{runtime.length}</b><span>proveedores listos</span></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <h3>Canal de YouTube</h3>
    <section className="panel" style={{ margin: '10px 0 18px' }}>
      {!oauthReady ? <p className="muted">Pendiente de configurar en el servidor: <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code> y <code>TOKEN_ENCRYPTION_KEY</code>.</p>
        : connected ? <>
          <p><b>{connected.external_account_name ?? 'Canal conectado'}</b> · conectado el {new Date(connected.updated_at).toLocaleString()}</p>
          <p className="muted small">Permisos: Analytics (solo lectura){connected.scopes.includes(UPLOAD_SCOPE) ? ' · subida de vídeos (cada publicación exige tu aprobación)' : ''}</p>
          <div className="pageActions" style={{ marginTop: 10 }}>
            {!connected.scopes.includes(UPLOAD_SCOPE) && <a className="buttonLink ghost" href="/api/oauth/youtube/start?scope=publish">Permitir subida de vídeos</a>}
            <button type="button" className="ghost" onClick={() => void disconnect()}>Desconectar</button>
          </div>
        </> : <>
          <p className="muted small">Conecta tu canal para importar YouTube Analytics. Solo se piden permisos de lectura; la subida de vídeos se autoriza aparte y cada publicación requiere tu aprobación.</p>
          <div className="pageActions" style={{ marginTop: 10 }}><a className="buttonLink" href="/api/oauth/youtube/start?scope=analytics">Conectar canal de YouTube</a></div>
        </>}
    </section>

    <h3>Runtime</h3>
    <div className="grid">{runtime.map(c => <article key={c.id}><small>{capabilityLabels[c.capability] ?? c.capability}</small><h3>{c.id}</h3><p>Estado: {c.enabled ? c.health : 'sin configurar'}</p></article>)}</div>
    {rows.length > 0 && <><h3>Configuración registrada</h3><div className="grid">{rows.map(c => <article key={c.id}><small>{c.capability}</small><h3>{c.provider}</h3><p>Estado: {c.enabled ? 'Habilitado' : 'Deshabilitado'}</p></article>)}</div></>}
  </StudioShell>
}
