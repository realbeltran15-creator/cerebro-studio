import { describe, expect, it } from 'vitest'
import { parseKeywords, trendWatchFormConfig } from '@/lib/automations/keywords'
import { matchKeywords, trendWatchConfig } from '@/lib/automations/run'
import { importSummary } from '@/lib/analytics/summary'

describe('trend-watch keywords', () => {
  it('stores exactly the keywords typed in the form', () => {
    const config = trendWatchFormConfig({ region: 'ES', categoryId: '', keywords: 'supervivencia, rescate, expedición', autoSave: true })
    expect(config).toEqual({ region: 'ES', categoryId: null, keywords: ['supervivencia', 'rescate', 'expedición'], autoSave: true })
  })

  it('normalizes spacing, case and duplicates without inventing words', () => {
    expect(parseKeywords('  Rescate ,rescate;  Expedición   polar\n x')).toEqual(['rescate', 'expedición polar'])
    expect(parseKeywords('')).toEqual([])
  })

  it('runner uses the stored keywords, not defaults', () => {
    const cfg = trendWatchConfig({ region: 'ES', keywords: ['supervivencia', 'rescate', 'expedición'], autoSave: true })
    expect(cfg.keywords).toEqual(['supervivencia', 'rescate', 'expedición'])
    const video = (title: string) => ({ title }) as never
    const hits = matchKeywords([video('Expedicion al Everest'), video('Animados virales 2026'), video('RESCATE en la montaña')], cfg.keywords)
    expect(hits.map((v: { title: string }) => v.title)).toEqual(['Expedicion al Everest', 'RESCATE en la montaña'])
  })
})

describe('analytics import summary', () => {
  it('explains requested period vs days YouTube returned (processing lag)', () => {
    const text = importSummary({ requestedDays: 28, days: 26, videos: 0, period: { startDate: '2026-08-30', endDate: '2026-09-26' }, dataRange: { startDate: '2026-08-30', endDate: '2026-09-24' } })
    expect(text).toContain('Solicitados 28 días (2026-08-30 → 2026-09-26)')
    expect(text).toContain('26 días con datos (2026-08-30 → 2026-09-24)')
    expect(text).toContain('2–3 días')
  })
})
