import { describe, expect, it } from 'vitest'
import { groupedModules, moduleGroups, studioModules } from '@/lib/module-status'

describe('sidebar groups', () => {
  it('places every module exactly once, Inicio first, in work-cycle order', () => {
    const g = groupedModules()
    expect(g[0].modules.map(m => m.href)).toEqual(['/'])
    expect(g.slice(1).map(x => x.id)).toEqual(moduleGroups.map(x => x.id))
    expect(g.flatMap(x => x.modules).length).toBe(studioModules.length)
    expect(studioModules.filter(m => m.href !== '/').every(m => m.group)).toBe(true)
  })
})
