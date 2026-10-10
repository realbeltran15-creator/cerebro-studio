import { describe, expect, it } from 'vitest'
import { calculatedSummary, metricSortValue, observedSummary, viewsHistory } from '@/lib/opportunity-metrics'

describe('opportunity metrics display', () => {
  const observed = { views: 15000, likes: 50, durationSeconds: 3723, fetchedAt: '2026-09-26T10:00:00Z', history: [{ fetchedAt: '2026-09-24T10:00:00Z', views: 10000 }, { junk: true }], source: 'youtube_data_api' }
  const calculated = { viewsPerDay: 100, viewsGainedSinceLastCheck: 500, formula: { viewsPerDay: 'x' } }

  it('lists only known numeric metrics, keeping observed and calculated apart', () => {
    expect(observedSummary(observed)).toEqual(['15.000 vistas', '50 likes', '62:03 duración'])
    expect(calculatedSummary(calculated)).toEqual(['100 vistas/día', '+500 vistas desde la última lectura'])
    expect(observedSummary(null)).toEqual([])
  })

  it('builds the views history from stored readings plus the current one', () => {
    expect(viewsHistory(observed).map(h => h.views)).toEqual([10000, 15000])
  })

  it('sorts opportunities without the metric last', () => {
    expect(metricSortValue(observed, calculated, 'viewsPerDay')).toBe(100)
    expect(metricSortValue(observed, calculated, 'growth')).toBe(Number.NEGATIVE_INFINITY)
    expect(metricSortValue({}, {}, 'viewsToSubscribers')).toBe(Number.NEGATIVE_INFINITY)
  })
})
