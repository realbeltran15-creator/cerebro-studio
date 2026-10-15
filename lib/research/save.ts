import { isUniqueViolation } from '@/lib/opportunities'
import { RPM_LABEL, formatAdjusted, nicheRpm } from './monetization'
import { marketLabel } from './markets'
import type { TopicAnalysis } from './topic-analysis'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }; from: (t: string) => any }

/** Stores an analysed topic in Oportunidades, with observed, calculated and estimated data kept apart and the evidence attached. */
export async function saveAnalysis(db: Db, a: TopicAnalysis): Promise<'saved' | 'exists'> {
  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const sourceId = `research:${a.topic.toLowerCase()}|${a.region ?? ''}|${a.language ?? ''}|${a.recentDays ?? 30}`
  const { data: existing, error: lookup } = await db.from('opportunities').select('id').eq('owner_id', user.id).eq('source_platform', 'research').eq('source_id', sourceId).limit(1)
  if (lookup) throw lookup
  if (existing?.length) return 'exists'
  const rpm = a.niches.slice(0, 3).map(n => ({ niche: n, ...formatAdjusted(nicheRpm(n), 'long') }))
  const { error } = await db.from('opportunities').insert({
    owner_id: user.id, title: a.topic.slice(0, 180), source_platform: 'research', source_id: sourceId, query: a.topic, region: a.region, language: a.language, status: 'discovered',
    observed_metrics: {
      // Everything needed to reopen the analysis later, not just the headline numbers: window, units spent, the examples with their official thumbnails.
      snapshot: { topic: a.topic, region: a.region, language: a.language, recentDays: a.recentDays ?? 30, units: a.units, fetchedAt: a.fetchedAt,
        videos: a.topVideos.map(v => ({ videoId: v.videoId, url: v.url, title: v.title, channelTitle: v.channelTitle, thumbnailUrl: v.thumbnailUrl, publishedAt: v.publishedAt, views: v.observed.views, subscribers: v.observed.channelSubscribers, durationSeconds: v.observed.durationSeconds, live: v.live ?? null })) },
      sampleSizes: a.sampleSizes, approxTotals: a.approxTotals, evidence: a.evidence.filter(e => e.kind === 'observado'), fetchedAt: a.fetchedAt, source: 'youtube_data_api', market: marketLabel(a.region, a.language) },
    calculated_metrics: { indices: a.indices, growth: a.growth, quality: a.quality, formatQuality: a.formatQuality, growthPct: a.growthPct, verdict: a.verdict, reasons: a.reasons, byFormat: a.byFormat, niches: a.niches, confidence: a.confidence, confidenceNote: a.confidenceNote, rpmReference: { label: RPM_LABEL.estimado, entries: rpm } },
    evidence: a.topVideos.map(v => ({ url: v.url, source: 'youtube_data_api', captured_at: v.observed.fetchedAt, note: `${v.title} · ${v.channelTitle}` })),
  })
  if (error && !isUniqueViolation(error)) throw error
  return error ? 'exists' : 'saved'
}
