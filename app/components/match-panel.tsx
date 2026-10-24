'use client'

import { useState } from 'react'
import type { Clip, Composition, Grade, OverlayClip } from '@/lib/editor/composition'
import { averageStats, DEFAULT_MATCH, loadSamples, measure, solveMatch, type MatchOptions, type PictureStats } from '@/lib/editor/grade'
import { updateClip } from '@/lib/editor/timeline'
import { updateOverlay, type ItemRef } from '@/lib/editor/tracks'
import { SliderField } from './editor-inspectors'

type Item = { ref: ItemRef; label: string; assetId: string; filters: Clip['filters']; grade: Grade | null | undefined; fromMs: number; spanMs: number }
type RefMode = 'first' | 'second' | 'average'

/** Composition without any «Igualar imagen» correction (to compare before / after in the viewer). */
export function withoutGrades(c: Composition): Composition {
  return { ...c, clips: c.clips.map(k => (k.grade ? { ...k, grade: { ...k.grade, enabled: false } } : k)), overlays: (c.overlays ?? []).map(o => (o.grade ? { ...o, grade: { ...o.grade, enabled: false } } : o)) }
}

/**
 * «Igualar imagen»: a small panel. Pick the reference (first, second or average), what to match, and the strength; then match the selection
 * or the whole project. The correction is measured on the real pictures (several frames for a video) and kept apart from the owner's filters.
 */
export function MatchPanel({ comp, sel, apply, resolveUrl, typeOf, onNotice, onError, compare, setCompare }: {
  comp: Composition; sel: ItemRef[]
  apply: (fn: (c: Composition) => Composition) => void
  resolveUrl: (id: string) => Promise<string>; typeOf: (id: string | null) => string
  onNotice: (m: string) => void; onError: (m: string) => void
  compare: boolean; setCompare: (v: boolean) => void
}) {
  const [refMode, setRefMode] = useState<RefMode>('first')
  const [opts, setOpts] = useState<MatchOptions>(DEFAULT_MATCH)
  const [strength, setStrength] = useState(1)
  const [busy, setBusy] = useState(false)
  const visual = (id: string | null) => !!id && ['image', 'video'].includes(typeOf(id))
  const itemOf = (r: ItemRef): Item | null => {
    if (r.kind === 'clip') {
      const i = comp.clips.findIndex(k => k.id === r.id), k = comp.clips[i]
      return k && visual(k.visualAssetId) ? { ref: r, label: `clip ${i + 1}`, assetId: k.visualAssetId!, filters: k.filters, grade: k.grade, fromMs: k.trimInMs ?? 0, spanMs: k.durationMs * (k.speed ?? 1) } : null
    }
    if (r.kind === 'overlay') {
      const o = (comp.overlays ?? []).find(x => x.id === r.id)
      return o && visual(o.assetId) ? { ref: r, label: 'capa', assetId: o.assetId, filters: o.filters, grade: o.grade, fromMs: o.trimInMs ?? 0, spanMs: o.durationMs * (o.speed ?? 1) } : null
    }
    return null
  }
  const selected = sel.map(itemOf).filter((x): x is Item => !!x)
  const project = comp.clips.map(k => itemOf({ kind: 'clip', id: k.id })).filter((x): x is Item => !!x)
  const graded = [...comp.clips, ...(comp.overlays ?? [])].filter(x => x.grade)

  const setGrade = (c: Composition, r: ItemRef, g: Grade | null) => (r.kind === 'clip' ? updateClip(c, r.id, { grade: g }) : updateOverlay(c, r.id, { grade: g } as Partial<OverlayClip>))

  async function run(targets: Item[]) {
    if (targets.length < 2) { onError('Selecciona al menos dos fotos o vídeos (Mayús/Ctrl + clic) para igualarlos, o usa «Todo el proyecto».'); return }
    if (!opts.brightness && !opts.contrast && !opts.warmth && !opts.color) { onError('Elige qué igualar (luminosidad, contraste, temperatura o color).'); return }
    setBusy(true)
    try {
      const samples = await Promise.all(targets.map(async t => loadSamples(await resolveUrl(t.assetId), typeOf(t.assetId) === 'video' ? 'video' : 'image', t.fromMs, t.spanMs)))
      const stats: PictureStats[] = targets.map((t, i) => measure(samples[i], t.filters ?? null, null))
      const refIndex = refMode === 'second' ? 1 : 0
      const ref = refMode === 'average' ? averageStats(stats) : stats[refIndex]
      const results = targets.map((t, i) => (refMode !== 'average' && i === refIndex ? null : { t, m: solveMatch(samples[i], t.filters ?? null, ref, opts) }))
      apply(c => targets.reduce((x, t, i) => {
        const r = results[i]
        if (!r) return setGrade(x, t.ref, null) // the reference stays as it is
        return setGrade(x, t.ref, { brightness: r.m.brightness, contrast: r.m.contrast, saturation: r.m.saturation, warmth: r.m.warmth, strength, ref: refMode === 'average' ? 'promedio' : targets[refIndex].label })
      }, c))
      const changed = results.filter(Boolean) as Array<{ t: Item; m: ReturnType<typeof solveMatch> }>
      const pct = (v: number) => `${Math.round(v * 100)} %`
      const varies = samples.some(s => s.length > 1 && (() => { const ms = s.map(f => measure([f], null, null).mean); return Math.max(...ms) - Math.min(...ms) > 0.15 })())
      onNotice(`Imagen igualada con ${refMode === 'average' ? 'el promedio' : `el ${targets[refIndex].label}`} como referencia: ${changed.map(({ t, m }) => `${t.label} luminosidad ${pct(m.before.mean)} → ${pct(m.after.mean)}`).join('; ')} (referencia ${pct(ref.mean)}).${changed.some(c => c.m.limited) ? ' Se ha llegado hasta donde se puede sin quemar las luces ni empastar las sombras.' : ''}${varies ? ' Un vídeo cambia de iluminación por dentro: se iguala su media.' : ''} Ctrl+Z lo deshace.`)
    } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo analizar la imagen.') }
    finally { setBusy(false) }
  }

  return <div className="matchPanel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <p className="muted small" role="status">{selected.length >= 2 ? `${selected.length} fotos o vídeos seleccionados.` : 'Selecciona dos o más fotos o vídeos (Mayús/Ctrl + clic), o iguala todo el proyecto.'}</p>
    <label>Referencia<select aria-label="Referencia para igualar" value={refMode} onChange={e => setRefMode(e.target.value as RefMode)}>
      <option value="first">El primero seleccionado</option><option value="second">El segundo seleccionado</option><option value="average">El promedio de todos</option>
    </select></label>
    <div className="pageActions" role="group" aria-label="Qué igualar">
      {([['brightness', 'Luminosidad'], ['contrast', 'Contraste'], ['warmth', 'Temperatura'], ['color', 'Color (saturación)']] as Array<[keyof MatchOptions, string]>).map(([k, l]) =>
        <label key={k} className="pill small"><input type="checkbox" checked={opts[k]} onChange={e => setOpts(o => ({ ...o, [k]: e.target.checked }))} /> {l}</label>)}
    </div>
    <SliderField label="Intensidad" ariaLabel="Intensidad de la igualación" value={Math.round(strength * 100)} min={0} max={100} step={5} unit="%" decimals={0}
      onChange={v => { setStrength(v / 100); if (graded.length) apply(c => ({ ...c, clips: c.clips.map(k => (k.grade ? { ...k, grade: { ...k.grade, strength: v / 100 } } : k)), overlays: (c.overlays ?? []).map(o => (o.grade ? { ...o, grade: { ...o.grade, strength: v / 100 } } : o)) })) }} />
    <div className="pageActions">
      <button type="button" className="small" disabled={busy || selected.length < 2} onClick={() => void run(selected)}>{busy ? 'Analizando…' : 'Igualar selección'}</button>
      <button type="button" className="ghost small" disabled={busy || project.length < 2} onClick={() => void run(refMode === 'average' ? project : [...selected.slice(0, refMode === 'second' ? 2 : 1), ...project.filter(p => !selected.slice(0, 2).some(s => s.ref.id === p.ref.id))])}>Todo el proyecto</button>
    </div>
    {graded.length > 0 && <div className="pageActions">
      <button type="button" className={compare ? 'small' : 'ghost small'} aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? 'Viendo el antes' : 'Ver antes / después'}</button>
      <label className="pill small"><input type="checkbox" checked={graded.every(x => x.grade!.enabled !== false)} onChange={e => apply(c => ({ ...c, clips: c.clips.map(k => (k.grade ? { ...k, grade: { ...k.grade, enabled: e.target.checked || undefined } } : k)), overlays: (c.overlays ?? []).map(o => (o.grade ? { ...o, grade: { ...o.grade, enabled: e.target.checked || undefined } } : o)) }))} /> Activada</label>
      <button type="button" className="ghost small" onClick={() => { apply(c => ({ ...c, clips: c.clips.map(k => (k.grade ? { ...k, grade: null } : k)), overlays: (c.overlays ?? []).map(o => (o.grade ? { ...o, grade: null } : o)) })); setCompare(false); onNotice('Igualación quitada de todos los clips (tus filtros siguen como estaban).') }}>Restablecer</button>
    </div>}
    <p className="muted small">No cambia tus filtros: es una corrección aparte, ajustable y reversible, que se ve igual en el visor y en la exportación.</p>
  </div>
}
