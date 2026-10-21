import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { analyzeTopic, type TopicSamples } from '@/lib/research/topic-analysis'
import { analysisReportMarkdown } from '@/lib/research/patterns'

const NOW = Date.parse('2026-10-13T12:00:00Z')
type O = { title?: string; days?: number; views?: number; subs?: number | null; dur?: number | null; ch?: string; lang?: string | null; tags?: string[]; cat?: string; live?: YouTubeVideoResult['live'] }
let n = 0
const vid = (o: O = {}): YouTubeVideoResult => {
  const days = o.days ?? 10, views = o.views ?? 1000, subs = o.subs === undefined ? 5000 : o.subs
  return { videoId: `v${++n}`, url: '', title: o.title ?? 'tema video', channelId: o.ch ?? `c${n}`, channelTitle: 'C', publishedAt: new Date(NOW - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: o.lang === undefined ? 'es' : o.lang, tags: o.tags ?? [], categoryId: o.cat ?? null, live: o.live ?? null,
    observed: { views, likes: 10, comments: 1, durationSeconds: o.dur === undefined ? 600 : o.dur, channelSubscribers: subs, fetchedAt: '' },
    calculated: { viewsPerDay: Math.round(views / Math.max(days, 1)), viewsToSubscribers: subs ? views / subs : null, engagementRate: 1 } }
}
const many = (count: number, f: (i: number) => O) => Array.from({ length: count }, (_, i) => vid(f(i)))
const samples = (top: YouTubeVideoResult[], recent: YouTubeVideoResult[], topic = 'tema'): TopicSamples => ({ topic, region: 'ES', language: 'es', top: { videos: top, approxTotal: 120000 }, recent: { videos: recent, approxTotal: 5000 }, fetchedAt: new Date(NOW).toISOString(), units: 204 })

describe('research report', () => {
  it('builds a complete Markdown report from a saved analysis without new queries', () => {
    const a = analyzeTopic(samples(many(20, i => ({ views: 200000 - i * 5000, days: 90 })), many(10, i => ({ views: 20000, days: 3 + i }))), NOW)
    const md = analysisReportMarkdown(a)
    expect(md).toMatch(/^# Informe de investigación: tema/)
    for (const h of ['## Veredicto', '## Índices', '## Formato', '## Patrones', '## Vídeos de referencia']) expect(md).toContain(h)
    expect(md).toMatch(/no se hicieron consultas nuevas/)
  })
})
