'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { RenderPanel } from '../../components/render-panel'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { audioStartMs, envelopeBreakpoints, TRACK_LABELS, type AudioClip as AudioClipT, type TrackKind, type TrackState, CAMERA_MOVES, CAPTION_STYLES, clipStarts, type CameraKind, type CaptionStyle, TEXT_ANIMATIONS, TEXT_FONTS, type TextAnimation, type TextFont, type TextClip, type TextOverlay, TRANSITIONS, type Transition, parseComposition, projectDurationMs, totalDurationMs, MAX_CLIP_MS, MIN_CLIP_MS, type AudioClip, type Clip, type Composition, type OutputFormat } from '@/lib/editor/composition'
import { addEnvelopePoint, envelopePointAt, moveEnvelopePoint, addVideo, setLevelBetween, addAudioClip, addClip, addTextClip, commit, deleteAudioClip, deleteClip, deleteTextClip, duplicateClip, duplicateTextClip, historyOf, moveAudioClip, moveClip, redo, setSpeed, splitClip, toManual, trimStart, undo, updateAudioClip, updateClip, updateTextClip, type History } from '@/lib/editor/timeline'
import { assetLabel, audioDurationMs, musicTypes, visualTypes, voiceTypes, type EditorAsset } from '@/lib/editor/client'
import { SaveConflictError } from '@/lib/editor/jobs'
import { StylePanel } from '../../components/style-panel'
import { MontageTemplatePanel } from '../../components/montage-template-panel'
import { LearnPanel } from '../../components/learn-panel'
import { WaveformSvg } from '../../components/waveform-view'
import { EditorSyncPanel } from '../../components/editor-sync-panel'
import { summarizeBeats, type BeatSummary } from '@/lib/editor/beat-summary'
import { EditorSubtitlesPanel } from '../../components/editor-subtitles-panel'
import { EditorReferencePanel } from '../../components/editor-reference-panel'
import { EditorComparePanel } from '../../components/editor-compare-panel'
import { analyzeAsset, type AssetAnalysis } from '@/lib/editor/analysis-assets'
import { nearestBeat } from '@/lib/editor/sync'
import { COMMAND_EXAMPLES, runInstruction } from '@/lib/editor/commands'
import { clearLocalDraft, draftDiffers, loadLocalDraft, saveLocalDraft, type LocalDraft } from '@/lib/editor/local-draft'
import { acceptProposal, DEFAULT_PREFS, detectCorrection, loadPrefs, PREF_LABELS, savePrefs, type EditPreferences, type Proposal, type Watch } from '@/lib/editor/preferences'
import { deleteRange, isolateRange, normRange, type Range } from '@/lib/editor/range'
import { effectiveCamera } from '@/lib/editor/motion'
import { ManualPicker } from '../../components/manual-picker'
import { EditorPlayerView } from '../../components/editor-player'
import { assetUrlResolver, kindFromAssets } from '@/lib/editor/media-urls'
import type { EditorPlayer } from '@/lib/editor/player'
import { mediaDuration, uploadProjectMedia, validateUpload, type LicenseStatus, type UploadKind } from '@/lib/media-upload'

type Job = { id: string; project_id: string; status: string; updated_at: string; composition: unknown }
type Selection = { kind: 'clip' | 'audio' | 'text'; id: string } | null
const ASSET_MIME = 'application/x-cerebro-asset'

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`
const secs = (ms: number) => Math.round(ms / 100) / 10
// Track colours keep white text at >= 4.5:1 (WCAG AA).
const kindColor: Record<string, string> = { image: '#2f62c4', video: '#7c4fe0', none: '#444', voice: '#23805a', music: '#9a5b0f', sfx: '#b03a2e', text: '#8a3a8f' }

export default function ManualEditorPage() {
  const supabase = getSupabaseBrowserClient()
  const [job, setJob] = useState<Job | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [assets, setAssets] = useState<EditorAsset[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [pxPerSec, setPxPerSec] = useState(40)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [addAsset, setAddAsset] = useState('')
  const [addAudio, setAddAudio] = useState('')
  const [addAudioKind, setAddAudioKind] = useState<AudioClip['kind']>('music')
  const [splitAt, setSplitAt] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [picking, setPicking] = useState(false)
  const [importAudioKind, setImportAudioKind] = useState<'music' | 'sfx' | 'voice'>('music')
  const [importLicense, setImportLicense] = useState<LicenseStatus>('owned')
  const [importNotes, setImportNotes] = useState('')
  const [dropping, setDropping] = useState(false)
  const [playheadMs, setPlayheadMsState] = useState(0)
  // The player owns the clock; the timeline playhead follows it every frame (directly on the DOM) and the state a few times a second.
  const playerRef = useRef<EditorPlayer | null>(null)
  const playheadEl = useRef<HTMLDivElement | null>(null)
  const resolveUrl = useMemo(() => assetUrlResolver(), [])
  const setPlayheadMs = useCallback((ms: number) => { setPlayheadMsState(ms); const p = playerRef.current; if (p && Math.abs(p.state.timeMs - ms) > 1) p.seek(ms) }, [])
  const lastPlayheadState = useRef(0)
  // Marked fragment («entrada»/«salida»): instructions and fragment actions apply only to it.
  const [range, setRange] = useState<Range | null>(null)
  const [markIn, setMarkIn] = useState<number | null>(null)
  const rangeDrag = useRef<{ startMs: number; left: number } | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [instructionLog, setInstructionLog] = useState<Array<{ text: string; done: string[] }>>([])
  // Preferences used by the instruction bar; a proposal appears when the owner corrects the result of an instruction by hand.
  const [prefs, setPrefs] = useState<EditPreferences>(DEFAULT_PREFS)
  const [prefsAt, setPrefsAt] = useState<string | null>(null)
  const [watches, setWatches] = useState<Watch[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  // How the montage was when it was opened: corrections can be compared with it even without an automatic version.
  const [sessionStart, setSessionStart] = useState<Composition | null>(null)
  // Recovery and automatic saving.
  const [recovery, setRecovery] = useState<LocalDraft | null>(null)
  const [autoSave, setAutoSave] = useState(true)
  const [lastAutoSave, setLastAutoSave] = useState<string | null>(null)
  const [matTab, setMatTab] = useState<'visual' | 'audio'>('visual')
  // Audio analysis (real waveforms and beats), measured in a background worker and kept per asset.
  const [analyses, setAnalyses] = useState<Record<string, AssetAnalysis | 'loading' | 'error'>>({})
  const requested = useRef(new Set<string>())
  const [showBeats, setShowBeats] = useState(true)
  const [snap, setSnap] = useState(true)
  const [toleranceMs, setToleranceMs] = useState(150)
  const [stylesKey, setStylesKey] = useState(0)
  // What part of the timeline is on screen: long montages only draw (and measure) that part.
  const scroller = useRef<HTMLElement | null>(null)
  const [view, setView] = useState({ left: 0, width: 1200 })

  const comp = history?.present ?? null
  const kindOfAsset = useMemo(() => kindFromAssets(assets), [assets])
  const pxRef = useRef(40)
  useEffect(() => { pxRef.current = pxPerSec }, [pxPerSec])
  const onPlayerTime = useCallback((ms: number, playing: boolean) => {
    const el = playheadEl.current
    if (el) el.style.left = `${ms / 1000 * pxRef.current}px`
    const now = performance.now()
    if (!playing || now - lastPlayheadState.current > 250) { lastPlayheadState.current = now; setPlayheadMsState(ms) }
    // Follow the playhead while playing when it leaves the visible part of the timeline.
    const sc = scroller.current
    if (playing && sc) { const x = ms / 1000 * pxRef.current; if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - 80) }
  }, [])
  const apply = useCallback((next: (c: Composition) => Composition) => {
    setHistory(h => (h ? commit(h, next(h.present)) : h)); setDirty(true); setNotice('')
  }, [])

  // Ask for the analysis of every audio file the montage uses (each file once; two at a time; kept in this browser for the next visit).
  const audioIds = useMemo(() => [...new Set([comp?.musicAssetId, ...(comp?.audioClips ?? []).map(a => a.assetId)].filter((x): x is string => Boolean(x)))].sort().join(','), [comp])
  useEffect(() => {
    for (const id of audioIds ? audioIds.split(',') : []) {
      if (requested.current.has(id)) continue
      requested.current.add(id)
      setAnalyses(a => ({ ...a, [id]: 'loading' }))
      analyzeAsset(id).then(r => setAnalyses(a => ({ ...a, [id]: r })), () => { requested.current.delete(id); setAnalyses(a => ({ ...a, [id]: 'error' })) })
    }
  }, [audioIds])

  // Beats of the music, on the montage's timeline (music clips on the track, plus the global background music).
  const beats: BeatSummary = useMemo(() => summarizeBeats(comp, analyses), [comp, analyses])

  const measureView = useCallback(() => { const el = scroller.current; if (el) setView(v => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth })) }, [])
  const loaded = history !== null
  useEffect(() => { void loadPrefs(supabase).then(r => { setPrefs(r.prefs); setPrefsAt(r.updatedAt) }).catch(() => undefined) }, [supabase])
  useEffect(() => { if (history && !sessionStart) setSessionStart(history.present) }, [history, sessionStart])
  useEffect(() => {
    if (!comp || proposal || !watches.length) return
    for (const w of watches) { const p = detectCorrection(comp, w); if (p) { setProposal(p); return } }
  }, [comp, watches, proposal])
  async function answerProposal(yes: boolean) {
    const p = proposal
    if (!p) return
    setProposal(null); setWatches(ws => ws.filter(w => w !== p.watch))
    if (!yes) return
    try { const next = acceptProposal(prefs, p); const at = await savePrefs(supabase, next, prefsAt); setPrefs(next); setPrefsAt(at); setNotice(`Preferencia guardada: ${PREF_LABELS[p.key].label} = ${PREF_LABELS[p.key].show(p.to)}. Se usará la próxima vez que pidas «${PREF_LABELS[p.key].phrase}».`) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la preferencia.') }
  }
  useEffect(() => { measureView(); window.addEventListener('resize', measureView); return () => window.removeEventListener('resize', measureView) }, [measureView, loaded])

  const load = useCallback(async () => {
    const id = new URLSearchParams(window.location.search).get('job')
    if (!id) { setPicking(true); return }
    const { data, error: e } = await supabase.from('render_jobs').select('id,project_id,status,updated_at,composition').eq('id', id).maybeSingle()
    if (e || !data) { setError(e?.message ?? 'Montaje no encontrado.'); return }
    const row = data as Job
    if (row.status !== 'draft') { setError('Solo se editan montajes guardados (borradores).'); return }
    const parsed = parseComposition(row.composition)
    if (!parsed) { setError('El montaje guardado no es válido.'); return }
    setJob(row); setSavedAt(row.updated_at)
    // A local copy with changes that never reached the cloud (closed tab, crash): offer it, never apply it silently.
    void loadLocalDraft(row.id).then(d => { const c = d ? parseComposition(d.composition) : null; if (d && c && draftDiffers({ ...d, composition: c }, parsed)) setRecovery({ ...d, composition: c }) })
    const { data: a } = await supabase.from('assets').select('id,project_id,asset_type,storage_path,license_status,source_provider,provenance,created_at').or(`project_id.eq.${row.project_id},project_id.is.null`).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
    setAssets((a ?? []) as EditorAsset[])
    if (parsed.editedManually) { setHistory(historyOf(parsed)); return }
    // First time in manual mode: move clip voices to the audio track with their real length.
    const voices = [...new Set(parsed.clips.map(c => c.voiceAssetId).filter((x): x is string => Boolean(x)))]
    // Nothing to move: open it as is, without a misleading notice or an "unsaved changes" state.
    if (voices.length === 0) { setHistory(historyOf(toManual(parsed))); return }
    setBusy('convert')
    const durations: Record<string, number> = {}
    for (const v of voices) {
      durations[v] = await audioDurationMs(v).catch(() => 0) || 0
    }
    setHistory(historyOf(toManual(parsed, Object.fromEntries(Object.entries(durations).filter(([, ms]) => ms > 0)))))
    setDirty(true); setBusy('')
    setNotice('Montaje abierto en modo manual: las voces pasaron a la pista de audio enlazadas a su clip. Guarda para conservar el cambio.')
  }, [supabase])
  useEffect(() => { void load() }, [load])

  const save = useCallback(async () => {
    if (!job || !comp || !savedAt) return
    const { data, error: e } = await supabase.from('render_jobs').update({ composition: comp, output_format: comp.format, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('updated_at', savedAt).select('updated_at')
    if (e) throw new Error(e.message)
    if (!data?.length) throw new SaveConflictError()
    setSavedAt((data[0] as { updated_at: string }).updated_at); setDirty(false)
    void clearLocalDraft(job.id)
  }, [job, comp, savedAt, supabase])

  // Every change is copied locally a moment later (recovery after a crash); with automatic saving on, dirty changes reach the cloud every minute.
  useEffect(() => {
    if (!job || !comp || !dirty) return
    const t = setTimeout(() => { void saveLocalDraft({ jobId: job.id, composition: comp, savedAt: new Date().toISOString(), baseUpdatedAt: savedAt }) }, 1500)
    return () => clearTimeout(t)
  }, [job, comp, dirty, savedAt])
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!autoSave || !dirty) return
    const t = setTimeout(() => {
      if (drag.current || busy) return
      void saveRef.current().then(() => setLastAutoSave(new Date().toLocaleTimeString()), e => { setAutoSave(false); setError(`Guardado automático detenido: ${e instanceof Error ? e.message : 'error al guardar'}`) })
    }, 60_000)
    return () => clearTimeout(t)
  }, [autoSave, dirty, comp, busy])

  async function saveClick() {
    setError(''); setBusy('save')
    try { await save(); setNotice('Montaje guardado.') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setBusy('') }
  }

  // Keyboard: undo/redo and delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); setHistory(h => (h ? (e.shiftKey ? redo(h) : undo(h)) : h)); setDirty(true) }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); setHistory(h => (h ? redo(h) : h)); setDirty(true) }
      if (e.key === 'i' || e.key === 'I') markAt('in')
      if (e.key === 'o' || e.key === 'O') markAt('out')
      if (e.key === 'Escape') { setRange(null); setMarkIn(null) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        apply(c => (selection.kind === 'clip' ? deleteClip(c, selection.id) : selection.kind === 'text' ? deleteTextClip(c, selection.id) : deleteAudioClip(c, selection.id)))
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apply, selection, playheadMs, markIn, range]) // eslint-disable-line react-hooks/exhaustive-deps

  /** «Marcar entrada» / «Marcar salida» at the playhead. */
  function markAt(which: 'in' | 'out') {
    const total = history ? totalDurationMs(history.present) : 0
    if (which === 'in') { setMarkIn(playheadMs); setRange(r => (r && r.endMs > playheadMs ? normRange({ startMs: playheadMs, endMs: r.endMs }, total) : null)); return }
    const from = range?.startMs ?? markIn ?? 0
    setRange(normRange({ startMs: from, endMs: playheadMs }, total)); setMarkIn(null)
  }

  /** Runs a written instruction as one undoable step and says what it did. */
  function runText(text: string) {
    if (!history || !text.trim()) return
    const kinds = Object.fromEntries(assets.map(a => [a.id, a.asset_type]))
    const durationOf = (id: string) => { const an = analyses[id]; if (typeof an === 'object' && an.durationMs) return an.durationMs; const p = assets.find(a => a.id === id)?.provenance ?? {}; return typeof p.durationMs === 'number' ? p.durationMs : typeof p.durationSeconds === 'number' ? p.durationSeconds * 1000 : null }
    const r = runInstruction(history.present, text, {
      playheadMs, range, selectedClipId: selection?.kind === 'clip' ? selection.id : null, selectedAssetId: selectedAsset, beatsMs: beats.beatsMs,
      assets: assets.map(a => ({ id: a.id, label: assetLabel(a), type: a.asset_type, durationMs: durationOf(a.id) })),
      isVideo: k => kinds[k.visualAssetId ?? ''] === 'video', prefs,
    })
    if (!r.ok) { setError(`${r.message} Ejemplos: «${COMMAND_EXAMPLES.slice(0, 4).join('», «')}».`); return }
    setError('')
    if (r.history) { setHistory(h => (h ? (r.history === 'undo' ? undo(h) : redo(h)) : h)); setDirty(true) }
    else if (r.composition !== history.present) apply(() => r.composition)
    if (r.playheadMs !== undefined) setPlayheadMs(r.playheadMs)
    if (r.range !== undefined) { setRange(r.range); setMarkIn(null) }
    setInstructionLog(l => [{ text, done: r.done }, ...l].slice(0, 8))
    if (r.watch?.length) setWatches(ws => [...r.watch!, ...ws].slice(0, 20))
    setNotice(`${r.done.join(' ')} (Ctrl+Z para deshacer)`)
    setInstruction('')
  }

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Thumbnails of the images used on the timeline (signed URLs, fetched once per asset).
  const imageIds = useMemo(() => [...new Set([...(history?.present.clips ?? []).map(c => c.visualAssetId), ...assets.filter(a => a.asset_type !== 'video' && visualTypes.includes(a.asset_type)).slice(0, 60).map(a => a.id)].filter((id): id is string => Boolean(id) && assets.find(a => a.id === id)?.asset_type !== 'video'))].sort().join(','), [history, assets])
  useEffect(() => {
    const missing = imageIds ? imageIds.split(',').filter(id => !thumbs[id]) : []
    if (!missing.length) return
    let alive = true
    void Promise.all(missing.map(async id => {
      const r = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({})) as { url?: string }
      return [id, j.url ?? ''] as const
    })).then(pairs => { if (alive) setThumbs(t => ({ ...t, ...Object.fromEntries(pairs.filter(([, u]) => u)) })) })
    return () => { alive = false }
  }, [imageIds, thumbs])

  /** Uploads files from the computer to the project's Library and puts them on the timeline (videos and images at the end, audio on its own track). */
  async function importFiles(files: File[]) {
    if (!job || files.length === 0 || busy) return
    if (importLicense === 'licensed' && !importNotes.trim()) { setError('Indica la licencia o el enlace de origen de los archivos con licencia.'); return }
    setBusy('import'); setError(''); setNotice('')
    const added: Array<{ id: string; kind: UploadKind; ms: number | null }> = []
    const problems: string[] = []
    for (const file of files) {
      const kind: UploadKind | null = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? importAudioKind : null
      if (!kind) { problems.push(`${file.name}: solo se admiten vídeo, imagen y audio.`); continue }
      const bad = validateUpload(kind, file)
      if (bad) { problems.push(`${file.name}: ${bad}`); continue }
      try {
        const saved = await uploadProjectMedia(supabase, { projectId: job.project_id, kind, file, title: file.name.replace(/\.[^.]+$/, ''), license: importLicense, licenseNotes: importNotes || null })
        added.push({ id: saved.id, kind, ms: kind === 'image' ? null : await mediaDuration(file).then(sec => (sec ? Math.round(sec * 1000) : null)) })
      } catch (e) { problems.push(`${file.name}: ${e instanceof Error ? e.message : 'no se pudo subir.'}`) }
    }
    if (added.length) {
      const { data: a } = await supabase.from('assets').select('id,project_id,asset_type,storage_path,license_status,source_provider,provenance,created_at').or(`project_id.eq.${job.project_id},project_id.is.null`).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
      setAssets((a ?? []) as EditorAsset[])
      apply(c => added.reduce((acc, f) => {
        if (f.kind === 'video') return addVideo(acc, f.id, f.ms ?? 5000)
        if (f.kind === 'image') return addClip(acc, f.id, 5000)
        const ms = f.ms ?? 10_000
        return addAudioClip(acc, { assetId: f.id, kind: f.kind === 'voice' ? 'voice' : f.kind === 'sfx' ? 'sfx' : 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: f.kind === 'music' ? Math.min(ms, Math.max(totalDurationMs(acc), 1000)) : ms, volume: f.kind === 'music' ? 0.5 : 1, muted: false })
      }, c))
      setNotice(`${added.length} archivo(s) importados a la Biblioteca y añadidos a la línea de tiempo. Guarda el montaje para conservar los cambios.`)
    }
    if (problems.length) setError(problems.join(' '))
    setBusy('')
  }

  const visuals = useMemo(() => assets.filter(a => visualTypes.includes(a.asset_type)), [assets])
  const audios = useMemo(() => assets.filter(a => voiceTypes.includes(a.asset_type) || musicTypes.includes(a.asset_type)), [assets])
  const typeOf = (id: string | null) => (id ? assets.find(a => a.id === id)?.asset_type ?? 'image' : 'none')
  const label = (id: string | null) => { const a = id ? assets.find(x => x.id === id) : undefined; return a ? assetLabel(a) : 'Sin visual' }

  // Pointer drag on the right edge of a clip changes its duration; on an audio block it moves it.
  const drag = useRef<{ kind: 'resize' | 'move' | 'textMove' | 'textResize'; id: string; startX: number; startValue: number; clipStartMs: number } | null>(null)
  function onPointerDown(e: ReactPointerEvent, kind: 'resize' | 'move' | 'textMove' | 'textResize', id: string, startValue: number) {
    e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, id, startX: e.clientX, startValue, clipStartMs: kind === 'resize' && comp ? clipStarts(comp)[comp.clips.findIndex(k => k.id === id)] ?? 0 : 0 }
    // Snapshot for undo: the drag then replaces `present` live without one entry per pixel.
    setHistory(h => (h ? { past: [...h.past, h.present].slice(-100), present: h.present, future: [] } : h))
  }
  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const deltaMs = ((e.clientX - d.startX) / pxPerSec) * 1000
    // Magnet: within ~14 px (and never more than the chosen margin) the edge jumps to the nearest beat of the music.
    const pull = Math.min(toleranceMs, 14 / pxPerSec * 1000)
    const magnet = (ms: number) => (snap && beats.beatsMs.length ? nearestBeat(ms, beats.beatsMs, pull) ?? ms : ms)
    // Live update without pushing a history entry per pixel: replace the present snapshot.
    setHistory(h => {
      if (!h) return h
      const next = d.kind === 'resize' ? updateClip(h.present, d.id, { durationMs: magnet(d.clipStartMs + d.startValue + deltaMs) - d.clipStartMs }) : d.kind === 'textMove' ? updateTextClip(h.present, d.id, { startMs: d.startValue + deltaMs }) : d.kind === 'textResize' ? updateTextClip(h.present, d.id, { durationMs: d.startValue + deltaMs }) : moveAudioClip(h.present, d.id, magnet(d.startValue + deltaMs))
      return { ...h, present: next }
    })
    setDirty(true)
  }
  function onPointerUp() {
    const d = drag.current
    drag.current = null
    // A click without movement leaves an identical snapshot on the undo stack: drop it.
    if (d) setHistory(h => (h && h.past.length && h.past[h.past.length - 1] === h.present ? { ...h, past: h.past.slice(0, -1) } : h))
  }

  const kindOf = useCallback((id: string | null) => { const t = assets.find(a => a.id === id)?.asset_type; return t === 'video' ? 'video' as const : t && visualTypes.includes(t) ? 'image' as const : 'other' as const }, [assets])

  /** A material dragged from the panel onto a track: visuals are inserted where they are dropped, audio starts at the drop point. */
  async function dropAsset(e: React.DragEvent, track: 'video' | AudioClip['kind'], el: HTMLElement) {
    const id = e.dataTransfer.getData(ASSET_MIME)
    if (!id) return
    e.preventDefault(); e.stopPropagation(); setDropping(false)
    const a = assets.find(x => x.id === id)
    if (!a || !history) return
    const atMs = Math.max(0, ((e.clientX - el.getBoundingClientRect().left) / pxPerSec) * 1000)
    if (track === 'video') {
      if (!visualTypes.includes(a.asset_type)) { setError('A la pista de vídeo solo van vídeos e imágenes.'); return }
      const c = history.present
      const starts = clipStarts(c)
      const index = c.clips.findIndex((k, i) => starts[i] + k.durationMs / 2 > atMs)
      const ms = a.asset_type === 'video' ? await audioDurationMs(id).catch(() => 5000) || 5000 : 5000
      apply(x => (a.asset_type === 'video' ? addVideo(x, id, ms, index < 0 ? x.clips.length : index) : addClip(x, id, ms, index < 0 ? x.clips.length : index)))
      return
    }
    if (visualTypes.includes(a.asset_type) && a.asset_type !== 'video') { setError('Una imagen no tiene audio: arrástrala a la pista de vídeo.'); return }
    const ms = await audioDurationMs(id).catch(() => 5000) || 5000
    apply(x => addAudioClip(x, { assetId: id, kind: track, linkedClipId: null, offsetMs: 0, startMs: atMs, trimInMs: 0, durationMs: ms, volume: track === 'music' ? 0.3 : 1, muted: false }))
  }
  const allowAsset = (e: React.DragEvent) => { if (e.dataTransfer.types.includes(ASSET_MIME)) e.preventDefault() }

  if (picking) return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN" actions={<Link className="buttonLink ghost" href="/editor">Editor automático</Link>}><ManualPicker /></StudioShell>

  if (!comp || !job) return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN">
    {error ? <p className="error" role="alert">{error} <Link className="open" href="/editor">Volver al editor</Link></p> : <p className="muted">{busy === 'convert' ? 'Preparando el montaje (midiendo voces)…' : 'Cargando…'}</p>}
  </StudioShell>

  const total = projectDurationMs(comp)
  const selClip = selection?.kind === 'clip' ? comp.clips.find(c => c.id === selection.id) ?? null : null
  const selAudio = selection?.kind === 'audio' ? (comp.audioClips ?? []).find(a => a.id === selection.id) ?? null : null
  const selText = selection?.kind === 'text' ? (comp.textClips ?? []).find(t => t.id === selection.id) ?? null : null
  const width = Math.max(total / 1000 * pxPerSec, 600)
  const rows: Array<{ key: AudioClip['kind']; label: string }> = [{ key: 'voice', label: 'Voz' }, { key: 'music', label: 'Música' }, { key: 'sfx', label: 'Efectos' }]
  const starts = clipStarts(comp)
  const underPlayhead = comp.clips.findIndex((k, i) => playheadMs >= starts[i] && playheadMs < starts[i] + k.durationMs)
  const splitPlayheadOk = underPlayhead >= 0 && playheadMs - starts[underPlayhead] >= MIN_CLIP_MS && starts[underPlayhead] + comp.clips[underPlayhead].durationMs - playheadMs >= MIN_CLIP_MS
  const materials = matTab === 'visual' ? visuals : audios
  // Long montages: only the clips on screen (plus a margin) are drawn; spacers keep the timeline the same length. Small montages draw everything.
  const windowed = (() => {
    if (comp.clips.length <= 120) return { from: 0, to: comp.clips.length, before: 0, after: 0 }
    const margin = 600, lo = (view.left - margin) / pxPerSec * 1000, hi = (view.left + view.width + margin) / pxPerSec * 1000
    const st = starts; let from = 0, to = comp.clips.length
    while (from < to - 1 && st[from] + comp.clips[from].durationMs < lo) from++
    while (to > from + 1 && st[to - 1] > hi) to--
    const px = (a: number, b: number) => comp.clips.slice(a, b).reduce((t, k) => t + k.durationMs, 0) / 1000 * pxPerSec
    return { from, to, before: px(0, from), after: px(to, comp.clips.length) }
  })()
  const loMs = (view.left - 200) / pxPerSec * 1000, hiMs = (view.left + view.width + 200) / pxPerSec * 1000
  // Long montages also draw only the audio and text blocks near the visible part.
  const many = comp.clips.length > 120 || (comp.audioClips?.length ?? 0) > 150 || (comp.textClips?.length ?? 0) > 150
  const onScreen = (start: number, dur: number) => !many || (start + dur >= loMs - 30_000 && start <= hiMs + 30_000)
  const nextBeatRel = selClip ? (() => { const st = starts[comp.clips.findIndex(k => k.id === selClip.id)]; const b = beats.beatsMs.find(t => t - st >= MIN_CLIP_MS && st + selClip.durationMs - t >= MIN_CLIP_MS); return b === undefined ? null : b - st })() : null

  return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN" actions={<><a className="buttonLink ghost" href="/editor/manual">Mis montajes</a><Link className="buttonLink ghost" href={`/editor/style?project=${job.project_id}`}>Editar con mi estilo</Link><Link className="buttonLink ghost" href={`/editor?project=${job.project_id}&storyboard=${comp.storyboardId}`}>Editor automático</Link></>}>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    {recovery && <div className="panel warning" role="alert" aria-label="Recuperar cambios" style={{ marginBottom: 12 }}>
      <b>Hay cambios sin guardar de este montaje</b> (copia local del {new Date(recovery.savedAt).toLocaleString()}){recovery.baseUpdatedAt !== savedAt ? '. Ojo: el montaje se guardó después desde otro sitio; si recuperas, al guardar se te avisará del conflicto.' : '.'}
      <div className="pageActions" style={{ marginTop: 6 }}>
        <button type="button" className="small" onClick={() => { setHistory(h => (h ? commit(h, recovery.composition) : h)); setDirty(true); setRecovery(null); setNotice('Cambios recuperados. Guarda para conservarlos (Ctrl+Z vuelve a la versión guardada).') }}>Recuperar cambios</button>
        <button type="button" className="ghost small" onClick={() => { if (job) void clearLocalDraft(job.id); setRecovery(null) }}>Descartar copia</button>
      </div>
    </div>}
    <div className="editorBar panel" style={{ marginBottom: 12 }}>
      <div className="stats">
        <span className="pill">{comp.clips.length} clips</span>
        <span className="pill info">{fmt(total)}</span>
        {comp.styleRef && <span className="pill" title="Estilo con el que se creó o se re-estiló">Estilo: {comp.styleRef.profileName}</span>}
        {dirty && <span className="pill warn">Cambios sin guardar</span>}
        <label className="pill small" title="Guarda en la nube cada minuto si hay cambios (con el mismo control de conflictos)"><input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} /> Guardado automático{lastAutoSave ? ` · ${lastAutoSave}` : ''}</label>
        <label className="small">Formato{' '}
          <select value={comp.format} onChange={e => apply(c => ({ ...c, format: e.target.value as OutputFormat }))}>
            <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
          </select>
        </label>
        <label className="small">Zoom timeline <input type="range" min={10} max={160} value={pxPerSec} onChange={e => setPxPerSec(Number(e.target.value))} /></label>
      </div>
      <div className="pageActions">
        <button type="button" className="ghost" disabled={!splitPlayheadOk} title="Divide el clip que está bajo el cabezal" onClick={() => apply(c => splitClip(c, c.clips[underPlayhead].id, playheadMs - starts[underPlayhead]))}>Cortar en el cabezal</button>
        <button type="button" className="ghost" title="Tecla I" onClick={() => markAt('in')}>Marcar entrada</button>
        <button type="button" className="ghost" title="Tecla O" onClick={() => markAt('out')}>Marcar salida</button>
        <button type="button" className="ghost" onClick={() => { const at = Math.min(playheadMs, Math.max(0, total - 1000)); apply(c => addTextClip(c, { content: 'Texto', startMs: at, durationMs: 3000, position: 'center', sizePct: 7, animation: 'fade', font: 'sans', color: '#ffffff' })) }}>Añadir texto</button>
        <button type="button" className="ghost" disabled={!history?.past.length} onClick={() => { setHistory(h => (h ? undo(h) : h)); setDirty(true) }} title="Ctrl+Z">Deshacer</button>
        <button type="button" className="ghost" disabled={!history?.future.length} onClick={() => { setHistory(h => (h ? redo(h) : h)); setDirty(true) }} title="Ctrl+Shift+Z">Rehacer</button>
        <button type="button" onClick={() => void saveClick()} disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Guardando…' : 'Guardar montaje'}</button>
      </div>
    </div>

    <form className="panel instructionBar" style={{ marginBottom: 12 }} onSubmit={e => { e.preventDefault(); runText(instruction) }} aria-label="Instrucciones">
      <label htmlFor="ed-instr" className="small"><b>Dile al editor qué hacer</b> {range ? <span className="pill info">Se aplica al fragmento {secs(range.startMs)}–{secs(range.endMs)} s</span> : selection?.kind === 'clip' ? <span className="pill">Se aplica al clip seleccionado</span> : <span className="muted">· se aplica al clip bajo el cabezal</span>}</label>
      <div className="field-row" style={{ alignItems: 'center' }}>
        <input id="ed-instr" list="ed-instr-examples" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="p. ej. pon esta música desde el minuto 2 · corta aquí · haz un zoom lento · cambia de imagen siguiendo el ritmo" style={{ flex: 1 }} />
        <datalist id="ed-instr-examples">{COMMAND_EXAMPLES.map(x => <option key={x} value={x} />)}</datalist>
        <button type="submit" disabled={!instruction.trim()}>Hacer</button>
      </div>
      {proposal && <div className="styleBox" role="group" aria-label="Propuesta de preferencia" style={{ marginTop: 8 }}>
        <span className="small">Has cambiado «{PREF_LABELS[proposal.key].phrase}» de <b>{PREF_LABELS[proposal.key].show(proposal.from)}</b> a <b>{PREF_LABELS[proposal.key].show(proposal.to)}</b>. ¿Uso {PREF_LABELS[proposal.key].show(proposal.to)} la próxima vez?</span>
        <div className="pageActions"><button type="button" className="small" onClick={() => void answerProposal(true)}>Guardar como preferencia</button><button type="button" className="ghost small" onClick={() => void answerProposal(false)}>No, solo esta vez</button></div>
      </div>}
      <details className="small"><summary>Mis preferencias ({prefs.history.length} cambios confirmados)</summary>
        <ul className="plainList">{(Object.keys(PREF_LABELS) as Array<keyof typeof PREF_LABELS>).map(k => <li key={k}>{PREF_LABELS[k].label}: <b>{PREF_LABELS[k].show(prefs[k])}</b>{prefs[k] !== DEFAULT_PREFS[k] ? <span className="muted"> (por defecto {PREF_LABELS[k].show(DEFAULT_PREFS[k])})</span> : null}</li>)}</ul>
      </details>
      {instructionLog.length > 0 && <details className="small"><summary>Últimas instrucciones ({instructionLog.length})</summary><ul className="plainList">{instructionLog.map((l, i) => <li key={i}><button type="button" className="ghost small" onClick={() => runText(l.text)} title="Repetir">↻</button> «{l.text}» → {l.done.join(' ')}</li>)}</ul></details>}
    </form>

    <div className="editorLayout">
      <aside className="panel editorMaterials" aria-label="Materiales">
        <div className="cardHead" style={{ marginBottom: 6 }}><h3>Materiales</h3><span className="muted small">{assets.length}</span></div>
        <div className="pageActions" role="tablist" aria-label="Tipo de material">
          <button type="button" role="tab" aria-selected={matTab === 'visual'} className={matTab === 'visual' ? 'small' : 'ghost small'} onClick={() => setMatTab('visual')}>Vídeo e imagen</button>
          <button type="button" role="tab" aria-selected={matTab === 'audio'} className={matTab === 'audio' ? 'small' : 'ghost small'} onClick={() => setMatTab('audio')}>Audio</button>
        </div>
        <ul className="materialList" role="listbox" aria-label="Materiales del proyecto">
          {materials.map(a => <li key={a.id} role="option" draggable aria-selected={selectedAsset === a.id} className={selectedAsset === a.id ? 'selected' : undefined} onClick={() => setSelectedAsset(x => (x === a.id ? null : a.id))} onDragStart={e => { e.dataTransfer.setData(ASSET_MIME, a.id); e.dataTransfer.effectAllowed = 'copy' }} title="Arrástralo a una pista" aria-label={`Material ${assetLabel(a)}`}>
            <span className="matThumb" style={{ background: thumbs[a.id] ? `url(${thumbs[a.id]}) center / cover` : kindColor[a.asset_type] ?? '#555' }} aria-hidden="true">{thumbs[a.id] ? '' : a.asset_type === 'video' ? '▶' : a.asset_type === 'image' ? '' : '♪'}</span>
            <span className="matName">{assetLabel(a)}<small className="muted">{a.asset_type}{a.project_id === null ? ' · Biblioteca general' : ''}</small></span>
          </li>)}
          {!materials.length && <li role="option" aria-selected={false} aria-disabled="true" className="muted small">Nada todavía. Importa archivos abajo.</li>}
        </ul>
        <p className="muted small">Arrastra un material a la pista de vídeo o a una pista de audio; se coloca donde lo sueltas.</p>
        <details open={assets.length === 0}><summary className="small"><b>Importar o añadir</b></summary>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label htmlFor="mi-files"><b>Importar desde tu equipo</b>
              <input id="mi-files" type="file" multiple accept="video/*,image/*,audio/*" disabled={busy === 'import'} onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void importFiles(f) }} />
            </label>
            <span className="muted small">Se guardan en la Biblioteca del proyecto y se añaden al montaje. También puedes soltarlos sobre la línea de tiempo.</span>
            <div className="field-row">
              <label htmlFor="mi-akind">Si es audio, usar como<select id="mi-akind" value={importAudioKind} onChange={e => setImportAudioKind(e.target.value as 'music' | 'sfx' | 'voice')}><option value="music">Música</option><option value="sfx">Efecto</option><option value="voice">Voz</option></select></label>
              <label htmlFor="mi-license">Licencia<select id="mi-license" value={importLicense} onChange={e => setImportLicense(e.target.value as LicenseStatus)}><option value="owned">Propio</option><option value="public_domain">Dominio público</option><option value="licensed">Con licencia</option></select></label>
            </div>
            {importLicense === 'licensed' && <label htmlFor="mi-notes">Licencia o enlace de origen<input id="mi-notes" value={importNotes} onChange={e => setImportNotes(e.target.value)} maxLength={500} /></label>}
            {busy === 'import' && <span className="muted small" role="status">Importando…</span>}
            <label>Clip de imagen o vídeo
              <select value={addAsset} onChange={e => setAddAsset(e.target.value)}><option value="">— Elegir de la Biblioteca</option>{visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select>
            </label>
            <button type="button" className="ghost" disabled={!addAsset} onClick={() => void (async () => { const at = selClip ? comp.clips.findIndex(c => c.id === selClip.id) + 1 : comp.clips.length; const id = addAsset; setAddAsset(''); if (typeOf(id) === 'video') { const ms = await audioDurationMs(id).catch(() => 5000) || 5000; apply(c => addVideo(c, id, ms, at)) } else apply(c => addClip(c, id, 5000, at)) })()}>Añadir clip {selClip ? 'tras el seleccionado' : 'al final'}</button>
            <label>Audio
              <select value={addAudio} onChange={e => setAddAudio(e.target.value)}><option value="">— Elegir de la Biblioteca</option>{audios.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select>
            </label>
            <label>Pista<select value={addAudioKind} onChange={e => setAddAudioKind(e.target.value as AudioClip['kind'])}><option value="voice">Voz / voice-over</option><option value="music">Música</option><option value="sfx">Efecto</option></select></label>
            <button type="button" className="ghost" disabled={!addAudio || busy === 'audio'} onClick={() => void (async () => {
              setBusy('audio')
              const ms = await audioDurationMs(addAudio).catch(() => 5000)
              const linked = selClip && addAudioKind === 'voice' ? selClip.id : null
              apply(c => addAudioClip(c, { assetId: addAudio, kind: addAudioKind, linkedClipId: linked, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: Math.min(ms, addAudioKind === 'music' ? totalDurationMs(c) : ms), volume: addAudioKind === 'music' ? 0.3 : 1, muted: false }))
              setAddAudio(''); setBusy('')
            })()}>{busy === 'audio' ? 'Midiendo…' : addAudioKind === 'voice' && selClip ? 'Añadir enlazado al clip seleccionado' : 'Añadir al inicio'}</button>
          </section>
        </details>
      </aside>

      <div className="editorViewer">
        <EditorPlayerView composition={comp} kindOf={kindOfAsset} resolveUrl={resolveUrl} loop={range} onTime={onPlayerTime} onPlayer={p => { playerRef.current = p }} />
        <details className="panel exportBox" style={{ marginTop: 12 }}>
          <summary><b>Exportar el vídeo</b> <span className="muted small">resolución, calidad, destino</span></summary>
          <RenderPanel key="full" projectId={job.project_id} composition={comp} assets={assets} beforeRender={dirty ? save : undefined} onExportSettings={e => apply(c => ({ ...c, exportSettings: e }))} exportOnly />
        </details>
      </div>

      <section className="panel editorProps" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Propiedades">
        <h3>{selClip ? `Clip ${comp.clips.findIndex(c => c.id === selClip.id) + 1}` : selAudio ? 'Audio' : selText ? 'Texto' : 'Montaje'}</h3>
        {selClip && <ClipInspector clip={selClip} isVideo={typeOf(selClip.visualAssetId) === 'video'} visuals={visuals} splitAt={splitAt} setSplitAt={setSplitAt} nextBeatMs={nextBeatRel}
          onChange={p => apply(c => updateClip(c, selClip.id, p))}
          onSpeed={v => apply(c => setSpeed(c, selClip.id, v))}
          onTrim={d => apply(c => trimStart(c, selClip.id, d))}
          onSplit={ms => { apply(c => splitClip(c, selClip.id, ms)); setSplitAt('') }}
          onDuplicate={() => apply(c => duplicateClip(c, selClip.id))}
          onDelete={() => { apply(c => deleteClip(c, selClip.id)); setSelection(null) }}
          onMove={dir => apply(c => moveClip(c, selClip.id, c.clips.findIndex(k => k.id === selClip.id) + dir))} />}
        {selText && <TextInspector t={selText} onChange={p => apply(c => updateTextClip(c, selText.id, p))} onDuplicate={() => apply(c => duplicateTextClip(c, selText.id))} onDelete={() => { apply(c => deleteTextClip(c, selText.id)); setSelection(null) }} />}
        {selAudio && <>
          <p className="small">{label(selAudio.assetId)} · {selAudio.linkedClipId ? 'enlazado a su clip' : 'posición absoluta'}</p>
          <div className="field-row">
            <label>Inicio (s)<input type="number" min={0} step={0.1} value={secs(audioStartMs(comp, selAudio))} onChange={e => apply(c => moveAudioClip(c, selAudio.id, Number(e.target.value) * 1000))} /></label>
            <label>Recortar inicio (s)<input type="number" min={0} step={0.1} value={secs(selAudio.trimInMs)} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { trimInMs: Math.max(0, Number(e.target.value) * 1000) }))} /></label>
            <label>Duración (s)<input type="number" min={0.1} step={0.1} value={secs(selAudio.durationMs)} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { durationMs: Number(e.target.value) * 1000 }))} /></label>
          </div>
          <label>Volumen ({Math.round(selAudio.volume * 100)}%)<input type="range" min={0} max={2} step={0.05} value={selAudio.volume} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { volume: Number(e.target.value) }))} /></label>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={selAudio.muted} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { muted: e.target.checked }))} /> Silenciar</label>
          <AutomationEditor a={selAudio} startMs={audioStartMs(comp, selAudio)} playheadMs={playheadMs} range={range} onChange={p => apply(c => updateAudioClip(c, selAudio.id, p))} />
          <div className="pageActions">
            {selAudio.linkedClipId === null && <span className="muted small">Para enlazarlo a un clip, bórralo y añádelo con ese clip seleccionado.</span>}
            <button type="button" className="ghost" onClick={() => { apply(c => deleteAudioClip(c, selAudio.id)); setSelection(null) }}>Eliminar audio</button>
          </div>
        </>}
        {!selClip && !selAudio && !selText && <>
          <label>Música de fondo
            <select value={comp.musicAssetId ?? ''} onChange={e => apply(c => ({ ...c, musicAssetId: e.target.value || null }))}><option value="">— Sin música</option>{assets.filter(a => musicTypes.includes(a.asset_type)).map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select>
          </label>
          <label>Volumen de música ({Math.round(comp.musicVolume * 100)}%)<input type="range" min={0} max={1} step={0.05} value={comp.musicVolume} onChange={e => apply(c => ({ ...c, musicVolume: Number(e.target.value) }))} /></label>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={comp.duckMusic} onChange={e => apply(c => ({ ...c, duckMusic: e.target.checked }))} /> Bajar música bajo la voz</label>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={comp.subtitles} onChange={e => apply(c => ({ ...c, subtitles: e.target.checked }))} /> Subtítulos (texto de cada clip)</label>
          {comp.subtitles && <label>Estilo de subtítulos<select value={comp.captionStyle ?? 'box'} onChange={e => apply(c => ({ ...c, captionStyle: e.target.value as CaptionStyle }))}>{(Object.keys(CAPTION_STYLES) as CaptionStyle[]).map(k => <option key={k} value={k}>{CAPTION_STYLES[k]}</option>)}</select></label>}
          <label>Duración de las transiciones (ms)<input type="number" min={0} max={1500} step={50} value={comp.fadeMs} onChange={e => apply(c => ({ ...c, fadeMs: Math.min(Math.max(Number(e.target.value) || 0, 0), 1500) }))} /></label>
          <label>Hook inicial en pantalla<input value={comp.hookText ?? ''} maxLength={120} onChange={e => apply(c => ({ ...c, hookText: e.target.value || null }))} /></label>
                    <p className="muted small">Selecciona un clip, un audio o un texto en la línea de tiempo para editarlo.</p>
        </>}
      </section>
    </div>

    <MixerStrip comp={comp} onChange={mix => apply(c => ({ ...c, mix }))} />
    <section ref={scroller} onScroll={measureView} className="panel" style={{ marginBottom: 12, overflowX: 'auto', outline: dropping ? '2px dashed var(--accent, #7c4fe0)' : undefined }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} aria-label="Línea de tiempo"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }} onDragLeave={() => setDropping(false)}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDropping(false); void importFiles(Array.from(e.dataTransfer.files)) } }}>
      <div style={{ width, position: 'relative' }}>
        <div className="muted small timelineRuler" style={{ position: 'relative', height: 18, cursor: 'pointer' }} title="Clic: mover el cabezal · Mayús + arrastrar: marcar un fragmento"
          onPointerDown={e => { const left = e.currentTarget.getBoundingClientRect().left; const ms = Math.max(0, Math.min(total, ((e.clientX - left) / pxPerSec) * 1000)); if (e.shiftKey) { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); rangeDrag.current = { startMs: ms, left }; setRange(null) } else setPlayheadMs(ms) }}
          onPointerMove={e => { const d = rangeDrag.current; if (!d) return; e.stopPropagation(); const ms = Math.max(0, Math.min(total, ((e.clientX - d.left) / pxPerSec) * 1000)); setRange(normRange({ startMs: d.startMs, endMs: ms }, total)) }}
          onPointerUp={e => { if (rangeDrag.current) { e.stopPropagation(); rangeDrag.current = null } }}>
          {Array.from({ length: Math.ceil(total / 1000 / 5) + 1 }, (_, i) => <span key={i} style={{ position: 'absolute', left: i * 5 * pxPerSec }}>{i * 5}s</span>)}
        </div>
        <div className="playhead" ref={playheadEl} style={{ left: playheadMs / 1000 * pxPerSec }} aria-hidden="true" />
        {range && <div className="rangeOverlay" style={{ position: 'absolute', top: 0, bottom: 0, left: range.startMs / 1000 * pxPerSec, width: (range.endMs - range.startMs) / 1000 * pxPerSec }} aria-label={`Fragmento marcado ${secs(range.startMs)}–${secs(range.endMs)} s`} />}
        {!range && markIn !== null && <div className="markIn" style={{ left: markIn / 1000 * pxPerSec }} aria-hidden="true" />}
        <div style={{ display: 'flex', height: 64, marginTop: 4 }} aria-label="Pista de vídeo" onDragOver={allowAsset} onDrop={e => void dropAsset(e, 'video', e.currentTarget)}>
          {windowed.before > 0 && <div aria-hidden style={{ width: windowed.before, flex: 'none' }} />}
          {comp.clips.map((clip, i) => i < windowed.from || i >= windowed.to ? null : <div key={clip.id} draggable
            onDragStart={e => { if (drag.current) { e.preventDefault(); return } setDragId(clip.id) }} onDragOver={e => e.preventDefault()}
            onDrop={e => { if (e.dataTransfer.types.includes(ASSET_MIME)) return; if (dragId && dragId !== clip.id) apply(c => moveClip(c, dragId, i)); setDragId(null) }}
            onClick={() => setSelection({ kind: 'clip', id: clip.id })}
            style={{ width: clip.durationMs / 1000 * pxPerSec, minWidth: 12, position: 'relative', flex: 'none', background: thumbs[clip.visualAssetId ?? ''] ? `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${thumbs[clip.visualAssetId ?? '']}) center / cover` : kindColor[typeOf(clip.visualAssetId)] ?? '#555', borderRadius: 6, marginRight: 2, padding: '4px 6px', overflow: 'hidden', cursor: 'grab', outline: selection?.id === clip.id ? '2px solid #fff' : 'none', color: '#fff', fontSize: 11 }}
            title={`${label(clip.visualAssetId)} · ${secs(clip.durationMs)} s`}>
            <b>{i + 1}</b> {label(clip.visualAssetId)}<br />{secs(clip.durationMs)} s{clip.speed && clip.speed !== 1 ? ` · ${clip.speed}×` : ''}{clip.transition && clip.transition !== 'fade' ? ` · ${TRANSITIONS[clip.transition].toLowerCase()}` : ''}{clip.text ? ' · T' : ''}{clip.muted ? ' · 🔇' : ''}
            <span onMouseDown={e => { e.preventDefault(); e.stopPropagation() }} onPointerDown={e => onPointerDown(e, 'resize', clip.id, clip.durationMs)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: 'rgba(255,255,255,0.35)' }} role="separator" aria-orientation="vertical" aria-label="Cambiar duración" />
          </div>)}
          {windowed.after > 0 && <div aria-hidden style={{ width: windowed.after, flex: 'none' }} />}
        </div>
        <div style={{ position: 'relative', height: 30, marginTop: 6, background: 'var(--bg-2)', borderRadius: 6 }} aria-label="Pista de Texto">
          <span className="muted small" style={{ position: 'absolute', left: 4, top: 6, pointerEvents: 'none' }}>Texto</span>
          {(comp.textClips ?? []).filter(t => onScreen(t.startMs, t.durationMs)).map(t => <div key={t.id} onClick={() => setSelection({ kind: 'text', id: t.id })} onPointerDown={e => onPointerDown(e, 'textMove', t.id, t.startMs)}
            style={{ position: 'absolute', left: t.startMs / 1000 * pxPerSec, width: Math.max(t.durationMs / 1000 * pxPerSec, 10), top: 3, height: 24, background: kindColor.text, borderRadius: 5, color: '#fff', fontSize: 11, padding: '4px 6px', overflow: 'hidden', cursor: 'grab', outline: selection?.id === t.id ? '2px solid #fff' : 'none', whiteSpace: 'nowrap' }}
            title={`${t.content} · ${secs(t.startMs)}–${secs(t.startMs + t.durationMs)} s`}>
            T {t.content}
            <span onPointerDown={e => { e.stopPropagation(); onPointerDown(e, 'textResize', t.id, t.durationMs) }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'rgba(255,255,255,0.35)' }} role="separator" aria-orientation="vertical" aria-label="Cambiar duración del texto" />
          </div>)}
        </div>
        {rows.map(row => <div key={row.key} style={{ position: 'relative', height: 34, marginTop: 6, background: 'var(--bg-2)', borderRadius: 6 }} aria-label={`Pista de ${row.label}`} onDragOver={allowAsset} onDrop={e => void dropAsset(e, row.key, e.currentTarget)}>
          <span className="muted small" style={{ position: 'absolute', left: 4, top: 8, pointerEvents: 'none', zIndex: 2 }}>{row.label}</span>
          {row.key === 'music' && showBeats && beats.beatsMs.filter(t => t >= loMs && t <= hiMs).slice(0, 1500).map(t => <span key={t} data-beat="true" aria-hidden style={{ position: 'absolute', left: t / 1000 * pxPerSec, top: 0, bottom: 0, width: 1, background: '#8ab4ff', opacity: 0.7, pointerEvents: 'none', zIndex: 3 }} />)}
          {(comp.audioClips ?? []).filter(a => a.kind === row.key).map(a => {
            const start = audioStartMs(comp, a)
            if (!onScreen(start, a.durationMs)) return null
            const an = analyses[a.assetId]
            return <div key={a.id} onClick={() => setSelection({ kind: 'audio', id: a.id })} onPointerDown={e => onPointerDown(e, 'move', a.id, start)}
              style={{ position: 'absolute', left: start / 1000 * pxPerSec, width: Math.max(a.durationMs / 1000 * pxPerSec, 8), top: 3, height: 28, background: kindColor[a.kind], opacity: a.muted ? 0.4 : 1, borderRadius: 5, color: '#fff', fontSize: 11, padding: '6px 6px', overflow: 'hidden', cursor: 'grab', outline: selection?.id === a.id ? '2px solid #fff' : 'none', whiteSpace: 'nowrap' }}
              title={`${label(a.assetId)} · ${secs(start)}–${secs(start + a.durationMs)} s${a.linkedClipId ? ' · enlazado a su clip' : ''}`}>
              {typeof an === 'object' && an.waveform && <WaveformSvg w={an.waveform} fromMs={a.trimInMs} toMs={a.trimInMs + a.durationMs} width={Math.max(a.durationMs / 1000 * pxPerSec, 8)} height={28} />}
              {(a.envelope?.length || a.fadeInMs || a.fadeOutMs) ? <svg aria-label="Automatización de volumen" width={Math.max(a.durationMs / 1000 * pxPerSec, 8)} height={28} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}><polyline fill="none" stroke="#ffe08a" strokeWidth={1.5} points={envelopeBreakpoints(a).map(p => `${p.atMs / 1000 * pxPerSec},${26 - Math.min(2, p.gain) / 2 * 24}`).join(' ')} /></svg> : null}
              <span style={{ position: 'relative' }}>{a.linkedClipId ? '🔗 ' : ''}{label(a.assetId)}{an === 'loading' ? ' · midiendo…' : ''}</span>
            </div>
          })}
        </div>)}
        {selAudio && <AutomationLane key={selAudio.id} a={selAudio} startMs={audioStartMs(comp, selAudio)} pxPerSec={pxPerSec} label={label(selAudio.assetId)}
          waveform={(() => { const an = analyses[selAudio.assetId]; return typeof an === 'object' && an.waveform ? an.waveform : null })()}
          onBegin={() => setHistory(h => (h ? { past: [...h.past, h.present].slice(-100), present: h.present, future: [] } : h))}
          onLive={next => { setHistory(h => (h ? { ...h, present: updateAudioClip(h.present, next.id, { envelope: next.envelope }) } : h)); setDirty(true) }}
          onEnd={() => setHistory(h => (h && h.past.length && h.past[h.past.length - 1] === h.present ? { ...h, past: h.past.slice(0, -1) } : h))}
          onCommit={next => apply(c => updateAudioClip(c, next.id, { envelope: next.envelope }))} />}
        {comp.musicAssetId && <p className="muted small" style={{ marginTop: 6 }}>Música de fondo global: {label(comp.musicAssetId)} ({Math.round(comp.musicVolume * 100)}%, {comp.duckMusic ? 'baja bajo la voz' : 'sin ducking'})</p>}
      </div>
      {range && <div className="pageActions" role="group" aria-label="Fragmento" style={{ marginTop: 8 }}>
        <span className="pill info">Fragmento {secs(range.startMs)}–{secs(range.endMs)} s ({secs(range.endMs - range.startMs)} s)</span>
        <button type="button" className="ghost small" onClick={() => { const r = isolateRange(comp, range); apply(() => r.composition); setRange(r.range); setNotice(`Fragmento separado en ${r.ids.length} clip${r.ids.length === 1 ? '' : 's'} propios.`) }}>Separar en clips</button>
        <button type="button" className="ghost small" onClick={() => { const r = deleteRange(comp, range); if (!r.removedMs) { setError('El fragmento no contiene clips completos.'); return } apply(() => r.composition); setRange(null); setNotice(`Fragmento eliminado (${secs(r.removedMs)} s); lo que venía después se adelanta y la música sigue sincronizada. Ctrl+Z para deshacer.`) }}>Eliminar fragmento</button>
        <button type="button" className="ghost small" onClick={() => setRange(null)}>Quitar selección (Esc)</button>
        <span className="muted small">Las instrucciones se aplican solo a este fragmento.</span>
      </div>}
      <p className="muted small" style={{ marginTop: 8 }}>Arrastra los clips para reordenarlos y su borde derecho para cambiar la duración; arrastra audios y textos para moverlos. Haz clic en la regla para mover el cabezal. Supr borra la selección; Ctrl+Z / Ctrl+Shift+Z deshacen y rehacen.</p>
    </section>

    <EditorSyncPanel comp={comp} assets={assets} beats={beats} showBeats={showBeats} setShowBeats={setShowBeats} snap={snap} setSnap={setSnap} toleranceMs={toleranceMs} setToleranceMs={setToleranceMs}
      isVideo={k => typeOf(k.visualAssetId) === 'video'} apply={apply} onNotice={setNotice} />
    <EditorSubtitlesPanel comp={comp} apply={apply} onNotice={setNotice} />
    <StylePanel composition={comp} kindOf={kindOf} refreshKey={stylesKey} sessionStart={sessionStart} onApply={(next, changes) => { apply(() => next); setNotice(`${changes.join(' ')} (puedes deshacerlo)`) }} />
    <MontageTemplatePanel composition={comp} typeOf={id => assets.find(a => a.id === id)?.asset_type ?? 'other'} />
    <EditorReferencePanel comp={comp} kindOf={kindOf} beatsMs={beats.beatsMs} apply={apply} onNotice={setNotice} onStylesChanged={() => setStylesKey(k => k + 1)} />
    <EditorComparePanel comp={comp} jobId={job.id} projectId={job.project_id} beatsMs={beats.beatsMs} />
    <LearnPanel composition={comp} beatsMs={beats.beatsMs} refreshKey={stylesKey} kindOf={kindOf}
      onApply={(next, changes) => { apply(() => next); setNotice(`Estilo aplicado (puedes deshacerlo): ${changes.join(' ')}`) }} />
  </StudioShell>
}

function ClipInspector({ clip, isVideo, visuals, splitAt, setSplitAt, nextBeatMs, onChange, onSpeed, onTrim, onSplit, onDuplicate, onDelete, onMove }: {
  clip: Clip; isVideo: boolean; visuals: EditorAsset[]; splitAt: string; setSplitAt: (v: string) => void; /** First beat of the music inside this clip that leaves both halves ≥ 1 s (ms from the clip start), or null. */ nextBeatMs: number | null
  onChange: (p: Partial<Clip>) => void; onSpeed: (v: number) => void; onTrim: (deltaMs: number) => void; onSplit: (ms: number) => void; onDuplicate: () => void; onDelete: () => void; onMove: (dir: -1 | 1) => void
}) {
  const splitMs = Math.round(Number(splitAt) * 1000)
  const cam = effectiveCamera(clip, !isVideo)
  const canSplit = splitMs >= MIN_CLIP_MS && clip.durationMs - splitMs >= MIN_CLIP_MS
  return <>
    <label>Imagen o vídeo
      <select value={clip.visualAssetId ?? ''} onChange={e => onChange({ visualAssetId: e.target.value || null, trimInMs: 0 })}><option value="">— Sin visual (negro)</option>{visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select>
    </label>
    <div className="field-row">
      <label>Duración (s)<input type="number" min={MIN_CLIP_MS / 1000} max={MAX_CLIP_MS / 1000} step={0.1} value={secs(clip.durationMs)} onChange={e => onChange({ durationMs: Number(e.target.value) * 1000 })} /></label>
      {isVideo && <label>Inicio en el vídeo (s)<input type="number" min={0} step={0.1} value={secs(clip.trimInMs ?? 0)} onChange={e => onTrim(Number(e.target.value) * 1000 - (clip.trimInMs ?? 0))} /></label>}
      <label>Transición al siguiente<select value={clip.transition ?? 'fade'} onChange={e => onChange({ transition: e.target.value as Clip['transition'] })}>{(Object.keys(TRANSITIONS) as Transition[]).map(t => <option key={t} value={t}>{TRANSITIONS[t]}</option>)}</select></label>
    </div>
    <div className="field-row">
      <label>Zoom ({(clip.zoom ?? 1).toFixed(2)}×)<input type="range" min={1} max={3} step={0.05} value={clip.zoom ?? 1} onChange={e => onChange({ zoom: Number(e.target.value) })} /></label>
      <label>Posición horizontal<input type="range" min={0} max={1} step={0.01} value={clip.focusX ?? 0.5} onChange={e => onChange({ focusX: Number(e.target.value) })} /></label>
      <label>Posición vertical<input type="range" min={0} max={1} step={0.01} value={clip.focusY ?? 0.5} onChange={e => onChange({ focusY: Number(e.target.value) })} /></label>
    </div>
    <div className="field-row">
      <label>Movimiento de cámara<select value={cam?.kind ?? 'none'} onChange={e => onChange({ camera: { kind: e.target.value as CameraKind, amount: cam?.amount ?? 0.1 } })}>{(Object.keys(CAMERA_MOVES) as CameraKind[]).map(k => <option key={k} value={k}>{CAMERA_MOVES[k]}</option>)}</select></label>
      <label>Intensidad ({Math.round((cam?.amount ?? 0.1) * 100)} %)<input type="range" min={0.02} max={0.5} step={0.01} value={cam?.amount ?? 0.1} disabled={!cam || cam.kind === 'none'} onChange={e => onChange({ camera: { kind: cam?.kind ?? 'zoom_in', amount: Number(e.target.value) } })} /></label>
      {isVideo && <label>Velocidad<select value={String(clip.speed ?? 1)} onChange={e => onSpeed(Number(e.target.value))}>{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(v => <option key={v} value={String(v)}>{v}×</option>)}</select></label>}
    </div>
    {isVideo && <div className="field-row">
      <label>Volumen del vídeo ({Math.round((clip.volume ?? 1) * 100)}%)<input type="range" min={0} max={2} step={0.05} value={clip.volume ?? 1} onChange={e => onChange({ volume: Number(e.target.value) })} /></label>
      <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={clip.muted === true} onChange={e => onChange({ muted: e.target.checked })} /> Silenciar</label>
    </div>}
    <label>Subtítulo de este clip<textarea className="viText" value={clip.narration ?? ''} onChange={e => onChange({ narration: e.target.value || null })} /></label>
    <div className="field-row">
      <label>Texto en pantalla<input value={clip.text?.content ?? ''} maxLength={200} onChange={e => onChange({ text: e.target.value ? { content: e.target.value, position: clip.text?.position ?? 'center', sizePct: clip.text?.sizePct ?? 6 } : null })} /></label>
      <label>Posición del texto<select value={clip.text?.position ?? 'center'} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, position: e.target.value as 'top' | 'center' | 'bottom' } })}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
      <label>Tamaño<input type="range" min={2} max={15} step={0.5} value={clip.text?.sizePct ?? 6} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, sizePct: Number(e.target.value) } })} /></label>
      <label>Animación del texto<select value={clip.text?.animation ?? 'none'} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, animation: e.target.value as TextAnimation } })}>{(Object.keys(TEXT_ANIMATIONS) as TextAnimation[]).map(a => <option key={a} value={a}>{TEXT_ANIMATIONS[a]}</option>)}</select></label>
      {clip.text && <TextStyleFields t={clip.text} onChange={p => onChange({ text: { ...clip.text!, ...p } })} />}
    </div>
    <div className="field-row" style={{ alignItems: 'end' }}>
      <label>Dividir en (s desde el inicio del clip)<input type="number" min={1} step={0.1} value={splitAt} onChange={e => setSplitAt(e.target.value)} placeholder={`1 – ${secs(clip.durationMs - MIN_CLIP_MS)}`} /></label>
      <button type="button" className="ghost" disabled={!canSplit} onClick={() => onSplit(splitMs)}>Dividir</button>
      <button type="button" className="ghost" disabled={nextBeatMs === null} title="Divide el clip en el primer pulso de la música que deja al menos 1 s a cada lado" onClick={() => nextBeatMs !== null && onSplit(nextBeatMs)}>Dividir en el siguiente pulso</button>
    </div>
    <div className="pageActions">
      <button type="button" className="ghost" onClick={() => onMove(-1)}>← Mover</button>
      <button type="button" className="ghost" onClick={() => onMove(1)}>Mover →</button>
      <button type="button" className="ghost" onClick={onDuplicate}>Duplicar</button>
      <button type="button" className="ghost" onClick={onDelete}>Eliminar</button>
    </div>
  </>
}

function TextStyleFields({ t, onChange }: { t: TextOverlay; onChange: (p: Partial<TextOverlay>) => void }) {
  return <>
    <label>Tipografía<select value={t.font ?? 'sans'} onChange={e => onChange({ font: e.target.value as TextFont })}>{(Object.keys(TEXT_FONTS) as TextFont[]).map(f => <option key={f} value={f}>{TEXT_FONTS[f].label}</option>)}</select></label>
    <label>Color<input type="color" value={t.color ?? '#ffffff'} onChange={e => onChange({ color: e.target.value })} /></label>
  </>
}

function TextInspector({ t, onChange, onDuplicate, onDelete }: { t: TextClip; onChange: (p: Partial<TextClip>) => void; onDuplicate: () => void; onDelete: () => void }) {
  return <>
    <label>Texto<input aria-label="Contenido del texto" value={t.content} maxLength={200} onChange={e => onChange({ content: e.target.value || ' ' })} /></label>
    <div className="field-row">
      <label>Aparece en (s)<input type="number" min={0} step={0.1} value={secs(t.startMs)} onChange={e => onChange({ startMs: Number(e.target.value) * 1000 })} /></label>
      <label>Dura (s)<input type="number" min={0.3} step={0.1} value={secs(t.durationMs)} onChange={e => onChange({ durationMs: Number(e.target.value) * 1000 })} /></label>
    </div>
    <div className="field-row">
      <label>Posición<select value={t.position} onChange={e => onChange({ position: e.target.value as TextClip['position'] })}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
      <label>Tamaño ({t.sizePct} %)<input type="range" min={2} max={15} step={0.5} value={t.sizePct} onChange={e => onChange({ sizePct: Number(e.target.value) })} /></label>
      <label>Animación<select value={t.animation ?? 'none'} onChange={e => onChange({ animation: e.target.value as TextAnimation })}>{(Object.keys(TEXT_ANIMATIONS) as TextAnimation[]).map(a => <option key={a} value={a}>{TEXT_ANIMATIONS[a]}</option>)}</select></label>
      <TextStyleFields t={t} onChange={onChange} />
    </div>
    <div className="pageActions">
      <button type="button" className="ghost" onClick={onDuplicate}>Duplicar texto</button>
      <button type="button" className="ghost" onClick={onDelete}>Eliminar texto</button>
    </div>
  </>
}

function MixerStrip({ comp, onChange }: { comp: Composition; onChange: (mix: NonNullable<Composition['mix']>) => void }) {
  const kinds: TrackKind[] = ['voice', 'music', 'sfx', 'video']
  const st = (k: TrackKind): TrackState => comp.mix?.[k] ?? { gain: 1, muted: false, solo: false }
  const set = (k: TrackKind, p: Partial<TrackState>) => onChange({ ...(comp.mix ?? {}), [k]: { ...st(k), ...p } })
  return <section className="panel mixerStrip" aria-label="Mezclador" style={{ marginBottom: 12 }}>
    <b className="small">Mezcla</b>
    {kinds.map(k => <div key={k} className="mixerTrack" role="group" aria-label={`Pista ${TRACK_LABELS[k]}`}>
      <span className="small">{TRACK_LABELS[k]}</span>
      <input type="range" min={0} max={2} step={0.05} value={st(k).gain} aria-label={`Nivel de ${TRACK_LABELS[k]}`} onChange={e => set(k, { gain: Number(e.target.value) })} />
      <span className="small muted" style={{ width: 38, textAlign: 'right' }}>{Math.round(st(k).gain * 100)}%</span>
      <button type="button" className={st(k).muted ? 'small' : 'ghost small'} aria-pressed={st(k).muted} title="Silenciar la pista" onClick={() => set(k, { muted: !st(k).muted })}>M</button>
      <button type="button" className={st(k).solo ? 'small' : 'ghost small'} aria-pressed={st(k).solo} title="Escuchar solo esta pista" onClick={() => set(k, { solo: !st(k).solo })}>S</button>
    </div>)}
  </section>
}

function AutomationEditor({ a, startMs, playheadMs, range, onChange }: { a: AudioClipT; startMs: number; playheadMs: number; range: Range | null; onChange: (p: Partial<AudioClipT>) => void }) {
  const pts = a.envelope ?? []
  const rel = Math.min(Math.max(playheadMs - startMs, 0), a.durationMs)
  const setPt = (i: number, p: Partial<{ atMs: number; gain: number }>) => onChange({ envelope: pts.map((x, n) => (n === i ? { ...x, ...p } : x)).sort((x, y) => x.atMs - y.atMs) })
  const inRange = range && range.endMs > startMs && range.startMs < startMs + a.durationMs
  return <details open={pts.length > 0 || Boolean(a.fadeInMs || a.fadeOutMs)} className="small">
    <summary><b>Automatización de volumen</b></summary>
    <div className="field-row" style={{ marginTop: 6 }}>
      <label>Entrada gradual (s)<input type="number" min={0} max={60} step={0.1} value={secs(a.fadeInMs ?? 0)} onChange={e => onChange({ fadeInMs: Math.max(0, Number(e.target.value) * 1000) })} /></label>
      <label>Salida gradual (s)<input type="number" min={0} max={60} step={0.1} value={secs(a.fadeOutMs ?? 0)} onChange={e => onChange({ fadeOutMs: Math.max(0, Number(e.target.value) * 1000) })} /></label>
    </div>
    <table className="table small" aria-label="Puntos de volumen"><tbody>
      {pts.map((p, i) => <tr key={i}>
        <td><label>En (s)<input type="number" min={0} step={0.1} value={secs(p.atMs)} aria-label={`Tiempo del punto ${i + 1}`} onChange={e => setPt(i, { atMs: Math.min(a.durationMs, Math.max(0, Number(e.target.value) * 1000)) })} style={{ width: 80 }} /></label></td>
        <td><label>Nivel (%)<input type="number" min={0} max={200} step={5} value={Math.round(p.gain * 100)} aria-label={`Nivel del punto ${i + 1}`} onChange={e => setPt(i, { gain: Math.min(2, Math.max(0, Number(e.target.value) / 100)) })} style={{ width: 70 }} /></label></td>
        <td><button type="button" className="ghost small" aria-label={`Quitar el punto ${i + 1}`} onClick={() => onChange({ envelope: pts.filter((_, n) => n !== i) })}>✕</button></td>
      </tr>)}
    </tbody></table>
    <div className="pageActions">
      <button type="button" className="ghost small" onClick={() => onChange({ envelope: [...pts, { atMs: Math.round(rel), gain: 1 }].sort((x, y) => x.atMs - y.atMs) })}>Añadir punto en el cabezal</button>
      {inRange && <button type="button" className="ghost small" onClick={() => onChange({ envelope: setLevelBetween(a, range!.startMs - startMs, range!.endMs - startMs, 0.3).envelope })}>Bajar al 30 % en el fragmento</button>}
      {pts.length > 0 && <button type="button" className="ghost small" onClick={() => onChange({ envelope: [] })}>Quitar puntos</button>}
    </div>
    <p className="muted">Los puntos multiplican el volumen del clip y se unen en línea recta; también se aplican sobre la bajada automática bajo la voz.</p>
  </details>
}

/**
 * Volume automation lane under the tracks for the selected audio clip: its real waveform with the envelope on top.
 * Drag a point (time and level), double-click the lane to add one, double-click a point to remove it. One drag = one undo step.
 */
function AutomationLane({ a, startMs, pxPerSec, label, waveform, onBegin, onLive, onEnd, onCommit }: {
  a: AudioClipT; startMs: number; pxPerSec: number; label: string; waveform: import('@/lib/editor/waveform').Waveform | null
  onBegin: () => void; onLive: (a: AudioClipT) => void; onEnd: () => void; onCommit: (a: AudioClipT) => void
}) {
  const H = 72
  const width = Math.max(a.durationMs / 1000 * pxPerSec, 8)
  const svg = useRef<SVGSVGElement | null>(null)
  const dragging = useRef<{ i: number; base: AudioClipT } | null>(null)
  const pts = a.envelope ?? []
  const xy = (e: { clientX: number; clientY: number }) => { const r = svg.current!.getBoundingClientRect(); return envelopePointAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height, a.durationMs) }
  const yOf = (g: number) => H - Math.min(2, g) / 2 * H
  const line = envelopeBreakpoints(a).map(p => `${p.atMs / 1000 * pxPerSec},${yOf(p.gain)}`).join(' ')
  return <div className="automationLane" style={{ position: 'relative', height: H + 18, marginTop: 6 }} aria-label={`Volumen de ${label}`}>
    <span className="muted small" style={{ position: 'absolute', left: 4, top: 0 }}>Volumen de «{label}» · arrastra los puntos · doble clic para añadir o quitar</span>
    <div style={{ position: 'absolute', left: startMs / 1000 * pxPerSec, top: 16, width, height: H, background: 'rgba(154,91,15,.25)', borderRadius: 5, overflow: 'hidden' }}>
      {waveform && <WaveformSvg w={waveform} fromMs={a.trimInMs} toMs={a.trimInMs + a.durationMs} width={width} height={H} opacity={0.35} />}
      <svg ref={svg} width={width} height={H} role="img" aria-label="Puntos de volumen" style={{ position: 'absolute', left: 0, top: 0, cursor: 'crosshair', touchAction: 'none' }}
        onDoubleClick={e => { if ((e.target as Element).tagName !== 'circle') onCommit(addEnvelopePoint(a, xy(e))) }}
        onPointerMove={e => { const d = dragging.current; if (d) onLive(moveEnvelopePoint(d.base, d.i, xy(e))) }}
        onPointerUp={() => { if (dragging.current) { dragging.current = null; onEnd() } }}>
        <line x1={0} x2={width} y1={yOf(1)} y2={yOf(1)} stroke="rgba(255,255,255,.25)" strokeDasharray="3 3" />
        <polyline fill="none" stroke="#ffe08a" strokeWidth={2} points={line} />
        {pts.map((p, i) => <circle key={i} data-point={i} cx={p.atMs / 1000 * pxPerSec} cy={yOf(p.gain)} r={6} fill="#ffe08a" stroke="#000" style={{ cursor: 'grab' }}
          onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); dragging.current = { i, base: a }; onBegin() }}
          onDoubleClick={e => { e.stopPropagation(); onCommit({ ...a, envelope: pts.filter((_, n) => n !== i) }) }}>
          <title>{`${Math.round(p.atMs / 100) / 10} s · ${Math.round(p.gain * 100)} %`}</title>
        </circle>)}
      </svg>
    </div>
  </div>
}
