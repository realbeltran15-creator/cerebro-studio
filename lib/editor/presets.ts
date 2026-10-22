/**
 * The owner's saved presets, reusable in every montage: favourite transitions and animations (keyframes/camera moves).
 * Stored in connector_configs (provider cerebro-editor, capability edit_presets; owner RLS): no migration.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { TRANSITIONS, type CameraMove, type KeyEasing, type Transition, type TransitionOptions } from './composition'

export type TransitionPreset = { id: string; name: string; transition: Transition; ms: number; opts: TransitionOptions }
/** An animation with times as fractions of the clip (0..1), so it fits any length. `target`: a main-track picture or a layer. */
export type AnimKey = { at: number; easing?: KeyEasing } & Partial<Record<'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'zoom' | 'focusX' | 'focusY', number>>
export type AnimationPreset = { id: string; name: string; target: 'clip' | 'layer'; keyframes: AnimKey[]; camera: CameraMove | null }
/** Ready-made smooth movements for still photos (lo-fi videos) and for layers. */
export const BUILTIN_ANIMATIONS: AnimationPreset[] = [
  { id: 'b-breathe', name: 'Respiración lenta (lo-fi)', target: 'clip', camera: null, keyframes: [{ at: 0, zoom: 1 }, { at: 0.5, zoom: 1.06 }, { at: 1, zoom: 1 }] },
  { id: 'b-push', name: 'Acercamiento suave', target: 'clip', camera: null, keyframes: [{ at: 0, zoom: 1 }, { at: 1, zoom: 1.15 }] },
  { id: 'b-pull', name: 'Alejamiento suave', target: 'clip', camera: null, keyframes: [{ at: 0, zoom: 1.15 }, { at: 1, zoom: 1 }] },
  { id: 'b-drift', name: 'Deriva lateral', target: 'clip', camera: null, keyframes: [{ at: 0, zoom: 1.12, focusX: 0.3 }, { at: 1, zoom: 1.12, focusX: 0.7 }] },
  { id: 'b-rise', name: 'Subida lenta', target: 'clip', camera: null, keyframes: [{ at: 0, zoom: 1.12, focusY: 0.75 }, { at: 1, zoom: 1.12, focusY: 0.25 }] },
  { id: 'b-tilt', name: 'Giro leve', target: 'clip', camera: null, keyframes: [{ at: 0, zoom: 1.1, rotation: -1.5 }, { at: 1, zoom: 1.1, rotation: 1.5 }] },
  { id: 'b-in', name: 'Aparecer y desaparecer', target: 'layer', camera: null, keyframes: [{ at: 0, opacity: 0 }, { at: 0.12, opacity: 1 }, { at: 0.88, opacity: 1 }, { at: 1, opacity: 0 }] },
  { id: 'b-cross', name: 'Cruzar de izquierda a derecha', target: 'layer', camera: null, keyframes: [{ at: 0, x: 0.15 }, { at: 1, x: 0.85 }] },
  { id: 'b-spin', name: 'Girar una vuelta', target: 'layer', camera: null, keyframes: [{ at: 0, rotation: 0, easing: 'linear' }, { at: 1, rotation: 360, easing: 'linear' }] },
]
export type Presets = { transitions: TransitionPreset[]; animations: AnimationPreset[] }
export const EMPTY_PRESETS: Presets = { transitions: [], animations: [] }

const num = (v: unknown, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d }
export function parsePresets(v: unknown): Presets {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Presets>
  const transitions = (Array.isArray(o.transitions) ? o.transitions : []).flatMap(t => (t && typeof t.name === 'string' && typeof t.transition === 'string' && t.transition in TRANSITIONS
    ? [{ id: String(t.id ?? t.name).slice(0, 60), name: t.name.slice(0, 40), transition: t.transition, ms: num(t.ms, 0, 3000, 400), opts: { ...(t.opts?.direction ? { direction: t.opts.direction } : {}), ...(t.opts?.intensity !== undefined ? { intensity: num(t.opts.intensity, 0.1, 3, 1) } : {}), ...(t.opts?.easing ? { easing: t.opts.easing } : {}) } }] : [])).slice(0, 50)
  const animations = (Array.isArray(o.animations) ? o.animations : []).flatMap(a => (a && typeof a.name === 'string'
    ? [{ id: String(a.id ?? a.name).slice(0, 60), name: a.name.slice(0, 40), target: a.target === 'layer' ? 'layer' as const : 'clip' as const, keyframes: (Array.isArray(a.keyframes) ? a.keyframes : []).slice(0, 32).map(k => { const out: AnimKey = { at: num(k.at, 0, 1, 0) }; if (k.easing && ['linear', 'in', 'out', 'hold'].includes(k.easing)) out.easing = k.easing; for (const key of ['x', 'y', 'scale', 'rotation', 'opacity', 'zoom', 'focusX', 'focusY'] as const) if (k[key] !== undefined && Number.isFinite(Number(k[key]))) out[key] = Number(k[key]); return out }), camera: a.camera && typeof a.camera === 'object' ? { kind: a.camera.kind, amount: num(a.camera.amount, 0.02, 0.5, 0.12) } : null }] : [])).slice(0, 50)
  return { transitions, animations }
}

const KEY = { provider: 'cerebro-editor', capability: 'edit_presets' } as const
export async function loadPresets(db: SupabaseClient): Promise<{ presets: Presets; updatedAt: string | null }> {
  const { data, error } = await db.from('connector_configs').select('config,updated_at').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as { config?: unknown; updated_at?: string } | null
  return { presets: parsePresets(row?.config), updatedAt: row?.updated_at ?? null }
}
export async function savePresets(db: SupabaseClient, presets: Presets, prevUpdatedAt: string | null): Promise<string> {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const at = new Date().toISOString()
  if (prevUpdatedAt) {
    const { data, error } = await db.from('connector_configs').update({ config: presets, updated_at: at }).eq('provider', KEY.provider).eq('capability', KEY.capability).eq('owner_id', user.id).eq('updated_at', prevUpdatedAt).select('updated_at')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Tus preajustes cambiaron en otra pestaña. Recarga antes de guardar.')
    return at
  }
  const { error } = await db.from('connector_configs').insert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config: presets, updated_at: at })
  if (error) throw new Error(error.message)
  return at
}

/** A preset laid onto a clip of `durationMs` (fractions → ms). */
export const presetKeys = (p: AnimationPreset, durationMs: number) => p.keyframes.map(({ at, ...rest }) => ({ ...rest, atMs: Math.round(at * durationMs) }))
/** Keyframes of a clip as a preset (ms → fractions). */
export const keysToPreset = (keys: Array<{ atMs: number } & Record<string, unknown>>, durationMs: number): AnimKey[] => keys.map(({ atMs, ...rest }) => ({ ...(rest as Omit<AnimKey, 'at'>), at: Math.min(1, Math.max(0, atMs / Math.max(1, durationMs))) }))
