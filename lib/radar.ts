/**
 * Recurring terms across a set of titles. A CALCULATED signal, not a trend prediction:
 * it only counts how many titles in the current chart mention each term.
 */
const stopwords = new Set(`a al algo ante como con contra cual de del desde donde el ella ellos en entre era es esa ese eso esta este esto fue ha hay la las le les lo los mas más me mi muy no nos o os para pero por que qué se sea ser si sin sobre son su sus te tu tus un una uno unos y ya yo
the a an and are as at be by for from has have how i in is it its my of on or our that the this to was we what when who why will with you your vs ft feat official video oficial music musica música full episode ep capitulo capítulo parte part trailer live en vivo new nuevo nueva`.split(/\s+/))

export type RecurringTerm = { term: string; titles: number }

export function recurringTerms(titles: string[], minTitles = 2, limit = 15): RecurringTerm[] {
  const counts = new Map<string, number>()
  for (const title of titles) {
    const words = new Set(
      title.toLowerCase().normalize('NFKC')
        .replace(/https?:\/\/\S+/g, ' ')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(w => w.length >= 3 && !stopwords.has(w) && !/^\d+$/.test(w)),
    )
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minTitles)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, n]) => ({ term, titles: n }))
}

export type SnapshotItem = { videoId: string; title: string; channelTitle: string; rank: number; views: number | null }

export type TrendMovement = {
  videoId: string
  status: 'new' | 'up' | 'down' | 'same'
  /** Positive = climbed that many positions since the previous snapshot. */
  rankChange: number | null
  viewsGained: number | null
}

export type TrendComparison = {
  previousAt: string | null
  movements: Record<string, TrendMovement>
  dropped: SnapshotItem[]
}

/** Compares the current chart with the previous snapshot. Calculated, not predicted. */
export function compareSnapshots(current: SnapshotItem[], previous: SnapshotItem[] | null, previousAt: string | null): TrendComparison {
  if (!previous) return { previousAt: null, movements: {}, dropped: [] }
  const before = new Map(previous.map(p => [p.videoId, p]))
  const now = new Set(current.map(c => c.videoId))
  const movements: Record<string, TrendMovement> = {}
  for (const item of current) {
    const prev = before.get(item.videoId)
    if (!prev) { movements[item.videoId] = { videoId: item.videoId, status: 'new', rankChange: null, viewsGained: null }; continue }
    const rankChange = prev.rank - item.rank
    movements[item.videoId] = {
      videoId: item.videoId,
      status: rankChange > 0 ? 'up' : rankChange < 0 ? 'down' : 'same',
      rankChange,
      viewsGained: item.views !== null && prev.views !== null ? item.views - prev.views : null,
    }
  }
  return { previousAt, movements, dropped: previous.filter(p => !now.has(p.videoId)) }
}
