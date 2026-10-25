/** Horizontal timeline zoom driven by Alt + wheel. Pure maths so the page and the tests share one implementation. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 200
const SENSITIVITY = 0.0015

export const clampZoom = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))

/** Wheel delta in pixels whatever the device reports (lines / pages / pixels). Some browsers turn Alt+wheel into a horizontal delta. */
export function wheelDelta(e: { deltaY: number; deltaX: number; deltaMode: number }): number {
  const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX
  return e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * 100 : raw
}

/** Wheel up (negative delta) zooms in; down zooms out. Exponential so each notch is the same relative step; one notch is capped. */
export function zoomAfterWheel(pxPerSec: number, delta: number): number {
  if (!delta) return clampZoom(pxPerSec)
  const d = Math.max(-240, Math.min(240, delta))
  return clampZoom(Math.round(pxPerSec * Math.exp(-d * SENSITIVITY) * 100) / 100)
}

/** Scroll position that keeps the instant under the cursor at the same screen x after a zoom change. */
export function anchoredScrollLeft(oldPx: number, newPx: number, scrollLeft: number, cursorX: number, contentWidth: number, viewWidth: number): number {
  const t = (scrollLeft + cursorX) / oldPx
  const left = t * newPx - cursorX
  return Math.max(0, Math.min(left, Math.max(0, contentWidth - viewWidth)))
}

/** Scroll that puts instant `t` (seconds) at screen x for the new scale. */
export const scrollForAnchor = (t: number, newPx: number, cursorX: number) => Math.max(0, t * newPx - cursorX)
