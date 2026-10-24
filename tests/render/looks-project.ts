/**
 * «Looks» project for the engine-vs-editor comparison: a textured picture (so crops, turns and camera moves show) treated with filters, blur,
 * grade, opacity, rotation, crop, camera moves, speed, a video, titles with animations, outlines, shadows and a box, and subtitles in each style.
 */
import { emptyComposition, type Composition } from '../../lib/editor/composition'
import { addClip, addTextClip, updateClip } from '../../lib/editor/timeline'

export const LOOK_MEDIA: Record<string, { kind: 'image' | 'video'; file: string }> = { tex: { kind: 'image', file: 'tex.png' }, mov: { kind: 'video', file: 'mov.webm' } }

export function looksProject(): Composition {
  let c: Composition = { ...emptyComposition('lk', 'Looks'), editedManually: true, fadeMs: 0, subtitles: true, duckMusic: false, captionStyle: 'box' }
  for (let i = 0; i < 8; i++) c = addClip(c, i === 6 ? 'mov' : 'tex', 3000)
  const set = (i: number, p: object) => { c = updateClip(c, c.clips[i].id, p) }
  set(0, { filters: { brightness: 1.2, contrast: 1.3, saturation: 0.4, blur: 0 }, camera: { kind: 'zoom_in', amount: 0.2 } })
  set(1, { filters: { brightness: 1, contrast: 1, saturation: 1, blur: 3 }, rotation: 12, crop: { left: 0.1, top: 0.05, right: 0.1, bottom: 0.05 } })
  set(2, { grade: { brightness: 1.1, contrast: 1.1, saturation: 0.8, warmth: 0.6, strength: 1, enabled: true }, opacity: 0.7 })
  set(3, { camera: { kind: 'pan_left', amount: 0.15 }, zoom: 1.4, focusX: 0.3, focusY: 0.6 })
  set(4, { narration: 'Subtítulos de prueba', captionStyle: 'bold' })
  set(5, { narration: 'Palabra a palabra aquí', captionStyle: 'karaoke' })
  set(6, { speed: 0.5, trimInMs: 1000, filters: { brightness: 1, contrast: 1, saturation: 0.6, blur: 0 } })
  set(7, { narration: 'Cuadro clásico', captionPosition: 'top' })
  c = addTextClip(c, { content: 'TITULO UNO', startMs: 12000, durationMs: 3000, position: 'center', sizePct: 10, animation: 'none', color: '#ffffff', outline: '#000000', outlineWidth: 12, shadow: true })
  c = addTextClip(c, { content: 'Caja y sombra', startMs: 15000, durationMs: 3000, position: 'bottom', sizePct: 7, animation: 'none', color: '#ffee00', background: '#000000', backgroundOpacity: 0.6, shadow: true, font: 'serif' })
  c = addTextClip(c, { content: 'LIBRE', startMs: 18000, durationMs: 3000, position: 'top', sizePct: 9, animation: 'none', color: '#ff3366', x: 0.25, y: 0.3, font: 'condensed' })
  return { ...c, exportSettings: { quality: 'normal', resolution: '720', destination: 'download' } }
}
/** One time per clip, in the middle of it (the titles run over clips 4–7, so they are compared at the same times). */
export const LOOK_TIMES = [1500, 4500, 7500, 10500, 13500, 16500, 19500, 22500]
