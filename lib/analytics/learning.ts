/**
 * "What worked" from the owner's own YouTube Analytics (CALCULATED, descriptive, not causal): which videos beat the
 * channel's median, which keep viewers longest and how views compare by video length. It never claims why.
 */
export type LearningVideo = { id: string; title: string; projectId: string | null; views: number | null; avgViewPercentage: number | null; avgViewDurationSeconds: number | null }

export type Learning = {
  sampleSize: number
  enough: boolean
  medianViews: number | null
  outperformers: Array<{ id: string; title: string; projectId: string | null; views: number; ratio: number }>
  retentionLeaders: Array<{ id: string; title: string; projectId: string | null; percentage: number }>
  lengthBuckets: Array<{ label: string; count: number; medianViews: number }>
  notes: string[]
}

const MIN_SAMPLE = 5
const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

export function learnFromVideos(videos: LearningVideo[]): Learning {
  const withViews = videos.filter((v): v is LearningVideo & { views: number } => v.views !== null && v.views >= 0)
  const medianViews = median(withViews.map(v => v.views))
  const base: Learning = { sampleSize: withViews.length, enough: withViews.length >= MIN_SAMPLE, medianViews, outperformers: [], retentionLeaders: [], lengthBuckets: [], notes: [] }
  if (!base.enough || !medianViews) {
    base.notes.push(`Hacen falta al menos ${MIN_SAMPLE} vídeos con datos para sacar conclusiones; ahora hay ${withViews.length}.`)
    return base
  }
  base.outperformers = withViews.filter(v => v.views >= medianViews * 2).sort((a, b) => b.views - a.views).slice(0, 5)
    .map(v => ({ id: v.id, title: v.title, projectId: v.projectId, views: v.views, ratio: Math.round((v.views / medianViews) * 10) / 10 }))
  base.retentionLeaders = videos.filter((v): v is LearningVideo & { avgViewPercentage: number } => v.avgViewPercentage !== null).sort((a, b) => b.avgViewPercentage - a.avgViewPercentage).slice(0, 3)
    .map(v => ({ id: v.id, title: v.title, projectId: v.projectId, percentage: Math.round(v.avgViewPercentage * 10) / 10 }))
  // Length is inferred from average view duration / average percentage viewed (observed), only when both exist.
  const lengthOf = (v: LearningVideo) => v.avgViewDurationSeconds && v.avgViewPercentage ? v.avgViewDurationSeconds / (v.avgViewPercentage / 100) : null
  const bucket = (s: number) => (s < 60 ? 'Menos de 1 min' : s < 600 ? '1–10 min' : 'Más de 10 min')
  const groups = new Map<string, number[]>()
  for (const v of withViews) { const l = lengthOf(v); if (l) { const k = bucket(l); groups.set(k, [...(groups.get(k) ?? []), v.views]) } }
  base.lengthBuckets = [...groups.entries()].filter(([, a]) => a.length >= 2).map(([label, a]) => ({ label, count: a.length, medianViews: median(a) ?? 0 }))
  base.notes.push('Compara tus propios vídeos entre sí: describe qué pasó, no por qué. Con pocos vídeos, una diferencia puede ser casualidad.')
  base.notes.push('La duración del vídeo se deduce de la duración media vista dividida por el porcentaje visto (dato calculado, aproximado).')
  return base
}

export type SnapshotRow = { external_content_id: string; metric_date: string; project_id?: string | null; observed: Record<string, unknown> }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Learning from stored YouTube snapshots: only per-video rows of the most recent import day (channel rows are skipped). */
export function learningFromSnapshots(rows: SnapshotRow[]): Learning {
  const perVideo = rows.filter(r => !r.external_content_id.startsWith('channel:'))
  const latest = perVideo.map(r => r.metric_date).sort().at(-1)
  return learnFromVideos(perVideo.filter(r => r.metric_date === latest).map(r => ({
    id: r.external_content_id, title: String(r.observed.title ?? r.external_content_id), projectId: r.project_id ?? null,
    views: num(r.observed.views), avgViewPercentage: num(r.observed.averageViewPercentage), avgViewDurationSeconds: num(r.observed.averageViewDuration),
  })))
}
