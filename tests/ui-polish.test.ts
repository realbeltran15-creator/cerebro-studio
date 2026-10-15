import { describe, expect, it } from 'vitest'
import { autoPick } from '@/lib/providers/auto-model'
import { readFileSync } from 'node:fs'

describe('Miniaturas: the default model is never a paid one', () => {
  const r = (id: string, tier: 'free' | 'local' | 'credits' | 'freemium' | 'paid', eligible = true) => ({ eligible, model: { id, tier } })
  it('«Automático» picks the best eligible FREE model, skipping better paid ones', () => {
    const { auto, paidEligible } = autoPick([r('best-paid', 'paid'), r('good-credits', 'credits'), r('free-ok', 'free'), r('local-ok', 'local')])
    expect(auto?.model.id).toBe('free-ok'); expect(paidEligible.map(x => x.model.id)).toEqual(['best-paid', 'good-credits'])
  })
  it('with only paid models eligible nothing is preselected, and the paid ones are offered for an explicit choice', () => {
    const { auto, paidEligible } = autoPick([r('paid-a', 'paid'), r('credits-b', 'credits'), r('free-not-eligible', 'free', false)])
    expect(auto).toBeNull(); expect(paidEligible).toHaveLength(2)
  })
  it('a freemium model is not treated as free by default', () => { expect(autoPick([r('g', 'freemium')]).auto).toBeNull() })
})

describe('screens do not expose internal variable names in the open', () => {
  const files = ['app/connectors/page.tsx', 'app/radar/page.tsx', 'app/automations/page.tsx', 'app/scripts/page.tsx', 'app/shorts/page.tsx', 'app/analytics/page.tsx', 'app/components/stock-browser.tsx', 'app/components/flow-import.tsx', 'app/components/provider-directory.tsx']
  it('every environment-variable name sits inside <AdminHint>, never in the visible sentence', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      // Remove the AdminHint usages (the only place names may appear), then no variable-looking token may remain in JSX text.
      const visible = src.replace(/<AdminHint[^>]*\/>/g, '')
      expect(visible, f).not.toMatch(/<code>[A-Z][A-Z0-9]+_[A-Z0-9_]+<\/code>/)
      expect(visible, f).not.toMatch(/(?:faltan?|necesita|Configura)\s+(?:<code>)?[A-Z][A-Z0-9]+_[A-Z0-9_]{3,}/)
      expect(visible, f).not.toMatch(/NEXT_PUBLIC_[A-Z_]+ y /)
    }
  })
  it('Conectores speaks in plain states, not internal health codes', () => {
    const src = readFileSync('app/connectors/page.tsx', 'utf8')
    expect(src).toMatch(/Listo para usar/); expect(src).toMatch(/Falta configurarlo/); expect(src).toMatch(/Funciona con problemas/)
    expect(src).not.toMatch(/Estado: \{c\.enabled \? c\.health/); expect(src).not.toMatch(/<h3>Runtime<\/h3>/)
  })
})
