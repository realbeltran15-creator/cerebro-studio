import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { effectiveExportMode, exportNeedsRecorder, mayFallBackToRealtime, REALTIME_EXPORT_ENABLED } from '../lib/editor/export-policy'
import { emptyComposition, exportPlan, parseComposition } from '../lib/editor/composition'

describe('beta export policy: only the exact (fast) path produces a saved file', () => {
  it('the real-time export is switched off', () => {
    expect(REALTIME_EXPORT_ENABLED).toBe(false)
    expect(mayFallBackToRealtime()).toBe(false)
    expect(exportNeedsRecorder()).toBe(false)
  })
  it('any requested mode resolves to fast, including old projects saved with realtime', () => {
    for (const m of [undefined, null, 'fast', 'realtime'] as const) expect(effectiveExportMode(m)).toBe('fast')
    // A project saved earlier with mode realtime still parses (nothing is lost), but is exported as fast.
    const saved = parseComposition(JSON.parse(JSON.stringify({ ...emptyComposition('b', 't', '16:9'), exportSettings: { quality: 'normal', mode: 'realtime' } })))
    expect(saved?.exportSettings?.mode).toBe('realtime')
    expect(effectiveExportMode(saved?.exportSettings?.mode)).toBe('fast')
  })
  it('the export plan does not depend on the mode (resolution, fps, bitrate)', () => {
    const base = { clips: [], format: '16:9' as const }
    const a = exportPlan({ ...base, exportSettings: { quality: 'normal' } }), b = exportPlan({ ...base, exportSettings: { quality: 'normal', mode: 'realtime' } })
    expect(b.width).toBe(a.width); expect(b.height).toBe(a.height); expect(b.fps).toBe(a.fps)
  })
})

describe('the export panel has no door to the real-time recorder', () => {
  const src = readFileSync(new URL('../app/components/render-panel.tsx', import.meta.url), 'utf8')
  it('the mode selector is locked and offers no real-time option while the policy is off', () => {
    expect(src).toMatch(/aria-label="Modo de exportación"[^>]*disabled=\{!REALTIME_EXPORT_ENABLED\}/)
    expect(src).toMatch(/\{REALTIME_EXPORT_ENABLED && <option value="realtime"/)
  })
  it('a failing fast export throws before it could reach the real-time fallback', () => {
    const guard = src.indexOf('if (!mayFallBackToRealtime()) throw')
    const fallback = src.indexOf('result = await realtime()')
    expect(guard).toBeGreaterThan(0)
    expect(fallback).toBeGreaterThan(guard)
  })
  it('the only direct use of the recorder for a saved file is behind the fast-mode check', () => {
    // `renderComposition` is called once, inside the `realtime` helper; a saved export with the policy off always takes the fast branch.
    expect(src.match(/renderComposition\(/g)?.length).toBe(1)
    expect(src).toContain("if (record && effectiveExportMode(exp.mode) === 'fast')")
    expect(src.match(/await realtime\(\)/g)?.length).toBe(2)
  })
  it('no other module records the canvas for a saved file', () => {
    for (const f of ['../app/editor/manual/page.tsx', '../app/editor/page.tsx', '../app/editor/auto/page.tsx', '../app/shorts/page.tsx', '../app/repurpose/page.tsx', '../app/editor/style/page.tsx']) {
      const t = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(t, f).not.toMatch(/renderComposition|MediaRecorder|captureStream/)
    }
  })
})
