import { median, type ScoreComponent } from './topics'
import type { Theme } from './config'

// Client-safe: this file is also imported by the approval screen, so it must not pull in server-only code (tokens, crypto).

/**
 * Main metric of the factory: average view percentage (YouTube Analytics `averageViewPercentage`) over the first 7 days.
 * It is stored as OBSERVED data. What the factory learns from it (which themes tend to retain more) is INFERRED and labelled so.
 */

export const WINDOW_DAYS = 7
/** YouTube Analytics can lag by a couple of days, so a window is read two days after it closes. */
export const ANALYTICS_LAG_DAYS = 2
/** Below this many views in the window the percentage is too noisy to learn from. */
export const MIN_VIEWS_FOR_LEARNING = 100

const day = (d: Date) => d.toISOString().slice(0, 10)

/** First 7 days of a video: the publication day and the six after it (both dates are inclusive in the Analytics API). */
export function retentionWindow(publishedAtIso: string) {
  const start = new Date(`${publishedAtIso.slice(0, 10)}T00:00:00Z`)
  const end = new Date(start.getTime() + (WINDOW_DAYS - 1) * 86400000)
  return { startDate: day(start), endDate: day(end) }
}

export function isRetentionDue(publishedAtIso: string, now = new Date()) {
  const { endDate } = retentionWindow(publishedAtIso)
  return now.getTime() >= Date.parse(`${endDate}T00:00:00Z`) + (1 + ANALYTICS_LAG_DAYS) * 86400000
}

export type ObservedRetention = {
  averageViewPercentage: number | null
  views: number | null
  averageViewDuration: number | null
  window: { startDate: string; endDate: string }
  source: 'youtube_analytics_v2'
  fetchedAt: string
  /** Enough views for the percentage to be used when prioritising topics. */
  usableForLearning: boolean
}

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function fetchVideoRetention(token: string, videoId: string, window: { startDate: string; endDate: string }, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<ObservedRetention> {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new Error('Identificador de vídeo no válido.')
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
  url.search = new URLSearchParams({ ids: 'channel==MINE', startDate: window.startDate, endDate: window.endDate, metrics: 'averageViewPercentage,views,averageViewDuration', filters: `video==${videoId}` }).toString()
  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(r.status === 403 ? 'YouTube Analytics denegó el acceso: vuelve a conectar el canal con permisos de Analytics.' : `YouTube Analytics respondió ${r.status}.`)
  const j = await r.json() as { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<number | string>> }
  const names = (j.columnHeaders ?? []).map(h => h.name)
  const row = Object.fromEntries((j.rows?.[0] ?? []).map((v, i) => [names[i], v]))
  const views = numOrNull(row.views)
  return {
    averageViewPercentage: numOrNull(row.averageViewPercentage), views, averageViewDuration: numOrNull(row.averageViewDuration),
    window, source: 'youtube_analytics_v2', fetchedAt: now.toISOString(), usableForLearning: views !== null && views >= MIN_VIEWS_FOR_LEARNING && numOrNull(row.averageViewPercentage) !== null,
  }
}

// ---------- Learning (inferred) ----------
export const MIN_ITEMS_OVERALL = 5
export const MIN_ITEMS_PER_THEME = 3

export type ThemeStat = { theme: Theme; n: number; median: number }

export function themeRetention(items: Array<{ theme: Theme; retention: ObservedRetention | null }>) {
  const usable = items.filter((i): i is { theme: Theme; retention: ObservedRetention & { averageViewPercentage: number } } => Boolean(i.retention?.usableForLearning && i.retention.averageViewPercentage !== null))
  const overall = median(usable.map(i => i.retention.averageViewPercentage))
  const byTheme = new Map<Theme, number[]>()
  for (const i of usable) byTheme.set(i.theme, [...(byTheme.get(i.theme) ?? []), i.retention.averageViewPercentage])
  const stats: ThemeStat[] = [...byTheme.entries()].map(([theme, v]) => ({ theme, n: v.length, median: median(v)! }))
  return { overall, samples: usable.length, stats }
}

/**
 * Score boost for a theme from past retention: INFERRED, because a theme median over a few Shorts says what happened,
 * not what will happen. Needs enough Shorts overall and in the theme; capped to ±1.5 so it nudges, never decides.
 */
export function historyBoost(items: Array<{ theme: Theme; retention: ObservedRetention | null }>) {
  const { overall, samples, stats } = themeRetention(items)
  return (theme: Theme): ScoreComponent => {
    const s = stats.find(x => x.theme === theme)
    if (overall === null || samples < MIN_ITEMS_OVERALL || !s || s.n < MIN_ITEMS_PER_THEME) {
      return { value: 0, kind: 'inferred', note: `Sin historial suficiente de retención a 7 días (hacen falta ${MIN_ITEMS_OVERALL} Shorts medidos y ${MIN_ITEMS_PER_THEME} del tema).` }
    }
    const value = Math.max(-1.5, Math.min(1.5, (s.median - overall) / 10))
    return { value, kind: 'inferred', note: `Inferido: los ${s.n} Shorts de «${theme}» tuvieron una retención mediana observada de ${s.median.toFixed(1)}% frente a ${overall.toFixed(1)}% en general.` }
  }
}
