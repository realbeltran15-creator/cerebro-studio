'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { StockBrowser } from '../components/stock-browser'
import { FlowImport } from '../components/flow-import'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { imageModes, imagePresets, presetGroupLabels, type ImageMode, type PresetGroup } from '@/lib/providers/image-presets'
import { modalityLabels, modelById, type Evidence, type Format, type Modality, type Rights } from '@/lib/providers/catalog'
import { tierLabels, type CostTier } from '@/lib/providers/directory'
import { normalizeStrategy, qualityLevels, rankModels, STRATEGY_KEY, strategyLabels, type Strategy } from '@/lib/providers/router'
import type { ProjectRow } from '@/lib/types/database'

type Model = {
  id: string; modality: Modality; provider: string; label: string; strength: string; price: string; priceConfirmed: boolean; sync: boolean
  tier: CostTier; quality: number; speed: 'fast' | 'medium' | 'slow'; limits: string | null; capabilities: string[]
  formats: Format[] | null; durations: number[] | null; maxVariants: number; negative: boolean; ready: boolean; creditsExhausted: boolean; missing: string[]
  evidence: Evidence; evidenceNote: string | null; rights: Rights; rightsNote: string | null; maxResolution: string | null; maxShortSidePx: number | null
  references: { max: number; note?: string } | null; confirm: boolean
  allowance: { pool: string; kind: 'daily' | 'monthly' | 'promo'; unit: string; note: string; remaining: number | null; amount: number; endsAt: string | null; label: string | null; unitsPerGeneration: number | null } | null
}
type Suggestion = { message: string; free: Array<{ id: string; label: string; quality: number; evidence: Evidence; warnings: string[] }>; paid: Array<{ id: string; label: string; estimateUsd: number }> }
const evidenceLabel: Record<Evidence, string> = { tested: 'Probado', documented: 'Documentado', secondary: 'Fuente secundaria', unverified: 'Sin verificar' }
const rightsLabel: Record<Rights, string> = { commercial: 'Uso comercial', plan_dependent: 'Comercial según plan', non_commercial: 'No comercial', check_terms: 'Revisar licencia' }
type RefAsset = { id: string; provenance: Record<string, unknown> | null }
type Balance = { used: number; limit: number; remaining: number; resetsAt: string | null; tier: string | null } | null
type Asset = { id: string; asset_type: string; provenance: Record<string, unknown> | null; created_at: string; source_provider: string | null }
type Scene = { id: string; position: number; narration: string | null; visual_prompt: string | null; video_prompt: string | null; ambient_prompt: string | null; metadata: Record<string, unknown>; storyboard_id: string }
type Board = { id: string; title: string }
type Voice = { voice_id: string; name: string; labels?: Record<string, string> }
type Job = {
  key: string; modelId: string; label: string; modality: Modality; prompt: string; estimateUsd: number; startedAt: number
  state: 'sending' | 'queued' | 'running' | 'saving' | 'done' | 'failed'; position?: number | null; token?: string; error?: string; assetIds?: string[]
}

const modalityIcon: Record<Modality, string> = { image: 'image', video: 'video', voice: 'mic', music: 'music', sfx: 'bolt', ambient: 'radar' }
const modalityKinds: Record<Modality, string[]> = { image: ['image', 'thumbnail'], video: ['video'], voice: ['voice'], music: ['music'], sfx: ['sfx'], ambient: ['sfx'] }
const promptLabel: Record<Modality, string> = {
  image: 'Describe la imagen', video: 'Describe el plano (un solo movimiento continuo)', voice: 'Texto que se va a locutar',
  music: 'Describe la música', sfx: 'Describe el sonido', ambient: 'Describe el ambiente',
}
const promptHint: Record<Modality, string> = {
  image: 'Quién, qué hace, dónde, cuándo, encuadre y luz. Ej.: una joven sola caminando entre la selva peruana, 1971, luz filtrada tras la lluvia.',
  video: 'Sujeto, acción, movimiento de cámara y luz. Ej.: travelling lento sobre restos de un avión entre la vegetación, niebla matinal.',
  voice: 'Pega la narración de la escena. La voz la leerá tal cual.',
  music: 'Género, tempo, instrumentos y emoción. Ej.: ambient cinematográfico, 70 BPM, cuerdas graves y piano, tensión contenida.',
  sfx: 'Fuente, espacio y distancia. Ej.: golpe metálico seco en un hangar vacío.',
  ambient: 'Lugar y textura continua; se genera en bucle. Ej.: selva tropical de noche, insectos, lluvia lejana, sin música.',
}
const stateLabel: Record<Job['state'], string> = { sending: 'Enviando…', queued: 'En cola', running: 'Generando…', saving: 'Guardando…', done: 'Listo', failed: 'Error' }
const JOBS_KEY = 'cerebro.studio.jobs.v1'
const usd = (v: number) => (v > 0 ? `≈ $${v.toFixed(2)}` : 'según tu plan')
const since = (t: number, now: number) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s` }

function loadJobs(): Job[] {
  try { const raw = localStorage.getItem(JOBS_KEY); return raw ? (JSON.parse(raw) as Job[]).filter(j => Date.now() - j.startedAt < 24 * 3600e3) : [] } catch { return [] }
}
function saveJobs(jobs: Job[]) { try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 30))) } catch { /* private mode */ } }

export default function StudioPage() {
  const supabase = getSupabaseBrowserClient()
  const [models, setModels] = useState<Model[]>([])
  const [strategy, setStrategy] = useState<Strategy | 'manual'>('manual')
  const [minQuality, setMinQuality] = useState(4)
  const [geminiVoices, setGeminiVoices] = useState<string[]>([])
  const [balance, setBalance] = useState<Balance>(null)
  const [language, setLanguage] = useState('es')
  const [openAiVoices, setOpenAiVoices] = useState<string[]>([])
  const [textReady, setTextReady] = useState(false)
  const [elVoices, setElVoices] = useState<Voice[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [projectId, setProjectId] = useState('')
  const [boards, setBoards] = useState<Board[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sceneId, setSceneId] = useState('')
  const [modality, setModality] = useState<Modality>('image')
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [preset, setPreset] = useState('documentary')
  const [imageMode, setImageMode] = useState<ImageMode | null>(null)
  const [needsCommercial, setNeedsCommercial] = useState(false)
  const [minRes, setMinRes] = useState(0)
  const [refIds, setRefIds] = useState<string[]>([])
  const [identity, setIdentity] = useState('')
  const [characters, setCharacters] = useState<RefAsset[]>([])
  const [charName, setCharName] = useState('')
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [emotion, setEmotion] = useState('')
  const [format, setFormat] = useState<Format>('16:9')
  const [duration, setDuration] = useState<number | null>(null)
  const [variants, setVariants] = useState(1)
  const [quality, setQuality] = useState<'medium' | 'high'>('medium')
  const [audioOn, setAudioOn] = useState(true)
  const [instrumental, setInstrumental] = useState(true)
  const [voice, setVoice] = useState('')
  const [stability, setStability] = useState(0.5)
  const [style, setStyle] = useState(0.2)
  const [speed, setSpeed] = useState(1)
  const [instructions, setInstructions] = useState('Voz masculina profunda, español latino neutro, tono documental sereno, pausas naturales.')
  const [confirming, setConfirming] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [tips, setTips] = useState<string[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [history, setHistory] = useState<Asset[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pollBusy = useRef(false)
  // Lets effects declared before ensureUrl load signed URLs without a circular dependency.
  const ensureUrlRef = useRef<(id: string) => Promise<string>>(async () => '')
  const stageRef = useRef<HTMLDivElement>(null)
  const showResult = useCallback((id: string) => {
    setSelected(id)
    if (window.matchMedia('(max-width: 1100px)').matches) setTimeout(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }, [])
  // Clock for elapsed times; ticks only while something is running.
  const [now, setNow] = useState(0)

  // ---------- Load ----------
  useEffect(() => {
    setJobs(loadJobs())
    try { const v = normalizeStrategy(localStorage.getItem(STRATEGY_KEY)); if (v) setStrategy(v); const q = Number(localStorage.getItem(`${STRATEGY_KEY}.quality`)); if (q >= 1 && q <= 5) setMinQuality(q) } catch { /* private mode */ }
    const params = new URLSearchParams(window.location.search)
    const m = params.get('tab') as Modality | null
    if (m && m in modalityLabels) setModality(m)
    void (async () => {
      const [cat, proj] = await Promise.all([
        fetch('/api/studio/catalog', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        supabase.from('projects').select('*').order('updated_at', { ascending: false }),
      ])
      if (cat) { setModels(cat.models); setOpenAiVoices(cat.openAiVoices); setGeminiVoices(cat.geminiVoices ?? []); setBalance(cat.balances?.elevenlabs ?? null); setTextReady(cat.textReady) } else setError('No se pudo leer el catálogo de modelos. ¿Has iniciado sesión?')
      const rows = (proj.data ?? []) as ProjectRow[]
      setProjects(rows)
      const wanted = params.get('project')
      setProjectId(wanted && rows.some(p => p.id === wanted) ? wanted : rows[0]?.id ?? '')
      if (params.get('scene')) setSceneId(params.get('scene')!)
    })()
    fetch('/api/providers/voices').then(r => r.ok ? r.json() : { voices: [] }).then(j => setElVoices(j.voices ?? [])).catch(() => {})
  }, [supabase])

  useEffect(() => { saveJobs(jobs) }, [jobs])
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const running = jobs.some(j => j.state !== 'done' && j.state !== 'failed')
    const t = running ? setInterval(tick, 1000) : undefined
    return () => { clearTimeout(first); if (t) clearInterval(t) }
  }, [jobs])

  const modalityModels = useMemo(() => models.filter(m => m.modality === modality), [models, modality])
  const model = models.find(m => m.id === modelId) ?? null

  // Ranking for the chosen strategy (it only selects; generating always needs a confirmation click).
  const ranked = useMemo(() => {
    const full = modalityModels.map(m => modelById(m.id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    const availability = Object.fromEntries(modalityModels.map(m => [m.id, { ready: m.ready, creditsExhausted: m.creditsExhausted && !m.allowance, remaining: m.allowance?.remaining ?? undefined }]))
    return rankModels(full, {
      modality, strategy: strategy === 'manual' ? 'best_value' : strategy, minQuality: strategy === 'manual' ? undefined : minQuality,
      needsCommercial: needsCommercial || undefined, minShortSidePx: minRes || undefined, references: refIds.length || undefined, format,
    }, availability)
  }, [modalityModels, modality, strategy, minQuality, needsCommercial, minRes, refIds.length, format])
  const reasonsFor = (id: string) => ranked.find(r => r.model.id === id)?.reasons ?? []
  const orderedModels = strategy === 'manual' ? modalityModels : ranked.map(r => modalityModels.find(m => m.id === r.model.id)!).filter(Boolean)

  // Strategy picks the best eligible model; manual keeps the user's choice (or the first ready model).
  useEffect(() => {
    if (!modalityModels.length) return
    if (strategy !== 'manual') {
      const best = ranked.find(r => r.eligible)
      if (best && best.model.id !== modelId) setModelId(best.model.id)
      if (!best && !modalityModels.some(m => m.id === modelId)) setModelId(modalityModels[0].id)
      return
    }
    if (!modalityModels.some(m => m.id === modelId)) setModelId((modalityModels.find(m => m.ready) ?? modalityModels[0]).id)
  }, [modalityModels, modelId, strategy, ranked])
  useEffect(() => {
    if (!model) return
    if (model.formats && !model.formats.includes(format)) setFormat(model.formats[0])
    if (model.durations) { if (!duration || !model.durations.includes(duration)) setDuration(model.durations[Math.min(1, model.durations.length - 1)]) }
    if (variants > model.maxVariants) setVariants(1)
    if (!model.references) { if (refIds.length) setRefIds([]) } else if (refIds.length > model.references.max) setRefIds(l => l.slice(0, model.references!.max))
    if (model.id.startsWith('openai:gpt-4o') && !openAiVoices.includes(voice)) setVoice('onyx')
    if (model.id.startsWith('elevenlabs:eleven') && !elVoices.some(v => v.voice_id === voice)) setVoice(elVoices[0]?.voice_id ?? '')
    if (model.id === 'gemini:gemini-3.8-flash-tts' && !geminiVoices.includes(voice)) setVoice(geminiVoices.includes('Charon') ? 'Charon' : geminiVoices[0] ?? '')
  }, [model, format, duration, variants, voice, openAiVoices, elVoices, geminiVoices, refIds.length])

  // Project → storyboards → scenes (for prefill and linking).
  useEffect(() => {
    if (!projectId) return
    void (async () => {
      const { data: b } = await supabase.from('storyboards').select('id,title').eq('project_id', projectId).order('created_at', { ascending: false })
      const bs = (b ?? []) as Board[]
      setBoards(bs)
      if (!bs.length) { setScenes([]); return }
      const { data: s } = await supabase.from('scenes').select('id,position,narration,visual_prompt,video_prompt,ambient_prompt,metadata,storyboard_id').in('storyboard_id', bs.map(x => x.id)).order('position')
      setScenes((s ?? []) as Scene[])
    })()
  }, [projectId, supabase])

  // Images saved as characters (provenance.role = character_reference) can be reused as references in any scene.
  useEffect(() => {
    if (!projectId || modality !== 'image') return
    void (async () => {
      const { data } = await supabase.from('assets').select('id,provenance').eq('project_id', projectId).in('asset_type', ['image', 'thumbnail']).eq('provenance->>role', 'character_reference').order('created_at', { ascending: false }).limit(12)
      const rows = (data ?? []) as RefAsset[]
      setCharacters(rows)
      rows.forEach(r => { void ensureUrlRef.current(r.id) })
    })()
  }, [projectId, modality, supabase])

  const loadHistory = useCallback(async () => {
    if (!projectId) return
    const { data } = await supabase.from('assets').select('id,asset_type,provenance,created_at,source_provider')
      .eq('project_id', projectId).in('asset_type', modalityKinds[modality]).order('created_at', { ascending: false }).limit(24)
    setHistory((data ?? []) as Asset[])
  }, [projectId, modality, supabase])
  useEffect(() => { void loadHistory() }, [loadHistory])

  // Signed URLs for previews (private bucket).
  const ensureUrl = useCallback(async (id: string) => {
    if (urls[id]) return urls[id]
    const r = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({})) as { url?: string }
    if (j.url) setUrls(u => ({ ...u, [id]: j.url! }))
    return j.url ?? ''
  }, [urls])
  useEffect(() => { ensureUrlRef.current = ensureUrl }, [ensureUrl])
  useEffect(() => { history.slice(0, 12).forEach(a => { if (!urls[a.id]) void ensureUrl(a.id) }) }, [history]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!selected && history[0]) setSelected(history[0].id) }, [history, selected])

  // ---------- Poll queued jobs ----------
  useEffect(() => {
    const pending = jobs.filter(j => j.token && (j.state === 'queued' || j.state === 'running' || j.state === 'saving'))
    if (!pending.length) return
    const t = setInterval(async () => {
      if (pollBusy.current) return
      pollBusy.current = true
      try {
        for (const job of pending) {
          const r = await fetch('/api/studio/job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: job.token }) })
          const j = await r.json().catch(() => ({})) as { state?: string; position?: number | null; error?: string; assets?: Asset[] }
          setJobs(list => list.map(x => {
            if (x.key !== job.key) return x
            if (j.state === 'done') return { ...x, state: 'done', assetIds: (j.assets ?? []).map(a => a.id) }
            if (j.state === 'failed' || j.state === 'expired') return { ...x, state: 'failed', error: j.error ?? 'Error' }
            if (j.state === 'running' || j.state === 'queued') return { ...x, state: j.state, position: j.position ?? null }
            return x
          }))
          if (j.state === 'done' && j.assets?.[0]) { showResult(j.assets[0].id); void loadHistory(); setNotice(`${job.label}: listo y guardado en la Biblioteca.`) }
        }
      } finally { pollBusy.current = false }
    }, 5000)
    return () => clearInterval(t)
  }, [jobs, loadHistory, showResult])

  // ---------- Actions ----------
  const scene = scenes.find(s => s.id === sceneId) ?? null
  const sceneText = (s: Scene, key: string) => (typeof s.metadata?.[key] === 'string' ? s.metadata[key] as string : '')
  function fillFromScene() {
    if (!scene) return
    const value = modality === 'image' ? scene.visual_prompt || sceneText(scene, 'visual_description') || scene.narration
      : modality === 'video' ? scene.video_prompt || scene.visual_prompt || sceneText(scene, 'visual_description')
      : modality === 'voice' ? scene.narration
      : modality === 'music' ? sceneText(scene, 'music')
      : modality === 'ambient' ? scene.ambient_prompt || sceneText(scene, 'sfx')
      : sceneText(scene, 'sfx') || scene.ambient_prompt
    if (value?.trim()) { setPrompt(value.trim()); setNotice(`Texto tomado de la escena ${scene.position}.`) }
    else setError(`La escena ${scene.position} no tiene datos para ${modalityLabels[modality].toLowerCase()}.`)
  }
  // Opened from a storyboard scene (?scene=…): prefill once with that scene's text for the current tab.
  const autoFilled = useRef('')
  useEffect(() => {
    if (!scene || prompt.trim() || autoFilled.current === `${scene.id}:${modality}`) return
    autoFilled.current = `${scene.id}:${modality}`
    const t = setTimeout(fillFromScene, 0)
    return () => clearTimeout(t)
  }, [scene, modality]) // eslint-disable-line react-hooks/exhaustive-deps

  async function enhance() {
    if (!prompt.trim()) return
    setEnhancing(true); setError(''); setTips([])
    const idea = modality === 'voice' ? `Texto: ${prompt}\nIndicaciones actuales: ${instructions}` : prompt
    const r = await fetch('/api/studio/enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modality, idea, projectId, sceneContext: scene?.narration ?? '' }) })
    const j = await r.json().catch(() => ({})) as { prompt?: string; negative?: string; notes?: string[]; error?: string }
    setEnhancing(false)
    if (!r.ok || !j.prompt) { setError(j.error ?? 'No se pudo mejorar el prompt.'); return }
    if (modality === 'voice') setInstructions(j.prompt); else setPrompt(j.prompt)
    if (j.negative && model?.negative) setNegative(j.negative)
    setTips(j.notes ?? [])
  }

  // Same estimate the server records with the asset (lib/providers/catalog.ts).
  const estimate = useMemo(() => modelById(model?.id ?? '')?.estimateUsd({ format, durationSeconds: duration ?? undefined, variants, quality, audio: audioOn, references: refIds.length }) ?? 0,
    [model, format, duration, variants, quality, audioOn, refIds.length])

  async function generate() {
    if (!model || !projectId || !prompt.trim()) return
    setConfirming(false); setError(''); setNotice(''); setSuggestion(null)
    const key = crypto.randomUUID()
    const job: Job = { key, modelId: model.id, label: model.label, modality, prompt: prompt.trim(), estimateUsd: estimate, startedAt: Date.now(), state: 'sending' }
    setJobs(list => [job, ...list])
    const body = {
      projectId, sceneId: sceneId || null, modelId: model.id, prompt: prompt.trim(), negative: negative.trim() || undefined,
      preset: modality === 'image' && model.id !== 'fal:fal-ai/ideogram/v3' && preset !== 'none' ? preset : undefined, context: scene?.narration ?? undefined,
      options: { format, durationSeconds: duration ?? undefined, variants, quality, audio: audioOn, instrumental },
      voice: voice || undefined, voiceSettings: { stability, style, speed }, instructions: model.id.startsWith('topmediai:') ? emotion : instructions, language,
      referenceAssetIds: model.references && refIds.length ? refIds.slice(0, model.references.max) : undefined, identity: identity.trim() || undefined, needsCommercial: needsCommercial || undefined,
      selection: strategy === 'manual' ? 'manual' : `${strategy}:q${minQuality}`, confirmedEstimateUsd: estimate,
    }
    const r = await fetch('/api/studio/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({})) as { error?: string; assets?: Asset[]; job?: { token: string }; recommendation?: Suggestion }
    if (j.recommendation) setSuggestion(j.recommendation)
    if (!r.ok && r.status !== 202) { setJobs(list => list.map(x => x.key === key ? { ...x, state: 'failed', error: j.error ?? 'Error' } : x)); setError(j.error ?? 'No se pudo generar.'); return }
    if (j.job) { setJobs(list => list.map(x => x.key === key ? { ...x, state: 'queued', token: j.job!.token } : x)); setNotice(`${model.label}: trabajo enviado. Puedes seguir trabajando; se guardará solo al terminar.`); return }
    const ids = (j.assets ?? []).map(a => a.id)
    setJobs(list => list.map(x => x.key === key ? { ...x, state: 'done', assetIds: ids } : x))
    if (ids[0]) showResult(ids[0])
    setNotice(`${model.label}: listo y guardado en la Biblioteca.`)
    void loadHistory()
  }

  const selectedAsset = history.find(a => a.id === selected) ?? null
  const selectedUrl = selected ? urls[selected] : ''
  useEffect(() => { if (selected && !urls[selected]) void ensureUrl(selected) }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeJobs = jobs.filter(j => j.state !== 'done' || now - j.startedAt < 10 * 60e3).slice(0, 8)
  const kindOf = (a: Asset | null): Modality | 'image' => (!a ? modality : a.asset_type === 'thumbnail' ? 'image' : (a.asset_type as Modality))
  const promptOf = (a: Asset) => String(a.provenance?.originalPrompt ?? a.provenance?.prompt ?? a.provenance?.text ?? '')

  function toggleRef(a: RefAsset) {
    const max = model?.references?.max ?? 0
    if (refIds.includes(a.id)) { setRefIds(list => list.filter(x => x !== a.id)); return }
    if (refIds.length >= max) { setError(`Este modelo admite ${max} referencia(s) como máximo.`); return }
    setRefIds(list => [...list, a.id])
    const described = typeof a.provenance?.characterIdentity === 'string' ? a.provenance.characterIdentity : ''
    if (described && !identity.trim()) setIdentity(described)
  }

  async function saveCharacter(a: Asset) {
    const name = charName.trim()
    if (!name) { setError('Ponle un nombre al personaje.'); return }
    const provenance = { ...(a.provenance ?? {}), role: 'character_reference', characterName: name.slice(0, 60), characterIdentity: identity.trim().slice(0, 600) || null }
    const { error: e } = await supabase.from('assets').update({ provenance }).eq('id', a.id)
    if (e) { setError(e.message); return }
    setCharName(''); setNotice(`«${name}» guardado como personaje: ya puedes usarlo como referencia en otras escenas.`)
    setCharacters(list => [{ id: a.id, provenance }, ...list.filter(c => c.id !== a.id)])
    setHistory(list => list.map(x => x.id === a.id ? { ...x, provenance } : x))
  }

  function media(a: Asset | null, url: string, large: boolean) {
    const k = kindOf(a)
    if (!url) return <div className="mediaEmpty"><Icon name={modalityIcon[modality]} size={large ? 40 : 22} /></div>
    if (k === 'image') return <img src={url} alt={a ? promptOf(a).slice(0, 120) || 'Imagen generada' : 'Imagen'} />
    if (k === 'video') return <video src={url} controls={large} muted={!large} playsInline preload="metadata" />
    return large ? <div className="audioStage"><Icon name={modalityIcon[k as Modality] ?? 'music'} size={42} /><audio src={url} controls preload="metadata" /></div>
      : <div className="mediaEmpty"><Icon name={modalityIcon[k as Modality] ?? 'music'} size={22} /></div>
  }

  const ready = Boolean(model?.ready && projectId && prompt.trim())

  return (
    <StudioShell title="Estudio de creación" eyebrow="PRODUCCIÓN" actions={<>
      <select aria-label="Proyecto" value={projectId} onChange={e => { setProjectId(e.target.value); setSceneId(''); setSelected(null) }} style={{ width: 'auto', minWidth: 200 }}>
        {projects.length === 0 && <option value="">Sin proyectos</option>}
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {projectId && <Link className="buttonLink ghost" href={`/editor?project=${projectId}`}><Icon name="scissors" size={16} />Editor</Link>}
    </>}>
      {error && <p className="error" role="alert">{error} <button type="button" className="linkish" onClick={() => setError('')}>Cerrar</button></p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <nav className="segTabs" aria-label="Tipo de contenido">
        {(Object.keys(modalityLabels) as Modality[]).map(m => (
          <button key={m} type="button" className={m === modality ? 'seg active' : 'seg'} aria-pressed={m === modality} onClick={() => { setModality(m); setSelected(null); setTips([]); setConfirming(false) }}>
            <Icon name={modalityIcon[m]} size={16} />{modalityLabels[m]}
            <span className="segCount">{models.filter(x => x.modality === m && x.ready).length}/{models.filter(x => x.modality === m).length}</span>
          </button>
        ))}
      </nav>

      <div className="studioGrid">
        {/* ---------- Controls ---------- */}
        <section className="panel studioControls">
          <div className="rowBetween" style={{ marginTop: 0 }}>
            <h2 className="panelTitle">Modelo</h2>
            <select aria-label="Cómo elegir el modelo" value={strategy} onChange={e => { setStrategy(e.target.value as Strategy | 'manual'); setImageMode(null) }} style={{ width: 'auto', fontSize: 13, padding: '6px 10px' }}>
              <option value="manual">Elección manual</option>
              {(Object.keys(strategyLabels) as Strategy[]).map(k => <option key={k} value={k}>{strategyLabels[k]}</option>)}
            </select>
          </div>
          {modality === 'image' && (
            <fieldset className="chips"><legend>Modo de imagen</legend>
              {(Object.keys(imageModes) as ImageMode[]).map(k => (
                <button key={k} type="button" className={imageMode === k ? 'chip active' : 'chip'} aria-pressed={imageMode === k}
                  onClick={() => { setImageMode(k); setStrategy(imageModes[k].strategy); setMinQuality(imageModes[k].minQuality); setSuggestion(null) }}>{imageModes[k].label}</button>
              ))}
            </fieldset>
          )}
          {modality === 'image' && imageMode && <p className="muted small" style={{ marginTop: -6 }}>{imageModes[imageMode].hint}</p>}
          <div className="chips" style={{ alignItems: 'center' }}>
            <label className="toggle"><input type="checkbox" checked={needsCommercial} onChange={e => setNeedsCommercial(e.target.checked)} /> Voy a publicarlo con fines comerciales</label>
            {(modality === 'image' || modality === 'video') && (
              <label htmlFor="studio-minres" className="inline">Resolución mínima
                <select id="studio-minres" value={minRes} onChange={e => setMinRes(Number(e.target.value))}>
                  <option value={0}>Cualquiera</option><option value={720}>720 px</option><option value={1080}>1080 px</option><option value={2000}>2K o más</option>
                </select>
              </label>
            )}
          </div>
          {strategy !== 'manual' && strategy !== 'best_quality' && (
            <label htmlFor="studio-minq" className="inline">Calidad necesaria
              <select id="studio-minq" value={minQuality} onChange={e => setMinQuality(Number(e.target.value))}>
                {qualityLevels.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </label>
          )}
          {strategy !== 'manual' && <p className="muted small" style={{ marginTop: -6 }}>{ranked.find(r => r.eligible) ? `Elegido: ${ranked.find(r => r.eligible)!.model.label}. Generar seguirá pidiendo tu confirmación.` : 'Ninguna opción cumple esta regla ahora mismo (mira los motivos en cada modelo).'}</p>}
          {balance && ['voice', 'music', 'sfx', 'ambient'].includes(modality) && <p className="pill info" style={{ alignSelf: 'flex-start' }}>ElevenLabs: {balance.remaining.toLocaleString()} de {balance.limit.toLocaleString()} créditos disponibles{balance.resetsAt ? ` · se renuevan el ${new Date(balance.resetsAt).toLocaleDateString()}` : ''}</p>}
          <div className="modelList" role="radiogroup" aria-label="Modelo">
            {orderedModels.map(m => (
              <button key={m.id} type="button" role="radio" aria-checked={m.id === modelId} className={`modelCard${m.id === modelId ? ' active' : ''}${m.ready ? '' : ' off'}`} onClick={() => { setModelId(m.id); setStrategy('manual') }}>
                <span className="modelTop"><b>{m.label}</b><span className={m.ready && !m.creditsExhausted ? 'pill ok' : 'pill'}>{!m.ready ? 'Sin clave' : m.creditsExhausted ? 'Sin créditos' : 'Listo'}</span></span>
                <span className="modelBadges"><span className={`tierBadge tier-${m.tier}`}>{tierLabels[m.tier]}</span><span className="quality" aria-label={`Calidad ${m.quality} de 5`}>{'★'.repeat(m.quality)}{'☆'.repeat(5 - m.quality)}</span><span className="muted small">{m.speed === 'fast' ? 'Rápido' : m.speed === 'medium' ? 'Medio' : 'Lento'}</span></span>
                <span className="modelBadges">
                  <span className={m.evidence === 'unverified' ? 'pill warn' : m.evidence === 'tested' ? 'pill ok' : 'pill'} title={m.evidenceNote ?? ''}>{evidenceLabel[m.evidence]}</span>
                  <span className={m.rights === 'non_commercial' ? 'pill warn' : 'pill'} title={m.rightsNote ?? ''}>{rightsLabel[m.rights]}</span>
                  {m.maxResolution && <span className="pill">{m.maxResolution}</span>}
                  {m.references && <span className="pill" title={m.references.note ?? ''}>Referencias ×{m.references.max}</span>}
                </span>
                {m.allowance && <span className={m.creditsExhausted ? 'modelMissing' : 'modelStrength'} title={m.allowance.note}>
                  Crédito {m.allowance.kind === 'daily' ? 'diario' : m.allowance.kind === 'monthly' ? 'mensual' : 'promocional'}: {m.allowance.label ?? `${m.allowance.amount} ${m.allowance.unit}`}
                  {m.allowance.unitsPerGeneration ? ` · ≈ ${Math.round(m.allowance.unitsPerGeneration)} ${m.allowance.unit} por generación` : ''}
                </span>}
                {m.evidence === 'unverified' && <span className="modelMissing">Integración sin verificar con el proveedor real: solo se usa si la eliges tú; si falla no se guarda nada.</span>}
                <span className="modelStrength">{m.strength}</span>
                <span className="modelPrice">{m.priceConfirmed ? '' : 'Precio de referencia · '}{m.price}</span>
                {m.limits && <span className="modelStrength">Límites: {m.limits}</span>}
                {!m.ready && <span className="modelMissing">Falta en Vercel: {m.missing.join(', ')}</span>}
                {strategy !== 'manual' && m.ready && reasonsFor(m.id).length > 0 && <span className="modelMissing">{reasonsFor(m.id).join(' · ')}</span>}
              </button>
            ))}
            {!modalityModels.length && <p className="muted">Cargando modelos…</p>}
          </div>

          {scenes.length > 0 && (
            <div className="sceneLink">
              <label htmlFor="studio-scene">Escena (opcional)
                <select id="studio-scene" value={sceneId} onChange={e => setSceneId(e.target.value)}>
                  <option value="">Sin escena</option>
                  {boards.map(b => <optgroup key={b.id} label={b.title}>
                    {scenes.filter(s => s.storyboard_id === b.id).map(s => <option key={s.id} value={s.id}>Escena {s.position}{typeof s.metadata?.heading === 'string' ? ` · ${s.metadata.heading}` : ''}</option>)}
                  </optgroup>)}
                </select>
              </label>
              <button type="button" className="ghost small" disabled={!scene} onClick={fillFromScene}>Usar texto de la escena</button>
            </div>
          )}

          <label htmlFor="studio-prompt">{promptLabel[modality]}
            <textarea id="studio-prompt" rows={modality === 'voice' ? 7 : 5} value={prompt} onChange={e => { setPrompt(e.target.value); setConfirming(false) }} placeholder={promptHint[modality]} maxLength={4000} />
          </label>
          <div className="rowBetween">
            <span className="muted small">{prompt.length}/4000</span>
            <button type="button" className="ghost small" disabled={!textReady || enhancing || !prompt.trim() || (modality === 'voice' && model?.id !== 'openai:gpt-4o-mini-tts' && model?.id !== 'gemini:gemini-3.8-flash-tts')} onClick={() => void enhance()} title={textReady ? 'Reescribe tu idea con ChatGPT para este modelo' : 'Configura OPENAI_API_KEY para usar ChatGPT'}>
              <Icon name="bolt" size={14} />{enhancing ? 'Mejorando…' : modality === 'voice' ? 'Dirigir la voz con ChatGPT' : 'Mejorar con ChatGPT'}
            </button>
          </div>
          {tips.length > 0 && <ul className="tips">{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}

          {/* Options that apply to the selected model only */}
          {model?.formats && (
            <fieldset className="chips"><legend>Formato</legend>
              {model.formats.map(f => <button key={f} type="button" className={f === format ? 'chip active' : 'chip'} aria-pressed={f === format} onClick={() => setFormat(f)}>{f === '16:9' ? '16:9 YouTube' : f === '9:16' ? '9:16 Shorts' : '1:1'}</button>)}
            </fieldset>
          )}
          {model?.durations && (
            <fieldset className="chips"><legend>Duración</legend>
              {model.durations.map(d => <button key={d} type="button" className={d === duration ? 'chip active' : 'chip'} aria-pressed={d === duration} onClick={() => setDuration(d)}>{d} s</button>)}
            </fieldset>
          )}
          {modality === 'image' && model && model.id !== 'fal:fal-ai/ideogram/v3' && (
            <label htmlFor="studio-preset">Estilo
              <select id="studio-preset" value={preset} onChange={e => setPreset(e.target.value)}>
                {(['photo', 'cinema', 'art'] as PresetGroup[]).map(g => (
                  <optgroup key={g} label={presetGroupLabels[g]}>
                    {Object.entries(imagePresets).filter(([, p]) => p.group === g).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  </optgroup>
                ))}
                <option value="none">Sin estilo (prompt tal cual)</option>
              </select>
            </label>
          )}
          {modality === 'image' && model?.references && (
            <div className="refBox" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>Referencias de personaje <span className="muted small">(hasta {model.references.max}{model.references.note ? ` · ${model.references.note}` : ''})</span></b>
              <p className="muted small" style={{ margin: 0 }}>Elige imágenes del proyecto para mantener la misma cara, pelo y ropa entre escenas. Marca una imagen como personaje desde la vista previa para tenerla siempre a mano.</p>
              <div className="thumbGrid">
                {[...characters, ...history.filter(a => !characters.some(c => c.id === a.id))].slice(0, 24).map(a => {
                  const on = refIds.includes(a.id)
                  const isChar = a.provenance?.role === 'character_reference'
                  return <button key={a.id} type="button" className={on ? 'thumb active' : 'thumb'} aria-pressed={on} onClick={() => toggleRef(a)} title={isChar ? `Personaje: ${String(a.provenance?.characterName ?? '')}` : promptOf(a as Asset).slice(0, 160)}>
                    {urls[a.id] ? <img src={urls[a.id]} alt="" /> : <div className="mediaEmpty"><Icon name="image" size={22} /></div>}
                    <span>{on ? '✓ ' : ''}{isChar ? String(a.provenance?.characterName ?? 'Personaje') : 'Imagen'}</span>
                  </button>
                })}
              </div>
              {refIds.length > 0 && <p className="muted small" style={{ margin: 0 }}>{refIds.length} referencia(s) seleccionada(s){refIds.length > model.references.max ? ' — sobran' : ''}.</p>}
              <label htmlFor="studio-identity">Descripción fija del personaje (se repite en cada escena)
                <textarea id="studio-identity" rows={2} value={identity} onChange={e => setIdentity(e.target.value)} maxLength={600} placeholder="Ej.: Marta, 40 años, pelo corto canoso, parka verde desgastada, cicatriz en la ceja izquierda" />
              </label>
            </div>
          )}
          {model && model.maxVariants > 1 && (
            <fieldset className="chips"><legend>Variantes</legend>
              {[1, 2, 3, 4].filter(v => v <= model.maxVariants).map(v => <button key={v} type="button" className={v === variants ? 'chip active' : 'chip'} aria-pressed={v === variants} onClick={() => setVariants(v)}>{v}</button>)}
            </fieldset>
          )}
          {model?.id.startsWith('openai:gpt-image') && (
            <fieldset className="chips"><legend>Calidad</legend>
              <button type="button" className={quality === 'medium' ? 'chip active' : 'chip'} onClick={() => setQuality('medium')}>Media</button>
              <button type="button" className={quality === 'high' ? 'chip active' : 'chip'} onClick={() => setQuality('high')}>Alta</button>
            </fieldset>
          )}
          {model?.id === 'fal:fal-ai/veo3/fast' && <label className="toggle"><input type="checkbox" checked={audioOn} onChange={e => setAudioOn(e.target.checked)} /> Generar sonido del plano</label>}
          {model?.id === 'elevenlabs:music_v1' && <label className="toggle"><input type="checkbox" checked={instrumental} onChange={e => setInstrumental(e.target.checked)} /> Solo instrumental (recomendado bajo narración)</label>}
          {model?.negative && (
            <label htmlFor="studio-negative">Evitar (opcional)<input id="studio-negative" value={negative} onChange={e => setNegative(e.target.value)} placeholder="texto, logos, deformaciones, desenfoque" maxLength={1000} /></label>
          )}

          {model?.id === 'elevenlabs:eleven_multilingual_v2' && <>
            <label htmlFor="studio-voice">Voz de tu cuenta de ElevenLabs
              <select id="studio-voice" value={voice} onChange={e => setVoice(e.target.value)}>
                {elVoices.length === 0 && <option value="">Voz por defecto (ELEVENLABS_VOICE_ID)</option>}
                {elVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}{v.labels?.accent ? ` · ${v.labels.accent}` : ''}{v.labels?.gender ? ` · ${v.labels.gender}` : ''}</option>)}
              </select>
            </label>
            <div className="sliders">
              <label htmlFor="sl-stab">Estabilidad {stability.toFixed(2)}<input id="sl-stab" type="range" min={0} max={1} step={0.05} value={stability} onChange={e => setStability(Number(e.target.value))} /></label>
              <label htmlFor="sl-style">Expresividad {style.toFixed(2)}<input id="sl-style" type="range" min={0} max={1} step={0.05} value={style} onChange={e => setStyle(Number(e.target.value))} /></label>
              <label htmlFor="sl-speed">Velocidad {speed.toFixed(2)}×<input id="sl-speed" type="range" min={0.7} max={1.2} step={0.05} value={speed} onChange={e => setSpeed(Number(e.target.value))} /></label>
            </div>
          </>}
          {model?.id === 'gemini:gemini-3.8-flash-tts' && <>
            <label htmlFor="studio-gvoice">Voz de Gemini
              <select id="studio-gvoice" value={voice} onChange={e => setVoice(e.target.value)}>
                {geminiVoices.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label htmlFor="studio-gstyle">Estilo de la locución<textarea id="studio-gstyle" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={500} /></label>
          </>}
          {model?.id === 'topmediai:text2speech' && <>
            <label htmlFor="studio-tspk">ID del speaker de TopMediai<input id="studio-tspk" value={voice} onChange={e => setVoice(e.target.value)} placeholder="Identificador de la voz (TOPMEDIAI_SPEAKER si lo dejas vacío)" maxLength={80} /></label>
            <label htmlFor="studio-temo">Emoción (opcional)<input id="studio-temo" value={emotion} onChange={e => setEmotion(e.target.value)} placeholder="Neutral, Cheerful, Sad…" maxLength={40} /></label>
            <p className="muted small">La API de TopMediai se contrata aparte de tus suscripciones (5.000 caracteres gratis). Máximo 500 caracteres por petición. Si ya generaste el audio en su web, usa «Importar desde TopMediai» en Música y sonidos.</p>
          </>}
          {model?.id === 'cloudflare:@cf/myshell-ai/melotts' && (
            <fieldset className="chips"><legend>Idioma</legend>
              {[['es', 'Español'], ['en', 'Inglés'], ['fr', 'Francés']].map(([v, l]) => <button key={v} type="button" className={v === language ? 'chip active' : 'chip'} aria-pressed={v === language} onClick={() => setLanguage(v)}>{l}</button>)}
            </fieldset>
          )}
          {model?.id === 'openai:gpt-4o-mini-tts' && <>
            <fieldset className="chips"><legend>Voz</legend>
              {openAiVoices.map(v => <button key={v} type="button" className={v === voice ? 'chip active' : 'chip'} aria-pressed={v === voice} onClick={() => setVoice(v)}>{v}</button>)}
            </fieldset>
            <label htmlFor="studio-instr">Dirección de la locución<textarea id="studio-instr" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={1000} /></label>
          </>}

          {suggestion && (
            <div className="confirmBox" role="status" aria-label="Alternativas">
              <p><b>{suggestion.message}</b></p>
              <div className="pageActions">
                {suggestion.free.map(f => <button key={f.id} type="button" className="ghost small" onClick={() => { setModelId(f.id); setStrategy('manual'); setImageMode(null); setSuggestion(null) }}>Usar {f.label} (gratis)</button>)}
              </div>
              {suggestion.paid.length > 0 && <p className="muted small">De pago (solo con tu autorización y confirmando el coste): {suggestion.paid.map(x => `${x.label} ≈ ${usd(x.estimateUsd)}`).join(' · ')}.</p>}
              <button type="button" className="linkish" onClick={() => setSuggestion(null)}>Cerrar</button>
            </div>
          )}
          <div className="generateBar">
          {!confirming ? (
            <button type="button" className="generateBtn" disabled={!ready} onClick={() => setConfirming(true)}>
              <Icon name="bolt" size={16} />Generar {modalityLabels[modality].toLowerCase()} · {model && (model.tier === 'free' || model.tier === 'local') ? 'gratis' : estimate > 0 ? usd(estimate) : 'con créditos'}
            </button>
          ) : (
            <div className="confirmBox" role="alertdialog" aria-label="Confirmar gasto">
              <p><b>¿Generar con {model?.label}?</b> {model && (model.tier === 'free' || model.tier === 'local') ? 'Usa el cupo gratuito del proveedor; no tiene coste.' : model && (model.tier === 'credits' || model.tier === 'freemium') ? 'Consume créditos o el nivel gratuito de tu cuenta del proveedor.' : `Se cobrará en tu cuenta del proveedor (${usd(estimate)}, precio ${model?.priceConfirmed ? 'de lista' : 'de referencia'} estimado).`} Se guardará en la Biblioteca del proyecto.{model && model.evidence === 'unverified' ? ' Atención: esta integración no se ha comprobado con el proveedor real; si falla no se guarda nada.' : ''}{model && needsCommercial && (model.rights === 'plan_dependent' || model.rights === 'check_terms') ? ` Derechos comerciales: ${model.rightsNote ?? 'revisa las condiciones del proveedor.'}` : ''}</p>
              <div className="pageActions"><button type="button" onClick={() => void generate()}>Confirmar y generar</button><button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancelar</button></div>
            </div>
          )}
          </div>
          {!projectId && <p className="muted small">Crea o elige un proyecto para guardar lo que generes.</p>}
          {model && !model.ready && <p className="muted small">Este modelo necesita {model.missing.join(', ')} en las variables de entorno de Vercel.</p>}
        </section>

        {/* ---------- Preview ---------- */}
        <section className="panel studioStage">
          <div className="stage" ref={stageRef}>{media(selectedAsset, selectedUrl, true)}</div>
          {selectedAsset ? (
            <div className="stageMeta">
              <div>
                <b>{modelById(String(selectedAsset.provenance?.catalogModel ?? ''))?.label ?? String(selectedAsset.source_provider ?? selectedAsset.asset_type)}</b>
                <span className="muted small"> · {new Date(selectedAsset.created_at).toLocaleString()}{typeof selectedAsset.provenance?.sceneId === 'string' ? ` · escena ${scenes.find(s => s.id === selectedAsset.provenance?.sceneId)?.position ?? ''}` : ''}</span>
                {promptOf(selectedAsset) && <p className="muted small clamp">{promptOf(selectedAsset)}</p>}
              </div>
              <div className="pageActions">
                {selectedUrl && <a className="buttonLink ghost small" href={selectedUrl} target="_blank" rel="noopener noreferrer"><Icon name="upload" size={14} />Abrir</a>}
                {promptOf(selectedAsset) && <button type="button" className="ghost small" onClick={() => { setPrompt(promptOf(selectedAsset)); setNotice('Prompt copiado al formulario.') }}><Icon name="copy" size={14} />Reusar prompt</button>}
                <Link className="buttonLink ghost small" href={`/editor?project=${projectId}`}><Icon name="scissors" size={14} />Usar en el editor</Link>
              </div>
              {kindOf(selectedAsset) === 'image' && (
                <div className="pageActions" style={{ marginTop: 8 }}>
                  <input aria-label="Nombre del personaje" value={charName} onChange={e => setCharName(e.target.value)} placeholder={selectedAsset.provenance?.role === 'character_reference' ? `Personaje: ${String(selectedAsset.provenance?.characterName ?? '')}` : 'Nombre del personaje'} maxLength={60} style={{ maxWidth: 220 }} />
                  <button type="button" className="ghost small" onClick={() => void saveCharacter(selectedAsset)}>Guardar como personaje</button>
                </div>
              )}
            </div>
          ) : <p className="muted" style={{ textAlign: 'center' }}>Lo que generes aparecerá aquí para revisarlo antes de usarlo.</p>}

          {activeJobs.length > 0 && (
            <div className="jobList" aria-live="polite">
              {activeJobs.map(j => (
                <div key={j.key} className={`job job-${j.state}`}>
                  <span className="jobDot" />
                  <div><b>{j.label}</b><span>{stateLabel[j.state]}{j.state === 'queued' && j.position != null ? ` · posición ${j.position + 1}` : ''} · {since(j.startedAt, now)}{j.estimateUsd > 0 ? ` · ${usd(j.estimateUsd)}` : ''}</span>{j.error && <span className="jobErr">{j.error}</span>}</div>
                  {j.state === 'done' && j.assetIds?.[0] && <button type="button" className="ghost small" onClick={() => setSelected(j.assetIds![0])}>Ver</button>}
                  {(j.state === 'done' || j.state === 'failed') && <button type="button" className="iconButton" aria-label="Quitar de la lista" onClick={() => setJobs(list => list.filter(x => x.key !== j.key))}><Icon name="trash" size={14} /></button>}
                </div>
              ))}
            </div>
          )}

          <div className="cardHead" style={{ margin: '18px 0 10px' }}><h3>{modalityLabels[modality]} del proyecto</h3><Link href="/library">Biblioteca <Icon name="arrow" size={14} /></Link></div>
          {history.length === 0 ? <p className="emptyState">Aún no hay {modalityLabels[modality].toLowerCase()} en este proyecto.</p> : (
            <div className="thumbGrid">
              {history.map(a => (
                <button key={a.id} type="button" className={a.id === selected ? 'thumb active' : 'thumb'} onClick={() => setSelected(a.id)} title={promptOf(a).slice(0, 200)}>
                  {media(a, urls[a.id] ?? '', false)}
                  <span>{new Date(a.created_at).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}

          {modality === 'video' && (
            <details className="freeAlt">
              <summary><Icon name="video" size={14} /> Importar vídeos creados en Google Flow</summary>
              <FlowImport projectId={projectId} sceneId={sceneId || null} onImported={() => { void loadHistory(); setNotice('Vídeos importados en la Biblioteca del proyecto.') }} />
            </details>
          )}

          {modality !== 'voice' && (
            <details className="freeAlt">
              <summary><Icon name="search" size={14} /> Alternativas gratuitas: buscar en bancos con licencia</summary>
              <StockBrowser kind={modality === 'image' ? 'image' : modality === 'video' ? 'video' : 'audio'} projectId={projectId} sceneId={sceneId || null}
                defaultQuery="" importAs={modality === 'music' ? 'music' : 'sfx'} onImported={id => { void loadHistory(); setSelected(id); setNotice('Importado con su licencia en la Biblioteca.') }} />
            </details>
          )}
        </section>
      </div>
    </StudioShell>
  )
}
