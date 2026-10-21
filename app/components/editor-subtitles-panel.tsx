'use client'

import { useMemo, useState } from 'react'
import { clipStarts, type Composition } from '@/lib/editor/composition'
import { applyCuesToComposition, captionList, deleteCue, editCue, exportSubtitles, parseSubtitles, type ParsedSubtitles } from '@/lib/editor/subtitles'
import { downloadText } from '@/lib/library'

const MAX_FILE = 2 * 1024 * 1024
const PAGE = 60
const sec = (ms: number) => Math.round(ms / 10) / 100

/** Subtitles: import SRT/VTT, see and edit every caption with its time, export SRT/VTT. Everything is local; each change is one undoable step. */
export function EditorSubtitlesPanel({ comp, apply, onNotice }: { comp: Composition; apply: (fn: (c: Composition) => Composition) => void; onNotice: (msg: string) => void }) {
  const [parsed, setParsed] = useState<(ParsedSubtitles & { name: string }) | null>(null)
  const [shift, setShift] = useState(0)
  const [replace, setReplace] = useState(true)
  const [error, setError] = useState('')
  const [shown, setShown] = useState(PAGE)
  const list = useMemo(() => (comp.subtitles ? captionList(comp) : []), [comp])
  const starts = useMemo(() => clipStarts(comp), [comp])

  async function onFile(file: File | undefined) {
    setError(''); setParsed(null)
    if (!file) return
    if (file.size > MAX_FILE) { setError('El archivo de subtítulos supera 2 MB; no parece un SRT/VTT.'); return }
    if (!/\.(srt|vtt)$/i.test(file.name) && !/^text\//.test(file.type)) { setError('Elige un archivo .srt o .vtt.'); return }
    const text = await file.text()
    const p = parseSubtitles(text)
    if (!p.cues.length) { setError(`No se encontró ningún subtítulo válido en «${file.name}».${p.warnings.length ? ` ${p.warnings.join(' ')}` : ''}`); return }
    setParsed({ ...p, name: file.name })
  }
  function place() {
    if (!parsed) return
    const r = applyCuesToComposition(comp, parsed.cues, { shiftMs: Math.round(shift * 1000), replace })
    if (!r.assigned) { setError(r.warnings.join(' ') || 'No se pudo colocar ningún subtítulo.'); return }
    apply(() => r.composition)
    onNotice(`${r.assigned} subtítulos de «${parsed.name}» colocados en ${r.clipsWithCues} clips. ${r.warnings.join(' ')} Puedes deshacerlo.`)
    setParsed(null); setShift(0)
  }
  const dl = (f: 'srt' | 'vtt') => downloadText(`${(comp.title || 'montaje').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60)}.${f}`, exportSubtitles(comp, f), f === 'srt' ? 'application/x-subrip' : 'text/vtt')

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }} aria-label="Subtítulos">
    <div className="cardHead" style={{ marginBottom: 0 }}><h3>Subtítulos (SRT y VTT)</h3><span className="pill">{list.length} subtítulos</span></div>
    <label>Importar un archivo .srt o .vtt<input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip,text/plain" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f) }} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    {parsed && <div className="panel" style={{ background: 'transparent' }}>
      <p className="small"><b>{parsed.name}</b>: {parsed.cues.length} subtítulos ({parsed.format.toUpperCase()}), de {sec(parsed.cues[0].startMs)} s a {sec(parsed.cues[parsed.cues.length - 1].endMs)} s. El montaje dura {sec(clipStarts(comp).at(-1)! + (comp.clips.at(-1)?.durationMs ?? 0))} s.</p>
      {parsed.warnings.length > 0 && <ul className="small muted" style={{ margin: '4px 0 6px 18px' }}>{parsed.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <div className="field-row" style={{ alignItems: 'end' }}>
        <label>Desplazar (s) <input type="number" step={0.1} value={shift} onChange={e => setShift(Number(e.target.value) || 0)} aria-label="Desplazamiento en segundos" /></label>
        <label className="pill"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> Sustituir el texto que ya tenían los clips</label>
        <button type="button" onClick={place}>Colocar en el montaje</button>
        <button type="button" className="ghost" onClick={() => setParsed(null)}>Descartar</button>
      </div>
      <p className="muted small">Un subtítulo que cruza un corte se reparte entre los dos clips. Desplaza el archivo si empieza en otro punto que el montaje (positivo = aparecen más tarde).</p>
    </div>}

    {!comp.subtitles && <p className="muted small">Los subtítulos están desactivados en este montaje (casilla «Subtítulos» de Montaje). Al colocar un archivo se activan.</p>}
    {list.length > 0 && <>
      <div className="tableScroll"><table className="dataTable" aria-label="Lista de subtítulos">
        <thead><tr><th>#</th><th>Inicio (s)</th><th>Fin (s)</th><th>Texto</th><th /></tr></thead>
        <tbody>{list.slice(0, shown).map((q, i) => { const s0 = starts[q.clipIndex]; return <tr key={`${q.clipId}-${q.index}`}>
          <td>{i + 1}</td>
          <td><input type="number" step={0.05} min={0} style={{ width: 84 }} aria-label={`Inicio del subtítulo ${i + 1}`} value={sec(q.startMs)} onChange={e => apply(c => editCue(c, q, { startMs: Number(e.target.value) * 1000 - s0 }))} /></td>
          <td><input type="number" step={0.05} min={0} style={{ width: 84 }} aria-label={`Fin del subtítulo ${i + 1}`} value={sec(q.endMs)} onChange={e => apply(c => editCue(c, q, { endMs: Number(e.target.value) * 1000 - s0 }))} /></td>
          <td><input style={{ width: '100%', minWidth: 220 }} maxLength={300} aria-label={`Texto del subtítulo ${i + 1}`} value={q.text} onChange={e => apply(c => editCue(c, q, { text: e.target.value }))} /></td>
          <td><button type="button" className="ghost" aria-label={`Quitar el subtítulo ${i + 1}`} onClick={() => apply(c => deleteCue(c, q))}>Quitar</button></td>
        </tr> })}</tbody></table></div>
      {list.length > shown && <button type="button" className="ghost" onClick={() => setShown(n => n + PAGE)}>Mostrar {Math.min(PAGE, list.length - shown)} más ({list.length - shown} sin mostrar)</button>}
      <div className="pageActions"><button type="button" className="ghost" onClick={() => dl('srt')}>Descargar .srt</button><button type="button" className="ghost" onClick={() => dl('vtt')}>Descargar .vtt</button></div>
    </>}
  </section>
}
