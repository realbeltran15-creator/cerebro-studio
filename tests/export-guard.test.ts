import { describe, expect, it } from 'vitest'
import { startExportGuard, STALL_MS, type GuardEvent } from '@/lib/editor/export-guard'

function fakeEnv() {
  let t = 0, vis: 'visible' | 'hidden' = 'visible'
  const listeners: Record<string, Array<(e: unknown) => void>> = {}
  const winL: Record<string, Array<(e: unknown) => void>> = {}
  let tick: (() => void) | null = null
  let lockHeld = false, lockReleased = false, wakeRequests = 0, wakeReleased = 0
  const env = {
    now: () => t,
    setInterval: (f: () => void) => { tick = f; return 1 },
    clearInterval: () => { tick = null },
    doc: {
      get visibilityState() { return vis },
      addEventListener: (n: string, f: (e: unknown) => void) => { (listeners[n] ??= []).push(f) },
      removeEventListener: (n: string, f: (e: unknown) => void) => { listeners[n] = (listeners[n] ?? []).filter(x => x !== f) },
    } as unknown as Document,
    win: {
      addEventListener: (n: string, f: (e: unknown) => void) => { (winL[n] ??= []).push(f) },
      removeEventListener: (n: string, f: (e: unknown) => void) => { winL[n] = (winL[n] ?? []).filter(x => x !== f) },
    } as unknown as Window,
    nav: {
      locks: { request: (_: string, cb: () => Promise<void>) => { lockHeld = true; return cb().then(() => { lockReleased = true }) } },
      wakeLock: { request: async () => { wakeRequests++; return { release: async () => { wakeReleased++ } } } },
    },
  }
  return {
    env,
    advance: (ms: number) => { t += ms; tick?.() },
    setVis: (v: 'visible' | 'hidden') => { vis = v; for (const f of listeners.visibilitychange ?? []) f({}) },
    unload: () => { const e = { preventDefault() { (e as { prevented?: boolean }).prevented = true }, returnValue: 'x', prevented: false }; for (const f of winL.beforeunload ?? []) f(e); return e },
    state: () => ({ lockHeld, lockReleased, wakeRequests, wakeReleased, ticking: !!tick, vlisteners: (listeners.visibilitychange ?? []).length, ulisteners: (winL.beforeunload ?? []).length }),
  }
}

describe('export guard', () => {
  it('holds a Web Lock and a wake lock while the export runs and releases both at the end', async () => {
    const f = fakeEnv()
    const g = startExportGuard(() => undefined, f.env)
    await Promise.resolve(); await Promise.resolve()
    expect(g.locked).toBe(true)
    expect(f.state().lockHeld).toBe(true)
    expect(f.state().wakeRequests).toBe(1)
    g.stop()
    await new Promise(r => setTimeout(r, 0))
    expect(f.state().lockReleased).toBe(true)
    expect(f.state().wakeReleased).toBe(1)
    expect(f.state()).toMatchObject({ ticking: false, vlisteners: 0, ulisteners: 0 })
  })

  it('asks before closing the tab during the export, and not after', () => {
    const f = fakeEnv()
    const g = startExportGuard(() => undefined, f.env)
    expect(f.unload().prevented).toBe(true)
    g.stop()
    expect(f.unload().prevented).toBe(false)
  })

  it('reports the tab being hidden and for how long', () => {
    const f = fakeEnv(), ev: GuardEvent[] = []
    const g = startExportGuard(e => ev.push(e), f.env)
    f.setVis('hidden'); f.advance(7000); f.setVis('visible')
    expect(ev).toEqual([{ type: 'hidden' }, { type: 'visible', hiddenMs: 7000 }])
    expect(g.hiddenMs()).toBe(7000)
    g.stop()
  })

  it('notices when progress stops (and says whether the tab is hidden), and when it moves again', () => {
    const f = fakeEnv(), ev: GuardEvent[] = []
    const g = startExportGuard(e => ev.push(e), f.env)
    f.advance(5000); g.progress(); f.advance(STALL_MS - 1000)
    expect(ev).toEqual([])
    f.setVis('hidden'); f.advance(5000)
    expect(ev.at(-1)).toMatchObject({ type: 'stalled', hidden: true })
    f.advance(5000)
    expect(ev.filter(e => e.type === 'stalled')).toHaveLength(1)
    g.progress()
    expect(ev.at(-1)).toEqual({ type: 'resumed' })
    g.stop()
  })

  it('works (doing less) when the browser has no locks or wake lock', () => {
    const f = fakeEnv()
    const g = startExportGuard(() => undefined, { ...f.env, nav: {} })
    expect(g.locked).toBe(false)
    g.stop()
  })
})
