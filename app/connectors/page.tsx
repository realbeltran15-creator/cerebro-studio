'use client'

import { useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { ProviderDirectory } from '../components/provider-directory'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { AdminHint } from '../components/admin-hint'

type Connector = { id: string; provider: string; capability: string; enabled: boolean; updated_at: string }
type Runtime = { id: string; capability: string; enabled: boolean; health: string }
type Pending = { channelId: string; channelName: string | null; handle: string | null; canUpload: boolean; expiresAt: number }
type Channel = { id: string; external_account_id: string; external_account_name: string | null; status: string; scopes: string[]; updated_at: string }

/** Plain-language state of a service: what it means for the person using the app, not the internal health code. */
function serviceState(enabled: boolean, health: string): { label: string; cls: string; help: string } {
  if (!enabled || health === 'unconfigured') return { label: 'Falta configurarlo', cls: 'state-not_implemented', help: 'No está activado en este servidor, así que no se puede usar todavía. Quien administra Cerebro Studio debe añadir su acceso.' }
  if (health === 'degraded') return { label: 'Funciona con problemas', cls: 'state-partial', help: 'Está activado, pero la última comprobación falló. Pulsa «Comprobar» (no tiene coste) para ver el motivo.' }
  return { label: 'Listo para usar', cls: 'state-functional', help: 'Está activado y puede usarse.' }
}
const SERVICE_NAMES: Record<string, string> = { elevenlabs: 'ElevenLabs (voz y música)', openai: 'OpenAI', gemini: 'Google Gemini', cloudflare: 'Cloudflare Workers AI', fal: 'fal.ai', freesound: 'Freesound', pexels: 'Pexels', pixabay: 'Pixabay', kling: 'Kling', topmediai: 'TopMediai', higgsfield: 'Higgsfield', alibaba: 'Alibaba Wan', youtube: 'YouTube' }
const serviceName = (id: string) => SERVICE_NAMES[id] ?? SERVICE_NAMES[id.split(/[-:_]/)[0]] ?? id.replace(/[-_]+/g, ' ')

const oauthMessages: Record<string, [string, 'notice' | 'error']> = {
  connected: ['Canal de YouTube conectado.', 'notice'],
  pending: ['Google autorizó una cuenta. Comprueba el canal y su ID antes de confirmarlo: hasta entonces no se usa para nada.', 'notice'],
  denied: ['Cancelaste la autorización en Google.', 'error'],
  invalid_state: ['La autorización caducó o no coincide con tu sesión. Vuelve a intentarlo.', 'error'],
  no_channel: ['La cuenta de Google elegida no tiene canal de YouTube.', 'error'],
  exchange_failed: ['Google no aceptó la autorización. Inténtalo de nuevo; si se repite, avisa a quien administra Cerebro Studio (la dirección de retorno de la conexión no coincide).', 'error'],
  save_failed: ['No se pudo guardar la conexión.', 'error'],
  not_configured: ['La conexión con YouTube todavía no está activada en este servidor. Avisa a quien administra Cerebro Studio.', 'error'],
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
  const [checks, setChecks] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)

  const load = useCallback(async () => {
    // A failed or non-JSON status response (network error, proxy error page) must show a message, not crash the page.
    const status = fetch('/api/providers/status', { cache: 'no-store' })
      .then(async res => res.ok ? { providers: ((await res.json()) as { providers?: Runtime[] }).providers ?? [] } : null)
      .catch(() => null)
    const [db, providers, ch] = await Promise.all([
      supabase.from('connector_configs').select('id,provider,capability,enabled,updated_at').neq('provider', 'cerebro-editor').order('provider'),
      status,
      supabase.from('channel_connections').select('id,external_account_id,external_account_name,status,scopes,updated_at').eq('provider', 'youtube').order('updated_at', { ascending: false }),
    ])
    if (db.error) setError(db.error.message); else setRows((db.data ?? []) as Connector[])
    if (providers) setRuntime(providers.providers); else setError(v => v || 'No se pudo leer el estado de proveedores.')
    setChannels((ch.data ?? []) as Channel[])
    try { const r = await fetch('/api/oauth/youtube/pending', { cache: 'no-store' }); setPending(r.ok ? ((await r.json()) as { pending: Pending | null }).pending : null) } catch { setPending(null) }
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

  const checkable = [['fal', 'fal.ai'], ['cloudflare', 'Cloudflare'], ['gemini', 'Gemini'], ['topmediai', 'TopMediai']] as const
  async function check(provider: string, label: string) {
    setChecking(provider); setChecks(c => ({ ...c, [provider]: '' }))
    try {
      const res = await fetch('/api/providers/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) })
      const data = await res.json().catch(() => null) as { message?: string; error?: string; details?: Record<string, unknown> } | null
      const extra = data?.details ? ` (${Object.entries(data.details).map(([k, v]) => `${k}: ${String(v)}`).join(', ')})` : ''
      setChecks(c => ({ ...c, [provider]: `${label}: ${data?.message ?? data?.error ?? 'no se pudo comprobar.'}${extra}` }))
    } catch { setChecks(c => ({ ...c, [provider]: `${label}: no se pudo comprobar.` })) }
    finally { setChecking('') }
  }

  async function disconnect() {
    if (!window.confirm('¿Desconectar el canal? Se revocará el acceso en Google y se borrarán las credenciales guardadas.')) return
    const r = await fetch('/api/oauth/youtube/disconnect', { method: 'POST' })
    if (!r.ok) setError('No se pudo desconectar.'); else { setNotice('Canal desconectado.'); await load() }
  }

  const oauthReady = runtime.some(p => p.id === 'youtube-oauth' && p.enabled)
  const connected = channels.find(c => c.status === 'connected')
  const expired = !connected && channels.find(c => c.status === 'expired')
  async function decide(p: Pending, decision: 'confirm' | 'discard') {
    setError(''); setNotice('')
    const r = await fetch('/api/oauth/youtube/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: p.channelId, decision }) })
    const j = await r.json().catch(() => ({})) as { error?: string }
    if (!r.ok) { setError(j.error ?? 'No se pudo completar.'); await load(); return }
    setNotice(decision === 'confirm' ? `Canal confirmado: ${p.channelName ?? ''} (${p.channelId}).` : 'Autorización descartada. No se ha guardado ningún canal.')
    await load()
  }
  const ready = runtime.filter(p => p.health === 'ready' && p.enabled).length

  return <StudioShell title="Conectores">
    <div className="hero"><div><small>INTEGRACIONES</small><h2>Estado real de proveedores</h2><p>Estado de ejecución leído desde el servidor. Las credenciales y tokens permanecen exclusivamente en variables seguras del servidor o cifrados en la base de datos.</p></div><div className="status"><b>{ready}/{runtime.length}</b><span>proveedores listos</span></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    <h3>Canal de YouTube</h3>
    <section className="panel" style={{ margin: '10px 0 18px' }}>
      {!oauthReady ? <div><p className="muted">La conexión con YouTube todavía no está activada en este servidor. Quien administra Cerebro Studio debe completar su configuración; mientras tanto no puedes conectar tu canal.</p><AdminHint names={['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY']} /></div>
        : pending ? <div role="region" aria-label="Confirmar canal de YouTube">
          <p><b>¿Es este el canal correcto?</b></p>
          <p>Canal: <b>{pending.channelName ?? 'sin nombre'}</b>{pending.handle ? ` (${pending.handle})` : ''}<br />ID del canal: <code>{pending.channelId}</code><br />Permiso de subida: {pending.canUpload ? 'sí' : 'no (solo lectura)'}</p>
          <p className="muted small">Comprueba el ID en YouTube Studio → Configuración → Canal → Configuración avanzada. Hasta que lo confirmes no se guarda ni se usa para nada; si no lo confirmas en 15 minutos, se descarta sola. {connected ? `Si confirmas, sustituirá a «${connected.external_account_name ?? connected.external_account_id}».` : ''}</p>
          <div className="pageActions" style={{ marginTop: 10 }}>
            <button type="button" onClick={() => void decide(pending, 'confirm')}>Confirmar este canal</button>
            <button type="button" className="ghost" onClick={() => void decide(pending, 'discard')}>No es este: descartar</button>
          </div>
        </div>
        : connected ? <>
          <p><b>{connected.external_account_name ?? 'Canal conectado'}</b> · conectado el {new Date(connected.updated_at).toLocaleString()}</p>
          <p className="muted small">ID del canal: <code>{connected.external_account_id}</code></p>
          <p className="muted small">Permisos: Analytics (solo lectura){connected.scopes.includes(UPLOAD_SCOPE) ? ' · subida de vídeos (cada publicación exige tu aprobación)' : ''}</p>
          <div className="pageActions" style={{ marginTop: 10 }}>
            {!connected.scopes.includes(UPLOAD_SCOPE) && <a className="buttonLink ghost" href="/api/oauth/youtube/start?scope=publish">Permitir subida de vídeos</a>}
            <a className="buttonLink ghost" href="/api/oauth/youtube/start?scope=publish">Cambiar de cuenta o canal</a>
            <button type="button" className="ghost" onClick={() => void disconnect()}>Desconectar</button>
          </div>
        </> : <>
          {expired && <p className="warnBox small">La autorización de «{expired.external_account_name ?? expired.external_account_id}» (ID <code>{expired.external_account_id}</code>) caducó o se revocó en Google: no se puede usar. Si la app de Google está en modo «Testing», caduca a los 7 días. Vuelve a conectar el canal.</p>}
          <p className="muted small">Google te mostrará el selector de cuentas: elige la cuenta que administra el canal. Antes de usarlo verás su nombre e ID para confirmarlo. Cada publicación requiere además tu aprobación.</p>
          <div className="pageActions" style={{ marginTop: 10 }}>
            <a className="buttonLink" href="/api/oauth/youtube/start?scope=publish">Conectar canal (con permiso de subida)</a>
            <a className="buttonLink ghost" href="/api/oauth/youtube/start?scope=analytics">Conectar solo lectura</a>
          </div>
        </>}
    </section>

    <h3>Estado de los servicios</h3>
    <div className="pageActions" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
      {checkable.map(([id, label]) => <button key={id} type="button" className="ghost" onClick={() => void check(id, label)} disabled={Boolean(checking)}>{checking === id ? 'Comprobando…' : `Comprobar ${label} (sin coste)`}</button>)}
    </div>
    {Object.values(checks).filter(Boolean).map(m => <p key={m} role="status" className="muted small">{m}</p>)}
    <div className="grid">{runtime.map(c => { const st = serviceState(c.enabled, c.health); return <article key={c.id}><small>{capabilityLabels[c.capability] ?? c.capability}</small><h3>{serviceName(c.id)}</h3><p><span className={`stateBadge ${st.cls}`}>{st.label}</span></p><p className="muted small">{st.help}</p></article> })}</div>
    {rows.length > 0 && <><h3>Servicios que has activado o desactivado</h3><div className="grid">{rows.map(c => <article key={c.id}><small>{capabilityLabels[c.capability] ?? c.capability}</small><h3>{serviceName(c.provider)}</h3><p>{c.enabled ? 'Activado por ti' : 'Desactivado por ti'}</p></article>)}</div></>}
    <ProviderDirectory />
  </StudioShell>
}
