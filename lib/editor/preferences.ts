/**
 * Preferencias de edición: the values the instruction bar uses («zoom lento» = how much, music volume when none is said…).
 * They change ONLY when the owner confirms a proposal made after they corrected the result of an instruction by hand.
 * Stored in connector_configs (provider cerebro-editor, capability edit_preferences; owner RLS): no migration.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Composition } from './composition'

export type EditPreferences = {
  zoomSlow: number; zoomNormal: number; zoomFast: number
  musicVolume: number; voiceVolume: number; sfxVolume: number
  textMs: number; titleSizePct: number; textSizePct: number
  /** Changes confirmed by the owner, newest last. */
  history: Array<{ at: string; key: PrefKey; from: number; to: number }>
}
export type PrefKey = Exclude<keyof EditPreferences, 'history'>
export const DEFAULT_PREFS: EditPreferences = { zoomSlow: 0.08, zoomNormal: 0.12, zoomFast: 0.25, musicVolume: 0.3, voiceVolume: 1, sfxVolume: 1, textMs: 3000, titleSizePct: 10, textSizePct: 6, history: [] }
export const PREF_LABELS: Record<PrefKey, { label: string; show: (v: number) => string; phrase: string }> = {
  zoomSlow: { label: 'Intensidad de «zoom lento»', show: v => `${Math.round(v * 100)} %`, phrase: 'zoom lento' },
  zoomNormal: { label: 'Intensidad de «zoom»', show: v => `${Math.round(v * 100)} %`, phrase: 'zoom' },
  zoomFast: { label: 'Intensidad de «zoom rápido»', show: v => `${Math.round(v * 100)} %`, phrase: 'zoom rápido' },
  musicVolume: { label: 'Volumen al poner música', show: v => `${Math.round(v * 100)} %`, phrase: 'pon esta música' },
  voiceVolume: { label: 'Volumen al poner una voz', show: v => `${Math.round(v * 100)} %`, phrase: 'pon la voz' },
  sfxVolume: { label: 'Volumen al poner un efecto', show: v => `${Math.round(v * 100)} %`, phrase: 'pon el efecto' },
  textMs: { label: 'Duración de un texto', show: v => `${Math.round(v / 100) / 10} s`, phrase: 'pon el texto' },
  titleSizePct: { label: 'Tamaño de un título', show: v => `${v} %`, phrase: 'pon el título' },
  textSizePct: { label: 'Tamaño de un texto', show: v => `${v} %`, phrase: 'pon el texto' },
}
const RANGES: Record<PrefKey, [number, number]> = { zoomSlow: [0.02, 0.5], zoomNormal: [0.02, 0.5], zoomFast: [0.02, 0.5], musicVolume: [0, 2], voiceVolume: [0, 2], sfxVolume: [0, 2], textMs: [300, 120000], titleSizePct: [2, 15], textSizePct: [2, 15] }

export function parsePrefs(v: unknown): EditPreferences {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<EditPreferences>
  const out = { ...DEFAULT_PREFS, history: Array.isArray(o.history) ? o.history.filter(h => h && typeof h.key === 'string' && h.key in RANGES).slice(-50) : [] }
  for (const k of Object.keys(RANGES) as PrefKey[]) { const x = Number(o[k]); if (Number.isFinite(x)) out[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], x)) }
  return out
}

/** What an instruction set, to notice later if the owner corrects it by hand. */
export type Watch = { key: PrefKey; value: number; target: { kind: 'clips'; ids: string[] } | { kind: 'audio'; id: string } | { kind: 'text'; id: string; field: 'durationMs' | 'sizePct' } }
export type Proposal = { key: PrefKey; from: number; to: number; watch: Watch }

/** A correction is proposed when every target that still exists now has the same, different value (one deliberate change, not noise). */
export function detectCorrection(c: Composition, w: Watch): Proposal | null {
  let vals: number[] = []
  if (w.target.kind === 'clips') { const ids = new Set(w.target.ids); vals = c.clips.filter(k => ids.has(k.id) && k.camera).map(k => k.camera!.amount) }
  else if (w.target.kind === 'audio') { const id = w.target.id; vals = (c.audioClips ?? []).filter(a => a.id === id).map(a => a.volume) }
  else { const { id, field } = w.target; vals = (c.textClips ?? []).filter(t => t.id === id).map(t => t[field]) }
  if (!vals.length) return null
  const v = vals[0]
  if (vals.some(x => Math.abs(x - v) > 1e-6)) return null
  const tol = w.key === 'textMs' ? 200 : w.key.endsWith('SizePct') ? 0.5 : 0.015
  return Math.abs(v - w.value) > tol ? { key: w.key, from: w.value, to: Math.round(v * 1000) / 1000, watch: w } : null
}

export function acceptProposal(p: EditPreferences, prop: Proposal, at = new Date().toISOString()): EditPreferences {
  return parsePrefs({ ...p, [prop.key]: prop.to, history: [...p.history, { at, key: prop.key, from: p[prop.key], to: prop.to }] })
}

const KEY = { provider: 'cerebro-editor', capability: 'edit_preferences' } as const
export async function loadPrefs(db: SupabaseClient): Promise<{ prefs: EditPreferences; updatedAt: string | null }> {
  const { data, error } = await db.from('connector_configs').select('config,updated_at').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as { config?: unknown; updated_at?: string } | null
  return { prefs: parsePrefs(row?.config), updatedAt: row?.updated_at ?? null }
}
export async function savePrefs(db: SupabaseClient, prefs: EditPreferences, prevUpdatedAt: string | null): Promise<string> {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const at = new Date().toISOString()
  if (prevUpdatedAt) {
    const { data, error } = await db.from('connector_configs').update({ config: prefs, updated_at: at }).eq('provider', KEY.provider).eq('capability', KEY.capability).eq('owner_id', user.id).eq('updated_at', prevUpdatedAt).select('updated_at')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Tus preferencias cambiaron en otra pestaña. Recarga antes de guardar.')
    return at
  }
  const { error } = await db.from('connector_configs').insert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config: prefs, updated_at: at })
  if (error) throw new Error(error.message)
  return at
}
