'use client'

import { useEffect, useState } from 'react'
import { authLabels, tierLabels, type ProviderInfo } from '@/lib/providers/directory'
import { modalityLabels } from '@/lib/providers/catalog'

type Dir = ProviderInfo & { configured: boolean }
type ModelLite = { id: string; provider: string; modality: keyof typeof modalityLabels; label: string; ready: boolean }
type TextInfo = { models: Array<{ id: string; label: string; model: string; tier: keyof typeof tierLabels; quality: number; priceNote: string; configured: boolean }>; tasks: Array<{ task: string; label: string; minQuality: number }> }
type SttInfo = Array<{ id: string; label: string; tier: keyof typeof tierLabels; quality: number; note: string; configured: boolean }>

const apiLabels = { official: 'API oficial', official_preview: 'API oficial (preview)', no_public_api: 'Sin API pública' } as const

/** Every provider Cerebro knows, how it is paid for, how it authenticates and whether it is configured. */
export function ProviderDirectory() {
  const [dir, setDir] = useState<Dir[]>([])
  const [models, setModels] = useState<ModelLite[]>([])
  const [text, setText] = useState<TextInfo | null>(null)
  const [stt, setStt] = useState<SttInfo>([])
  useEffect(() => {
    fetch('/api/studio/catalog', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j) { setDir(j.providers); setModels(j.models); setText(j.text ?? null); setStt(j.transcription ?? []) } }).catch(() => {})
  }, [])
  if (!dir.length) return null
  return <>
    <h3 className="sectionTitle">Proveedores de generación y bancos de medios</h3>
    <div className="provGrid">
      {dir.map(p => {
        const ms = models.filter(m => m.provider === p.id)
        return (
          <article key={p.id} className="provCard">
            <div className="cardHead" style={{ marginBottom: 0 }}><h3>{p.name}</h3><span className={p.configured ? 'pill ok' : 'pill'}>{p.api === 'no_public_api' ? 'Sin API' : p.configured ? 'Configurado' : p.env.length ? 'Sin clave' : '—'}</span></div>
            <div className="modelBadges"><span className={`tierBadge tier-${p.tier}`}>{tierLabels[p.tier]}</span><span className="pill">{authLabels[p.auth]}</span><span className="pill">{apiLabels[p.api]}</span></div>
            <p>{p.allowance}</p>
            {ms.length > 0 && <p className="muted small">Modelos: {ms.map(m => `${m.label} (${modalityLabels[m.modality]})`).join(' · ')}</p>}
            <p className="muted small">{p.terms}</p>
            {p.notes && <p className="muted small">{p.notes}</p>}
            {p.env.length > 0 && !p.configured && <p className="modelMissing">Variables en Vercel: {p.env.join(', ')}</p>}
            <p className="muted small">Comprobado {p.verifiedAt} · <a className="open" href={p.docsUrl} target="_blank" rel="noopener noreferrer">Documentación</a>{p.pricingUrl && p.pricingUrl !== p.docsUrl ? <> · <a className="open" href={p.pricingUrl} target="_blank" rel="noopener noreferrer">Precios</a></> : null}</p>
          </article>
        )
      })}
    </div>

    {text && <>
      <h3 className="sectionTitle">Texto y razonamiento (calidad primero)</h3>
      <section className="panel">
        <p className="muted small" style={{ marginBottom: 10 }}>Cada tarea exige una calidad mínima. Entre los modelos configurados que la alcanzan se usa primero el gratuito, luego el de menor coste; si uno falla se prueba el siguiente que también la alcance.</p>
        <div style={{ overflowX: 'auto' }}><table className="dataTable">
          <thead><tr><th>Modelo</th><th>Coste</th><th>Calidad</th><th>Estado</th><th>Precio</th></tr></thead>
          <tbody>{text.models.map(m => <tr key={m.id}><td>{m.label}<br /><span className="muted small">{m.model}</span></td><td><span className={`tierBadge tier-${m.tier}`}>{tierLabels[m.tier]}</span></td><td>{'★'.repeat(m.quality)}</td><td>{m.configured ? <span className="pill ok">Configurado</span> : <span className="pill">Sin clave</span>}</td><td className="small">{m.priceNote}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small" style={{ marginTop: 10 }}>Calidad mínima por tarea: {text.tasks.map(t => `${t.label} ${t.minQuality}/5`).join(' · ')}</p>
      </section>
    </>}
    {stt.length > 0 && <>
      <h3 className="sectionTitle">Transcripción y subtítulos</h3>
      <section className="panel"><div className="list">{stt.map(m => <div key={m.id} className="listItem"><div><b>{m.label}</b><span>{m.note}</span></div><span className={m.configured ? 'pill ok' : 'pill'}>{m.configured ? 'Configurado' : 'Sin clave'}</span></div>)}</div></section>
    </>}

    <h3 className="sectionTitle">Google Flow: qué se puede integrar</h3>
    <section className="panel">
      <div className="flowGrid">
        <div><b>1 · Flow (producto)</b>Interfaz web de Google para crear vídeo. Los créditos de Flow de Google AI Pro (1.000/mes) y Ultra (10.000/mes) solo se usan dentro de Flow. No tiene API pública: Cerebro no lo automatiza con métodos no oficiales.</div>
        <div><b>2 · Modelos de Google</b>Veo 3.1 (vídeo con audio), Imagen, Nano Banana / Gemini image, Lyria (música) y Gemini TTS (voz).</div>
        <div><b>3 · APIs oficiales integradas</b>Gemini API con <code>GEMINI_API_KEY</code>: Veo 3.1 Fast (vídeo) y Gemini TTS (voz, con nivel gratuito). Vertex AI ofrece los mismos modelos con cuenta de Google Cloud.</div>
        <div><b>Créditos aprovechables</b>Google AI Pro incluye $10/mes y Ultra $40/mes en créditos de Google Cloud (Google Developer Program). Esos créditos son de Google Cloud, no de Flow; comprueba en la consola de facturación que se aplican al proyecto de la API antes de generar vídeo.</div>
      </div>
    </section>
  </>
}
