import type { SupabaseClient } from '@supabase/supabase-js'
import type { Composition, OutputFormat, Transition } from './composition'

/**
 * Reusable montage templates: the settings that make a series look the same (format, subtitles, transitions, music level, hook duration,
 * image motion), applied to any composition without touching its clips' content, trims or assets. Built-in templates cover the usual
 * outputs; the owner can save their own (stored in connector_configs, provider 'cerebro-editor', capability 'edit_templates'; RLS: owner).
 */
export type EditTemplate = {
  id: string; name: string; builtIn?: boolean
  format: OutputFormat; subtitles: boolean; fadeMs: number; musicVolume: number; duckMusic: boolean
  hookMs: number | null; transition: Transition; motion: 'kenburns' | 'none'
}

export const BUILT_IN_TEMPLATES: EditTemplate[] = [
  { id: 'yt-documental', name: 'YouTube documental (16:9, fundidos suaves, Ken Burns)', builtIn: true, format: '16:9', subtitles: true, fadeMs: 600, musicVolume: 0.25, duckMusic: true, hookMs: null, transition: 'fade', motion: 'kenburns' },
  { id: 'short-rapido', name: 'Short rápido (9:16, cortes secos, gancho 3 s)', builtIn: true, format: '9:16', subtitles: true, fadeMs: 0, musicVolume: 0.3, duckMusic: true, hookMs: 3000, transition: 'cut', motion: 'kenburns' },
  { id: 'reel-subtitulado', name: 'Reel / TikTok subtitulado (9:16, fundidos cortos)', builtIn: true, format: '9:16', subtitles: true, fadeMs: 250, musicVolume: 0.35, duckMusic: true, hookMs: 2500, transition: 'fade', motion: 'none' },
  { id: 'cuadrado-feed', name: 'Feed cuadrado (1:1, sin música alta)', builtIn: true, format: '1:1', subtitles: true, fadeMs: 400, musicVolume: 0.2, duckMusic: true, hookMs: null, transition: 'fade', motion: 'kenburns' },
]

/** Applies a template to a composition: global settings plus per-clip transition/motion. Clip content, trims and assets are kept. */
export function applyTemplate(c: Composition, t: EditTemplate): Composition {
  return {
    ...c,
    format: t.format, subtitles: t.subtitles, fadeMs: t.fadeMs, musicVolume: t.musicVolume, duckMusic: t.duckMusic,
    hookMs: t.hookMs ?? c.hookMs,
    clips: c.clips.map(clip => ({ ...clip, transition: t.transition, motion: t.motion })),
  }
}

/** A template capturing the current composition's settings (the most common transition/motion among its clips). */
export function templateFrom(c: Composition, name: string): EditTemplate {
  const most = <T,>(xs: T[], fallback: T) => { const n = new Map<T, number>(); xs.forEach(x => n.set(x, (n.get(x) ?? 0) + 1)); return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback }
  return {
    id: `user-${Date.now().toString(36)}`, name: name.trim().slice(0, 80) || 'Mi plantilla',
    format: c.format, subtitles: c.subtitles, fadeMs: c.fadeMs, musicVolume: c.musicVolume, duckMusic: c.duckMusic, hookMs: c.hookMs ?? null,
    transition: most(c.clips.map(x => x.transition ?? 'fade'), 'fade' as Transition), motion: most(c.clips.map(x => x.motion), 'none' as const),
  }
}

const KEY = { provider: 'cerebro-editor', capability: 'edit_templates' } as const
const valid = (t: unknown): t is EditTemplate => !!t && typeof t === 'object' && typeof (t as EditTemplate).id === 'string' && ['16:9', '9:16', '1:1'].includes((t as EditTemplate).format)

export async function loadTemplates(supabase: SupabaseClient): Promise<EditTemplate[]> {
  const { data } = await supabase.from('connector_configs').select('config').eq('provider', KEY.provider).eq('capability', KEY.capability).maybeSingle()
  const list = (data?.config as { templates?: unknown[] } | null)?.templates
  return Array.isArray(list) ? list.filter(valid).map(t => ({ ...t, builtIn: false })) : []
}

export async function saveTemplates(supabase: SupabaseClient, templates: EditTemplate[]) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const { error } = await supabase.from('connector_configs').upsert({ owner_id: user.id, ...KEY, enabled: true, priority: 0, config: { templates: templates.filter(t => !t.builtIn).slice(0, 30) }, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,provider,capability' })
  if (error) throw new Error(`No se pudo guardar la plantilla: ${error.message}`)
}
