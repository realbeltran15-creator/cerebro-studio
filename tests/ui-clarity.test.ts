import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { CostBadge, CostLegend, GrowthControl, QuotaExplainer, QuotaNote } from '@/app/market-intelligence/insight-panels'
import { growthStatus, type TopicAnalysis } from '@/lib/research/topic-analysis'
import { statusLabel } from '@/lib/research/labels'

// Pure rendering of the new-user explanations. No browser, no YouTube.
const NOW = Date.parse('2026-10-16T12:00:00Z')
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
