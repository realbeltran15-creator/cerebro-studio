import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { Thumb, youtubeThumb } from '@/app/components/thumb'
import { confidenceLabel, indexText, languageLabel, regionLabel, sourceLabel } from '@/lib/research/labels'
import { CURRENCY_NAME, currencyForCountries, currencyMismatch } from '@/lib/campaigns/currency'
import { briefFromLink, campaignLink } from '@/lib/campaigns/link'
import { buildStrategy } from '@/lib/campaigns/strategy'
import { EMPTY_BRIEF } from '@/lib/campaigns/types'
import { THRESHOLDS, buildRecommendations } from '@/lib/research/recommendations'
import { EMPTY_FILTERS } from '@/lib/research/filters'
import { analyzeTopic, type TopicAnalysis } from '@/lib/research/topic-analysis'
import { nicheRpm, formatAdjusted } from '@/lib/research/monetization'
import type { YouTubeVideoResult } from '@/lib/providers/youtube-data'

// SIMULATED data and pure rendering: no browser, no YouTube.
describe('missing thumbnails', () => {
  it('without an address the standard YouTube thumbnail of the video is used, never an empty box', () => {
    const html = renderToStaticMarkup(createElement(Thumb, { videoId: 'abc123', src: null }))
    expect(html).toContain(youtubeThumb('abc123')); expect(html).toContain('i.ytimg.com/vi/abc123/mqdefault.jpg')
  })
  it('a given address is used as it is, and only a video without an id shows the placeholder', () => {
    expect(renderToStaticMarkup(createElement(Thumb, { videoId: 'abc', src: 'https://i.ytimg.com/vi/abc/hq.jpg' }))).toContain('hq.jpg')
    expect(renderToStaticMarkup(createElement(Thumb, { videoId: '', src: null }))).toContain('Sin miniatura')
  })
})

describe('labels are in plain Spanish, never codes', () => {
  it('sources, countries, languages, confidence and non-calculable indices', () => {
    expect(sourceLabel('research')).toBe('Investigación'); expect(sourceLabel('youtube')).toBe('YouTube'); expect(sourceLabel(null)).toBe('—')
    expect(regionLabel('GB')).toMatch(/Reino Unido/); expect(regionLabel(null)).toBe('Mundial')
    expect(languageLabel('en')).toBe('Inglés'); expect(languageLabel('pt')).toBe('Portugués')
    expect(confidenceLabel('baja')).toBe('Baja'); expect(confidenceLabel('muy baja')).toBe('Muy baja')
    expect(indexText(null)).toBe('No calculable'); expect(indexText(0)).toBe('0'); expect(indexText(61)).toBe('61')
  })
})

describe('campaigns for the United Kingdom are not budgeted in euros without saying why', () => {
  it('the currency follows the country', () => {
    expect(currencyForCountries(['GB'])).toBe('GBP'); expect(currencyForCountries(['US'])).toBe('USD'); expect(currencyForCountries(['CH'])).toBe('CHF')
    expect(currencyForCountries(['DE', 'ES'])).toBe('EUR'); expect(currencyForCountries(['GB', 'DE'])).toBeNull(); expect(currencyForCountries([])).toBeNull()
  })
  it('a campaign that arrives from Investigación for a British market starts in pounds', () => {
    const b = briefFromLink(campaignLink({ topic: 'first time buyer', region: 'GB', language: 'en' }).split('?')[1])!
    expect(b.countries).toEqual(['GB']); expect(b.currency).toBe('GBP')
    const us = briefFromLink(campaignLink({ topic: 'index funds', region: 'US' }).split('?')[1])!; expect(us.currency).toBe('USD')
  })
  it('a mismatch is detected and the plan warns about it; a deliberate choice is respected', () => {
    expect(currencyMismatch(['GB'], 'EUR')).toBe('GBP'); expect(currencyMismatch(['GB'], 'GBP')).toBeNull(); expect(currencyMismatch(['GB', 'DE'], 'EUR')).toBeNull()
    const s = buildStrategy({ ...EMPTY_BRIEF, name: 'x', countries: ['GB'], currency: 'EUR', totalBudget: 500 })
    expect(s.warnings.join(' ')).toMatch(/libras|GBP/)
    expect(buildStrategy({ ...EMPTY_BRIEF, name: 'x', countries: ['GB'], currency: 'GBP', totalBudget: 500 }).warnings.join(' ')).not.toMatch(/usan GBP/)
    expect(CURRENCY_NAME.GBP).toBe('libras esterlinas')
  })
})

describe('monetization messages do not overstate a borrowed figure', () => {
  const NOW = Date.parse('2026-10-15T12:00:00Z'); let n = 0
  const vid = (title: string): YouTubeVideoResult => ({ videoId: `u${++n}`, url: '', title, channelId: `c${n}`, channelTitle: 'C', publishedAt: new Date(NOW - 10 * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: 'en', observed: { views: 60000, likes: 1, comments: 1, durationSeconds: 600, channelSubscribers: 5000, fetchedAt: '' }, calculated: { viewsPerDay: 6000, viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult)
  const analysisFor = (niches: string[]): TopicAnalysis => {
    const a = analyzeTopic({ topic: 'tema', region: null, language: 'en', recentDays: 30, top: { videos: Array.from({ length: 20 }, (_, i) => vid(`tema guide ${i}`)), approxTotal: 5 }, recent: { videos: Array.from({ length: 12 }, (_, i) => vid(`tema new ${i}`)), approxTotal: 5 }, fetchedAt: new Date(NOW).toISOString(), units: 204 }, NOW)
    return { ...a, niches, confidence: 'media' }
  }
  const moneyTitles = (a: TopicAnalysis) => buildRecommendations({ analyses: [a], charts: {}, filters: EMPTY_FILTERS }).sections.find(s => s.id === 'money')!.items.map(i => (i.kind === 'niche' ? i.topic : ''))
  it('a niche whose figure is borrowed from another niche (confidence «muy baja») never ranks as high-monetization', () => {
    expect(nicheRpm('ia')).toMatchObject({ status: 'estimado', confidence: 'muy baja' })
    expect(moneyTitles(analysisFor(['ia']))).toEqual([])
    expect(moneyTitles(analysisFor(['negocios']))).toEqual([])
  })
  it('a niche with its own figure still qualifies, and the card note says what the figure is', () => {
    expect(formatAdjusted(nicheRpm('tecnologia'), 'long')).toMatchObject({ status: 'estimado', confidence: 'baja' })
    const items = buildRecommendations({ analyses: [analysisFor(['tecnologia'])], charts: {}, filters: EMPTY_FILTERS }).sections.find(s => s.id === 'money')!.items
    expect(items).toHaveLength(1); expect(items[0].kind === 'niche' && items[0].rpmNote).toMatch(/RPM ESTIMADO/)
    expect(THRESHOLDS.money.rpmLow).toBeGreaterThan(0)
  })
  it('the borrowed figure is described as a weak reference wherever it is shown', () => {
    const a = analysisFor(['ia']), card = buildRecommendations({ analyses: [a], charts: {}, filters: EMPTY_FILTERS }).sections.flatMap(s => s.items).find(i => i.kind === 'niche' && i.rpmNote)
    if (card && card.kind === 'niche') expect(card.rpmNote).toMatch(/prestada de otro nicho/)
  })
})
