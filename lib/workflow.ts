import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Production workflow per project: idea → guion → storyboard → materiales → montaje → miniatura → publicación → analítica.
 * Every step's state is DERIVED from the real rows of the project (nothing is marked done by hand), except the owner's review
 * of materials and montage, which is an explicit approval stored with the date. Settings (cost limit, approvals) and a short
 * history of state changes live in ONE connector_configs row per owner (provider 'cerebro-workflows', capability 'settings'):
 * no migration, owner RLS.
 */
export type StepId = 'idea' | 'script' | 'storyboard' | 'materials' | 'montage' | 'thumbnail' | 'publication' | 'analytics'
export type StepState = 'pending' | 'in_progress' | 'needs_approval' | 'blocked' | 'failed' | 'done'
export const stepStateLabels: Record<StepState, string> = {
  pending: 'Pendiente', in_progress: 'En curso', needs_approval: 'Espera tu aprobación', blocked: 'Bloqueado', failed: 'Error', done: 'Hecho',
}
export const STEPS: Array<{ id: StepId; label: string; href: (projectId: string) => string }> = [
  { id: 'idea', label: 'Idea', href: () => '/opportunities' },
  { id: 'script', label: 'Guion', href: p => `/scripts?project=${p}` },
  { id: 'storyboard', label: 'Storyboard', href: p => `/create?project=${p}` },
  { id: 'materials', label: 'Materiales', href: p => `/studio?project=${p}` },
  { id: 'montage', label: 'Montaje', href: p => `/editor?project=${p}` },
  { id: 'thumbnail', label: 'Miniatura', href: p => `/thumbnails?project=${p}` },
  { id: 'publication', label: 'Publicación', href: () => '/youtube' },
  { id: 'analytics', label: 'Analítica', href: () => '/analytics' },
]

export type WfProject = { id: string; name: string; description: string | null; updated_at?: string | null }
export type WfScript = { project_id: string; status: string; source_opportunity_id: string | null; idea: string | null }
export type WfStoryboard = { id: string; project_id: string }
export type WfScene = { storyboard_id: string }
export type WfAsset = { id: string; project_id: string | null; asset_type: string; license_status: string | null; provenance: Record<string, unknown> | null }
export type WfRender = { project_id: string; status: string; error?: string | null }
export type WfPublication = { project_id: string | null; platform: string; status: string }
export type WfData = { scripts: WfScript[]; storyboards: WfStoryboard[]; scenes: WfScene[]; assets: WfAsset[]; renders: WfRender[]; publications: WfPublication[] }

export type ProjectSettings = { costLimitUsd: number | null; approvals: Partial<Record<'materials' | 'montage', string>> }
export type HistoryEntry = { at: string; projectId: string; step: StepId; from: StepState | null; to: StepState }
export type WorkflowStore = { projects: Record<string, ProjectSettings>; history: HistoryEntry[]; lastStates: Record<string, Partial<Record<StepId, StepState>>> }
export const EMPTY_STORE: WorkflowStore = { projects: {}, history: [], lastStates: {} }
const MAX_HISTORY = 300

export type Step = { id: StepId; label: string; state: StepState; detail: string; href: string; action?: string }
export type ProjectWorkflow = { project: WfProject; steps: Step[]; done: number; next: Step | null; costUsd: number; unreportedCosts: number; costLimitUsd: number | null; overBudget: boolean; warnings: string[] }

const isRender = (a: WfAsset) => a.asset_type === 'video' && (a.provenance?.purpose === 'render' || a.provenance?.origin === 'render' || typeof a.provenance?.composedFrom === 'string' || Array.isArray(a.provenance?.inputs))
const MATERIAL_TYPES = new Set(['image', 'video', 'voice', 'music', 'sfx'])

/** Estimated generation cost of a project: provenance.cost.amount (USD) of its assets; unreported costs are counted apart, never guessed. */
export function projectCost(assets: WfAsset[]) {
  let usd = 0, unreported = 0
  for (const a of assets) {
    const c = a.provenance?.cost as { amount?: unknown; currency?: unknown; reported?: unknown } | undefined
    if (c && typeof c.amount === 'number' && (c.currency === 'USD' || c.currency == null)) usd += c.amount
    else if (a.provenance?.costTier !== 'free' && a.license_status === 'generated') unreported++
  }
  return { usd: Math.round(usd * 10000) / 10000, unreported }
}

export function projectWorkflow(project: WfProject, data: WfData, settings: ProjectSettings = { costLimitUsd: null, approvals: {} }): ProjectWorkflow {
  const pid = project.id
  const scripts = data.scripts.filter(s => s.project_id === pid && s.status !== 'archived')
  const boards = new Set(data.storyboards.filter(b => b.project_id === pid).map(b => b.id))
  const scenes = data.scenes.filter(s => boards.has(s.storyboard_id)).length
  const assets = data.assets.filter(a => a.project_id === pid)
  const materials = assets.filter(a => MATERIAL_TYPES.has(a.asset_type) && !isRender(a))
  const licenseIssues = materials.filter(a => a.license_status === 'restricted' || a.license_status === 'unknown').length
  const renders = data.renders.filter(r => r.project_id === pid)
  const renderAssets = assets.filter(isRender)
  const thumbs = assets.filter(a => a.asset_type === 'thumbnail')
  const pubs = data.publications.filter(p => p.project_id === pid && p.status !== 'cancelled')
  const cost = projectCost(assets)
  const href = (id: StepId) => STEPS.find(s => s.id === id)!.href(pid)
  const label = (id: StepId) => STEPS.find(s => s.id === id)!.label
  const step = (id: StepId, state: StepState, detail: string, action?: string): Step => ({ id, label: label(id), state, detail, href: href(id), action })

  const steps: Step[] = []
  const hasIdea = Boolean(project.description?.trim()) || scripts.some(s => s.source_opportunity_id || s.idea?.trim())
  steps.push(hasIdea ? step('idea', 'done', scripts.some(s => s.source_opportunity_id) ? 'Viene de una oportunidad investigada.' : 'Idea descrita en el proyecto.') : step('idea', 'pending', 'Describe la idea o crea el guion desde una oportunidad.', 'Elegir oportunidad'))

  const approvedScript = scripts.some(s => s.status === 'approved')
  steps.push(approvedScript ? step('script', 'done', 'Guion aprobado.')
    : scripts.some(s => s.status === 'review') ? step('script', 'needs_approval', 'Guion en revisión: apruébalo para seguir.', 'Revisar guion')
    : scripts.length ? step('script', 'in_progress', `${scripts.length} versión${scripts.length === 1 ? '' : 'es'} en borrador.`, 'Seguir con el guion')
    : step('script', 'pending', 'Sin guion.', 'Escribir guion'))

  steps.push(scenes ? step('storyboard', 'done', `${scenes} escena${scenes === 1 ? '' : 's'}.`) : boards.size ? step('storyboard', 'in_progress', 'Storyboard sin escenas.', 'Añadir escenas') : step('storyboard', 'pending', approvedScript ? 'Convierte el guion en escenas.' : 'Llega después del guion.', 'Crear storyboard'))

  const overBudget = settings.costLimitUsd !== null && cost.usd > settings.costLimitUsd
  steps.push(!materials.length ? step('materials', 'pending', 'Sin imágenes, vídeos, voces ni música.', 'Crear materiales')
    : licenseIssues ? step('materials', 'blocked', `${licenseIssues} archivo${licenseIssues === 1 ? '' : 's'} con licencia por revisar.`, 'Revisar licencias')
    : settings.approvals.materials ? step('materials', 'done', `${materials.length} archivos revisados el ${new Date(settings.approvals.materials).toLocaleDateString()}.`)
    : step('materials', 'needs_approval', `${materials.length} archivos: revísalos y da el visto bueno.`, 'Dar visto bueno'))

  const failedRender = renders.find(r => r.status === 'failed')
  const rendering = renders.some(r => r.status === 'rendering' || r.status === 'queued')
  steps.push(renderAssets.length ? (settings.approvals.montage ? step('montage', 'done', `Montaje revisado el ${new Date(settings.approvals.montage).toLocaleDateString()}.`) : step('montage', 'needs_approval', `${renderAssets.length} montaje${renderAssets.length === 1 ? '' : 's'} renderizado${renderAssets.length === 1 ? '' : 's'}: revísalo y da el visto bueno.`, 'Dar visto bueno'))
    : rendering ? step('montage', 'in_progress', 'Render en curso.')
    : failedRender ? step('montage', 'failed', `El último render falló${failedRender.error ? `: ${failedRender.error.slice(0, 120)}` : '.'}`, 'Reintentar render')
    : renders.length ? step('montage', 'in_progress', 'Montaje en borrador.', 'Seguir montando')
    : step('montage', 'pending', 'Sin montaje.', 'Montar vídeo'))

  steps.push(thumbs.length ? step('thumbnail', 'done', `${thumbs.length} miniatura${thumbs.length === 1 ? '' : 's'}.`) : step('thumbnail', 'pending', 'Sin miniatura.', 'Crear miniatura'))

  const published = pubs.filter(p => p.status === 'published')
  const failedPub = pubs.find(p => p.status === 'failed')
  steps.push(published.length ? step('publication', 'done', `Publicado en ${[...new Set(published.map(p => p.platform))].join(', ')}.`)
    : failedPub ? step('publication', 'failed', `La publicación en ${failedPub.platform} falló.`, 'Revisar y reintentar')
    : pubs.some(p => p.status === 'approved' || p.status === 'publishing') ? step('publication', 'in_progress', 'Aprobada; pendiente de subir.')
    : pubs.some(p => p.status === 'awaiting_approval' || p.status === 'draft') ? step('publication', 'needs_approval', 'Borrador de publicación: revísalo y apruébalo.', 'Aprobar publicación')
    : step('publication', 'pending', 'Sin borrador de publicación.', 'Preparar publicación'))

  steps.push(published.length ? step('analytics', 'in_progress', 'Publicado: importa las métricas del canal en Analytics.', 'Ver métricas') : step('analytics', 'pending', 'Disponible tras publicar.'))

  const warnings: string[] = []
  if (overBudget) warnings.push(`Coste estimado ${cost.usd.toFixed(2)} USD por encima del límite de ${settings.costLimitUsd!.toFixed(2)} USD: no generes más hasta revisarlo.`)
  if (cost.unreported) warnings.push(`${cost.unreported} archivo${cost.unreported === 1 ? '' : 's'} generado${cost.unreported === 1 ? '' : 's'} sin coste informado por el proveedor (no se suma).`)
  const order: StepState[] = ['failed', 'blocked', 'needs_approval', 'in_progress', 'pending']
  const next = order.map(s => steps.find(x => x.state === s)).find(Boolean) ?? null
  return { project, steps, done: steps.filter(s => s.state === 'done').length, next, costUsd: cost.usd, unreportedCosts: cost.unreported, costLimitUsd: settings.costLimitUsd, overBudget, warnings }
}

/** Appends a history entry for every step whose state changed since the stored snapshot (first sighting records nothing). */
export function recordTransitions(store: WorkflowStore, flows: ProjectWorkflow[], now = new Date().toISOString()): { store: WorkflowStore; changed: boolean } {
  const history = [...store.history]
  const lastStates = { ...store.lastStates }
  let changed = false
  for (const f of flows) {
    const prev = lastStates[f.project.id]
    const cur: Partial<Record<StepId, StepState>> = Object.fromEntries(f.steps.map(s => [s.id, s.state]))
    if (prev) for (const s of f.steps) if (prev[s.id] !== s.state) history.push({ at: now, projectId: f.project.id, step: s.id, from: prev[s.id] ?? null, to: s.state })
    if (!prev || f.steps.some(s => prev[s.id] !== s.state)) { lastStates[f.project.id] = cur; changed = true }
  }
  return { store: { ...store, history: history.slice(-MAX_HISTORY), lastStates }, changed }
}

const STATES = new Set(Object.keys(stepStateLabels))
const STEP_IDS = new Set(STEPS.map(s => s.id))
export function parseStore(v: unknown): WorkflowStore {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const projects: Record<string, ProjectSettings> = {}
  if (o.projects && typeof o.projects === 'object') for (const [id, raw] of Object.entries(o.projects as Record<string, unknown>)) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const limit = typeof r.costLimitUsd === 'number' && Number.isFinite(r.costLimitUsd) && r.costLimitUsd >= 0 ? r.costLimitUsd : null
    const ap = (r.approvals && typeof r.approvals === 'object' ? r.approvals : {}) as Record<string, unknown>
    const approvals: ProjectSettings['approvals'] = {}
    for (const k of ['materials', 'montage'] as const) if (typeof ap[k] === 'string' && Number.isFinite(Date.parse(ap[k] as string))) approvals[k] = ap[k] as string
    projects[id] = { costLimitUsd: limit, approvals }
  }
  const history = (Array.isArray(o.history) ? o.history : []).filter((h): h is HistoryEntry => {
    const x = h as HistoryEntry
    return Boolean(x) && typeof x.at === 'string' && typeof x.projectId === 'string' && STEP_IDS.has(x.step) && STATES.has(x.to) && (x.from === null || STATES.has(x.from))
  }).slice(-MAX_HISTORY)
  const lastStates: WorkflowStore['lastStates'] = {}
  if (o.lastStates && typeof o.lastStates === 'object') for (const [id, raw] of Object.entries(o.lastStates as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    lastStates[id] = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k, v]) => STEP_IDS.has(k as StepId) && STATES.has(v as string))) as Partial<Record<StepId, StepState>>
  }
  return { projects, history, lastStates }
}

export function setApproval(store: WorkflowStore, projectId: string, step: 'materials' | 'montage', at: string | null): WorkflowStore {
  const cur = store.projects[projectId] ?? { costLimitUsd: null, approvals: {} }
  const approvals = { ...cur.approvals }
  if (at) approvals[step] = at; else delete approvals[step]
  return { ...store, projects: { ...store.projects, [projectId]: { ...cur, approvals } } }
}
export function setCostLimit(store: WorkflowStore, projectId: string, usd: number | null): WorkflowStore {
  const cur = store.projects[projectId] ?? { costLimitUsd: null, approvals: {} }
  const limit = usd === null || !Number.isFinite(usd) || usd < 0 ? null : Math.round(usd * 100) / 100
  return { ...store, projects: { ...store.projects, [projectId]: { ...cur, costLimitUsd: limit } } }
}

const KEY = { provider: 'cerebro-workflows', capability: 'settings' } as const
export async function loadStore(db: SupabaseClient): Promise<WorkflowStore> {
  const { data, error } = await db.from('connector_configs').select('config').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  if (error) throw new Error(error.message)
  return parseStore((data as { config?: unknown } | null)?.config)
}
export async function saveStore(db: SupabaseClient, store: WorkflowStore) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const { error } = await db.from('connector_configs').upsert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config: parseStore(store), updated_at: new Date().toISOString() }, { onConflict: 'owner_id,provider,capability' })
  if (error) throw new Error(error.message)
}
