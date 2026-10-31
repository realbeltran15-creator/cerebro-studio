'use client'

import { useMemo, useState } from 'react'
import type { Composition } from '@/lib/editor/composition'
import { FLOW_URL } from '@/lib/flow-import'
import { applyFlowClips, flowPromptPack, parseShortsInstruction, SHORT_MODES, veoEstimate, type ShortMode } from '@/lib/shorts/modes'
import { FlowImport } from './flow-import'

type Asset = { id: string; asset_type: string; source_provider?: string | null; provenance?: unknown; created_at?: string }

/** Choose how the pictures of this Short are made by writing an instruction; nothing paid runs from here. */
export function ShortsModesPanel({ projectId, composition, assets, onApply, onReload }: {
  projectId: string; composition: Composition; assets: Asset[]; onApply: (c: Composition) => void; onReload: () => void
}) {
  const [mode, setMode] = useState<ShortMode>('free')
  const [text, setText] = useState('')
  const [style, setStyle] = useState('')
  const [msg, setMsg] = useState('')
  const pack = useMemo(() => flowPromptPack({ title: '', description: '', hashtags: [], scenes: composition.clips.map(c => ({ narration: c.narration ?? "", visual: `Escena que ilustra, sin texto en pantalla: ${c.narration ?? ""}`, onScreenText: '' })) }, style), [composition, style])

  function interpret() {
    const m = parseShortsInstruction(text)
    if (m) { setMode(m); setMsg(`Modo elegido: ${SHORT_MODES.find(x => x.id === m)!.label}.`) } else setMsg('No encontré «gratis», «Flow» ni «Veo» en la instrucción; sigo con el modo actual.')
  }
  function apply() {
    const r = applyFlowClips(composition, assets)
    if (!r.applied) { setMsg('No hay vídeos de Flow importados para aplicar todavía.'); return }
    onApply(r.composition); setMsg(`${r.applied} escena(s) usan ahora su clip de Flow. Se volverá a renderizar.`)
  }

  return (
    <section className="panel" aria-labelledby="sh-modes">
      <h3 id="sh-modes">Cómo se hacen las imágenes</h3>
      <label htmlFor="sh-instr">Instrucción (por ejemplo «hazlo con Flow»)
        <input id="sh-instr" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') interpret() }} />
      </label>
      <div className="chips" style={{ alignItems: 'center' }}>
        <button type="button" className="ghost" onClick={interpret}>Interpretar</button>
        {SHORT_MODES.map(m => <button key={m.id} type="button" className={mode === m.id ? 'primary' : 'ghost'} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>)}
      </div>
      <p className="muted small" role="status">{SHORT_MODES.find(m => m.id === mode)!.cost}. {msg}</p>

      {mode === 'free' && <p className="small">Es lo que ya se generó: imágenes libres con voz gratuita.</p>}

      {mode === 'flow' && <>
        <p className="small">1) Copia el prompt de cada escena en <a href={FLOW_URL} target="_blank" rel="noopener noreferrer">Google Flow</a> (vertical, 8 s). 2) Importa los vídeos abajo. 3) Pulsa «Usar clips de Flow».</p>
        <label htmlFor="sh-style">Estilo común (opcional)
          <input id="sh-style" value={style} onChange={e => setStyle(e.target.value)} maxLength={300} placeholder="p. ej. fotorrealista, luz cálida" />
        </label>
        <ol className="list">{pack.map(p => <li key={p.scene} className="listItem"><span className="small">{p.prompt}</span>{' '}
          <button type="button" className="ghost" onClick={() => void navigator.clipboard?.writeText(p.prompt).then(() => setMsg(`Prompt de la escena ${p.scene} copiado.`))}>Copiar</button></li>)}</ol>
        <FlowImport projectId={projectId} onImported={onReload} />
        <button type="button" onClick={apply}>Usar clips de Flow</button>
        <p className="muted small">Los clips de Flow miden 8 s; si una escena dura más, el último fotograma se mantiene. El resto de la composición (voz, textos, música) no cambia.</p>
      </>}

      {mode === 'veo' && <>
        <p className="small">Veo de pago por segundo (720p): {composition.clips.length} escenas × 8 s ≈ <b>{veoEstimate(composition.clips.length, 'lite')}–{veoEstimate(composition.clips.length, 'standard')} USD</b> según el nivel (Lite {veoEstimate(composition.clips.length, 'lite')}, Fast {veoEstimate(composition.clips.length, 'fast')}, Standard {veoEstimate(composition.clips.length, 'standard')}).</p>
        <p className="muted small">Desde aquí no se lanza nada de pago. Requiere facturación en la API de Gemini; cuando quieras gastarlo, genera cada clip en el generador de vídeo con un modelo Veo (te pide confirmación) e impórtalo como proyecto propio.</p>
      </>}
    </section>
  )
}
