import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFor, youtubeConnection } from '@/lib/oauth/google'
import { fetchVideoRetention, isRetentionDue, retentionWindow } from './retention'

/** Server-only half of the retention reader (it needs the stored YouTube tokens). */
/**
 * Reads the 7-day retention of every published Short whose window has closed and has no reading yet.
 * Read-only against YouTube; the result is written to shorts_factory_items.retention. Needs the Analytics permission.
 */
export async function collectDueRetention(db: SupabaseClient, ownerId: string, now = new Date(), deps: { fetchRetention?: typeof fetchVideoRetention } = {}) {
  const { data, error } = await db.from('shorts_factory_items').select('id,theme,video_id,published_at,retention').eq('owner_id', ownerId).eq('status', 'published').is('retention', null).not('video_id', 'is', null).limit(20)
  if (error) throw new Error(error.message)
  const due = ((data ?? []) as Array<{ id: string; video_id: string; published_at: string | null }>).filter(r => r.published_at && isRetentionDue(r.published_at, now))
  if (!due.length) return { checked: 0, stored: 0, error: null as string | null }
  const connection = await youtubeConnection(db, ownerId)
  if (!connection) return { checked: due.length, stored: 0, error: 'No hay canal de YouTube conectado para leer la retención.' }
  let stored = 0
  const fetchRetention = deps.fetchRetention ?? fetchVideoRetention
  try {
    const token = await accessTokenFor(db, connection)
    for (const item of due) {
      const retention = await fetchRetention(token, item.video_id, retentionWindow(item.published_at!), fetch, now)
      const { error: updateError } = await db.from('shorts_factory_items').update({ retention, updated_at: now.toISOString() }).eq('id', item.id).eq('owner_id', ownerId)
      if (updateError) throw new Error(updateError.message)
      stored++
    }
  } catch (e) { return { checked: due.length, stored, error: e instanceof Error ? e.message : 'No se pudo leer la retención.' } }
  return { checked: due.length, stored, error: null as string | null }
}

