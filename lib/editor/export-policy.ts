/**
 * Export policy for the private beta.
 *
 * The real-time export (play the project and record the canvas) follows the wall clock, not project time, so under CPU load its
 * picture can differ from the preview (measured in P4.6/P4.7). The fast export (WebCodecs, frame by frame, project time) is exact.
 * While REALTIME_EXPORT_ENABLED is false, a saved file can only come out of the fast path:
 *  - the mode selector is locked on "fast" and a project saved with mode "realtime" is exported as "fast";
 *  - when the fast path cannot run (unsupported codec, unreadable file…), the export FAILS with the reason instead of silently falling back.
 * The real-time code (player, renderer, fidelity meter, tests) is kept for future work, and the preview still uses the player.
 */
export const REALTIME_EXPORT_ENABLED = false as boolean

export type ExportMode = 'fast' | 'realtime'

/** The mode an export really uses, whatever the project says. */
export const effectiveExportMode = (requested?: ExportMode | null): ExportMode =>
  REALTIME_EXPORT_ENABLED && requested === 'realtime' ? 'realtime' : 'fast'

/** Whether a failed fast export may be redone with the real-time recorder. */
export const mayFallBackToRealtime = (): boolean => REALTIME_EXPORT_ENABLED

/** Whether exporting needs MediaRecorder/captureStream support (only the real-time path does). */
export const exportNeedsRecorder = (): boolean => REALTIME_EXPORT_ENABLED
