/**
 * Fidelity meter for the REAL-TIME export.
 *
 * The real-time export records what the screen shows while the montage plays against the wall clock (media elements, rAF, MediaRecorder).
 * If the computer cannot draw frames on time, the project time keeps moving but the picture is held: the file has the right length and
 * sound, yet the image at a given instant can differ from the preview (worst in the middle of transitions). That cannot be made exact by
 * code in this mode, so it is MEASURED and reported instead of hidden. The fast export draws frame by frame and has no such limit.
 */
export type FrameQuality = {
  /** Frames actually drawn while recording. */
  frames: number
  /** Gaps between two drawn frames longer than LATE_GAP_MS. */
  lateFrames: number
  /** Estimated frames that should have been drawn at the target rate but were not (inside the late gaps). */
  droppedEstimate: number
  maxGapMs: number
  /** Longest time between reading the project clock for a frame and handing the finished frame to the recorder: the picture is stamped at least this late. */
  maxWorkMs: number
  /** Frames whose work took longer than WORK_LIMIT_MS. */
  slowFrames: number
  /** True when the picture was held long enough to be visible (see the thresholds below). */
  degraded: boolean
}

/** A gap above this is a visible hitch (about 5 frames at 60 Hz, 2.4 at 30 fps). */
export const LATE_GAP_MS = 80
/** Degraded: any visible hitch (measured: with 4x CPU throttling every hitch of 84-130 ms coincided with a picture that differed from the preview mid-transition), or a freeze of a quarter of a second. */
export const DEGRADED_LATE_FRAMES = 1
export const DEGRADED_MAX_GAP_MS = 250

/** Work per frame above this makes the recorded picture lag the project time visibly in fast transitions (calibrated in docs/informe-p4-7). */
export const WORK_LIMIT_MS = 28
export const DEGRADED_SLOW_FRAMES = 1

export function createFrameQuality(targetFps = 30) {
  const period = 1000 / targetFps
  let prev: number | null = null, frames = 0, late = 0, dropped = 0, maxGap = 0, maxWork = 0, slow = 0
  return {
    /** Call once per drawn frame with the project time (ms) of that frame. */
    push(tMs: number, workMs = 0) {
      frames++
      if (workMs > maxWork) maxWork = workMs
      if (workMs > WORK_LIMIT_MS) slow++
      if (prev !== null) {
        const gap = tMs - prev
        if (gap > maxGap) maxGap = gap
        if (gap > LATE_GAP_MS) { late++; dropped += Math.max(0, Math.round(gap / period) - 1) }
      }
      prev = tMs
    },
    summary(): FrameQuality {
      return { frames, lateFrames: late, droppedEstimate: dropped, maxGapMs: Math.round(maxGap), maxWorkMs: Math.round(maxWork), slowFrames: slow, degraded: late >= DEGRADED_LATE_FRAMES || maxGap >= DEGRADED_MAX_GAP_MS || slow >= DEGRADED_SLOW_FRAMES }
    },
  }
}

/** Text shown to the person when the real-time export could not keep up. */
export function fidelityWarning(q: FrameQuality | undefined | null): string {
  if (!q?.degraded) return ''
  return `Este equipo no pudo dibujar todos los fotogramas a tiempo en el modo tiempo real: ${q.lateFrames} saltos (el mayor de ${Math.round(q.maxGapMs)} ms, unos ${q.droppedEstimate} fotogramas sin dibujar). El vídeo dura lo que debe y suena bien, pero la imagen puede ir a saltos y no coincidir exactamente con la vista previa, sobre todo en las transiciones. Para un resultado exacto, exporta en modo rápido.`
}
