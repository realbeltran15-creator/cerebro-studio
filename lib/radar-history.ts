import type { SupabaseClient } from '@supabase/supabase-js'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { compareSnapshots, type SnapshotItem } from '@/lib/radar'

/**
 * Stores a snapshot of a trending chart and compares it with the owner's previous snapshot
 * for the same region and category. Works with a user-session or service-role client.
 */
export async function recordTrendSnapshot(db: SupabaseClient, input: {
  ownerId: string
  region: string
  categoryId: string | null
  source: 'radar' | 'automation'
  videos: YouTubeVideoResult[]
}) {
  const items: SnapshotItem[] = input.videos.map((v, i) => ({ videoId: v.videoId, title: v.title, channelTitle: v.channelTitle, rank: i + 1, views: v.observed.views }))
  let query = db.from('trend_snapshots').select('items,fetched_at').eq('owner_id', input.ownerId).eq('region', input.region)
  query = input.categoryId ? query.eq('category_id', input.categoryId) : query.is('category_id', null)
  const { data: prevRows } = await query.order('fetched_at', { ascending: false }).limit(1)
  const prev = (prevRows ?? [])[0] as { items: SnapshotItem[]; fetched_at: string } | undefined
  const { error } = await db.from('trend_snapshots').insert({ owner_id: input.ownerId, region: input.region, category_id: input.categoryId, source: input.source, items })
  // History is best effort: a failed insert must not hide the live chart.
  if (error) console.error('Trend snapshot insert failed', { details: error.message })
  return compareSnapshots(items, prev?.items ?? null, prev?.fetched_at ?? null)
}
