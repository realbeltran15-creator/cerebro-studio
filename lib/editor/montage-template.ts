/**
 * Plantillas de montaje: a whole montage saved as a reusable structure — tracks, clip lengths, trims, speeds, transitions, camera moves,
 * titles and texts, audio positions and volumes, subtitles, format and export settings — with every media file replaced by a numbered
 * slot («Visual 1», «Música 1»…). Filling the slots with other files gives a new montage with the same structure.
 * Stored in ONE connector_configs row per owner (provider cerebro-editor, capability montage_templates; owner RLS): no migration.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseComposition, totalDurationMs, type AudioClip, type Composition } from './composition'

export type SlotKind = 'visual' | 'music' | 'voice' | 'sfx'
export type TemplateSlot = { key: string; kind: SlotKind; label: string; uses: number; /** Type of the original file (video/image/…), as a hint. */ sourceType: string; /** Longest stretch of the original used by a clip (source ms), to warn when a shorter file fills the slot. */ needsMs: number }
export type MontageTemplate = { kind: 'montage_template'; id: string; name: string; createdAt: string; format: Composition['format']; durationMs: number; clips: number; slots: TemplateSlot[]; composition: Composition }

const SLOT = 'slot:'
const KIND_LABEL: Record<SlotKind, string> = { visual: 'Visual', music: 'Música', voice: 'Voz', sfx: 'Efecto' }
export const MAX_TEMPLATES = 20, MAX_TEMPLATE_CLIPS = 600

/** Turns a montage into a template: the same structure, with each distinct file replaced by a slot (in order of first appearance). */
export function makeTemplate(c: Composition, name: string, typeOf: (assetId: string) => string, id = `tpl-${Math.random().toString(36).slice(2, 10)}`): MontageTemplate {
  if (c.clips.length > MAX_TEMPLATE_CLIPS) throw new Error(`Una plantilla admite hasta ${MAX_TEMPLATE_CLIPS} clips.`)
  const slots: TemplateSlot[] = []
  const map = new Map<string, string>()
  const slotFor = (assetId: string, kind: SlotKind, sourceMs: number) => {
    const k = `${kind}:${assetId}`
    let key = map.get(k)
    if (!key) {
      const n = slots.filter(s => s.kind === kind).length + 1
      key = `${SLOT}${kind}-${n}`
      map.set(k, key)
      slots.push({ key, kind, label: `${KIND_LABEL[kind]} ${n}`, uses: 0, sourceType: typeOf(assetId), needsMs: 0 })
    }
    const s = slots.find(x => x.key === key)!
    s.uses++; s.needsMs = Math.max(s.needsMs, Math.round(sourceMs))
    return key
  }
  const clips = c.clips.map(k => ({ ...k, voiceAssetId: null, visualAssetId: k.visualAssetId ? slotFor(k.visualAssetId, 'visual', (k.trimInMs ?? 0) + k.durationMs * (k.speed ?? 1)) : null }))
  const audioClips = (c.audioClips ?? []).map(a => ({ ...a, assetId: slotFor(a.assetId, a.kind, a.trimInMs + a.durationMs) }))
  const musicAssetId = c.musicAssetId ? slotFor(c.musicAssetId, 'music', totalDurationMs(c)) : null
  const composition: Composition = { ...structuredClone({ ...c, clips, audioClips, musicAssetId }), styleRef: null, autoSnapshot: null, title: name, editedManually: true }
  return { kind: 'montage_template', id, name: name.trim().slice(0, 80) || 'Plantilla', createdAt: new Date().toISOString(), format: c.format, durationMs: totalDurationMs(c), clips: c.clips.length, slots, composition }
}

export type Assignment = Record<string, string | undefined>
/** Durations (ms) of the files used to fill the slots, when known: trims beyond a shorter file are moved back so the clip still shows something. */
export function fillTemplate(t: MontageTemplate, assign: Assignment, opts: { title?: string; durationOf?: (assetId: string) => number | null } = {}): { composition: Composition; missing: TemplateSlot[]; warnings: string[] } {
  const missing = t.slots.filter(s => !assign[s.key])
  const warnings: string[] = []
  const pick = (v: string | null) => (v && v.startsWith(SLOT) ? assign[v] ?? null : v)
  const c = structuredClone(t.composition)
  c.clips = c.clips.map(k => {
    const asset = pick(k.visualAssetId)
    const len = asset ? opts.durationOf?.(asset) ?? null : null
    const need = (k.trimInMs ?? 0) + k.durationMs * (k.speed ?? 1)
    const trimInMs = len !== null && need > len ? Math.max(0, len - k.durationMs * (k.speed ?? 1)) : k.trimInMs
    return { ...k, visualAssetId: asset, trimInMs }
  })
  c.audioClips = (c.audioClips ?? []).flatMap((a): AudioClip[] => { const id = pick(a.assetId); return id ? [{ ...a, assetId: id }] : [] })
  c.musicAssetId = pick(c.musicAssetId)
  for (const s of t.slots) {
    const id = assign[s.key]
    const len = id ? opts.durationOf?.(id) ?? null : null
    if (id && len !== null && s.needsMs > len + 500 && s.kind === 'visual') warnings.push(`${s.label}: el archivo dura ${Math.round(len / 100) / 10} s y la plantilla usa hasta ${Math.round(s.needsMs / 100) / 10} s; algunos clips empiezan antes.`)
  }
  if (missing.length) warnings.push(`Sin archivo: ${missing.map(s => s.label).join(', ')}${missing.some(s => s.kind === 'visual') ? ' (los clips visuales sin archivo saldrán en negro)' : ''}.`)
  c.title = (opts.title ?? t.name).slice(0, 160)
  c.styleRef = null; c.autoSnapshot = null; c.editedManually = true
  return { composition: parseComposition(JSON.parse(JSON.stringify(c))) ?? c, missing, warnings }
}

/** Fills slots automatically in order with the chosen files of each kind (images and videos both fill visual slots). */
export function autoAssign(t: MontageTemplate, files: Array<{ id: string; type: string }>): Assignment {
  const out: Assignment = {}
  const pools: Record<SlotKind, string[]> = {
    visual: files.filter(f => f.type === 'video' || f.type === 'image').map(f => f.id),
    music: files.filter(f => f.type === 'music').map(f => f.id), voice: files.filter(f => f.type === 'voice').map(f => f.id), sfx: files.filter(f => f.type === 'sfx').map(f => f.id),
  }
  for (const s of t.slots) { const next = pools[s.kind].shift(); if (next) out[s.key] = next }
  return out
}

export function parseTemplate(v: unknown): MontageTemplate | null {
  const o = (v && typeof v === 'object' ? v : null) as Partial<MontageTemplate> | null
  if (!o || o.kind !== 'montage_template' || typeof o.id !== 'string' || typeof o.name !== 'string') return null
  const composition = parseComposition(o.composition)
  if (!composition) return null
  const slots = (Array.isArray(o.slots) ? o.slots : []).filter(s => s && typeof s.key === 'string' && s.key.startsWith(SLOT) && ['visual', 'music', 'voice', 'sfx'].includes(s.kind))
  return { kind: 'montage_template', id: o.id, name: o.name.slice(0, 80), createdAt: typeof o.createdAt === 'string' ? o.createdAt : '', format: composition.format, durationMs: totalDurationMs(composition), clips: composition.clips.length, slots, composition }
}

const KEY = { provider: 'cerebro-editor', capability: 'montage_templates' } as const
export async function loadTemplates(db: SupabaseClient): Promise<{ templates: MontageTemplate[]; updatedAt: string | null }> {
  const { data, error } = await db.from('connector_configs').select('config,updated_at').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as { config?: { templates?: unknown[] }; updated_at?: string } | null
  return { templates: (row?.config?.templates ?? []).flatMap(t => { const p = parseTemplate(t); return p ? [p] : [] }), updatedAt: row?.updated_at ?? null }
}
/** Conditional on the row's updated_at (never overwrites templates saved from another tab). */
export async function saveTemplates(db: SupabaseClient, templates: MontageTemplate[], prevUpdatedAt: string | null): Promise<string> {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const config = { templates: templates.slice(0, MAX_TEMPLATES) }
  const at = new Date().toISOString()
  if (prevUpdatedAt) {
    const { data, error } = await db.from('connector_configs').update({ config, updated_at: at }).eq('provider', KEY.provider).eq('capability', KEY.capability).eq('owner_id', user.id).eq('updated_at', prevUpdatedAt).select('updated_at')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Tus plantillas cambiaron en otra pestaña. Recarga antes de guardar.')
    return (data[0] as { updated_at: string }).updated_at
  }
  const { error } = await db.from('connector_configs').insert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config, updated_at: at })
  if (error) throw new Error((error as { code?: string }).code === '23505' ? 'Tus plantillas cambiaron en otra pestaña. Recarga antes de guardar.' : error.message)
  return at
}
