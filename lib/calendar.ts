/**
 * Editorial calendar over publication_jobs (YouTube, Instagram, TikTok). Pure helpers; the page reads and writes with the owner's session.
 *
 * Which date a job sits on, in order of truth:
 *   1. published  → result.publishedAt (what really happened)
 *   2. YouTube publishAt in the payload → YouTube itself will publish then (a real schedule, set before approving)
 *   3. scheduled_for → the owner's planned date (a reminder: Cerebro Studio never publishes on its own)
 * A job with none of them is «sin fecha».
 */
export type Platform = 'youtube' | 'instagram' | 'tiktok'
export const PLATFORMS: Platform[] = ['youtube', 'instagram', 'tiktok']
export const platformNames: Record<Platform, string> = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' }

export type CalendarJob = {
  id: string; project_id: string; platform: string; status: string; scheduled_for: string | null; created_at: string
  payload: Record<string, unknown> | null; result: Record<string, unknown> | null
}
export type DateKind = 'published' | 'scheduled' | 'planned'

export function jobDate(j: CalendarJob): { at: Date; kind: DateKind } | null {
  const valid = (v: unknown) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t) : null }
  if (j.status === 'published') { const d = valid(j.result?.publishedAt); if (d) return { at: d, kind: 'published' } }
  if (j.platform === 'youtube' && j.status !== 'cancelled') { const d = valid(j.payload?.publishAt); if (d) return { at: d, kind: 'scheduled' } }
  if (j.status !== 'cancelled') { const d = valid(j.scheduled_for); if (d) return { at: d, kind: 'planned' } }
  return null
}

/** Local calendar day key YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The 6×7 grid of a month, starting on Monday, as day keys (with flags for days outside the month). */
export function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - offset + i)
    return { key: dayKey(d), day: d.getDate(), inMonth: d.getMonth() === month }
  })
}

export function groupByDay(jobs: CalendarJob[]) {
  const byDay = new Map<string, Array<CalendarJob & { kind: DateKind; at: Date }>>()
  const undated: CalendarJob[] = []
  for (const j of jobs) {
    const d = jobDate(j)
    if (!d) { if (j.status !== 'cancelled') undated.push(j); continue }
    const k = dayKey(d.at)
    byDay.set(k, [...(byDay.get(k) ?? []), { ...j, ...d }].sort((a, b) => a.at.getTime() - b.at.getTime()))
  }
  return { byDay, undated }
}

/** Only drafts can get a planned date from the browser (the database refuses changes to approved jobs). */
export const canPlan = (j: Pick<CalendarJob, 'status'>) => j.status === 'draft' || j.status === 'awaiting_approval'

export type MultiDraftInput = { videoAssetId: string; title: string; text: string; platforms: Platform[]; plannedFor: string | null }

/**
 * One draft per platform from the same video, with each platform's own payload. Conservative defaults: YouTube private, AI content declared,
 * TikTok privacy left for the owner to choose (TikTok forbids a default). Nothing is approved or published.
 */
export function multiPlatformDrafts(input: MultiDraftInput, ownerId: string, projectId: string, uuid: () => string) {
  const title = input.title.trim().slice(0, 100)
  const text = input.text.trim().slice(0, 2200)
  return input.platforms.map(platform => ({
    owner_id: ownerId, project_id: projectId, platform, status: 'draft', idempotency_key: uuid(), scheduled_for: input.plannedFor,
    payload: platform === 'youtube'
      ? { videoAssetId: input.videoAssetId, title, description: text, tags: [], privacyStatus: 'private', categoryId: '27', madeForKids: false, containsSyntheticMedia: true }
      : platform === 'instagram'
        ? { videoAssetId: input.videoAssetId, caption: [title, text].filter(Boolean).join('\n\n').slice(0, 2200), shareToFeed: true }
        : { videoAssetId: input.videoAssetId, caption: [title, text].filter(Boolean).join('\n\n').slice(0, 2200), isAigc: true, disableComment: true, disableDuet: true, disableStitch: true },
  }))
}

/** Format advice per platform for a video of a given aspect (from the asset's provenance). */
export function formatAdvice(format: string | null, platform: Platform) {
  if (!format) return null
  if ((platform === 'instagram' || platform === 'tiktok') && format !== '9:16') return `${platformNames[platform]} funciona mejor en vertical 9:16; este vídeo es ${format}. Crea una versión vertical en Convertir a Shorts.`
  return null
}
