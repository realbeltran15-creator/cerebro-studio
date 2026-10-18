import type { SupabaseClient } from '@supabase/supabase-js'
import type { TopicAnalysis } from './topic-analysis'

/**
 * Cloud copy of the analyses already paid for. Until now they lived only in this browser (localStorage): clearing the browser, another
 * device or a new deploy lost them, and they cannot be recalculated for free. This keeps the latest ones in the owner's own
 * connector_configs row (provider 'cerebro-research', capability 'analyses'; existing table with owner RLS, no migration needed).
 * Pure helpers are exported for tests; load/save are thin Supabase calls.
 */
export const HISTORY_KEY = { provider: 'cerebro-research', capability: 'analyses' } as const
export const HISTORY_MAX = 40
/** Keeps the stored row well under PostgREST/JSON limits; the per-video sample detail goes first, then examples. */
export const HISTORY_MAX_BYTES = 1_500_000

type Map = Record<string, TopicAnalysis>
const at = (a: TopicAnalysis) => Date.parse(a.growth?.measuredAt ?? a.fetchedAt ?? '') || 0

/** Union of two sets of analyses; for the same key the more recent one (fetch or growth measure) wins. */
export function mergeAnalyses(local: Map, remote: Map): Map {
  const out: Map = { ...remote }
  for (const [k, a] of Object.entries(local)) if (!out[k] || at(a) >= at(out[k])) out[k] = a
  return out
}

/** The newest HISTORY_MAX analyses, shrunk until the JSON fits HISTORY_MAX_BYTES. Numbers and verdicts are never dropped. */
export function compactForCloud(all: Map, maxBytes = HISTORY_MAX_BYTES): Map {
  const newest = Object.entries(all).filter(([, a]) => a && a.quality && a.growth).sort(([, x], [, y]) => at(y) - at(x)).slice(0, HISTORY_MAX)
  const variants: Array<(a: TopicAnalysis) => TopicAnalysis> = [a => a, a => ({ ...a, sample: [] }), a => ({ ...a, sample: [], topVideos: a.topVideos.slice(0, 3) }), a => ({ ...a, sample: [], topVideos: [] })]
  for (const v of variants) {
    const m = Object.fromEntries(newest.map(([k, a]) => [k, v(a)]))
    if (JSON.stringify(m).length <= maxBytes) return m
  }
  return Object.fromEntries(newest.slice(0, 10).map(([k, a]) => [k, { ...a, sample: [], topVideos: [] }]))
}

export async function loadHistory(db: SupabaseClient): Promise<Map> {
  const { data, error } = await db.from('connector_configs').select('config').eq('provider', HISTORY_KEY.provider).eq('capability', HISTORY_KEY.capability).maybeSingle()
  if (error) throw new Error(error.message)
  const a = (data?.config as { analyses?: unknown } | null)?.analyses
  return a && typeof a === 'object' ? a as Map : {}
}

export async function saveHistory(db: SupabaseClient, analyses: Map) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) return
  const { error } = await db.from('connector_configs').upsert({ owner_id: user.id, ...HISTORY_KEY, enabled: true, priority: 0, config: { analyses: compactForCloud(analyses), savedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,provider,capability' })
  if (error) throw new Error(error.message)
}
