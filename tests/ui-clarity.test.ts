import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { CostBadge, CostLegend, CostSummary, GrowthControl, QuotaExplainer, QuotaNote } from '@/app/market-intelligence/insight-panels'
import { growthStatus, type TopicAnalysis } from '@/lib/research/topic-analysis'
import { statusLabel } from '@/lib/research/labels'

// Pure rendering of the new-user explanations. No browser, no YouTube.
const NOW = Date.parse('2026-10-16T12:00:00Z')
// GrowthControl reads Date.now(); freeze it so the fixtures don't expire with the real clock.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })
const growth = (over: Partial<TopicAnalysis['growth']>): TopicAnalysis['growth'] => ({ state: 'no_calculable', reason: 'Falta la ventana anterior.', windowDays: 30, recent: { n: 12, medianVpd: 100 }, ...over })
const an = (g: TopicAnalysis['growth'], fetchedAt = new Date(NOW).toISOString()) => ({ topic: 'tema', region: null, language: 'es', recentDays: 30, fetchedAt, growth: g }) as unknown as TopicAnalysis
const html = (a: TopicAnalysis, busy = false) => renderToStaticMarkup(createElement(GrowthControl, { a, busy, onMeasure: () => undefined }))

describe('«Medir crecimiento» says whether a valid measurement already exists', () => {
  it('never measured: offers the button with its cost in units and searches', () => {
    expect(growthStatus(an(growth({}))).kind).toBe('sin_medir')
    const h = html(an(growth({}))); expect(h).toMatch(/<button/); expect(h).toMatch(/Medir crecimiento \(≈ 102 unidades, 1 búsqueda\)/)
  })
  it('measured and calculable: no button, shows the date and the result, and explains why repeating is pointless', () => {
    const a = an(growth({ state: 'calculable', label: 'al alza (posible)', ratio: 2.3, previous: { n: 10, medianVpd: 40 }, measuredAt: new Date(NOW - 86400000).toISOString() }))
    expect(growthStatus(a, NOW).kind).toBe('vigente')
    const h = html(a); expect(h).not.toMatch(/<button/); expect(h).toMatch(/ya medido/); expect(h).toMatch(/al alza/); expect(h).toMatch(/gastaría cuota/)
  })
  it('measured but not calculable: no button either, says so and why', () => {
    const a = an(growth({ previous: { n: 3, medianVpd: 20 }, reason: 'La ventana anterior tiene 3 vídeos relevantes; hacen falta 8.', measuredAt: new Date(NOW - 3600000).toISOString() }))
    expect(growthStatus(a, NOW).kind).toBe('medido_no_calculable')
    const h = html(a); expect(h).not.toMatch(/<button/); expect(h).toMatch(/sin resultado/); expect(h).toMatch(/hacen falta 8/)
  })
  it('an expired measurement can be repeated, and the button says it expired', () => {
    const a = an(growth({ previous: { n: 9, medianVpd: 20 }, measuredAt: new Date(NOW - 9 * 86400000).toISOString() }))
    expect(growthStatus(a, NOW).kind).toBe('caducado'); const h = html(a); expect(h).toMatch(/<button/); expect(h).toMatch(/caducó/)
  })
  it('while measuring the button is disabled', () => { expect(html(an(growth({})), true)).toMatch(/disabled/) })
  it('an analysis saved before measurements carried a date falls back to its own date', () => {
    expect(growthStatus(an(growth({ previous: { n: 9, medianVpd: 20 } }), new Date(NOW - 86400000).toISOString()), NOW).kind).toBe('medido_no_calculable')
  })
})

describe('the quota is explained in plain words', () => {
  const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
  it('units are not money, search limit is separate, and nothing is charged by this app', () => {
    const t = text(createElement(QuotaExplainer))
    expect(t).toMatch(/No son dinero/); expect(t).toMatch(/segundo límite/); expect(t).toMatch(/no cobra por unidad/); expect(t).toMatch(/medianoche, hora del Pacífico/); expect(t).toMatch(/Es gratis/)
  })
  it('the cost legend and badges separate what is free from what spends quota', () => {
    expect(text(createElement(CostLegend))).toMatch(/Gratis/); expect(text(createElement(CostLegend))).toMatch(/Gasta cuota/)
    expect(text(createElement(CostBadge, { kind: 'free' }))).toContain('Gratis'); expect(text(createElement(CostBadge, { kind: 'cost' }))).toContain('Gasta cuota')
  })
  it('no technical words reach the person', () => {
    const all = [text(createElement(QuotaExplainer)), text(createElement(CostLegend)), text(createElement(QuotaNote, { usage: { usedToday: 0, cap: 6000, searchesToday: 0, searchCap: 60, persistent: false, exhausted: false } }))].join(' ')
    for (const w of [/migraci/i, /research_cache/, /discovered/, /análisis de pago/i, /payload/i, /RLS/, /snapshot/i]) expect(all).not.toMatch(w)
  })
  it('opportunity states are shown in Spanish, never as stored codes', () => {
    expect(statusLabel('discovered')).toBe('Descubierta'); expect(statusLabel('research_needed')).toBe('Necesita investigación'); expect(statusLabel('some_new_state')).toBe('some new state')
  })
})

describe('P3 — growth badge date, both limits explained, cost always visible', () => {
  it('«ya medido el …» has no stray comma or empty date, whatever the date', () => {
    const a = an(growth({ state: 'calculable', label: 'al alza (posible)', ratio: 2, previous: { n: 10, medianVpd: 1 }, measuredAt: '2026-10-17T10:00:00Z' }))
    const h = html(a); expect(h).toMatch(/ya medido el 17 oct/); expect(h).not.toMatch(/ya medido el ,|el ,|, ?17/)
    expect(renderToStaticMarkup(createElement(CostBadge, { kind: 'free' }, 'ya medido el ', '17 oct'))).toContain('ya medido el 17 oct')
    expect(html(an(growth({ previous: { n: 3, medianVpd: 1 }, measuredAt: '2026-10-17T10:00:00Z' })))).toMatch(/medido el 17 oct, sin resultado/)
  })
  it('the explainer states the 100-searches limit next to the 10,000 units', () => {
    const t = renderToStaticMarkup(createElement(QuotaExplainer)); expect(t).toMatch(/100 al día/); expect(t).toMatch(/10\.000 unidades/); expect(t).toMatch(/Se acaba el que llegue antes/)
  })
  it('every action shows its cost in units AND searches against both limits, also when it is free', () => {
    const h = renderToStaticMarkup(createElement(CostSummary, { units: 204, searches: 2, usage: { usedToday: 408, cap: 6000, searchesToday: 4, searchCap: 60 } }))
    expect(h).toMatch(/204 unidades y 2 búsquedas/); expect(h).toMatch(/10\.000 unidades y 100 búsquedas/); expect(h).toMatch(/408 de 6\.?000 unidades y 4 de 60 búsquedas/)
    expect(renderToStaticMarkup(createElement(CostSummary, { units: 0, searches: 0 }))).toMatch(/0 unidades y 0 búsquedas/)
    expect(renderToStaticMarkup(createElement(CostSummary, { units: 1, searches: 1 }))).toMatch(/1 unidad y 1 búsqueda\./)
  })
  it('the search plans count searches: 2 per analysis, 1 per market search, 0 for charts', async () => {
    const { searchPlanFor, planLabel } = await import('@/lib/research/search-plan'), { EMPTY_FILTERS } = await import('@/lib/research/filters')
    const q = { niches: 'tema a, tema b', keywords: '', competition: 'invertir', international: '', order: 'relevance', perMarket: 3 } as never
    const f = { ...EMPTY_FILTERS, countries: ['US', 'DE'] }
    const p = searchPlanFor('niches', f, q, { analyses: {}, charts: {}, remainingToday: 6000 })
    expect(p.searches).toBe(p.fresh * 2); expect(planLabel(p)).toMatch(/\(\d[\d.]* unidades · \d+ búsquedas\)/)
    const s = searchPlanFor('competition', f, q, { analyses: {}, charts: {}, remainingToday: 6000 }); expect(s.searches).toBe(2); expect(planLabel(s)).toMatch(/2 búsquedas/)
    const c = searchPlanFor('discover', { ...f, countries: ['US'] }, q, { analyses: {}, charts: {}, remainingToday: 6000 }); expect(c.searches).toBe(0); expect(planLabel(c)).toMatch(/0 búsquedas/)
  })
})
