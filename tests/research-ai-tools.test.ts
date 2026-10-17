import { describe, expect, it } from 'vitest'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { assessVideo, expectedLanguages, queryProfile } from '@/lib/research/relevance'

// SIMULATED titles modelled on the manual test «AI tools for beginners» (US, English). They prove the rules, not YouTube's output.
let n = 0
type O = { desc?: string; tags?: string[]; ch?: string; views?: number; days?: number }
const vid = (title: string, o: O = {}): YouTubeVideoResult => {
  const days = o.days ?? 15, views = o.views ?? 40000
  return { videoId: `a${++n}`, url: `https://www.youtube.com/watch?v=a${n}`, title, channelId: `c${n}`, channelTitle: o.ch ?? 'Canal', publishedAt: new Date(Date.parse('2026-10-18T12:00:00Z') - days * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: 'en', categoryId: null,
    description: o.desc ?? '', tags: o.tags ?? [], channelCountry: null, live: null, observed: { views, likes: 10, comments: 1, durationSeconds: 600, channelSubscribers: 20000, fetchedAt: '' }, calculated: { viewsPerDay: Math.round(views / days), viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult
}
const T = 'AI tools for beginners'
const judge = (t: string, o: O = {}) => assessVideo(vid(t, o), queryProfile(T), expectedLanguages('US', 'en'), { region: 'US' }).status

const TOOL_TUTORIALS = [
  'Claude AI Tutorial for Beginners (Step by Step)', 'ChatGPT Tutorial for Beginners 2026', 'Gemini Tutorial for Beginners: Google AI Explained', 'Microsoft Copilot for beginners: full course',
  'Perplexity AI tutorial for beginners', 'Midjourney for Beginners: your first images', 'How to use Claude for beginners', 'ChatGPT for beginners: 10 things to try', 'DeepSeek tutorial for beginners', 'Notion AI for beginners',
]
const GENERIC = ['Best AI tools for beginners 2026', 'AI Tools Every Beginner Should Know', '10 free AI tools for beginners', 'Artificial intelligence tools for beginners: where to start', 'AI for beginners: a complete guide to ChatGPT, Claude and Gemini']
const OFF_TOPIC = ['Best woodworking tools for beginners', 'Garden tools for beginners', 'Guitar for beginners lesson 1', 'Beginner makeup tools', 'Learn Python for beginners (full course)']

describe('AI tools: ChatGPT, Claude, Gemini and equivalents are AI tools', () => {
  it.each(TOOL_TUTORIALS)('accepts the tutorial «%s»', t => { expect(judge(t)).toBe('aceptado') })
  it.each(GENERIC)('accepts the generic video «%s»', t => { expect(judge(t)).toBe('aceptado') })
  it.each(OFF_TOPIC)('does not accept «%s» (other kind of tool/beginner topic)', t => { expect(judge(t)).not.toBe('aceptado') })
  it('treats near-identical tutorials the same way whatever the tool: no valid one is dropped while a twin is kept', () => {
    const names = ['Claude', 'ChatGPT', 'Gemini', 'Copilot', 'Perplexity', 'Midjourney', 'DeepSeek', 'Grok']
    const verdicts = names.map(x => judge(`${x} tutorial for beginners`))
    expect(new Set(verdicts)).toEqual(new Set(['aceptado']))
    const noisy = names.map(x => judge(`${x} Tutorial For Beginners | Full Course (2026)`, { desc: `Learn ${x} step by step.` }))
    expect(new Set(noisy)).toEqual(new Set(['aceptado']))
  })
  it('a tool name used in another sense does not pass', () => {
    expect(judge('Gemini zodiac sign horoscope for beginners')).not.toBe('aceptado')
    expect(judge('Claude Monet painting for beginners')).not.toBe('aceptado')
    expect(judge('Copilot seat adjustment in a Cessna for beginners')).not.toBe('aceptado')
  })
})
