'use client'

/**
 * Keeps a long export alive and tells the person what is happening:
 * - holds a Web Lock while it runs. Chrome only freezes hidden tabs in Energy Saver mode, after 5 minutes hidden and silent, and never
 *   while the tab holds a lock another context is waiting for (a second editor tab exporting at the same time waits for this one, so
 *   neither is frozen mid-export). A hidden tab is otherwise throttled, not stopped: the export uses no animation frames, only codecs
 *   and the library's own unthrottled timers, so it keeps going, more slowly;
 * - keeps the screen awake while the tab is visible (Screen Wake Lock, where the browser offers it);
 * - asks before the tab is closed or reloaded (the video only exists in this tab's memory until it is saved);
 * - notices when the tab is hidden and when progress stops, so the panel can say so instead of looking frozen.
 * Everything is free and local; when an API is missing the guard simply does less.
 */
export type GuardEvent =
  | { type: 'hidden' }
  | { type: 'visible'; hiddenMs: number }
  | { type: 'stalled'; sinceMs: number; hidden: boolean }
  | { type: 'resumed' }

export type ExportGuard = { progress: () => void; stop: () => void; hiddenMs: () => number; locked: boolean }

type Env = {
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  nav?: { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<unknown> }; wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
  now?: () => number
  setInterval?: (f: () => void, ms: number) => unknown
  clearInterval?: (h: unknown) => void
}

export const STALL_MS = 20_000

export function startExportGuard(onEvent: (e: GuardEvent) => void, env: Env = {}): ExportGuard {
  const doc = env.doc ?? (typeof document !== 'undefined' ? document : undefined)
  const win = env.win ?? (typeof window !== 'undefined' ? window : undefined)
  const nav = env.nav ?? (typeof navigator !== 'undefined' ? (navigator as unknown as Env['nav']) : undefined)
  const now = env.now ?? (() => Date.now())
  const every = env.setInterval ?? ((f, ms) => setInterval(f, ms))
  const clear = env.clearInterval ?? (h => clearInterval(h as ReturnType<typeof setInterval>))

  let stopped = false
  let lastProgress = now()
  let stalled = false
  let hiddenSince: number | null = doc?.visibilityState === 'hidden' ? now() : null
  let hiddenTotal = 0
  let wake: { release: () => Promise<void> } | null = null

  // Web Lock: held until stop() resolves it.
  let releaseLock: (() => void) | null = null
  let locked = false
  if (nav?.locks?.request) {
    locked = true
    void nav.locks.request('cerebro-export', () => new Promise<void>(r => { releaseLock = r })).catch(() => undefined)
  }
  const wakeUp = () => { if (!stopped && !wake && doc?.visibilityState !== 'hidden') void nav?.wakeLock?.request('screen').then(w => { if (stopped) void w.release().catch(() => undefined); else wake = w }, () => undefined) }
  wakeUp()

  const onVis = () => {
    if (doc?.visibilityState === 'hidden') {
      hiddenSince ??= now()
      wake = null // the browser releases it when hidden
      onEvent({ type: 'hidden' })
    } else {
      const ms = hiddenSince === null ? 0 : now() - hiddenSince
      hiddenTotal += ms
      hiddenSince = null
      wakeUp()
      onEvent({ type: 'visible', hiddenMs: ms })
    }
  }
  const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
  doc?.addEventListener('visibilitychange', onVis)
  win?.addEventListener('beforeunload', onBeforeUnload as EventListener)

  const timer = every(() => {
    if (stopped) return
    const since = now() - lastProgress
    if (!stalled && since >= STALL_MS) { stalled = true; onEvent({ type: 'stalled', sinceMs: since, hidden: doc?.visibilityState === 'hidden' }) }
  }, 5_000)

  return {
    locked,
    progress() {
      lastProgress = now()
      if (stalled) { stalled = false; onEvent({ type: 'resumed' }) }
    },
    hiddenMs: () => hiddenTotal + (hiddenSince === null ? 0 : now() - hiddenSince),
    stop() {
      if (stopped) return
      stopped = true
      clear(timer)
      doc?.removeEventListener('visibilitychange', onVis)
      win?.removeEventListener('beforeunload', onBeforeUnload as EventListener)
      ;(releaseLock as (() => void) | null)?.()
      void wake?.release().catch(() => undefined)
    },
  }
}
