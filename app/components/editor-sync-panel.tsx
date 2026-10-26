'use client'

import { useMemo, useState } from 'react'
import type { Clip, Composition } from '@/lib/editor/composition'
import { cutBeatAlignment, syncCutsToBeats } from '@/lib/editor/sync'
import { cutSfxClips, defaultCutSfx, removeCutSfx, setCutSfx } from '@/lib/editor/cut-sfx'
import { assetLabel, type EditorAsset } from '@/lib/editor/client'
import type { BeatSummary } from '@/lib/editor/beat-summary'


/**
 * Cuts on the beat of the music, and sound effects on the cuts. The beats are measured from the music files of this montage (see beats.ts);
 * moving the cuts is one undoable step, and the panel says exactly which cuts moved and which could not.
 */
const ON_BEAT_MS = 60

export function EditorSyncPanel({ comp, assets, beats, showBeats, setShowBeats, snap, setSnap, toleranceMs, setToleranceMs, isVideo, apply, onNotice }: {
  comp: Composition; assets: EditorAsset[]; beats: BeatSummary
  showBeats: boolean; setShowBeats: (v: boolean) => void; snap: boolean; setSnap: (v: boolean) => void; toleranceMs: number; setToleranceMs: (v: number) => void
  isVideo: (clip: Clip) => boolean
  apply: (fn: (c: Composition) => Composition) => void; onNotice: (msg: string) => void
}) {
  const sfxAssets = useMemo(() => assets.filter(a => a.asset_type === 'sfx' || a.asset_type === 'audio'), [assets])
  const [sfxId, setSfxId] = useState('')
  const [volume, setVolume] = useState(0.8)
  const [timing, setTiming] = useState<'at' | 'after' | 'before'>('at')
  const [offset, setOffset] = useState(120)
  const [every, setEvery] = useState(1)
  const label = (id: string) => { const a = assets.find(x => x.id === id); return a ? assetLabel(a) : id }
  // «On the beat» is read tightly (±60 ms) whatever the margin used to MOVE cuts, so the figure shows how close the cuts really are.
  const align = useMemo(() => (beats.beatsMs.length ? cutBeatAlignment(comp, beats.beatsMs, ON_BEAT_MS) : null), [comp, beats.beatsMs])
  const placed = cutSfxClips(comp).length
  const regular = beats.bpm !== null && beats.confidence >= 0.2

  function syncNow() {
    const r = syncCutsToBeats(comp, beats.beatsMs, { toleranceMs, isVideo })
    if (!r.moved.length) { onNotice(r.skipped.length ? `Ningún corte se pudo mover: ${[...new Set(r.skipped.map(s => s.reason))].join('; ')}.` : r.alreadyOn ? 'Todos los cortes que tienen un pulso cerca ya están en él.' : `Ningún corte tiene un pulso a menos de ${toleranceMs} ms.`); return }
    apply(() => r.composition)
    onNotice(`${r.moved.length} corte${r.moved.length === 1 ? '' : 's'} movido${r.moved.length === 1 ? '' : 's'} al pulso (${r.moved.slice(0, 4).map(m => `${(m.fromMs / 1000).toFixed(2)} → ${(m.toMs / 1000).toFixed(2)} s`).join(', ')}${r.moved.length > 4 ? '…' : ''}). ${r.alreadyOn ? `${r.alreadyOn} ya estaban en el pulso. ` : ''}${r.skipped.length ? `${r.skipped.length} no se movieron (${[...new Set(r.skipped.map(s => s.reason))].join('; ')}). ` : ''}Puedes deshacerlo.`)
  }
  function putSfx() {
    const r = setCutSfx(comp, { ...defaultCutSfx(sfxId), volume, every, offsetMs: timing === 'after' ? offset : 0, preMs: timing === 'before' ? offset : 0 })
    if (!r.added) { onNotice('Hacen falta al menos dos clips para que haya cortes.'); return }
    apply(() => r.composition)
    onNotice(`Efecto «${label(sfxId)}» colocado en ${r.added} corte${r.added === 1 ? '' : 's'}. Si ya habías puesto efectos con esta función, se han sustituido; los que pusiste a mano no se tocan.`)
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }} aria-label="Cortes con la música y efectos">
    <div className="cardHead" style={{ marginBottom: 0 }}><h3>Cortes con la música y efectos</h3>
      {beats.analysing > 0 ? <span className="pill info" role="status">Analizando {beats.analysing} pista{beats.analysing === 1 ? '' : 's'}…</span> : beats.beatsMs.length ? <span className="pill ok">{beats.beatsMs.length} pulsos{beats.bpm ? ` · ~${Math.round(beats.bpm)} BPM` : ''}</span> : <span className="pill">Sin pulsos medidos</span>}</div>
    {beats.tracks === 0 && <p className="muted small">Añade música (en la pista de música o como música de fondo) y Cerebro medirá su pulso en tu navegador, sin subir nada.</p>}
    {beats.failed > 0 && <p className="muted small">No se pudo analizar {beats.failed} pista{beats.failed === 1 ? '' : 's'} de audio en este navegador; se ignoran.</p>}
    {beats.beatsMs.length > 0 && <>
      {!regular && <p className="notice small" role="note">La música no tiene un pulso regular claro (regularidad {Math.round(beats.confidence * 100)} %). Los marcadores son golpes reales del audio, pero pueden no ser un compás.</p>}
      <div className="field-row" style={{ alignItems: 'end' }}>
        <label className="pill"><input type="checkbox" checked={showBeats} onChange={e => setShowBeats(e.target.checked)} /> Mostrar pulsos en la línea de tiempo</label>
        <label className="pill"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Imán: al arrastrar, los bordes saltan al pulso</label>
        <label>Margen ({toleranceMs} ms)<input type="range" min={40} max={300} step={10} value={toleranceMs} onChange={e => setToleranceMs(Number(e.target.value))} /></label>
      </div>
      <p className="small" aria-live="polite">{align && align.share !== null ? `${align.onBeat} de ${align.cuts} cortes caen en un pulso (±${ON_BEAT_MS} ms)${align.medianMissMs !== null && align.share < 1 ? `; el fallo típico es de ${align.medianMissMs} ms` : ''}.` : 'Este montaje no tiene cortes todavía.'}</p>
      <div className="pageActions"><button type="button" onClick={syncNow} disabled={comp.clips.length < 2}>Mover los cortes al pulso</button></div>
      <p className="muted small">Mueve cada corte al pulso más cercano dentro del margen. La duración total no cambia, ningún clip baja de 1 s y no se tocan los cortes junto a una voz.</p>
    </>}

    <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
    <b>Efecto de sonido en los cortes</b>
    {sfxAssets.length === 0 ? <p className="muted small">No hay efectos en la Biblioteca. Importa un audio como «Efecto» (arriba, en «Añadir») y aparecerá aquí.</p> : <>
      <div className="field-row" style={{ alignItems: 'end' }}>
        <label>Efecto<select value={sfxId} onChange={e => setSfxId(e.target.value)}><option value="">— Elegir</option>{sfxAssets.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select></label>
        <label>Volumen de los efectos en cortes ({Math.round(volume * 100)}%)<input type="range" min={0.1} max={1.5} step={0.05} value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
        <label>Cuándo<select value={timing} onChange={e => setTiming(e.target.value as typeof timing)}><option value="at">Justo en el corte</option><option value="before">Antes del corte (entra con el plano)</option><option value="after">Después del corte</option></select></label>
        {timing !== 'at' && <label>Distancia (ms)<input type="number" min={20} max={2000} step={10} value={offset} onChange={e => setOffset(Math.min(2000, Math.max(20, Number(e.target.value) || 0)))} /></label>}
        <label>En<select value={every} onChange={e => setEvery(Number(e.target.value))}><option value={1}>cada corte</option><option value={2}>uno de cada dos</option><option value={3}>uno de cada tres</option></select></label>
      </div>
      <div className="pageActions">
        <button type="button" disabled={!sfxId || comp.clips.length < 2} onClick={putSfx}>{placed ? 'Reemplazar efectos de los cortes' : 'Poner en los cortes'}</button>
        <button type="button" className="ghost" disabled={!placed} onClick={() => { apply(removeCutSfx); onNotice('Efectos de los cortes quitados (los que pusiste a mano siguen).') }}>Quitar los {placed} efectos de los cortes</button>
      </div>
      <p className="muted small">Cada efecto va enlazado a su clip: si mueves o reordenas clips, sigue a su corte. Se guardan en el montaje y «Aprende de mí» los recuerda en tus estilos (cuál, volumen, cuándo y cada cuánto).</p>
    </>}
  </section>
}
