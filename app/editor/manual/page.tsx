'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { readSidebarMode, StudioShell, writeSidebarMode, type SidebarMode } from '../../components/studio-shell'
import { ContextMenu, DEFAULT_LAYOUT, MODES, Section, type MenuItem, Splitter, ToolSearch, ToolTabs, useWorkspaceState, WorkspaceProvider, type ToolEntry, type WorkspaceMode } from '../../components/editor-workspace'
import { RenderPanel } from '../../components/render-panel'
import { ImportCenter, type ImportedItem } from '../../components/import-center'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { CAPTION_POSITIONS, FILTER_PRESETS, tracksOf, type CaptionPosition, audioStartMs, envelopeBreakpoints, type TrackMeta, TRACK_LABELS, type AudioClip as AudioClipT, type TrackKind, type TrackState, CAMERA_MOVES, CAPTION_STYLES, clipStarts, type CameraKind, type CaptionStyle, TEXT_ANIMATIONS, TEXT_FONTS, type TextAnimation, type TextFont, type TextClip, type TextOverlay, TRANSITIONS, type Transition, parseComposition, projectDurationMs, totalDurationMs, MAX_CLIP_MS, MIN_CLIP_MS, type AudioClip, type Clip, type Composition, type OutputFormat, type OverlayClip } from '@/lib/editor/composition'
import { addEnvelopePoint, envelopePointAt, moveEnvelopePoint, addVideo, setLevelBetween, addAudioClip, addClip, addTextClip, commit, deleteAudioClip, deleteClip, deleteTextClip, duplicateClip, duplicateTextClip, historyOf, moveAudioClip, moveClip, redo, setSpeed, splitClip, toManual, trimStart, undo, updateAudioClip, updateClip, updateTextClip, type History } from '@/lib/editor/timeline'
import { assetLabel, audioDurationMs, videoDurationMs, musicTypes, visualTypes, voiceTypes, type EditorAsset } from '@/lib/editor/client'
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
import { clearLocalDraft, draftDiffers, loadLocalDraft, loadLocalHistory, saveLocalDraft, saveLocalHistory, type LocalDraft } from '@/lib/editor/local-draft'
import { listVersions, loadVersion, REASON_LABELS, removedItems, saveVersion, type VersionInfo, type VersionReason } from '@/lib/editor/versions'
import { acceptProposal, DEFAULT_PREFS, detectCorrection, loadPrefs, PREF_LABELS, savePrefs, type EditPreferences, type Proposal, type Watch } from '@/lib/editor/preferences'
import { deleteRange, isolateRange, normRange, type Range } from '@/lib/editor/range'
import { effectiveCamera } from '@/lib/editor/motion'
import { ManualPicker } from '../../components/manual-picker'
import { EditorPlayerView } from '../../components/editor-player'
import { ViewerHandles } from '../../components/viewer-handles'
import { MatchPanel, withoutGrades } from '../../components/match-panel'
import { makeRoomForTransition } from '@/lib/editor/transition-room'
import { RepeatDialog, BatchTransitionsDialog } from '../../components/editor-batch'
import { zoomAfterWheel, wheelDelta, scrollForAnchor, sliderAnchor, clampZoom } from '@/lib/editor/timeline-zoom'
import { ALIGNS, alignOf, transitionHandles, transitionPatch, transitionWindow } from '@/lib/editor/transition-window'
import { BLENDS } from '@/lib/editor/motion'
import { ASSET_MIME, EditorTimeline, kindColor, TRANSITION_ICONS, TRANSITION_MIME } from '../../components/editor-timeline'
import { CLIP_PROPS, KeyframeEditor, LAYER_PROPS, OverlayInspector, SliderField, TransitionTools, VisualFields } from '../../components/editor-inspectors'
import { BUILTIN_ANIMATIONS, EMPTY_PRESETS, type AnimationPreset, keysToPreset, loadPresets, presetKeys, savePresets, type AnimKey, type Presets } from '@/lib/editor/presets'
import { transformAt as frameValuesAt } from '@/lib/editor/motion'
import { loadProfiles, saveProfiles } from '@/lib/editor/profiles-store'
import { extractProfile } from '@/lib/editor/profile'
import { addMarker, addOverlay, addTrack, copyItems, deleteItems, deleteMarker, deleteTrack, duplicateItems, duplicateTrack, expandGroups, groupItems, itemsInRange, moveTrack, pasteItems, isLocked, setClipKeyframes, splitAt as splitAllAt, ungroupItems, missingAssets, replaceAsset, updateMarker, updateOverlay, updateTrack, type Clipboard, type ItemRef } from '@/lib/editor/tracks'
import { assetUrlResolver, kindFromAssets } from '@/lib/editor/media-urls'
import type { EditorPlayer } from '@/lib/editor/player'
import { mediaDuration, uploadProjectMedia, validateUpload, type LicenseStatus, type UploadKind } from '@/lib/media-upload'

type Job = { id: string; project_id: string; status: string; updated_at: string; composition: unknown }

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`
const secs = (ms: number) => Math.round(ms / 100) / 10

export default function ManualEditorPage() {
  const supabase = getSupabaseBrowserClient()
  const [job, setJob] = useState<Job | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [assets, setAssets] = useState<EditorAsset[]>([])
  // Several items can be selected (Mayús/Ctrl + clic); the last one is the one the inspector shows.
  const [sel, setSelState] = useState<ItemRef[]>([])
  // Selecting items clears the selected transition (the selection setter is declared once here, the transition one just below).
  const setSel = useCallback((r: ItemRef[]) => { setSelState(r); setSelTrState(null) }, [])
  const selection: ItemRef | null = sel.length ? sel[sel.length - 1] : null
  const setSelection = useCallback((r: ItemRef | null) => setSel(r ? [r] : []), [])
  const clipboard = useRef<Clipboard | null>(null)
  const [copiedAnim, setCopiedAnim] = useState<{ target: 'clip' | 'layer'; keys: AnimKey[] } | null>(null)
  // The selected transition: the cut after this clip (selecting a clip or anything else clears it).
  const [selTr, setSelTrState] = useState<string | null>(null)
  // Right-click menu on the timeline (items, a transition or the empty timeline).
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'item' | 'transition' | 'empty' } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // Sliders: the composition when a drag started (the whole drag becomes one undo step).
  const sliderBase = useRef<Composition | null>(null)
  // Export lives in its own panel (opened from the top bar) so nothing separates the viewer from the timeline.
  const [exportOpen, setExportOpen] = useState(false)
  const [batchDlg, setBatchDlg] = useState<null | 'repeat' | 'trans'>(null)
  // «Igualar imagen»: show the viewer without the corrections (before / after).
  const [compareBefore, setCompareBefore] = useState(false)
  const selectTransition = useCallback((clipId: string | null) => { setSelTrState(clipId); if (clipId) setSelState([]) }, [])
  const [copiedTransition, setCopiedTransition] = useState<Pick<Clip, 'transition' | 'transitionMs' | 'transitionOpts'> | null>(null)
  // Favourite transitions and animations, saved in the account (every montage, every device).
  const [presets, setPresets] = useState<Presets>(EMPTY_PRESETS)
  const [presetsAt, setPresetsAt] = useState<string | null>(null)
  const storePresets = async (next: Presets) => { try { const at = await savePresets(supabase, next, presetsAt); setPresets(next); setPresetsAt(at) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el preajuste.') } }
  const dragging = useRef(false)
  const dragStartedAt = useRef(0)
  // Whether a mouse button / finger is down anywhere in the page (to tell a real drag from one whose release was lost).
  const pointerDown = useRef(false)
  useEffect(() => {
    const down = () => { pointerDown.current = true }, up = () => { pointerDown.current = false }
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true); window.addEventListener('blur', up)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); window.removeEventListener('blur', up) }
  }, [])
  const [trackScale, setTrackScale] = useState(1)
  const [allProjects, setAllProjects] = useState(false)
  // Workspace: tool tabs | viewer | properties, panel sizes, open property groups and the workspace mode (remembered in this browser).
  const ws = useWorkspaceState()
  const sidebarBeforeWide = useRef<SidebarMode | null>(null)
  const setMode = (m: WorkspaceMode) => {
    const was = ws.layout.mode
    if (m === 'wide' && was !== 'wide') { sidebarBeforeWide.current = readSidebarMode(); writeSidebarMode('hidden') }
    if (was === 'wide' && m !== 'wide') writeSidebarMode(sidebarBeforeWide.current && sidebarBeforeWide.current !== 'hidden' ? sidebarBeforeWide.current : 'pinned')
    if (m === 'edit') ws.set({ mode: m, left: true, right: true, viewerAuto: true, rightW: DEFAULT_LAYOUT.rightW })
    if (m === 'audio') { ws.set({ mode: m, left: true, right: true, tab: 'audio', viewerAuto: true }); setTrackScale(1.4) }
    if (m === 'effects') ws.set({ mode: m, left: true, right: true, tab: 'effects', rightW: 440 })
    if (m === 'wide') ws.set({ mode: m, left: false, right: false })
    if (m !== 'audio') setTrackScale(1)
  }
  // Automatic viewer height: as tall as possible while the timeline up to the main video track still fits on the screen, so the picture
  // and the timeline can be watched together without scrolling (dragging the splitter fixes a height; double-click returns to automatic).
  const [autoViewerH, setAutoViewerH] = useState<number | null>(null)
  const trackCount = history ? tracksOf(history.present).length : 0
  useEffect(() => {
    if (!ws.layout.viewerAuto) return
    const fit = () => {
      const stage = document.querySelector('.playerStage'), main = document.querySelector('[aria-label="Pista de vídeo"]')
      if (!stage || !main || window.innerWidth <= 1100) { setAutoViewerH(null); return }
      const sb = stage.getBoundingClientRect(), mb = main.getBoundingClientRect()
      const below = mb.bottom - sb.bottom, top = sb.top + window.scrollY
      const h = Math.round(Math.min(1000, Math.max(200, window.innerHeight - 10 - below - top)))
      setAutoViewerH(prev => (prev !== null && Math.abs(prev - h) < 4 ? prev : h))
    }
    // Measured again once fonts, thumbnails and panels have settled (their height changes what is left for the picture).
    const ts = [60, 700, 2000].map(ms => window.setTimeout(fit, ms))
    window.addEventListener('resize', fit)
    return () => { ts.forEach(t => window.clearTimeout(t)); window.removeEventListener('resize', fit) }
  }, [ws.layout.viewerAuto, ws.layout.left, ws.layout.right, trackCount, trackScale, !!history])
  // Ctrl+K (⌘K): tool search.
  useEffect(() => {
    const onK = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); (document.getElementById('tool-search') as HTMLInputElement | null)?.focus() } }
    window.addEventListener('keydown', onK)
    return () => window.removeEventListener('keydown', onK)
  }, [])
  const [relinkTo, setRelinkTo] = useState<Record<string, string>>({})
  const [magnet, setMagnet] = useState(true)
  const [pxPerSec, setPxPerSec] = useState(40)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
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
  // Alt + wheel over the timeline = the same state as the "Zoom" slider, anchored on the instant under the cursor.
  const zoomAnchor = useRef<{ t: number; x: number } | null>(null)
  useEffect(() => {
    // One listener on the document: the timeline panel can be mounted/moved by the workspace at any time.
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const el = scroller.current
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return
      e.preventDefault()
      const old = pxRef.current
      const next = zoomAfterWheel(old, wheelDelta(e))
      if (next === old) return
      const x = e.clientX - el.getBoundingClientRect().left
      const pending = zoomAnchor.current
      const t = pending && Math.abs(pending.x - x) < 3 ? pending.t : (el.scrollLeft + x) / old
      zoomAnchor.current = { t, x }
      pxRef.current = next
      setPxPerSec(next)
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => document.removeEventListener('wheel', onWheel)
  }, [])
  /** Zoom from the slider / buttons: keeps the playhead (or the centre of the window) where it is on screen. */
  const zoomKeepingView = useCallback((value: number) => {
    const next = clampZoom(value), old = pxRef.current, el = scroller.current
    if (next === old) return
    if (el) {
      const live = playerRef.current?.state.timeMs
      const a = sliderAnchor((live ?? playheadMs) / 1000, old, el.scrollLeft, el.clientWidth)
      const pending = zoomAnchor.current
      // Several slider events before React renders: keep the first reference so the view does not drift.
      zoomAnchor.current = pending ?? a
    }
    pxRef.current = next
    setPxPerSec(next)
  }, [playheadMs])
  useLayoutEffect(() => {
    const a = zoomAnchor.current, el = scroller.current
    if (!a || !el) return
    zoomAnchor.current = null
    el.scrollLeft = scrollForAnchor(a.t, pxPerSec, a.x)
  }, [pxPerSec])
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

  // Length of the source file of every main video clip, stored on the clip: a transition needs it to know whether the file has material after the
  // clip's end. Read from the asset's data when it has it, otherwise from the file's metadata (a few bytes). Not an undo step.
  const durCache = useRef(new Map<string, number>()), durAsked = useRef(new Set<string>())
  useEffect(() => {
    if (!comp) return
    const need = [...new Set(comp.clips.filter(k => k.visualAssetId && !k.sourceDurationMs && assets.find(a => a.id === k.visualAssetId)?.asset_type === 'video').map(k => k.visualAssetId as string))]
    const put = (id: string, ms: number) => { durCache.current.set(id, ms); setHistory(h => (h ? { ...h, present: { ...h.present, clips: h.present.clips.map(k => (k.visualAssetId === id && !k.sourceDurationMs ? { ...k, sourceDurationMs: ms } : k)) } } : h)); setDirty(true) }
    for (const id of need) {
      const cached = durCache.current.get(id)
      if (cached) { put(id, cached); continue }   // e.g. after an undo to a state older than the reading
      if (durAsked.current.has(id)) continue
      durAsked.current.add(id)
      const p = assets.find(a => a.id === id)?.provenance ?? {}
      const known = typeof p.durationMs === 'number' ? p.durationMs : typeof p.durationSeconds === 'number' ? Math.round(p.durationSeconds * 1000) : null
      void (known ? Promise.resolve(known) : videoDurationMs(id)).then(ms => { if (ms > 0) put(id, ms) }, () => durAsked.current.delete(id))
    }
  }, [comp, assets])

  // Beats of the music, on the montage's timeline (music clips on the track, plus the global background music).
  const beats: BeatSummary = useMemo(() => summarizeBeats(comp, analyses), [comp, analyses])

  const measureView = useCallback(() => { const el = scroller.current; if (el) setView(v => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth })) }, [])
  const loaded = history !== null
  useEffect(() => { void loadPrefs(supabase).then(r => { setPrefs(r.prefs); setPrefsAt(r.updatedAt) }).catch(() => undefined) }, [supabase])
  useEffect(() => { void loadPresets(supabase).then(r => { setPresets(r.presets); setPresetsAt(r.updatedAt) }).catch(() => undefined) }, [supabase])
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
    if (parsed.editedManually) {
      setHistory(historyOf(parsed))
      // Ctrl+Z after a reload: the history kept in this browser, if it ends exactly in the montage just opened.
      void loadLocalHistory(row.id).then(h => { if (h && JSON.stringify(parseComposition(h.present)) === JSON.stringify(parsed)) setHistory(cur => (cur && cur.present === parsed && !cur.past.length ? { past: h.past.flatMap(x => { const p = parseComposition(x); return p ? [p] : [] }), present: parsed, future: h.future.flatMap(x => { const p = parseComposition(x); return p ? [p] : [] }) } : cur)) })
      return
    }
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

  // Files used by the montage that are not in this project's list: look them up (another project's material is fine); what is left is really missing.
  const checkedMissing = useRef(new Set<string>())
  const missing = useMemo(() => (comp && history ? missingAssets(comp, assets) : []), [comp, assets, history])
  useEffect(() => {
    const ask = missing.map(m => m.id).filter(id => !checkedMissing.current.has(id))
    if (!ask.length || !job) return
    ask.forEach(id => checkedMissing.current.add(id))
    void supabase.from('assets').select('id,project_id,asset_type,storage_path,license_status,source_provider,provenance,created_at').in('id', ask).then(({ data }: { data: unknown[] | null }) => {
      const found = ((data ?? []) as EditorAsset[]).filter(a => a.storage_path)
      if (found.length) setAssets(list => [...list, ...found.filter(f => !list.some(x => x.id === f.id))])
    })
  }, [missing, job, supabase])
  // «Ver también otros proyectos»: the owner's materials from every project, used here without copying the files.
  useEffect(() => {
    if (!allProjects || !job) return
    void supabase.from('assets').select('id,project_id,asset_type,storage_path,license_status,source_provider,provenance,created_at').not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(1000).then(({ data }: { data: unknown[] | null }) => {
      const more = (data ?? []) as EditorAsset[]
      setAssets(list => [...list, ...more.filter(f => !list.some(x => x.id === f.id))])
    })
  }, [allProjects, job, supabase])

  // ---------- Saving ----------
  // The cloud copy (render_jobs.composition) is the one that counts: autosave a couple of seconds after each change, «Guardar ahora»,
  // a visible state, retries when the connection fails, conflict handling between sessions, and recovery points on the server.
  // The browser copy (IndexedDB) is only a safety net for crashes and is never taken for the saved one.
  const presentRef = useRef<Composition | null>(null)
  useEffect(() => { presentRef.current = comp }, [comp])
  const savedAtRef = useRef<string | null>(null)
  useEffect(() => { savedAtRef.current = savedAt }, [savedAt])
  const lastSaved = useRef<Composition | null>(null)
  const ownerRef = useRef<string | null>(null)
  const lastVersionAt = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error' | 'conflict'>('saved')
  const [saveMessage, setSaveMessage] = useState('')
  const [lastCloudSave, setLastCloudSave] = useState<string | null>(null)
  const [retryIn, setRetryIn] = useState(0)
  useEffect(() => { if (history && !lastSaved.current) lastSaved.current = history.present }, [history])
  useEffect(() => { void supabase.auth.getUser().then(({ data }: { data: { user: { id: string } | null } }) => { ownerRef.current = data.user?.id ?? null }) }, [supabase])

  const writeVersion = useCallback(async (composition: Composition, reason: VersionReason) => {
    if (!job || !ownerRef.current) return
    try { await saveVersion(supabase, { owner: ownerRef.current, projectId: job.project_id, jobId: job.id, composition, reason }); lastVersionAt.current = Date.now(); setVersionsKey(k => k + 1) } catch { /* a recovery point is a bonus: the save itself already happened */ }
  }, [job, supabase])

  const save = useCallback(async (opts: { force?: boolean; reason?: VersionReason } = {}) => {
    // One save at a time: a second request waits for the first and then saves whatever is newest.
    while (inFlight.current) await inFlight.current.catch(() => undefined)
    const snapshot = presentRef.current
    if (!job || !snapshot || !savedAtRef.current) return
    const run = (async () => {
      setSaveState('saving'); setSaveMessage('')
      // Before saving a version that removes clips, layers, texts or sounds, the previous saved one is kept as a recovery point.
      const prev = lastSaved.current
      if (prev && prev !== snapshot && removedItems(prev, snapshot).length) await writeVersion(prev, 'before-removal')
      let q = supabase.from('render_jobs').update({ composition: snapshot, output_format: snapshot.format, updated_at: new Date().toISOString() }).eq('id', job.id)
      if (!opts.force) q = q.eq('updated_at', savedAtRef.current)
      const { data, error: e } = await q.select('updated_at')
      if (e) throw new Error(e.message)
      if (!data?.length) throw new SaveConflictError()
      const at = (data[0] as { updated_at: string }).updated_at
      savedAtRef.current = at; setSavedAt(at)
      lastSaved.current = snapshot
      setLastCloudSave(new Date().toLocaleTimeString())
      const still = presentRef.current !== snapshot
      setDirty(still); setSaveState(still ? 'pending' : 'saved'); setRetryIn(0)
      if (!still) void clearLocalDraft(job.id)
      if (opts.reason || Date.now() - lastVersionAt.current > 5 * 60_000) void writeVersion(snapshot, opts.reason ?? 'auto')
    })()
    inFlight.current = run
    try { await run } catch (err) {
      if (err instanceof SaveConflictError) { setSaveState('conflict'); setSaveMessage(err.message) }
      else { setSaveState('error'); setSaveMessage(err instanceof Error ? err.message : 'No se pudo guardar.') }
      throw err
    } finally { inFlight.current = null }
  }, [job, supabase, writeVersion])

  // Every change is copied locally a moment later (crash safety net only).
  useEffect(() => {
    if (!job || !comp || !dirty) return
    const t = setTimeout(() => { void saveLocalDraft({ jobId: job.id, composition: comp, savedAt: new Date().toISOString(), baseUpdatedAt: savedAt }) }, 800)
    return () => clearTimeout(t)
  }, [job, comp, dirty, savedAt])
  // The undo history too (so Ctrl+Z works after reloading), a little later.
  useEffect(() => {
    if (!job || !history) return
    const t = setTimeout(() => { void saveLocalHistory({ jobId: job.id, past: history.past, future: history.future, present: history.present }) }, 2000)
    return () => clearTimeout(t)
  }, [job, history])
  useEffect(() => { if (dirty && saveState === 'saved') setSaveState('pending') }, [dirty, saveState])
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save }, [save])
  // Autosave: 2.5 s after the last change (never in the middle of a drag); after a failed attempt, retries after 5, 15, 30, 60 s.
  const failures = useRef(0)
  useEffect(() => {
    if (!autoSave || !dirty || saveState === 'conflict' || saveState === 'saving') return
    const wait = saveState === 'error' ? [5, 15, 30, 60][Math.min(failures.current, 3)] * 1000 : 2500
    if (saveState === 'error') setRetryIn(Math.round(wait / 1000))
    const t = setTimeout(function attempt() {
      // A drag that never ended (its release was lost) must not hold the save back forever: after 20 s without a pressed button, end it.
      if (dragging.current && Date.now() - dragStartedAt.current > 20_000 && !pointerDown.current) endDragRef.current()
      if (dragging.current || busy === 'import') { setTimeout(attempt, 800); return }
      void saveRef.current().then(() => { failures.current = 0 }, () => { failures.current++ })
    }, wait)
    return () => clearTimeout(t)
  }, [autoSave, dirty, comp, busy, saveState])

  async function saveClick() {
    setError(''); setBusy('save')
    try { await save({ reason: 'manual' }); setNotice('Montaje guardado en la nube.') } catch (e) { if (!(e instanceof SaveConflictError)) setError(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setBusy('') }
  }
  /** Conflict: the same montage was saved from another tab or device after it was opened here. */
  async function resolveConflict(how: 'theirs' | 'mine' | 'copy') {
    if (!job || !comp) return
    const mine = comp
    await writeVersion(mine, 'conflict')
    if (how === 'mine') { try { await save({ force: true, reason: 'manual' }); setNotice('Tu versión ha sustituido a la otra (la otra sigue en «Puntos de recuperación» si se guardó desde aquí).') } catch { /* state shows it */ } return }
    if (how === 'copy') {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error: e } = await supabase.from('render_jobs').insert({ owner_id: user?.id, project_id: job.project_id, output_format: mine.format, status: 'draft', composition: { ...mine, title: `${mine.title || 'Montaje'} (copia)` } }).select('id').single()
      if (e || !data) { setError(e?.message ?? 'No se pudo crear la copia.'); return }
      window.location.href = `/editor/manual?job=${(data as { id: string }).id}`
      return
    }
    const { data } = await supabase.from('render_jobs').select('id,project_id,status,updated_at,composition').eq('id', job.id).maybeSingle()
    const parsed = data ? parseComposition((data as Job).composition) : null
    if (!data || !parsed) { setError('No se pudo leer la otra versión.'); return }
    savedAtRef.current = (data as Job).updated_at; setSavedAt((data as Job).updated_at)
    lastSaved.current = parsed
    setHistory(h => (h ? commit(h, parsed) : historyOf(parsed))); setDirty(false); setSaveState('saved')
    setNotice('Cargada la versión más reciente. La tuya está en «Puntos de recuperación» y Ctrl+Z la devuelve.')
  }

  // Recovery points on the server.
  const [versionsKey, setVersionsKey] = useState(0)
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  useEffect(() => {
    if (!showVersions || !job || !ownerRef.current) return
    void listVersions(supabase, { owner: ownerRef.current, projectId: job.project_id, jobId: job.id }).then(setVersions, () => setVersions([]))
  }, [showVersions, versionsKey, job, supabase])
  async function restoreVersion(v: VersionInfo) {
    if (!comp) return
    try {
      const c = await loadVersion(supabase, v.path)
      if (!c) throw new Error('El punto de recuperación no es válido.')
      await writeVersion(comp, 'before-restore')
      apply(() => c)
      setNotice(`Restaurado el punto de recuperación del ${new Date(v.at).toLocaleString()}. Se guardará solo; Ctrl+Z lo deshace.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo restaurar.') }
  }

  // Keyboard: undo/redo, delete, split, copy/paste/duplicate, group, markers, select all (never while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const field = (e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]') as HTMLInputElement | null
      // Undo / redo also work right after changing a list, a slider or a checkbox; only text fields keep their own Ctrl+Z.
      const textField = !!field && (field.tagName === 'TEXTAREA' || field.isContentEditable || (field.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes(field.type)))
      if (field && !(mod && (k === 'z' || k === 'y') && !textField)) return
      if (mod && k === 'z') { e.preventDefault(); setHistory(h => (h ? (e.shiftKey ? redo(h) : undo(h)) : h)); setDirty(true); return }
      if (mod && k === 'y') { e.preventDefault(); setHistory(h => (h ? redo(h) : h)); setDirty(true); return }
      if (selTr && history) {
        const k2 = history.present.clips.find(x => x.id === selTr)
        if (k2 && mod && k === 'c') { e.preventDefault(); setCopiedTransition({ transition: k2.transition, transitionMs: k2.transitionMs, transitionOpts: k2.transitionOpts }); setNotice('Transición copiada.'); return }
        if (mod && k === 'v' && copiedTransition) { e.preventDefault(); pasteTransition(); return }
        if (k2 && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); apply(c => updateClip(c, selTr, { transition: 'cut', transitionMs: undefined, transitionOpts: undefined })); setSelTrState(null); setNotice('Transición quitada (ahora es un corte directo). Ctrl+Z la recupera.'); return }
        if (e.key === 'Escape') { setSelTrState(null); return }
      }
      if (mod && k === 'c' && sel.length) { e.preventDefault(); copySel(); return }
      if (mod && k === 'x' && sel.length) { e.preventDefault(); copySel(); deleteSel(); return }
      if (mod && k === 'v') { e.preventDefault(); pasteHere(); return }
      if (mod && k === 'd' && sel.length) { e.preventDefault(); duplicateSel(); return }
      if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); return }
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return }
      if (mod) return
      if (k === 'i') markAt('in')
      if (k === 'o') markAt('out')
      if (k === 's') { e.preventDefault(); splitHere() }
      if (k === 'm') { e.preventDefault(); apply(c => addMarker(c, playheadMs)) }
      if (e.key === 'Escape') { setRange(null); setMarkIn(null); setSel([]) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); deleteSel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apply, sel, playheadMs, markIn, range, selTr, copiedTransition]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Pastes the copied transition on the selected transition, or on the cuts after the selected clips. */
  function pasteTransition() {
    if (!copiedTransition || !history) return
    const ids = selTr ? [selTr] : sel.filter(r => r.kind === 'clip').map(r => r.id)
    if (!ids.length) { setError('Selecciona una transición o un clip para pegar la transición.'); return }
    apply(c => ids.reduce((x, id) => updateClip(x, id, { ...copiedTransition }), c))
    setNotice(`Transición pegada en ${ids.length} corte${ids.length === 1 ? '' : 's'}.`)
  }
  function copySel() { if (!history) return; clipboard.current = copyItems(history.present, sel); if (clipboard.current) setNotice(`${clipboard.current.items.length} elemento(s) copiados. Ctrl+V los pega en el cabezal.`) }
  function pasteHere() { const cb = clipboard.current; if (!cb || !history) return; const r = pasteItems(history.present, cb, playheadMs); apply(() => r.composition); setSel(r.refs) }
  function deleteSel() { apply(c => deleteItems(c, expandGroups(c, sel))); setSel([]) }
  function duplicateSel() { if (!history) return; const r = duplicateItems(history.present, sel); apply(() => r.composition); setSel(r.refs) }
  function groupSel() { if (sel.length < 2) { setError('Selecciona dos o más elementos (Mayús + clic) para agruparlos.'); return } apply(c => groupItems(c, sel)); setNotice('Agrupados: se seleccionan y se mueven juntos (Ctrl+Mayús+G para desagrupar).') }
  function ungroupSel() { apply(c => ungroupItems(c, sel)) }
  function selectAll() { if (history) setSel(itemsInRange(history.present, 0, Number.MAX_SAFE_INTEGER)) }
  function splitHere() { if (!history) return; const r = splitAllAt(history.present, playheadMs, sel.length ? sel : undefined); if (!r.cut) { setError('No hay nada que cortar en el cabezal (los clips principales necesitan al menos 1 s a cada lado).'); return } setError(''); apply(() => r.composition); setNotice(`Cortado en el cabezal: ${r.cut} elemento(s). Ctrl+Z para deshacer.`) }

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
      playheadMs, range, selectedClipId: selection?.kind === 'clip' ? selection.id : null, selectedAssetId: selectedAsset, selectedItems: sel, beatsMs: beats.beatsMs,
      assets: assets.map(a => ({ id: a.id, label: assetLabel(a), type: a.asset_type, durationMs: durationOf(a.id) })),
      isVideo: k => kinds[k.visualAssetId ?? ''] === 'video', prefs,
    })
    if (!r.ok) { setError(`${r.message} Ejemplos: «${COMMAND_EXAMPLES.slice(0, 4).join('», «')}».`); return }
    setError('')
    if (r.history) { setHistory(h => (h ? (r.history === 'undo' ? undo(h) : redo(h)) : h)); setDirty(true) }
    else if (r.composition !== history.present) apply(() => r.composition)
    if (r.playheadMs !== undefined) setPlayheadMs(r.playheadMs)
    if (r.saveStyle) {
      // The same measurement «Medir este montaje» makes: decisions as numbers (pacing, transitions, movement, sound), never the media.
      const name = r.saveStyle
      void (async () => {
        try {
          const st = await loadProfiles(supabase)
          if (st.profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) { setError(`Ya tienes un estilo «${name}». Dime otro nombre entre comillas.`); return }
          const prof = extractProfile(history.present, kindOf, name)
          await saveProfiles(supabase, [prof, ...st.profiles], st.updatedAt)
          setStylesKey(k => k + 1)
          setNotice(`Estilo «${name}» guardado en tu cuenta: aplícalo a otros montajes desde «Estilos de edición».`)
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el estilo.') }
      })()
    }
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

  /** Files that the import center finished (device or Google Drive): refresh the Library and put them on the timeline. */
  const [importMax, setImportMax] = useState(50 * 1024 * 1024)
  useEffect(() => {
    void fetch('/api/storage/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'library', folder: 'uploads', ext: 'mp4', contentType: 'video/mp4', size: 0 }) })
      .then(r => r.json()).then((j: { maxBytes?: number; driver?: string }) => { if (j.maxBytes) setImportMax(j.maxBytes); else if (j.driver === 'r2') setImportMax(Number.MAX_SAFE_INTEGER) }).catch(() => undefined)
  }, [])
  const centerImported = useCallback(async (items: ImportedItem[]) => {
    if (!job || items.length === 0) return
    const { data: a } = await supabase.from('assets').select('id,project_id,asset_type,storage_path,license_status,source_provider,provenance,created_at').or(`project_id.eq.${job.project_id},project_id.is.null`).not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(300)
    setAssets((a ?? []) as EditorAsset[])
    apply(c => items.reduce((acc, f) => {
      if (f.kind === 'video') return addVideo(acc, f.assetId, f.durationMs ?? 5000)
      if (f.kind === 'image') return addClip(acc, f.assetId, 5000)
      const ms = f.durationMs ?? 10_000
      const room = totalDurationMs(acc)
      return addAudioClip(acc, { assetId: f.assetId, kind: f.kind === 'voice' ? 'voice' : f.kind === 'sfx' ? 'sfx' : 'music', linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: f.kind === 'music' && room >= 1000 ? Math.min(ms, room) : ms, volume: f.kind === 'music' ? 0.5 : 1, muted: false })
    }, c))
    setNotice(`${items.length} archivo(s) importados (${items.filter(i => i.duplicate).length} ya estaban en tu Biblioteca) y añadidos a la línea de tiempo. Guarda el montaje para conservar los cambios.`)
  }, [job, supabase, apply]) // eslint-disable-line react-hooks/exhaustive-deps

  const visuals = useMemo(() => assets.filter(a => visualTypes.includes(a.asset_type)), [assets])
  const audios = useMemo(() => assets.filter(a => voiceTypes.includes(a.asset_type) || musicTypes.includes(a.asset_type)), [assets])
  const typeOf = (id: string | null) => (id ? assets.find(a => a.id === id)?.asset_type ?? 'image' : 'none')
  const label = (id: string | null) => { const a = id ? assets.find(x => x.id === id) : undefined; return a ? assetLabel(a) : 'Sin visual' }

  const kindOf = useCallback((id: string | null) => { const t = assets.find(a => a.id === id)?.asset_type; return t === 'video' ? 'video' as const : t && visualTypes.includes(t) ? 'image' as const : 'other' as const }, [assets])

  /** A material dropped on a track: main track = inserted where dropped; overlay track = layer at that time; audio track = sound at that time. */
  async function dropAsset(id: string, track: TrackMeta, atMs: number) {
    const a = assets.find(x => x.id === id)
    if (!a || !history) return
    if (track.locked) { setError(`La pista «${track.name}» está bloqueada.`); return }
    const isVisual = visualTypes.includes(a.asset_type)
    if (track.type === 'main') {
      if (!isVisual) { setError('A la pista de vídeo solo van vídeos e imágenes.'); return }
      const c = history.present
      const starts = clipStarts(c)
      const index = c.clips.findIndex((k, i) => starts[i] + k.durationMs / 2 > atMs)
      const ms = a.asset_type === 'video' ? await audioDurationMs(id).catch(() => 5000) || 5000 : 5000
      apply(x => (a.asset_type === 'video' ? addVideo(x, id, ms, index < 0 ? x.clips.length : index) : addClip(x, id, ms, index < 0 ? x.clips.length : index)))
      return
    }
    if (track.type === 'overlay') {
      if (!isVisual) { setError('A una pista de superposición van vídeos e imágenes.'); return }
      const ms = a.asset_type === 'video' ? await audioDurationMs(id).catch(() => 5000) || 5000 : 5000
      const r = addOverlay(history.present, { assetId: id, startMs: atMs, durationMs: ms, trackId: track.id })
      apply(() => r.composition); setSel([{ kind: 'overlay', id: r.id }])
      return
    }
    if (track.type === 'text') { setError('En una pista de texto se añaden textos con «Añadir texto».'); return }
    if (isVisual && a.asset_type !== 'video') { setError('Una imagen no tiene audio: arrástrala a la pista de vídeo o a una superposición.'); return }
    const ms = await audioDurationMs(id).catch(() => 5000) || 5000
    const kind = track.type as AudioClip['kind']
    apply(x => addAudioClip(x, { assetId: id, kind, linkedClipId: null, offsetMs: 0, startMs: atMs, trimInMs: 0, durationMs: ms, volume: kind === 'music' ? 0.3 : 1, muted: false, ...(track.id !== kind ? { trackId: track.id } : {}) }))
  }
  function trackAction(t: TrackMeta, action: 'up' | 'down' | 'duplicate' | 'delete' | 'rename', value?: string) {
    if (action === 'rename') { apply(c => updateTrack(c, t.id, { name: value ?? t.name })); return }
    if (action === 'up' || action === 'down') { apply(c => moveTrack(c, t.id, action === 'up' ? -1 : 1)); return }
    if (action === 'duplicate') { apply(c => duplicateTrack(c, t.id)); return }
    if (action === 'delete') {
      if (!history) return
      const n = t.type === 'overlay' ? (history.present.overlays ?? []).filter(o => o.trackId === t.id).length : t.type === 'text' ? (history.present.textClips ?? []).filter(x => (x.trackId ?? 'text') === t.id).length : (history.present.audioClips ?? []).filter(a => (a.trackId ?? a.kind) === t.id).length
      if (n && !window.confirm(`¿Eliminar la pista «${t.name}» y sus ${n} elemento(s)? Puedes deshacerlo con Ctrl+Z.`)) return
      apply(c => deleteTrack(c, t.id)); setSel([])
    }
  }
  const beginDrag = useCallback(() => { dragging.current = true; dragStartedAt.current = Date.now(); setHistory(h => (h ? { past: [...h.past, h.present].slice(-100), present: h.present, future: [] } : h)) }, [])
  const liveDrag = useCallback((next: Composition) => { setHistory(h => (h ? { ...h, present: next } : h)); setDirty(true) }, [])
  // A click without movement leaves an identical snapshot on the undo stack: drop it.
  const endDrag = useCallback(() => { dragging.current = false; setHistory(h => (h && h.past.length && h.past[h.past.length - 1] === h.present ? { ...h, past: h.past.slice(0, -1) } : h)) }, [])
  // How long the montage has had unsaved changes (a save that does not happen must be visible, not silent).
  const dirtySince = useRef<number | null>(null)
  const [unsavedFor, setUnsavedFor] = useState(0)
  useEffect(() => {
    if (!dirty) { dirtySince.current = null; setUnsavedFor(0); return }
    if (dirtySince.current === null) dirtySince.current = Date.now()
    const t = setInterval(() => setUnsavedFor(Math.round((Date.now() - (dirtySince.current ?? Date.now())) / 1000)), 10_000)
    return () => clearInterval(t)
  }, [dirty])
  const endDragRef = useRef(endDrag)
  useEffect(() => { endDragRef.current = endDrag }, [endDrag])

  if (picking) return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN" actions={<Link className="buttonLink ghost" href="/editor">Editor automático</Link>}><ManualPicker /></StudioShell>

  if (!comp || !job) return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN">
    {error ? <p className="error" role="alert">{error} <Link className="open" href="/editor">Volver al editor</Link></p> : <p className="muted">{busy === 'convert' ? 'Preparando el montaje (midiendo voces)…' : 'Cargando…'}</p>}
  </StudioShell>

  const total = projectDurationMs(comp)
  const selClip = selection?.kind === 'clip' ? comp.clips.find(c => c.id === selection.id) ?? null : null
  const selAudio = selection?.kind === 'audio' ? (comp.audioClips ?? []).find(a => a.id === selection.id) ?? null : null
  const selText = selection?.kind === 'text' ? (comp.textClips ?? []).find(t => t.id === selection.id) ?? null : null
  const width = Math.max(total / 1000 * pxPerSec, 600)
  const starts = clipStarts(comp)
  const selOverlay = selection?.kind === 'overlay' ? (comp.overlays ?? []).find(o => o.id === selection.id) ?? null : null
  const materials = matTab === 'visual' ? visuals : audios
  const nextBeatRel = selClip ? (() => { const st = starts[comp.clips.findIndex(k => k.id === selClip.id)]; const b = beats.beatsMs.find(t => t - st >= MIN_CLIP_MS && st + selClip.durationMs - t >= MIN_CLIP_MS); return b === undefined ? null : b - st })() : null

  const addTextHere = () => { const at = Math.min(playheadMs, Math.max(0, total - 1000)); const r = addTextClip(comp, { content: 'Texto', startMs: at, durationMs: 3000, position: 'center', sizePct: 7, animation: 'fade', font: 'sans', color: '#ffffff' }); const t = (r.textClips ?? []).find(x => !(comp.textClips ?? []).some(y => y.id === x.id)); apply(() => r); if (t) { setSelection({ kind: 'text', id: t.id }); ws.reveal({ section: 'text-basic' }) } }
  // Transitions are objects of their own: a selected transition (the cut after clip `selTr`) has its own properties.
  const selTrClip = selTr ? comp.clips.find(k => k.id === selTr) ?? null : null
  const cutIndex = (id: string) => comp.clips.findIndex(k => k.id === id)
  const trOf = (k: Clip) => ({ transition: k.transition, transitionMs: k.transitionMs, transitionOpts: k.transitionOpts })
  const clipLive = (id: string) => ({
    begin: () => { sliderBase.current = comp; beginDrag() },
    change: (p: Partial<Clip>) => { const b = sliderBase.current; if (b) liveDrag(updateClip(b, id, p)) },
    end: () => { sliderBase.current = null; endDrag() },
  })
  /**
   * Gives a transition real material: the end of A and the start of B are trimmed by what their files lack (see transition-room.ts), so both
   * videos play during the overlap. Applied when a person chooses or changes a transition, never on opening a project; the message says how
   * much was trimmed and that the project is shorter by it.
   */
  const roomFor = (clipId: string, base: Composition): Composition => {
    const i = base.clips.findIndex(k => k.id === clipId)
    if (i < 0) return base
    const r = makeRoomForTransition(base, i, id => typeOf(id) as 'video' | 'image' | 'audio' | null)
    if (r.message) setNotice(r.message)
    return r.composition
  }
  const ensureRoom = (clipId: string) => { const r = roomFor(clipId, comp); if (r !== comp) apply(() => r) }
  /** Transition length: never longer than the clip that ends nor than the one that starts (nor 3 s). */
  const trMaxMs = (clip: Clip) => { const i = cutIndex(clip.id); return Math.max(100, Math.min(3000, clip.durationMs, comp.clips[i + 1]?.durationMs ?? clip.durationMs)) }
  const secsLabel = (s2: number) => `${s2.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} s`
  const trDuration = (clip: Clip, ariaLabel: string) => { const lv = clipLive(clip.id); const max = trMaxMs(clip); return <SliderField label="Duración" ariaLabel={ariaLabel} unit="s" step={0.05} min={0.1} max={max / 1000}
    value={Math.min(max, clip.transitionMs ?? comp.fadeMs) / 1000} show={secsLabel}
    onChange={v => apply(c => updateClip(c, clip.id, { transitionMs: Math.round(v * 1000) }))}
    drag={{ begin: lv.begin, live: v => lv.change({ transitionMs: Math.round(v * 1000) }), end: lv.end }} onCommit={() => ensureRoom(clip.id)} /> }
  /** Plays the transition with a little before and after: from 0.7 s before its window starts to 0.7 s after it ends. */
  const previewTransition = (clip: Clip) => {
    const i = cutIndex(clip.id), p = playerRef.current
    if (i < 0 || !p) return
    const w = transitionWindow(comp, i), cut = starts[i] + clip.durationMs, from = Math.max(0, cut - w.pre - 700)
    p.seek(from); p.play(); setTimeout(() => p.pause(), cut + w.post + 700 - from)
  }
  /** Which two clips take part and whether their files cover the whole window; says what is missing instead of hiding it. */
  const trMaterial = (clip: Clip) => {
    const i = cutIndex(clip.id), b = comp.clips[i + 1]
    if (i < 0 || !b) return null
    const kindOfAsset = (id: string) => (typeOf(id) as 'video' | 'image' | 'audio' | null)
    const kind = clip.transition ?? 'fade', h = transitionHandles(comp, i, kindOfAsset)
    const fix = (patch: Partial<Clip>) => apply(c => updateClip(c, clip.id, patch))
    const alts = (['center', 'before', 'after'] as const).filter(a => a !== alignOf(clip)).map(a => {
      const t = updateClip(comp, clip.id, { transitionOpts: { ...(clip.transitionOpts ?? {}), align: a } })
      const hh = transitionHandles(t, i, kindOfAsset)
      return { a, ok: hh.missingA === 0 && hh.missingB === 0 && hh.ms > 0 }
    }).filter(x => x.ok)
    const secs1 = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} s`
    return <div className="stack" data-testid="transition-material">
      <p className="small"><b>Participan:</b> clip {i + 1} «{label(clip.visualAssetId)}» y clip {i + 2} «{label(b.visualAssetId)}»{BLENDS.has(kind) ? <> · ventana de {secs1(h.ms)}: {secs1(h.pre)} antes del corte y {secs1(h.post)} después. No cambia la duración del proyecto ni mueve ningún clip.</> : <> · {TRANSITIONS[kind]}: cada clip se atenúa en su propio extremo.</>}</p>
      {BLENDS.has(kind) && (h.missingA > 0 || h.missingB > 0) && <div className="warnBox small" role="status" aria-label="Falta material en la transición">
        <b>Falta material de vídeo.</b>
        {h.missingA > 0 && <> El clip {i + 1} no tiene {secs1(h.missingA)} de vídeo después de su salida{h.unknown ? ' (todavía se está leyendo la duración del archivo)' : ''}: en ese tramo mantiene su último fotograma.</>}
        {h.missingB > 0 && <> El clip {i + 2} no tiene {secs1(h.missingB)} de vídeo antes de su entrada: en ese tramo mantiene su primer fotograma.</>}
        {' '}Puedes recortar menos esos extremos del clip, cambiar el punto de alineación o limitar la duración.
        <div className="pageActions">
          {!h.unknown && <button type="button" className="small" onClick={() => ensureRoom(clip.id)}>Crear el material recortando los extremos (el proyecto dura {secs1(h.missingA + h.missingB)} menos)</button>}
          {h.maxCoveredMs >= 100 && <button type="button" className="ghost small" onClick={() => fix({ transitionMs: h.maxCoveredMs })}>Ajustar la duración al material disponible ({secs1(h.maxCoveredMs)})</button>}
          {alts.map(x => <button key={x.a} type="button" className="ghost small" onClick={() => fix({ transitionOpts: { ...(clip.transitionOpts ?? {}), align: x.a } })}>Alinear: {ALIGNS[x.a].toLowerCase()} (cubre toda la ventana)</button>)}
        </div>
      </div>}
      <div className="pageActions">
        <button type="button" className="ghost small" onClick={() => previewTransition(clip)} disabled={kind === 'cut'}>▶ Previsualizar ahora</button>
        <button type="button" className="ghost small" onClick={() => { fix({ transitionMs: undefined, transitionOpts: BLENDS.has(kind) ? { align: 'center' } : undefined }); setNotice('Transición restablecida (duración, curva, intensidad y dirección por defecto). Ctrl+Z la devuelve.') }}>Restablecer</button>
      </div>
    </div>
  }
  const trTools = (clip: Clip) => <TransitionTools bare clip={clip} defaultMs={comp.fadeMs} onChange={p => { if ('transition' in p || p.transitionOpts?.align !== undefined) { const next = updateClip(comp, clip.id, p); apply(() => roomFor(clip.id, next)) } else apply(c => updateClip(c, clip.id, p)) }} live={clipLive(clip.id)}
    canPaste={!!copiedTransition} onCopy={() => { setCopiedTransition(trOf(clip)); setNotice('Transición copiada: selecciona otra transición o clip y pulsa «Pegar transición» (o Ctrl+V).') }}
    onPaste={pasteTransition}
    onPreview={() => previewTransition(clip)}
    others={sel.filter(r => r.kind === 'clip' && r.id !== clip.id).length}
    onApplyToOthers={() => { const ids = sel.filter(r => r.kind === 'clip').map(r => r.id); apply(c => ids.reduce((x, id) => updateClip(x, id, trOf(clip)), c)); setNotice(`Transición aplicada a ${ids.length} cortes.`) }}
    cuts={Math.max(0, comp.clips.length - 1)}
    onApplyToAll={() => { apply(c => ({ ...c, clips: c.clips.map((k, i) => (i < c.clips.length - 1 ? { ...k, ...trOf(clip) } : k)) })); setNotice(`«${TRANSITIONS[clip.transition ?? 'fade']}» (${clip.transitionMs ?? comp.fadeMs} ms) en los ${comp.clips.length - 1} cortes. Ctrl+Z lo deshace.`) }}
    presets={presets.transitions}
    onSavePreset={name => void storePresets({ ...presets, transitions: [...presets.transitions.filter(t => t.name !== name), { id: `tp-${Date.now().toString(36)}`, name, transition: clip.transition ?? 'fade', ms: clip.transitionMs ?? comp.fadeMs, opts: clip.transitionOpts ?? {} }] }).then(() => setNotice(`Transición favorita «${name}» guardada en tu cuenta.`))}
    onDeletePreset={id => void storePresets({ ...presets, transitions: presets.transitions.filter(t => t.id !== id) })} />

  function openMenu(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest('[data-ref],[data-transition]') as HTMLElement | null
    if (!el && !(e.target as HTMLElement).closest('.tlScroll')) return
    e.preventDefault()
    const x = e.clientX, y = e.clientY
    if (el?.dataset.transition) { selectTransition(el.dataset.transition); setMenu({ x, y, kind: 'transition' }); return }
    if (el?.dataset.ref) {
      const [kind, id] = el.dataset.ref.split(':') as [ItemRef['kind'], string]
      if (!sel.some(r => r.kind === kind && r.id === id)) setSel(expandGroups(comp!, [{ kind, id }]))
      setMenu({ x, y, kind: 'item' }); return
    }
    setMenu({ x, y, kind: 'empty' })
  }
  const menuItems: MenuItem[] = !menu ? [] : menu.kind === 'transition' && selTrClip ? [
    { label: 'Editar la transición', run: () => ws.reveal({ section: 'tr-basic' }) },
    { label: 'Ver la transición', run: () => previewTransition(selTrClip) },
    'sep',
    { label: 'Copiar transición', hint: 'Ctrl+C', run: () => { setCopiedTransition(trOf(selTrClip)); setNotice('Transición copiada.') } },
    { label: 'Pegar transición', hint: 'Ctrl+V', disabled: !copiedTransition, run: pasteTransition },
    { label: 'Aplicar a todos los cortes', run: () => { apply(c => ({ ...c, clips: c.clips.map((k, i) => (i < c.clips.length - 1 ? { ...k, ...trOf(selTrClip) } : k)) })); setNotice('Transición aplicada a todos los cortes. Ctrl+Z lo deshace.') } },
    'sep',
    { label: 'Quitar transición', hint: 'Supr', run: () => { apply(c => updateClip(c, selTrClip.id, { transition: 'cut', transitionMs: undefined, transitionOpts: undefined })); setSelTrState(null) } },
  ] : menu.kind === 'item' ? [
    { label: 'Propiedades', run: () => ws.reveal({ right: true, selector: '#ed-props' }) },
    'sep',
    { label: 'Dividir en el cabezal', hint: 'S', run: splitHere },
    { label: 'Copiar', hint: 'Ctrl+C', run: copySel },
    { label: 'Pegar en el cabezal', hint: 'Ctrl+V', disabled: !clipboard.current, run: pasteHere },
    { label: 'Duplicar', hint: 'Ctrl+D', run: duplicateSel },
    { label: 'Repetir el clip N veces…', run: () => { if (selClip) setBatchDlg('repeat'); else setNotice('Selecciona primero un clip del vídeo principal.') } },
    { label: 'Transiciones en lote…', run: () => setBatchDlg('trans') },
    'sep',
    { label: 'Igualar imagen…', disabled: sel.filter(r => r.kind === 'clip' || r.kind === 'overlay').length < 2, run: () => ws.reveal({ tab: 'effects', section: 'match' }) },
    { label: 'Agrupar', hint: 'Ctrl+G', disabled: sel.length < 2, run: groupSel },
    { label: 'Desagrupar', hint: 'Ctrl+Mayús+G', run: ungroupSel },
    'sep',
    { label: 'Eliminar', hint: 'Supr', run: deleteSel },
  ] : [
    { label: 'Pegar en el cabezal', hint: 'Ctrl+V', disabled: !clipboard.current, run: pasteHere },
    { label: 'Añadir texto en el cabezal', run: addTextHere },
    { label: 'Añadir marcador', hint: 'M', run: () => apply(c => addMarker(c, playheadMs)) },
    { label: 'Ver todo el proyecto', run: () => { const w = scroller.current?.clientWidth ?? 1000; setPxPerSec(Math.max(1, Math.min(200, Math.floor((w - 60) / Math.max(1, total / 1000))))) } },
  ]

  // «Buscar herramienta»: where each tool lives depends on what is selected.
  const toProject = (section: string) => { setSel([]); ws.reveal({ section }) }
  const toolEntries: ToolEntry[] = [
    { label: 'Transición del clip seleccionado', words: 'transicion fundido disolvencia corte cortinilla', go: () => (selClip ? ws.reveal({ section: 'clip-transition' }) : ws.reveal({ tab: 'transitions' })) },
    { label: 'Transiciones (catálogo para arrastrar)', words: 'transicion transiciones catalogo paleta', go: () => ws.reveal({ tab: 'transitions' }) },
    { label: 'Volumen', words: 'volumen sonido nivel audio silenciar', go: () => (selAudio ? ws.reveal({ section: 'audio-basic' }) : selClip && typeOf(selClip.visualAssetId) === 'video' ? ws.reveal({ section: 'clip-basic', selector: '[data-tool="volume"]' }) : selOverlay ? ws.reveal({ section: 'layer-sound' }) : ws.reveal({ tab: 'audio', selector: '[aria-label="Mezclador"]' })) },
    { label: 'Mezclador de pistas', words: 'mezcla mezclador pistas solo mute volumen', go: () => ws.reveal({ tab: 'audio', selector: '[aria-label="Mezclador"]' }) },
    { label: 'Recortar / duración', words: 'recortar recorte trim duracion acortar alargar', go: () => (selClip ? ws.reveal({ section: 'clip-basic', selector: '[data-tool="trim"]' }) : selAudio ? ws.reveal({ section: 'audio-basic' }) : selOverlay ? ws.reveal({ section: 'layer-basic' }) : ws.reveal({ selector: '[aria-label="Herramientas de la línea de tiempo"]' })) },
    { label: 'Recortar la imagen (encuadre)', words: 'recortar recorte crop imagen', go: () => (selOverlay ? ws.reveal({ section: 'layer-color' }) : selClip ? ws.reveal({ section: 'clip-color' }) : ws.reveal({ tab: 'effects' })) },
    { label: 'Dividir en el cabezal', words: 'dividir cortar split tijera', go: () => ws.reveal({ selector: '[aria-label="Herramientas de la línea de tiempo"]' }) },
    { label: 'Subtítulos', words: 'subtitulos subtitulo captions transcripcion', go: () => ws.reveal({ tab: 'texts', selector: '[data-tabpanel="texts"] section' }) },
    { label: 'Estilo de subtítulos del proyecto', words: 'subtitulos estilo captions', go: () => toProject('proj-captions') },
    { label: 'Textos', words: 'texto titulo rotulo añadir texto', go: () => ws.reveal({ tab: 'texts' }) },
    { label: 'Zoom de la imagen', words: 'zoom encuadre acercar ken burns camara', go: () => (selClip ? ws.reveal({ section: 'clip-frame', selector: '[data-tool="zoom"]' }) : selOverlay ? ws.reveal({ section: 'layer-transform' }) : ws.reveal({ tab: 'effects' })) },
    { label: 'Zoom de la línea de tiempo', words: 'zoom linea de tiempo escala', go: () => ws.reveal({ selector: '[aria-label="Herramientas de la línea de tiempo"]' }) },
    { label: 'Animación (fotogramas clave)', words: 'animacion fotogramas clave keyframes movimiento', go: () => (selClip ? ws.reveal({ section: 'clip-anim' }) : selOverlay ? ws.reveal({ section: 'layer-anim' }) : ws.reveal({ tab: 'effects' })) },
    { label: 'Filtros y color', words: 'filtro filtros color brillo contraste saturacion blanco y negro efectos', go: () => (selClip ? ws.reveal({ section: 'clip-color' }) : selOverlay ? ws.reveal({ section: 'layer-color' }) : ws.reveal({ tab: 'effects' })) },
    { label: 'Igualar imagen (luminosidad y color)', words: 'igualar luminosidad brillo color temperatura exposicion', go: () => ws.reveal({ tab: 'effects', section: 'match' }) },
    { label: 'Efectos rápidos', words: 'efectos filtros movimientos presets', go: () => ws.reveal({ tab: 'effects' }) },
    { label: 'Exportar el vídeo', words: 'exportar render descargar mp4 webm resolucion', go: () => { setExportOpen(true); setTimeout(() => (document.querySelector('#ed-export select, #ed-export button') as HTMLElement | null)?.focus(), 50) } },
    { label: 'Materiales e importar archivos', words: 'materiales importar subir archivos biblioteca fotos videos', go: () => ws.reveal({ tab: 'materials' }) },
    { label: 'Música de fondo', words: 'musica fondo ducking bajar musica voz', go: () => toProject('proj-sound') },
    { label: 'Ritmo y pulsos de la música', words: 'ritmo pulsos beats sincronizar', go: () => ws.reveal({ tab: 'audio', selector: '[data-tabpanel="audio"] section:last-of-type' }) },
    { label: 'Estilo, plantillas y aprendizaje (IA)', words: 'ia estilo plantilla aprender referencia comparar', go: () => ws.reveal({ tab: 'ai' }) },
    { label: 'Formato del vídeo', words: 'formato 16:9 9:16 vertical cuadrado tamaño', go: () => ws.reveal({ selector: '[data-tool="format"]' }) },
    { label: 'Puntos de recuperación', words: 'versiones recuperar historial guardado', go: () => setShowVersions(true) },
    { label: 'Marcadores', words: 'marcador marcadores', go: () => ws.reveal({ selector: '[aria-label="Herramientas de la línea de tiempo"]' }) },
  ]

  return <StudioShell title="Editor manual" eyebrow="POSTPRODUCCIÓN" wide compactHead actions={<><a className="buttonLink ghost" href="/editor/manual">Mis montajes</a><Link className="buttonLink ghost" href={`/editor/style?project=${job.project_id}`}>Editar con mi estilo</Link><Link className="buttonLink ghost" href={`/editor?project=${job.project_id}&storyboard=${comp.storyboardId}`}>Editor automático</Link></>}>
    {/* Messages float over the bottom of the editor instead of pushing the viewer and the timeline down. */}
    {(error || notice) && <div className="edToasts" style={{ position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 75, width: 'min(680px, calc(100vw - 24px))', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {error && <p className="error" role="alert" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 1 }}>{error}</span><button type="button" className="ghost small" aria-label="Cerrar el aviso de error" onClick={() => setError('')}>✕</button></p>}
      {notice && <p className="notice" role="status" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 1 }}>{notice}</span><button type="button" className="ghost small" aria-label="Cerrar el aviso" onClick={() => setNotice('')}>✕</button></p>}
    </div>}

    {recovery && <div className="panel warning" role="alert" aria-label="Recuperar cambios" style={{ marginBottom: 12 }}>
      <b>Hay cambios sin guardar de este montaje</b> (copia local del {new Date(recovery.savedAt).toLocaleString()}){recovery.baseUpdatedAt !== savedAt ? '. Ojo: el montaje se guardó después desde otro sitio; si recuperas, al guardar se te avisará del conflicto.' : '.'}
      <div className="pageActions" style={{ marginTop: 6 }}>
        <button type="button" className="small" onClick={() => { setHistory(h => (h ? commit(h, recovery.composition) : h)); setDirty(true); setRecovery(null); setNotice('Cambios recuperados. Guarda para conservarlos (Ctrl+Z vuelve a la versión guardada).') }}>Recuperar cambios</button>
        <button type="button" className="ghost small" onClick={() => { if (job) void clearLocalDraft(job.id); setRecovery(null) }}>Descartar copia</button>
      </div>
    </div>}
    {missing.length > 0 && <div className="panel warning" role="alert" aria-label="Archivos que faltan" style={{ marginBottom: 12 }}>
      <b>Faltan {missing.length} archivo(s) del montaje</b> <span className="small">(se borraron de la Biblioteca o no se pueden abrir). El montaje no se ha tocado: esas partes se ven en negro o en silencio hasta que los vuelvas a vincular.</span>
      <ul className="plainList small">{missing.map(m => <li key={m.id} className="field-row" style={{ alignItems: 'center' }}>
        <span>Usado en: {m.uses.join(', ')}</span>
        <select aria-label={`Sustituto para ${m.uses[0]}`} value={relinkTo[m.id] ?? ''} onChange={e => setRelinkTo(r => ({ ...r, [m.id]: e.target.value }))}>
          <option value="">— Elegir un archivo de la Biblioteca</option>
          {assets.filter(a => (m.uses.some(u => /clip|superposici/.test(u)) ? visualTypes.includes(a.asset_type) : !visualTypes.includes(a.asset_type) || a.asset_type === 'video')).map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}
        </select>
        <button type="button" className="small" disabled={!relinkTo[m.id]} onClick={() => { const to = relinkTo[m.id]; apply(c => replaceAsset(c, m.id, to)); setNotice('Archivo vuelto a vincular: se mantienen los tiempos, efectos y ajustes.') }}>Volver a vincular</button>
      </li>)}</ul>
    </div>}
    {saveState === 'conflict' && <div className="panel warning" role="alert" aria-label="Conflicto al guardar" style={{ marginBottom: 12 }}>
      <b>Este montaje se guardó desde otra pestaña o dispositivo después de abrirlo aquí.</b> <span className="small">Tus cambios no se han perdido: siguen en pantalla y se guardan como punto de recuperación al elegir.</span>
      <div className="pageActions" style={{ marginTop: 6 }}>
        <button type="button" className="small" onClick={() => void resolveConflict('theirs')}>Cargar la versión más reciente</button>
        <button type="button" className="ghost small" onClick={() => void resolveConflict('mine')}>Guardar la mía encima</button>
        <button type="button" className="ghost small" onClick={() => void resolveConflict('copy')}>Guardar la mía como copia</button>
      </div>
    </div>}
    {unsavedFor >= 60 && saveState !== 'error' && saveState !== 'conflict' && <p className="warnBox small" role="alert">Hay cambios sin guardar en la nube desde hace {unsavedFor >= 120 ? `${Math.floor(unsavedFor / 60)} min` : `${unsavedFor} s`}{autoSave ? ' (el guardado automático no ha podido hacerlo)' : ''}. <button type="button" className="ghost small" onClick={() => void saveClick()}>Guardar ahora</button></p>}
    {saveState === 'error' && <p className="warnBox small" role="alert">No se pudo guardar en la nube ({saveMessage}). Tus cambios siguen aquí y en este navegador; se reintenta solo. <button type="button" className="ghost small" onClick={() => void saveClick()}>Reintentar ahora</button></p>}
    {showVersions && <section className="panel" aria-label="Puntos de recuperación" style={{ marginBottom: 12 }}>
      <b>Puntos de recuperación en la nube</b> <span className="muted small">(se crean al pulsar «Guardar ahora», cada 5 minutos de guardado automático, antes de restaurar y en los conflictos; se guardan los {30} últimos)</span>
      {versions === null ? <p className="muted small">Cargando…</p> : versions.length === 0 ? <p className="muted small">Todavía no hay ninguno.</p> :
        <ul className="plainList small">{versions.map(v => <li key={v.path} className="field-row" style={{ alignItems: 'center' }}>
          <span>{new Date(v.at).toLocaleString()} · {REASON_LABELS[v.reason] ?? v.reason}</span>
          <button type="button" className="ghost small" onClick={() => void restoreVersion(v)}>Restaurar</button>
        </li>)}</ul>}
    </section>}
    <WorkspaceProvider value={ws}>
    <div className="editorBar edTop panel" role="region" aria-label="Barra del editor">
      <div className="stats">
        <span className="pill">{comp.clips.length} clips</span>
        <span className="pill info">{fmt(total)}</span>
        {comp.styleRef && <span className="pill" title="Estilo con el que se creó o se re-estiló">Estilo: {comp.styleRef.profileName}</span>}
        <span role="status" aria-label="Estado del guardado" className={`pill ${saveState === 'error' || saveState === 'conflict' ? 'warn' : saveState === 'saved' && !dirty ? 'ok' : saveState === 'saving' ? 'info' : 'warn'}`} title={saveState === 'error' ? 'Tus cambios siguen en este navegador; se reintenta solo.' : 'La copia que cuenta es la de la nube: se abre igual desde cualquier dispositivo con tu cuenta.'}>
          {saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? `Error al guardar${retryIn ? ` · reintento en ${retryIn} s` : ''}` : saveState === 'conflict' ? 'Conflicto: guardado desde otra sesión' : dirty ? 'Cambios sin guardar' : `Guardado en la nube${lastCloudSave ? ` · ${lastCloudSave}` : ''}`}
        </span>
        <label className="pill small" title="Guarda en la nube unos segundos después de cada cambio (con control de conflictos entre sesiones)"><input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} /> Guardado automático</label>
        <button type="button" className="ghost small" aria-expanded={showVersions} onClick={() => setShowVersions(v => !v)}>Puntos de recuperación</button>
        <label className="small" data-tool="format">Formato{' '}
          <select value={comp.format} onChange={e => apply(c => ({ ...c, format: e.target.value as OutputFormat }))}>
            <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="custom">Personalizado</option>
          </select>
        </label>
        {comp.format === 'custom' && <span className="small field-row" style={{ alignItems: 'center' }}>
          <input type="number" aria-label="Ancho personalizado" min={240} max={3840} step={2} value={comp.customSize?.width ?? 1280} onChange={e => apply(c => ({ ...c, customSize: { width: Math.round(Math.min(3840, Math.max(240, Number(e.target.value) || 1280)) / 2) * 2, height: c.customSize?.height ?? 720 } }))} style={{ width: 76 }} />×
          <input type="number" aria-label="Alto personalizado" min={240} max={3840} step={2} value={comp.customSize?.height ?? 720} onChange={e => apply(c => ({ ...c, customSize: { width: c.customSize?.width ?? 1280, height: Math.round(Math.min(3840, Math.max(240, Number(e.target.value) || 720)) / 2) * 2 } }))} style={{ width: 76 }} />
        </span>}
      </div>
      <div className="edTopTools">
        <label className="small">Espacio de trabajo{' '}
          <select aria-label="Espacio de trabajo" value={ws.layout.mode} title={MODES[ws.layout.mode].hint} onChange={e => setMode(e.target.value as WorkspaceMode)}>
            {(Object.keys(MODES) as WorkspaceMode[]).map(m => <option key={m} value={m}>{MODES[m].label}</option>)}
          </select>
        </label>
        <button type="button" className={ws.layout.left ? 'small' : 'ghost small'} aria-pressed={ws.layout.left} aria-controls="ed-tools" onClick={() => ws.set({ left: !ws.layout.left })} title="Muestra u oculta el panel de herramientas (materiales, transiciones, efectos…)">Herramientas</button>
        <button type="button" className={ws.layout.right ? 'small' : 'ghost small'} aria-pressed={ws.layout.right} aria-controls="ed-props" onClick={() => ws.set({ right: !ws.layout.right })} title="Muestra u oculta el panel de propiedades">Propiedades</button>
        <ToolSearch entries={toolEntries} />
      </div>
      <div className="pageActions">
        <button type="button" className="ghost" disabled={!history?.past.length} onClick={() => { setHistory(h => (h ? undo(h) : h)); setDirty(true) }} title="Ctrl+Z">Deshacer</button>
        <button type="button" className="ghost" disabled={!history?.future.length} onClick={() => { setHistory(h => (h ? redo(h) : h)); setDirty(true) }} title="Ctrl+Shift+Z">Rehacer</button>
        <button type="button" onClick={() => void saveClick()} disabled={busy === 'save' || saveState === 'saving'} title="Guarda en la nube y crea un punto de recuperación">{busy === 'save' ? 'Guardando…' : 'Guardar ahora'}</button>
        <button type="button" className={exportOpen ? 'small' : 'ghost'} aria-expanded={exportOpen} aria-controls="ed-export" onClick={() => setExportOpen(v => !v)} title="Resolución, calidad y destino (la nube o tu equipo)">Exportar</button>
      </div>
    </div>

    {/* Kept mounted while closed: an export in progress continues. */}
    <section id="ed-export" className="panel edExport" role="dialog" aria-label="Exportar el vídeo" hidden={!exportOpen}
      style={{ position: 'fixed', right: 12, top: 72, zIndex: 70, width: 'min(460px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 90px)', overflow: 'auto', boxShadow: '0 18px 40px #000a' }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setExportOpen(false) } }}>
      <div className="cardHead" style={{ marginBottom: 6 }}><h3>Exportar el vídeo</h3><button type="button" className="ghost small" onClick={() => setExportOpen(false)} aria-label="Cerrar exportación">✕</button></div>
      <RenderPanel key="full" projectId={job.project_id} composition={comp} assets={assets} beforeRender={dirty ? save : undefined} onExportSettings={e => apply(c => ({ ...c, exportSettings: e }))} exportOnly />
    </section>

    {batchDlg === 'repeat' && selClip && <RepeatDialog comp={comp} clipId={selClip.id} kindOf={id => kindOfAsset(id)} onClose={() => setBatchDlg(null)}
      onApply={(next, msg) => { apply(() => next); setSel([{ kind: 'clip', id: selClip.id }]); setNotice(msg) }} />}
    {batchDlg === 'trans' && <BatchTransitionsDialog comp={comp} selectedClipIds={sel.filter(r => r.kind === 'clip').map(r => r.id)} selectedTransition={selTr} kindOf={id => kindOfAsset(id)} onClose={() => setBatchDlg(null)}
      onApply={(next, msg) => { apply(() => next); setNotice(msg) }} />}

    <form className="panel instructionBar" style={{ marginBottom: 10 }} onSubmit={e => { e.preventDefault(); runText(instruction) }} aria-label="Instrucciones">
      <label htmlFor="ed-instr" className="small"><b>Dile al editor qué hacer</b><span className="srOnly">:</span> {range ? <span className="pill info">Se aplica al fragmento {secs(range.startMs)}–{secs(range.endMs)} s</span> : selection?.kind === 'clip' ? <span className="pill">Se aplica al clip seleccionado</span> : <span className="muted">· se aplica al clip bajo el cabezal</span>}</label>
      <div className="field-row" style={{ alignItems: 'center' }}>
        <input id="ed-instr" list="ed-instr-examples" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="p. ej. pon esta música desde el minuto 2 · corta aquí · haz un zoom lento · cambia de imagen siguiendo el ritmo" style={{ flex: 1 }} />
        <datalist id="ed-instr-examples">{COMMAND_EXAMPLES.map(x => <option key={x} value={x} />)}</datalist>
        <button type="submit" disabled={!instruction.trim()}>Hacer</button>
      </div>
      {proposal && <div className="styleBox" role="group" aria-label="Propuesta de preferencia" style={{ marginTop: 8 }}>
        <span className="small">Has cambiado «{PREF_LABELS[proposal.key].phrase}» de <b>{PREF_LABELS[proposal.key].show(proposal.from)}</b> a <b>{PREF_LABELS[proposal.key].show(proposal.to)}</b>. ¿Uso {PREF_LABELS[proposal.key].show(proposal.to)} la próxima vez?</span>
        <div className="pageActions"><button type="button" className="small" onClick={() => void answerProposal(true)}>Guardar como preferencia</button><button type="button" className="ghost small" onClick={() => void answerProposal(false)}>No, solo esta vez</button></div>
      </div>}    </form>

    <div className="editorLayout edWork" data-mode={ws.layout.mode} data-left={ws.layout.left ? 'on' : 'off'} data-right={ws.layout.right ? 'on' : 'off'}
      style={{ ['--ed-cols' as string]: `${ws.layout.left ? `${ws.layout.leftW}px 8px ` : ''}minmax(0,1fr)${ws.layout.right ? ` 8px ${ws.layout.rightW}px` : ''}`, ['--ed-viewer' as string]: `${ws.layout.viewerAuto && autoViewerH ? autoViewerH : ws.layout.viewerH}px` }}>
      <aside id="ed-tools" className="panel editorMaterials edTools" aria-label="Herramientas" hidden={!ws.layout.left}>
        <ToolTabs panels={{
          materials: <>
            <div className="cardHead" style={{ marginBottom: 6 }}><h3>Materiales</h3><span className="muted small">{assets.length}</span></div>
            <div className="pageActions" role="tablist" aria-label="Tipo de material">
              <button type="button" role="tab" aria-selected={matTab === 'visual'} className={matTab === 'visual' ? 'small' : 'ghost small'} onClick={() => setMatTab('visual')}>Vídeo e imagen</button>
              <button type="button" role="tab" aria-selected={matTab === 'audio'} className={matTab === 'audio' ? 'small' : 'ghost small'} onClick={() => setMatTab('audio')}>Música y sonidos</button>
            </div>
        <ul className="materialList" role="listbox" aria-label="Materiales del proyecto">
          {materials.map(a => <li key={a.id} role="option" draggable aria-selected={selectedAsset === a.id} className={selectedAsset === a.id ? 'selected' : undefined} onClick={() => setSelectedAsset(x => (x === a.id ? null : a.id))} onDragStart={e => { e.dataTransfer.setData(ASSET_MIME, a.id); e.dataTransfer.effectAllowed = 'copy' }} title="Arrástralo a una pista" aria-label={`Material ${assetLabel(a)}`}>
            <span className="matThumb" style={{ background: thumbs[a.id] ? `url(${thumbs[a.id]}) center / cover` : kindColor[a.asset_type] ?? '#555' }} aria-hidden="true">{thumbs[a.id] ? '' : a.asset_type === 'video' ? '▶' : a.asset_type === 'image' ? '' : '♪'}</span>
            <span className="matName">{assetLabel(a)}<small className="muted">{a.asset_type}{a.project_id === null ? ' · Biblioteca general' : ''}</small></span>
          </li>)}
          {!materials.length && <li role="option" aria-selected={false} aria-disabled="true" className="muted small">Nada todavía. Importa archivos abajo.</li>}
        </ul>
        <label className="pill small"><input type="checkbox" checked={allProjects} onChange={e => setAllProjects(e.target.checked)} /> Ver también otros proyectos</label>
        <p className="muted small">Arrastra un material a cualquier pista; se coloca donde lo sueltas. Los materiales de la Biblioteca general y de otros proyectos se usan sin copiar el archivo.</p>
        <details open={assets.length === 0}><summary className="small"><b>Importar o añadir</b></summary>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {job && <ImportCenter supabase={supabase} projectId={job.project_id} section={matTab} audioKind={importAudioKind} maxBytes={importMax} onImported={items => void centerImported(items)} onError={setError} />}
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
              // Where the playhead is (at the start when it is at 0): no need to add it at 0 and then move it.
              const at = linked ? 0 : Math.round(playheadMs)
              apply(c => addAudioClip(c, { assetId: addAudio, kind: addAudioKind, linkedClipId: linked, offsetMs: 0, startMs: at, trimInMs: 0, durationMs: Math.min(ms, addAudioKind === 'music' ? Math.max(1000, totalDurationMs(c) - at) : ms), volume: addAudioKind === 'music' ? 0.3 : 1, muted: false }))
              setAddAudio(''); setBusy('')
            })()}>{busy === 'audio' ? 'Midiendo…' : addAudioKind === 'voice' && selClip ? 'Añadir enlazado al clip seleccionado' : playheadMs >= 100 ? `Añadir en el cabezal (${fmt(playheadMs)})` : 'Añadir al inicio'}</button>
          </section>
        </details>
          </>,
          transitions: <>
          <ul className="materialList" role="listbox" aria-label="Transiciones">
            {(Object.keys(TRANSITIONS) as Transition[]).map(t => <li key={t} role="option" aria-selected={selClip?.transition === t} draggable aria-label={`Transición ${TRANSITIONS[t]}`} title="Arrástrala entre dos clips del vídeo principal, o selecciona un clip y haz clic"
              onDragStart={e => { e.dataTransfer.setData(TRANSITION_MIME, t); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => { if (!selClip) { setError('Selecciona un clip del vídeo principal (la transición va de ese clip al siguiente) o arrástrala entre dos clips.'); return } { const next = updateClip(comp, selClip.id, transitionPatch(selClip, t)); apply(() => roomFor(selClip.id, next)); setNotice(n => n || `Transición «${TRANSITIONS[t]}» entre el clip seleccionado y el siguiente.`) }; ws.reveal({ section: 'clip-transition' }) }}>
              <span className="matThumb" aria-hidden="true" style={{ background: '#333', display: 'grid', placeItems: 'center' }}>{TRANSITION_ICONS[t]}</span>
              <span className="matName">{TRANSITIONS[t]}</span>
            </li>)}
          </ul>
          <div className="field-row" style={{ alignItems: 'end' }}>
            <label>Duración (ms)<input type="number" aria-label="Duración de las transiciones" min={0} max={3000} step={50} value={comp.fadeMs} onChange={e => apply(c => ({ ...c, fadeMs: Math.min(Math.max(Number(e.target.value) || 0, 0), 1500) }))} /></label>
            <button type="button" className="ghost small" onClick={() => { const t = selClip?.transition ?? 'dissolve'; apply(c => ({ ...c, clips: c.clips.map((k, i) => (i < c.clips.length - 1 ? { ...k, ...transitionPatch(k, t) } : k)) })); setNotice(`«${TRANSITIONS[t]}» aplicada entre todos los clips.`) }}>Aplicar a todos los cortes</button>
          </div>
          <p className="muted small">La transición se ve en el visor al momento, sin exportar. Cada clip puede tener su propia duración en sus propiedades.</p>
          </>,
          effects: <><EffectsTab selClips={sel.filter(r => r.kind === 'clip').map(r => comp.clips.find(k => k.id === r.id)).filter((k): k is Clip => !!k)}
            selLayers={sel.filter(r => r.kind === 'overlay').map(r => (comp.overlays ?? []).find(o => o.id === r.id)).filter((o): o is NonNullable<typeof o> => !!o)}
            presets={[...BUILTIN_ANIMATIONS, ...presets.animations]} apply={apply} onNotice={setNotice} onReveal={(id: string) => ws.reveal({ section: id })} />
            <Section id="match" title="Igualar imagen" defaultOpen={sel.filter(r => r.kind === 'clip' || r.kind === 'overlay').length >= 2}>
              <MatchPanel comp={comp} sel={sel} apply={apply} resolveUrl={resolveUrl} typeOf={typeOf} labelOf={label} onNotice={setNotice} onError={setError} compare={compareBefore} setCompare={setCompareBefore} />
            </Section>
          </>,
          texts: <>
            <div className="pageActions">
              <button type="button" className="small" onClick={addTextHere}>Añadir texto en el cabezal</button>
            </div>
            <ul className="materialList" aria-label="Textos del montaje">
              {(comp.textClips ?? []).map(t => <li key={t.id}><button type="button" className={selText?.id === t.id ? 'small' : 'ghost small'} style={{ width: '100%', textAlign: 'left' }} onClick={() => { setSelection({ kind: 'text', id: t.id }); setPlayheadMs(t.startMs); ws.set({ right: true }) }}>{secs(t.startMs)} s · {t.content}</button></li>)}
              {!(comp.textClips ?? []).length && <li className="muted small">Todavía no hay textos.</li>}
            </ul>
    <EditorSubtitlesPanel comp={comp} apply={apply} onNotice={setNotice} />
          </>,
          audio: <>
            <MixerStrip comp={comp} onChange={mix => apply(c => ({ ...c, mix }))} />
    <EditorSyncPanel comp={comp} assets={assets} beats={beats} showBeats={showBeats} setShowBeats={setShowBeats} snap={snap} setSnap={setSnap} toleranceMs={toleranceMs} setToleranceMs={setToleranceMs}
      isVideo={k => typeOf(k.visualAssetId) === 'video'} apply={apply} onNotice={setNotice} />
          </>,
          ai: <>
            <section className="panel" aria-label="Preferencias e historial de instrucciones">
      <details className="small"><summary>Mis preferencias ({prefs.history.length} cambios confirmados)</summary>
        <ul className="plainList">{(Object.keys(PREF_LABELS) as Array<keyof typeof PREF_LABELS>).map(k => <li key={k}>{PREF_LABELS[k].label}: <b>{PREF_LABELS[k].show(prefs[k])}</b>{prefs[k] !== DEFAULT_PREFS[k] ? <span className="muted"> (por defecto {PREF_LABELS[k].show(DEFAULT_PREFS[k])})</span> : null}</li>)}</ul>
      </details>
      {instructionLog.length > 0 && <details className="small"><summary>Últimas instrucciones ({instructionLog.length})</summary><ul className="plainList">{instructionLog.map((l, i) => <li key={i}><button type="button" className="ghost small" onClick={() => runText(l.text)} title="Repetir">↻</button> «{l.text}» → {l.done.join(' ')}</li>)}</ul></details>}
            </section>
    <StylePanel composition={comp} kindOf={kindOf} refreshKey={stylesKey} sessionStart={sessionStart} onApply={(next, changes) => { apply(() => next); setNotice(`${changes.join(' ')} (puedes deshacerlo)`) }} />
    <MontageTemplatePanel composition={comp} typeOf={id => assets.find(a => a.id === id)?.asset_type ?? 'other'} />
    <EditorReferencePanel comp={comp} kindOf={kindOf} beatsMs={beats.beatsMs} apply={apply} onNotice={setNotice} onStylesChanged={() => setStylesKey(k => k + 1)} />
    <EditorComparePanel comp={comp} jobId={job.id} projectId={job.project_id} beatsMs={beats.beatsMs} />
    <LearnPanel composition={comp} beatsMs={beats.beatsMs} refreshKey={stylesKey} kindOf={kindOf}
      onApply={(next, changes) => { apply(() => next); setNotice(`Estilo aplicado (puedes deshacerlo): ${changes.join(' ')}`) }} />
          </>,
        }} />
      </aside>
      {ws.layout.left && <Splitter label="Ancho del panel de herramientas" orientation="vertical" value={ws.layout.leftW} min={200} max={640} onChange={v => ws.set({ leftW: v })} />}
      <div className="editorViewer edViewer">
        <EditorPlayerView composition={compareBefore ? withoutGrades(comp) : comp} kindOf={kindOfAsset} resolveUrl={resolveUrl} loop={range} onTime={onPlayerTime} onPlayer={p => { playerRef.current = p }}
          overlay={<ViewerHandles comp={comp} player={playerRef.current} kindOf={kindOfAsset} playheadMs={playheadMs} selection={selection} onSelect={r => setSelection(r)} begin={beginDrag} live={liveDrag} end={endDrag} />} />
        <Splitter label="Alto del visor" orientation="horizontal" value={ws.layout.viewerAuto && autoViewerH ? autoViewerH : ws.layout.viewerH} min={180} max={1400} onChange={v => ws.set({ viewerH: v, viewerAuto: false })}
          onReset={() => ws.set({ viewerAuto: true })} title="Arrastra para cambiar el alto del visor; doble clic para que se ajuste solo a la pantalla" />
      </div>
      {ws.layout.right && <Splitter label="Ancho del panel de propiedades" orientation="vertical" invert value={ws.layout.rightW} min={240} max={640} onChange={v => ws.set({ rightW: v })} />}
      <section id="ed-props" className="panel editorProps edProps" aria-label="Propiedades" hidden={!ws.layout.right}>
        <h3>{selTrClip ? `Transición · clip ${cutIndex(selTrClip.id) + 1} → ${cutIndex(selTrClip.id) + 2}` : selClip ? `Clip ${comp.clips.findIndex(c => c.id === selClip.id) + 1} · ${typeOf(selClip.visualAssetId) === 'video' ? 'vídeo' : selClip.visualAssetId ? 'foto' : 'sin visual'}` : selAudio ? `Audio · ${({ music: 'música', voice: 'voz', sfx: 'efecto' } as const)[selAudio.kind]}` : selText ? 'Texto' : selOverlay ? `Capa · ${typeOf(selOverlay.assetId) === 'video' ? 'vídeo' : 'foto'}` : 'Proyecto'}{sel.length > 1 ? <span className="muted small"> · {sel.length} seleccionados</span> : null}</h3>
        {sel.filter(r => r.kind === 'clip' || r.kind === 'overlay').length >= 2 && <div className="pageActions"><button type="button" className="small" onClick={() => ws.reveal({ tab: 'effects', section: 'match' })}>Igualar imagen</button></div>}
        {selection && isLocked(comp, selection) && <p className="warnBox small" role="status">Este elemento está en una pista bloqueada: desbloquéala (🔒) para cambiarlo.</p>}
        <fieldset disabled={!!selection && isLocked(comp, selection)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {selTrClip && <Section id="tr-basic" title="Transición" defaultOpen extra={<span className="muted small">{TRANSITIONS[selTrClip.transition ?? 'fade']}</span>}>
          <div className="field-row">
            <label>Tipo<select aria-label="Tipo de transición" value={selTrClip.transition ?? 'fade'} onChange={e => { const next = updateClip(comp, selTrClip.id, transitionPatch(selTrClip, e.target.value as Transition)); apply(() => roomFor(selTrClip.id, next)) }}>{(Object.keys(TRANSITIONS) as Transition[]).map(t => <option key={t} value={t}>{TRANSITIONS[t]}</option>)}</select></label>
          </div>
          {trMaterial(selTrClip)}
          {trDuration(selTrClip, 'Duración de esta transición en segundos')}
          {trTools(selTrClip)}
          <p className="muted small">Arrastra la transición a otro corte para moverla, los bordes de su banda para alargarla o acortarla. Supr la quita; Ctrl+C / Ctrl+V la copian.</p>
        </Section>}
        {selOverlay && <OverlayInspector animation={(() => {
            const local = Math.min(Math.max(playheadMs - selOverlay.startMs, 0), selOverlay.durationMs)
            const cur = frameValuesAt({ ...selOverlay.transform }, selOverlay.keyframes, local)
            return <KeyframeEditor bare title="Animación con fotogramas clave" props={LAYER_PROPS} keys={selOverlay.keyframes as never} current={cur} localMs={local} durationMs={selOverlay.durationMs}
              inside={playheadMs >= selOverlay.startMs && playheadMs <= selOverlay.startMs + selOverlay.durationMs}
              onKeys={k => apply(c => updateOverlay(c, selOverlay.id, { keyframes: k as never }))}
              canPaste={copiedAnim?.target === 'layer'} onCopy={() => { setCopiedAnim({ target: 'layer', keys: keysToPreset((selOverlay.keyframes ?? []) as never, selOverlay.durationMs) }); setNotice('Animación copiada: selecciona otra capa y pulsa «Pegar animación».') }}
              onPaste={() => { if (!copiedAnim) return; const ids = sel.filter(r => r.kind === 'overlay').map(r => r.id); apply(c => ids.reduce((x, id) => { const o = (x.overlays ?? []).find(v => v.id === id); return o ? updateOverlay(x, id, { keyframes: presetKeys({ id: '', name: '', target: 'layer', camera: null, keyframes: copiedAnim.keys }, o.durationMs) as never }) : x }, c)) }}
              presets={[...BUILTIN_ANIMATIONS, ...presets.animations].filter(p => p.target === 'layer')}
              onApplyPreset={pr => apply(c => updateOverlay(c, selOverlay.id, { keyframes: presetKeys(pr, selOverlay.durationMs) as never }))}
              onSavePreset={name => void storePresets({ ...presets, animations: [...presets.animations.filter(a => a.name !== name), { id: `ap-${Date.now().toString(36)}`, name, target: 'layer', camera: null, keyframes: keysToPreset((selOverlay.keyframes ?? []) as never, selOverlay.durationMs) }] }).then(() => setNotice(`Animación «${name}» guardada en tu cuenta.`))}
              onDeletePreset={id => void storePresets({ ...presets, animations: presets.animations.filter(a => a.id !== id) })} />
          })()} o={selOverlay} visuals={visuals} isVideo={typeOf(selOverlay.assetId) === 'video'} playheadMs={playheadMs}
          onChange={p => apply(c => updateOverlay(c, selOverlay.id, p))} apply={apply}
          onDelete={() => { apply(c => deleteItems(c, [{ kind: 'overlay', id: selOverlay.id }])); setSel([]) }}
          onDuplicate={() => { const r = duplicateItems(comp, [{ kind: 'overlay', id: selOverlay.id }]); apply(() => r.composition); setSel(r.refs) }} />}
        {selClip && <ClipInspector animation={(() => {
            const i = comp.clips.findIndex(k => k.id === selClip.id)
            const local = Math.min(Math.max(playheadMs - starts[i], 0), selClip.durationMs)
            const cur = frameValuesAt({ zoom: selClip.zoom ?? 1, focusX: selClip.focusX ?? 0.5, focusY: selClip.focusY ?? 0.5, rotation: selClip.rotation ?? 0, opacity: selClip.opacity ?? 1 }, selClip.keyframes, local)
            return <KeyframeEditor bare title="Animación de la imagen (zoom, encuadre, giro, opacidad)" props={CLIP_PROPS} keys={selClip.keyframes as never} current={cur} localMs={local} durationMs={selClip.durationMs}
              inside={playheadMs >= starts[i] && playheadMs <= starts[i] + selClip.durationMs}
              onKeys={k => apply(c => setClipKeyframes(c, selClip.id, k as never))}
              canPaste={copiedAnim?.target === 'clip'} onCopy={() => { setCopiedAnim({ target: 'clip', keys: keysToPreset((selClip.keyframes ?? []) as never, selClip.durationMs) }); setNotice('Animación copiada: selecciona otro clip y pulsa «Pegar animación».') }}
              onPaste={() => { if (!copiedAnim) return; const ids = sel.filter(r => r.kind === 'clip').map(r => r.id); apply(c => ids.reduce((x, id) => { const k = x.clips.find(v => v.id === id); return k ? setClipKeyframes(x, id, presetKeys({ id: '', name: '', target: 'clip', camera: null, keyframes: copiedAnim.keys }, k.durationMs) as never) : x }, c)) }}
              presets={[...BUILTIN_ANIMATIONS, ...presets.animations].filter(p => p.target === 'clip')}
              onApplyPreset={pr => { apply(c => setClipKeyframes(updateClip(c, selClip.id, { camera: { kind: 'none', amount: 0.1 } }), selClip.id, presetKeys(pr, selClip.durationMs) as never)); setNotice(`Movimiento «${pr.name}» aplicado (sustituye al movimiento de cámara). Ctrl+Z lo deshace.`) }}
              onSavePreset={name => void storePresets({ ...presets, animations: [...presets.animations.filter(a => a.name !== name), { id: `ap-${Date.now().toString(36)}`, name, target: 'clip', camera: null, keyframes: keysToPreset((selClip.keyframes ?? []) as never, selClip.durationMs) }] }).then(() => setNotice(`Animación «${name}» guardada en tu cuenta.`))}
              onDeletePreset={id => void storePresets({ ...presets, animations: presets.animations.filter(a => a.id !== id) })} />
          })()} transitionTools={trTools(selClip)} transitionDuration={trDuration(selClip, 'Duración de la transición')}
          clip={selClip} isVideo={typeOf(selClip.visualAssetId) === 'video'} visuals={visuals} splitAt={splitAt} setSplitAt={setSplitAt} nextBeatMs={nextBeatRel}
          onChange={p => { if ('transition' in p) { const next = updateClip(comp, selClip.id, p); apply(() => roomFor(selClip.id, next)) } else apply(c => updateClip(c, selClip.id, p)) }}
          onSpeed={v => apply(c => setSpeed(c, selClip.id, v))}
          onTrim={d => apply(c => trimStart(c, selClip.id, d))}
          onSplit={ms => { apply(c => splitClip(c, selClip.id, ms)); setSplitAt('') }}
          onDuplicate={() => apply(c => duplicateClip(c, selClip.id))} onRepeat={() => setBatchDlg('repeat')}
          onDelete={() => { apply(c => deleteClip(c, selClip.id)); setSelection(null) }}
          onMove={dir => apply(c => moveClip(c, selClip.id, c.clips.findIndex(k => k.id === selClip.id) + dir))} />}
        {selText && <TextInspector t={selText} onChange={p => apply(c => updateTextClip(c, selText.id, p))} onDuplicate={() => apply(c => duplicateTextClip(c, selText.id))} onDelete={() => { apply(c => deleteTextClip(c, selText.id)); setSelection(null) }} />}
        {selAudio && <>
          <Section id="audio-basic" title="Sonido" defaultOpen>
          <p className="small">{label(selAudio.assetId)} · {selAudio.linkedClipId ? 'enlazado a su clip' : 'posición absoluta'}</p>
          <div className="field-row">
            <label>Inicio (s)<input type="number" min={0} step={0.1} value={secs(audioStartMs(comp, selAudio))} onChange={e => apply(c => moveAudioClip(c, selAudio.id, Number(e.target.value) * 1000))} /></label>
            <label>Recortar inicio (s)<input type="number" min={0} step={0.1} value={secs(selAudio.trimInMs)} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { trimInMs: Math.max(0, Number(e.target.value) * 1000) }))} /></label>
            <label>Duración (s)<input type="number" min={0.1} step={0.1} value={secs(selAudio.durationMs)} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { durationMs: Number(e.target.value) * 1000 }))} /></label>
          </div>
          <label>Volumen ({Math.round(selAudio.volume * 100)}%)<input type="range" min={0} max={2} step={0.05} value={selAudio.volume} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { volume: Number(e.target.value) }))} /></label>
          <label>Panorámica ({!selAudio.pan ? 'centro' : `${selAudio.pan < 0 ? 'izquierda' : 'derecha'} ${Math.round(Math.abs(selAudio.pan) * 100)} %`})<input type="range" aria-label="Panorámica" min={-1} max={1} step={0.05} value={selAudio.pan ?? 0} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { pan: Number(e.target.value) || undefined }))} /></label>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={selAudio.muted} onChange={e => apply(c => updateAudioClip(c, selAudio.id, { muted: e.target.checked }))} /> Silenciar</label>
          <div className="pageActions">
            {selAudio.linkedClipId === null && <span className="muted small">Para enlazarlo a un clip, bórralo y añádelo con ese clip seleccionado.</span>}
            <button type="button" className="ghost" onClick={() => { apply(c => deleteAudioClip(c, selAudio.id)); setSelection(null) }}>Eliminar audio</button>
          </div>
          </Section>
          <Section id="audio-auto" title="Automatización y fundidos" defaultOpen={(selAudio.envelope?.length ?? 0) > 0 || Boolean(selAudio.fadeInMs || selAudio.fadeOutMs)}>
          <AutomationEditor a={selAudio} startMs={audioStartMs(comp, selAudio)} playheadMs={playheadMs} range={range} onChange={p => apply(c => updateAudioClip(c, selAudio.id, p))} />
          </Section>
        </>}
        {!selClip && !selAudio && !selText && !selOverlay && !selTrClip && <>
          <Section id="proj-basic" title="Proyecto" defaultOpen>
            <p className="small">{comp.clips.length} clips · {fmt(total)} · formato {comp.format === 'custom' ? `${comp.customSize?.width ?? 1280}×${comp.customSize?.height ?? 720}` : comp.format}</p>
          <label>Duración de las transiciones (ms)<input type="number" min={0} max={1500} step={50} value={comp.fadeMs} onChange={e => apply(c => ({ ...c, fadeMs: Math.min(Math.max(Number(e.target.value) || 0, 0), 1500) }))} /></label>
          <label>Hook inicial en pantalla<input value={comp.hookText ?? ''} maxLength={120} onChange={e => apply(c => ({ ...c, hookText: e.target.value || null }))} /></label>
          </Section>
          <Section id="proj-sound" title="Sonido del proyecto" defaultOpen>
          <label>Música de fondo
            <select value={comp.musicAssetId ?? ''} onChange={e => apply(c => ({ ...c, musicAssetId: e.target.value || null }))}><option value="">— Sin música</option>{assets.filter(a => musicTypes.includes(a.asset_type)).map(a => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select>
          </label>
          <label>Volumen de música ({Math.round(comp.musicVolume * 100)}%)<input type="range" min={0} max={1} step={0.05} value={comp.musicVolume} onChange={e => apply(c => ({ ...c, musicVolume: Number(e.target.value) }))} /></label>
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={comp.duckMusic} onChange={e => apply(c => ({ ...c, duckMusic: e.target.checked }))} /> Bajar música bajo la voz</label>
          </Section>
          <Section id="proj-captions" title="Subtítulos">
          <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={comp.subtitles} onChange={e => apply(c => ({ ...c, subtitles: e.target.checked }))} /> Subtítulos (texto de cada clip)</label>
          {comp.subtitles && <label>Estilo de subtítulos<select value={comp.captionStyle ?? 'box'} onChange={e => apply(c => ({ ...c, captionStyle: e.target.value as CaptionStyle }))}>{(Object.keys(CAPTION_STYLES) as CaptionStyle[]).map(k => <option key={k} value={k}>{CAPTION_STYLES[k]}</option>)}</select></label>}
          {comp.subtitles && <label>Posición de los subtítulos<select value={comp.captionPosition ?? 'bottom'} onChange={e => apply(c => ({ ...c, captionPosition: e.target.value === 'bottom' ? undefined : e.target.value as CaptionPosition }))}>{(Object.keys(CAPTION_POSITIONS) as CaptionPosition[]).map(k => <option key={k} value={k}>{CAPTION_POSITIONS[k]}</option>)}</select></label>}
          </Section>
          <p className="muted small">Selecciona un clip, un audio, un texto o una capa en la línea de tiempo para ver sus herramientas.</p>
        </>}
        </fieldset>
      </section>
    </div>

    <section className="panel timelinePanel" style={{ marginBottom: 12, outline: dropping ? '2px dashed var(--accent, #7c4fe0)' : undefined }} aria-label="Edición multipista"
      onContextMenu={openMenu}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }} onDragLeave={() => setDropping(false)} onDrop={() => setDropping(false)}>
      <div className="tlToolbar" role="toolbar" aria-label="Herramientas de la línea de tiempo">
        <button type="button" className="ghost small" onClick={splitHere} aria-label="Dividir en el cabezal" title="Corta en el cabezal lo seleccionado o, sin selección, todo lo que pasa por él (S)">✂ Dividir (S)</button>
        <button type="button" className="ghost small" disabled={!sel.length} onClick={copySel} aria-label="Copiar selección" title="Ctrl+C">Copiar</button>
        <button type="button" className="ghost small" onClick={pasteHere} aria-label="Pegar en el cabezal" title="Pega en el cabezal (Ctrl+V)">Pegar</button>
        <button type="button" className="ghost small" disabled={!sel.length} onClick={duplicateSel} aria-label="Duplicar selección" title="Ctrl+D">Duplicar</button>
        <button type="button" className="ghost small" disabled={!selClip} onClick={() => setBatchDlg('repeat')} aria-label="Repetir el clip varias veces" title="Repite el clip seleccionado N veces o hasta una duración (comparten el mismo archivo)">Repetir…</button>
        <button type="button" className="ghost small" disabled={comp.clips.length < 2} onClick={() => setBatchDlg('trans')} aria-label="Transiciones en lote" title="Aplica o quita una transición en todos los cortes, en los seleccionados, en un rango o cada N">Transiciones en lote…</button>
        <button type="button" className="ghost small" disabled={!sel.length} onClick={deleteSel} aria-label="Eliminar selección" title="Supr">Eliminar</button>
        <button type="button" className="ghost small" disabled={sel.length < 2} onClick={groupSel} aria-label="Agrupar selección" title="Ctrl+G">Agrupar</button>
        <button type="button" className="ghost small" disabled={!sel.length} onClick={ungroupSel} aria-label="Desagrupar selección" title="Ctrl+Mayús+G">Desagrupar</button>
        <button type="button" className="ghost small" title="Tecla I" onClick={() => markAt('in')} aria-label="Marcar entrada">[ Entrada</button>
        <button type="button" className="ghost small" title="Tecla O" onClick={() => markAt('out')} aria-label="Marcar salida">Salida ]</button>
        <button type="button" className="ghost small" onClick={addTextHere} aria-label="Añadir texto" title="Añade un texto en el cabezal">T+ Texto</button>
        <button type="button" className="ghost small" onClick={() => apply(c => addMarker(c, playheadMs))} aria-label="Añadir marcador" title="M">◆ Marcador</button>
        <label className="small" title="Añadir una pista">+ Pista
          <select aria-label="Añadir pista" value="" onChange={e => { const v = e.target.value as 'overlay' | 'text' | 'voice' | 'music' | 'sfx'; if (!v) return; apply(c => addTrack(c, v).composition) }}>
            <option value="">—</option><option value="overlay">Vídeo / imagen superpuesta</option><option value="text">Texto</option><option value="voice">Voz</option><option value="music">Música</option><option value="sfx">Efectos</option>
          </select>
        </label>
        <label className="pill small" title="Los bordes se pegan a otros clips, al cabezal, a los marcadores y a los pulsos"><input type="checkbox" checked={magnet} onChange={e => setMagnet(e.target.checked)} /> Imán</label>
        <label className="small" title="También: Alt + rueda sobre la línea de tiempo">Zoom <input type="range" min={1} max={200} value={pxPerSec} aria-label="Zoom horizontal" onChange={e => zoomKeepingView(Number(e.target.value))} /></label>
        <label className="small">Altura <input type="range" min={0.6} max={2} step={0.1} value={trackScale} aria-label="Altura de las pistas" onChange={e => setTrackScale(Number(e.target.value))} /></label>
        <button type="button" className="ghost small" title="Ajusta el zoom para ver todo el proyecto" onClick={() => { const w = scroller.current?.clientWidth ?? 1000; setPxPerSec(Math.max(1, Math.min(200, Math.floor((w - 60) / Math.max(1, total / 1000))))) }}>Ver todo</button>
        {sel.length > 0 && <span className="pill info small">{sel.length} seleccionado(s)</span>}
      </div>
      <EditorTimeline comp={comp} selection={sel} onSelect={setSel} selectedTransition={selTr} onSelectTransition={id => { selectTransition(id); if (id) ws.reveal({ section: 'tr-basic' }) }}
        onMoveTransition={(from, to) => { apply(c => { const k = c.clips.find(x => x.id === from); return k ? updateClip(updateClip(c, to, trOf(k)), from, { transition: 'cut', transitionMs: undefined, transitionOpts: undefined }) : c }); selectTransition(to); setNotice('Transición movida a otro corte (el anterior queda como corte directo). Ctrl+Z la devuelve.') }} pxPerSec={pxPerSec} trackScale={trackScale} playheadMs={playheadMs} onSeek={setPlayheadMs}
        range={range} setRange={r => { setRange(r); setMarkIn(null) }} markIn={markIn} magnet={magnet || snap} beatsMs={beats.beatsMs} showBeats={showBeats}
        waveformOf={id => { const an = analyses[id]; return an === 'loading' ? 'loading' : typeof an === 'object' ? an.waveform ?? null : null }}
        thumbOf={id => (id ? thumbs[id] : undefined)} labelOf={label} typeOf={typeOf} resolveUrl={resolveUrl}
        begin={beginDrag} live={liveDrag} end={endDrag} apply={apply} onReorderMain={(id, to) => apply(c => moveClip(c, id, to))}
        onDropTransition={(clipId, t) => { { const k = comp.clips.find(x => x.id === clipId); const next = updateClip(comp, clipId, k ? transitionPatch(k, t) : { transition: t }); apply(() => roomFor(clipId, next)) }; setSelection({ kind: 'clip', id: clipId }); ws.reveal({ section: 'clip-transition' }); setNotice(`Transición «${TRANSITIONS[t]}» entre el clip ${comp.clips.findIndex(k => k.id === clipId) + 1} y el siguiente.`) }}
        onDropAsset={(id, t, at) => void dropAsset(id, t, at)} onDropFiles={files => void importFiles(files)}
        onTrackAction={trackAction} onTrackFlag={(t, f) => apply(c => updateTrack(c, t.id, { [f]: !t[f] }))}
        scrollerRef={scroller} playheadRef={playheadEl} view={view} onScroll={measureView}>
        {selAudio && <AutomationLane key={selAudio.id} a={selAudio} startMs={audioStartMs(comp, selAudio)} pxPerSec={pxPerSec} label={label(selAudio.assetId)}
          waveform={(() => { const an = analyses[selAudio.assetId]; return typeof an === 'object' && an.waveform ? an.waveform : null })()}
          onBegin={() => setHistory(h => (h ? { past: [...h.past, h.present].slice(-100), present: h.present, future: [] } : h))}
          onLive={next => { setHistory(h => (h ? { ...h, present: updateAudioClip(h.present, next.id, { envelope: next.envelope }) } : h)); setDirty(true) }}
          onEnd={() => setHistory(h => (h && h.past.length && h.past[h.past.length - 1] === h.present ? { ...h, past: h.past.slice(0, -1) } : h))}
          onCommit={next => apply(c => updateAudioClip(c, next.id, { envelope: next.envelope }))} />}
        {comp.musicAssetId && <p className="muted small" style={{ marginTop: 6 }}>Música de fondo global: {label(comp.musicAssetId)} ({Math.round(comp.musicVolume * 100)}%, {comp.duckMusic ? 'baja bajo la voz' : 'sin ducking'})</p>}
      </EditorTimeline>
      {range && <div className="pageActions" role="group" aria-label="Fragmento" style={{ marginTop: 8 }}>
        <span className="pill info">Fragmento {secs(range.startMs)}–{secs(range.endMs)} s ({secs(range.endMs - range.startMs)} s)</span>
        <button type="button" className="ghost small" onClick={() => { const r = isolateRange(comp, range); apply(() => r.composition); setRange(r.range); setNotice(`Fragmento separado en ${r.ids.length} clip${r.ids.length === 1 ? '' : 's'} propios.`) }}>Separar en clips</button>
        <button type="button" className="ghost small" onClick={() => { const r = deleteRange(comp, range); if (!r.removedMs) { setError('El fragmento no contiene clips completos.'); return } apply(() => r.composition); setRange(null); setNotice(`Fragmento eliminado (${secs(r.removedMs)} s); lo que venía después se adelanta y la música sigue sincronizada. Ctrl+Z para deshacer.`) }}>Eliminar fragmento</button>
        <button type="button" className="ghost small" onClick={() => setRange(null)}>Quitar selección (Esc)</button>
        <span className="muted small">Las instrucciones se aplican solo a este fragmento.</span>
      </div>}
      {(comp.markers?.length ?? 0) > 0 && <details className="small" style={{ marginTop: 8 }}><summary>Marcadores ({comp.markers!.length})</summary>
        <ul className="plainList">{comp.markers!.map(m => <li key={m.id} className="field-row" style={{ alignItems: 'center' }}>
          <button type="button" className="ghost small" onClick={() => setPlayheadMs(m.atMs)}>{secs(m.atMs)} s</button>
          <input aria-label={`Nombre del marcador ${m.label}`} defaultValue={m.label} key={m.label} onBlur={e => { if (e.target.value !== m.label) apply(c => updateMarker(c, m.id, { label: e.target.value })) }} />
          <button type="button" className="ghost small" aria-label={`Quitar el marcador ${m.label}`} onClick={() => apply(c => deleteMarker(c, m.id))}>✕</button>
        </li>)}</ul>
      </details>}
      <p className="muted small" style={{ marginTop: 8 }}>Arrastra materiales a cualquier pista. Clic selecciona; Mayús/Ctrl + clic suma a la selección. Arrastra los clips para moverlos (también a otra pista del mismo tipo) y sus bordes para recortarlos; los clips del vídeo principal se reordenan arrastrándolos. S divide en el cabezal · Ctrl+C / Ctrl+V / Ctrl+D copian, pegan y duplican · Ctrl+G agrupa · M añade un marcador · Supr borra · Ctrl+Z / Ctrl+Mayús+Z deshacen y rehacen · Espacio reproduce.</p>
    </section>
    {menu && menuItems.length > 0 && <ContextMenu x={menu.x} y={menu.y} label={menu.kind === 'transition' ? 'Menú de la transición' : menu.kind === 'item' ? 'Menú de la selección' : 'Menú de la línea de tiempo'} items={menuItems} onClose={closeMenu} />}
    </WorkspaceProvider>
  </StudioShell>
}

function ClipInspector({ clip, isVideo, visuals, splitAt, setSplitAt, nextBeatMs, onChange, onSpeed, onTrim, onSplit, onDuplicate, onRepeat, onDelete, onMove, transitionTools, transitionDuration, animation }: {
  transitionTools?: React.ReactNode
  transitionDuration?: React.ReactNode
  animation?: React.ReactNode
  clip: Clip; isVideo: boolean; visuals: EditorAsset[]; splitAt: string; setSplitAt: (v: string) => void; /** First beat of the music inside this clip that leaves both halves ≥ 1 s (ms from the clip start), or null. */ nextBeatMs: number | null
  onChange: (p: Partial<Clip>) => void; onSpeed: (v: number) => void; onTrim: (deltaMs: number) => void; onSplit: (ms: number) => void; onDuplicate: () => void; onRepeat?: () => void; onDelete: () => void; onMove: (dir: -1 | 1) => void
}) {
  const splitMs = Math.round(Number(splitAt) * 1000)
  const cam = effectiveCamera(clip, !isVideo)
  const canSplit = splitMs >= MIN_CLIP_MS && clip.durationMs - splitMs >= MIN_CLIP_MS
  return <>
    <Section id="clip-basic" title={isVideo ? 'Vídeo' : 'Foto'} defaultOpen>
      <label>Imagen o vídeo
        <select value={clip.visualAssetId ?? ''} onChange={e => onChange({ visualAssetId: e.target.value || null, trimInMs: 0 })}><option value="">— Sin visual (negro)</option>{visuals.map(a => <option key={a.id} value={a.id}>[{a.asset_type}] {assetLabel(a)}</option>)}</select>
      </label>
      <div className="field-row" data-tool="trim">
        <label>Duración (s)<input type="number" min={MIN_CLIP_MS / 1000} max={MAX_CLIP_MS / 1000} step={0.1} value={secs(clip.durationMs)} onChange={e => onChange({ durationMs: Number(e.target.value) * 1000 })} /></label>
        {isVideo && <label>Inicio en el vídeo (s)<input type="number" min={0} step={0.1} value={secs(clip.trimInMs ?? 0)} onChange={e => onTrim(Number(e.target.value) * 1000 - (clip.trimInMs ?? 0))} /></label>}
        {isVideo && <label>Velocidad<select value={String(clip.speed ?? 1)} onChange={e => onSpeed(Number(e.target.value))}>{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(v => <option key={v} value={String(v)}>{v}×</option>)}</select></label>}
      </div>
      {isVideo && <div className="field-row" data-tool="volume">
        <label>Volumen del vídeo ({Math.round((clip.volume ?? 1) * 100)}%)<input type="range" min={0} max={2} step={0.05} value={clip.volume ?? 1} onChange={e => onChange({ volume: Number(e.target.value) })} /></label>
        <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={clip.muted === true} onChange={e => onChange({ muted: e.target.checked })} /> Silenciar</label>
      </div>}
      <div className="field-row" style={{ alignItems: 'end' }}>
        <label>Dividir en (s desde el inicio del clip)<input type="number" min={1} step={0.1} value={splitAt} onChange={e => setSplitAt(e.target.value)} placeholder={`1 – ${secs(clip.durationMs - MIN_CLIP_MS)}`} /></label>
        <button type="button" className="ghost" disabled={!canSplit} onClick={() => onSplit(splitMs)}>Dividir</button>
        <button type="button" className="ghost" disabled={nextBeatMs === null} title="Divide el clip en el primer pulso de la música que deja al menos 1 s a cada lado" onClick={() => nextBeatMs !== null && onSplit(nextBeatMs)}>Dividir en el siguiente pulso</button>
      </div>
      <div className="pageActions">
        <button type="button" className="ghost" onClick={() => onMove(-1)}>← Mover</button>
        <button type="button" className="ghost" onClick={() => onMove(1)}>Mover →</button>
        <button type="button" className="ghost" onClick={onDuplicate}>Duplicar</button>
        {onRepeat && <button type="button" className="ghost" onClick={onRepeat} title="Repetir este clip N veces o hasta una duración">Repetir…</button>}
        <button type="button" className="ghost" onClick={onDelete}>Eliminar</button>
      </div>
    </Section>
    <Section id="clip-transition" title="Transición" defaultOpen extra={<span className="muted small">{TRANSITIONS[clip.transition ?? 'fade']}</span>}>
      <div className="field-row">
        <label>Transición al siguiente<select value={clip.transition ?? 'fade'} onChange={e => onChange(transitionPatch(clip, e.target.value as Transition))}>{(Object.keys(TRANSITIONS) as Transition[]).map(t => <option key={t} value={t}>{TRANSITIONS[t]}</option>)}</select></label>

      </div>
      {transitionDuration}
      {transitionTools}
    </Section>
    <Section id="clip-frame" title="Encuadre y movimiento" defaultOpen={(clip.zoom ?? 1) !== 1 || !!clip.camera}>
      <div className="field-row" data-tool="zoom">
        <label>Zoom ({(clip.zoom ?? 1).toFixed(2)}×)<input type="range" min={1} max={3} step={0.05} value={clip.zoom ?? 1} onChange={e => onChange({ zoom: Number(e.target.value) })} /></label>
        <label>Posición horizontal<input type="range" min={0} max={1} step={0.01} value={clip.focusX ?? 0.5} onChange={e => onChange({ focusX: Number(e.target.value) })} /></label>
        <label>Posición vertical<input type="range" min={0} max={1} step={0.01} value={clip.focusY ?? 0.5} onChange={e => onChange({ focusY: Number(e.target.value) })} /></label>
      </div>
      <div className="field-row">
        <label>Movimiento de cámara<select value={cam?.kind ?? 'none'} onChange={e => onChange({ camera: { kind: e.target.value as CameraKind, amount: cam?.amount ?? 0.1 } })}>{(Object.keys(CAMERA_MOVES) as CameraKind[]).map(k => <option key={k} value={k}>{CAMERA_MOVES[k]}</option>)}</select></label>
        <label>Intensidad ({Math.round((cam?.amount ?? 0.1) * 100)} %)<input type="range" min={0.02} max={0.5} step={0.01} value={cam?.amount ?? 0.1} disabled={!cam || cam.kind === 'none'} onChange={e => onChange({ camera: { kind: cam?.kind ?? 'zoom_in', amount: Number(e.target.value) } })} /></label>
      </div>
    </Section>
    <Section id="clip-anim" title="Animación (fotogramas clave)" defaultOpen={(clip.keyframes?.length ?? 0) > 0}>
      {animation}
    </Section>
    <Section id="clip-color" title="Color y efectos" defaultOpen={!!clip.filters || !!clip.crop || !!clip.rotation || (clip.opacity ?? 1) < 1}>
      <VisualFields bare filters={clip.filters} crop={clip.crop} rotation={clip.rotation ?? 0} opacity={clip.opacity ?? 1} onChange={p => onChange(p as Partial<Clip>)} />
    </Section>
    <Section id="clip-text" title="Texto y subtítulo" defaultOpen={!!clip.text}>
      <label>Subtítulo de este clip<textarea className="viText" value={clip.narration ?? ''} onChange={e => onChange({ narration: e.target.value || null })} /></label>
      <div className="field-row">
        <label>Texto en pantalla<input value={clip.text?.content ?? ''} maxLength={200} onChange={e => onChange({ text: e.target.value ? { content: e.target.value, position: clip.text?.position ?? 'center', sizePct: clip.text?.sizePct ?? 6 } : null })} /></label>
        <label>Posición del texto<select value={clip.text?.position ?? 'center'} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, position: e.target.value as 'top' | 'center' | 'bottom' } })}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
        <label>Tamaño<input type="range" min={2} max={15} step={0.5} value={clip.text?.sizePct ?? 6} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, sizePct: Number(e.target.value) } })} /></label>
        <label>Animación del texto<select value={clip.text?.animation ?? 'none'} disabled={!clip.text} onChange={e => clip.text && onChange({ text: { ...clip.text, animation: e.target.value as TextAnimation } })}>{(Object.keys(TEXT_ANIMATIONS) as TextAnimation[]).map(a => <option key={a} value={a}>{TEXT_ANIMATIONS[a]}</option>)}</select></label>
        {clip.text && <TextStyleFields t={clip.text} onChange={p => onChange({ text: { ...clip.text!, ...p } })} />}
      </div>
    </Section>
  </>
}

/**
 * «Efectos»: quick looks and movements applied to every selected clip or layer at once (one undo step).
 * The fine controls stay in the properties panel («Color y efectos», «Animación»).
 */
function EffectsTab({ selClips, selLayers, presets, apply, onNotice, onReveal }: {
  selClips: Clip[]; selLayers: OverlayClip[]; presets: AnimationPreset[]
  apply: (fn: (c: Composition) => Composition) => void; onNotice: (m: string) => void; onReveal: (section: string) => void
}) {
  const n = selClips.length + selLayers.length
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const filterOn = (k: string) => n > 0 && [...selClips, ...selLayers].every(x => same(x.filters, k === 'none' ? null : FILTER_PRESETS[k].f))
  const setFilter = (k: string) => {
    const f = k === 'none' ? null : FILTER_PRESETS[k].f
    apply(c => selLayers.reduce((x, o) => updateOverlay(x, o.id, { filters: f }), selClips.reduce((x, k2) => updateClip(x, k2.id, { filters: f }), c)))
    onNotice(`Filtro «${FILTER_PRESETS[k].label}» aplicado a ${n} elemento${n === 1 ? '' : 's'}. Ctrl+Z lo deshace.`)
  }
  const move = (p: AnimationPreset) => {
    apply(c => p.target === 'clip'
      ? selClips.reduce((x, k) => setClipKeyframes(updateClip(x, k.id, { camera: { kind: 'none', amount: 0.1 } }), k.id, presetKeys(p, k.durationMs) as never), c)
      : selLayers.reduce((x, o) => updateOverlay(x, o.id, { keyframes: presetKeys(p, o.durationMs) as never }), c))
    onNotice(`Movimiento «${p.name}» aplicado. Ctrl+Z lo deshace.`)
  }
  return <div className="edEffects" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {n === 0 ? <p className="muted small" role="status">Selecciona uno o varios clips o capas en la línea de tiempo (Mayús/Ctrl + clic para varios) y elige aquí un filtro o un movimiento.</p>
      : <p className="small" role="status">Se aplica a {n} elemento{n === 1 ? '' : 's'} seleccionado{n === 1 ? '' : 's'}.</p>}
    <section aria-label="Color rápido">
      <b className="small">Filtros</b>
      <div className="pageActions" role="group" aria-label="Looks de color">
        {Object.entries(FILTER_PRESETS).map(([k, v]) => <button key={k} type="button" className={filterOn(k) ? 'small' : 'ghost small'} aria-pressed={filterOn(k)} disabled={!n} onClick={() => setFilter(k)}>{v.label}</button>)}
      </div>
    </section>
    <section aria-label="Movimientos rápidos">
      <b className="small">Movimientos</b>
      <div className="pageActions" role="group" aria-label="Movimientos">
        {presets.filter(p => (p.target === 'clip' ? selClips.length : selLayers.length) > 0 || n === 0).map(p => <button key={p.id} type="button" className="ghost small" disabled={(p.target === 'clip' ? selClips.length : selLayers.length) === 0} title={p.target === 'clip' ? 'Para clips del vídeo principal' : 'Para capas superpuestas'} onClick={() => move(p)}>{p.id.startsWith('b-') ? '' : '★ '}{p.name}</button>)}
      </div>
    </section>
    {selClips.length > 0 && <section aria-label="Movimiento de cámara">
      <b className="small">Movimiento de cámara (clips)</b>
      <div className="pageActions" role="group" aria-label="Movimiento de cámara">
        {(Object.keys(CAMERA_MOVES) as CameraKind[]).map(k => <button key={k} type="button" className={selClips.every(c => (c.camera?.kind ?? 'none') === k) ? 'small' : 'ghost small'} onClick={() => apply(c => selClips.reduce((x, cl) => updateClip(x, cl.id, { camera: { kind: k, amount: cl.camera?.amount ?? 0.1 } }), c))}>{CAMERA_MOVES[k]}</button>)}
      </div>
    </section>}
    {n > 0 && <div className="pageActions">
      <button type="button" className="ghost small" onClick={() => onReveal(selClips.length ? 'clip-color' : 'layer-color')}>Ajustar color a mano</button>
      <button type="button" className="ghost small" onClick={() => onReveal(selClips.length ? 'clip-anim' : 'layer-anim')}>Editar la animación</button>
    </div>}
  </div>
}

function TextStyleFields({ t, onChange }: { t: TextOverlay; onChange: (p: Partial<TextOverlay>) => void }) {
  return <>
    <label>Tipografía<select value={t.font ?? 'sans'} onChange={e => onChange({ font: e.target.value as TextFont })}>{(Object.keys(TEXT_FONTS) as TextFont[]).map(f => <option key={f} value={f}>{TEXT_FONTS[f].label}</option>)}</select></label>
    <label>Color<input type="color" value={t.color ?? '#ffffff'} onChange={e => onChange({ color: e.target.value })} /></label>
    <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={t.bold !== false} onChange={e => onChange({ bold: e.target.checked ? undefined : false })} /> Negrita</label>
    <label>Contorno<input type="color" aria-label="Color del contorno" value={t.outline ?? '#000000'} onChange={e => onChange({ outline: e.target.value })} /></label>
    <label>Grosor del contorno ({t.outlineWidth ?? 10} %)<input type="range" aria-label="Grosor del contorno" min={0} max={30} step={1} value={t.outlineWidth ?? 10} onChange={e => onChange({ outlineWidth: Number(e.target.value) })} /></label>
    <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={t.shadow === true} onChange={e => onChange({ shadow: e.target.checked || undefined })} /> Sombra</label>
    <label className="pill" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!t.background} onChange={e => onChange({ background: e.target.checked ? '#000000' : null, backgroundOpacity: 0.6 })} /> Fondo</label>
    {t.background && <><label>Color del fondo<input type="color" aria-label="Color del fondo" value={t.background} onChange={e => onChange({ background: e.target.value })} /></label>
      <label>Opacidad del fondo ({Math.round((t.backgroundOpacity ?? 0.6) * 100)} %)<input type="range" min={0} max={1} step={0.05} value={t.backgroundOpacity ?? 0.6} onChange={e => onChange({ backgroundOpacity: Number(e.target.value) })} /></label></>}
    <label>Animación de salida<select aria-label="Animación de salida" value={t.outAnimation ?? ''} onChange={e => onChange({ outAnimation: (e.target.value || undefined) as TextAnimation | undefined })}><option value="">La de entrada</option>{(Object.keys(TEXT_ANIMATIONS) as TextAnimation[]).map(a => <option key={a} value={a}>{TEXT_ANIMATIONS[a]}</option>)}</select></label>
    {t.x !== undefined && <button type="button" className="ghost small" style={{ alignSelf: 'end' }} onClick={() => onChange({ x: undefined, y: undefined })} title="Lo has movido en el visor">Volver a {t.position === 'top' ? 'arriba' : t.position === 'center' ? 'centro' : 'abajo'}</button>}
  </>
}

function TextInspector({ t, onChange, onDuplicate, onDelete }: { t: TextClip; onChange: (p: Partial<TextClip>) => void; onDuplicate: () => void; onDelete: () => void }) {
  return <>
    <Section id="text-basic" title="Texto" defaultOpen>
    <label>Texto<input aria-label="Contenido del texto" value={t.content} maxLength={200} onChange={e => onChange({ content: e.target.value || ' ' })} /></label>
    <div className="field-row">
      <label>Aparece en (s)<input type="number" min={0} step={0.1} value={secs(t.startMs)} onChange={e => onChange({ startMs: Number(e.target.value) * 1000 })} /></label>
      <label>Dura (s)<input type="number" min={0.3} step={0.1} value={secs(t.durationMs)} onChange={e => onChange({ durationMs: Number(e.target.value) * 1000 })} /></label>
    </div>
    <div className="pageActions">
      <button type="button" className="ghost" onClick={onDuplicate}>Duplicar texto</button>
      <button type="button" className="ghost" onClick={onDelete}>Eliminar texto</button>
    </div>
    </Section>
    <Section id="text-style" title="Estilo y animación" defaultOpen>
    <div className="field-row">
      <label>Posición<select value={t.position} onChange={e => onChange({ position: e.target.value as TextClip['position'] })}><option value="top">Arriba</option><option value="center">Centro</option><option value="bottom">Abajo</option></select></label>
      <label>Tamaño ({t.sizePct} %)<input type="range" min={2} max={15} step={0.5} value={t.sizePct} onChange={e => onChange({ sizePct: Number(e.target.value) })} /></label>
      <label>Animación<select value={t.animation ?? 'none'} onChange={e => onChange({ animation: e.target.value as TextAnimation })}>{(Object.keys(TEXT_ANIMATIONS) as TextAnimation[]).map(a => <option key={a} value={a}>{TEXT_ANIMATIONS[a]}</option>)}</select></label>
      <TextStyleFields t={t} onChange={onChange} />
    </div>
    </Section>
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
  return <div className="small">
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
      <button type="button" className="ghost small" disabled={pts.some(p => Math.abs(p.atMs - rel) < 50)} title={pts.some(p => Math.abs(p.atMs - rel) < 50) ? 'Ya hay un punto en el cabezal: mueve el cabezal para añadir otro' : undefined} onClick={() => onChange({ envelope: [...pts, { atMs: Math.round(rel), gain: 1 }].sort((x, y) => x.atMs - y.atMs) })}>Añadir punto en el cabezal</button>
      {inRange && <button type="button" className="ghost small" onClick={() => onChange({ envelope: setLevelBetween(a, range!.startMs - startMs, range!.endMs - startMs, 0.3).envelope })}>Bajar al 30 % en el fragmento</button>}
      {pts.length > 0 && <button type="button" className="ghost small" onClick={() => onChange({ envelope: [] })}>Quitar puntos</button>}
    </div>
    <p className="muted">Los puntos multiplican el volumen del clip y se unen en línea recta; también se aplican sobre la bajada automática bajo la voz.</p>
  </div>
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
