/**
 * What a browser export costs in memory, from measurements (scripts/measure-local.mjs, real Chromium, the editor's own exporter):
 * the finished file is assembled in memory and copied once into a Blob, and the JavaScript heap peaked at 2.0–2.7 × the size of the output
 * (58 MB → 160 MB, 181 MB → 477 MB, 362 MB → 732 MB). A long 1080p montage therefore needs several GB of free memory in one tab.
 */
export const BROWSER_EXPORT_WARN_BYTES = 1024 ** 3
/** Heap needed ≈ 2.7 × output (the worst ratio measured). */
export const HEAP_FACTOR = 2.7

export type ExportAdvice = { level: 'ok' | 'heavy'; estimatedGB: number; neededGB: number; message: string }
export function browserExportAdvice(estimatedBytes: number): ExportAdvice {
  const gb = (b: number) => Math.round(b / 1024 ** 3 * 10) / 10
  const estimatedGB = gb(estimatedBytes), neededGB = gb(estimatedBytes * HEAP_FACTOR)
  if (estimatedBytes < BROWSER_EXPORT_WARN_BYTES) return { level: 'ok', estimatedGB, neededGB, message: '' }
  const fmt = (n: number) => n.toLocaleString('es-ES')
  return { level: 'heavy', estimatedGB, neededGB, message: `Este vídeo pesará unos ${fmt(estimatedGB)} GB y exportarlo en el navegador necesita unos ${fmt(neededGB)} GB de memoria libre en esta pestaña; si el navegador se queda sin memoria, la exportación se pierde. Para vídeos largos usa «Paquete para renderizar en mi PC» (render con FFmpeg, sin navegador y sin límite de memoria).` }
}
