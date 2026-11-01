import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadToCloud, removeFromCloud } from '@/lib/storage/client'

/**
 * Text composed ON TOP of a thumbnail, in the browser and for free. Image models often misspell text inside the picture; drawing it
 * afterwards guarantees exactly the words chosen, legible at YouTube's small sizes (bold, outlined, max 2 lines, 1280×720 output).
 * The result is a NEW thumbnail asset that keeps a link to the original (provenance.composedFrom); the original is never modified.
 */
export type TextPosition = 'top' | 'bottom' | 'center'
export type TextStyle = { position: TextPosition; color: string; outline: string; uppercase: boolean }
export const DEFAULT_TEXT_STYLE: TextStyle = { position: 'bottom', color: '#ffffff', outline: '#000000', uppercase: true }
export const THUMB_W = 1280, THUMB_H = 720
export type ThumbAspect = '16:9' | '9:16' | '1:1'
export const THUMB_SIZES: Record<ThumbAspect, { w: number; h: number }> = { '16:9': { w: 1280, h: 720 }, '9:16': { w: 720, h: 1280 }, '1:1': { w: 1080, h: 1080 } }

/** Cover-crop: where to draw a src of size sw×sh so that it fills w×h without distortion (centered). Pure. */
export function coverRect(sw: number, sh: number, w: number, h: number) {
  if (!(sw > 0) || !(sh > 0)) throw new Error('La imagen no tiene tamaño válido.')
  const scale = Math.max(w / sw, h / sh)
  return { x: (w - sw * scale) / 2, y: (h - sh * scale) / 2, width: sw * scale, height: sh * scale }
}

/** Breaks the text into at most `maxLines` lines that fit `maxWidth`, shrinking the font until they do. Pure (measure is injected). */
export function layoutText(text: string, measure: (s: string, px: number) => number, maxWidth = THUMB_W * 0.9, maxLines = 2, startPx = 150, minPx = 48) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  for (let px = startPx; px >= minPx; px -= 6) {
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (measure(next, px) <= maxWidth) cur = next
      else { if (cur) lines.push(cur); cur = w }
    }
    if (cur) lines.push(cur)
    if (lines.length <= maxLines && lines.every(l => measure(l, px) <= maxWidth)) return { px, lines }
  }
  return null
}

/** y of each line's baseline for the chosen position (8 % margin). */
export function lineBaselines(lines: number, px: number, position: TextPosition, height = THUMB_H) {
  const lh = px * 1.08, block = lh * lines, margin = height * 0.08
  const top = position === 'top' ? margin : position === 'center' ? (height - block) / 2 : height - margin - block
  return Array.from({ length: lines }, (_, i) => top + lh * (i + 0.82))
}

/** Draws the image cover-cropped to 1280×720 with the text on top and returns a JPEG. Browser only. */
export async function composeThumbnail(image: Blob, text: string, style: TextStyle = DEFAULT_TEXT_STYLE, aspect: ThumbAspect = '16:9'): Promise<Blob> {
  const { w: W, h: H } = THUMB_SIZES[aspect]
  const bmp = await createImageBitmap(image)
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const g = canvas.getContext('2d')!
  const r = coverRect(bmp.width, bmp.height, W, H)
  g.drawImage(bmp, r.x, r.y, r.width, r.height)
  const words = style.uppercase ? text.toLocaleUpperCase('es') : text
  const font = (px: number) => `900 ${px}px Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif`
  const k = W / THUMB_W
  const layout = layoutText(words, (s, px) => { g.font = font(px); return g.measureText(s).width }, W * 0.9, H > W ? 4 : 2, Math.round(150 * k), Math.max(28, Math.round(48 * k)))
  if (!layout) throw new Error('El texto no cabe en la miniatura: usa menos palabras (2–4).')
  g.font = font(layout.px); g.textAlign = 'center'; g.lineJoin = 'round'
  g.lineWidth = Math.max(6, layout.px / 9); g.strokeStyle = style.outline; g.fillStyle = style.color
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = layout.px / 10
  lineBaselines(layout.lines.length, layout.px, style.position, H).forEach((y, i) => { g.strokeText(layout.lines[i], W / 2, y); g.fillText(layout.lines[i], W / 2, y) })
  return await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('No se pudo generar la imagen.'))), 'image/jpeg', 0.92))
}

/** Saves the composed image as a new thumbnail asset of the project, linked to the original. */
export async function saveComposedThumbnail(supabase: SupabaseClient, input: { projectId: string; original: { id: string; provenance: Record<string, unknown> | null }; text: string; style: TextStyle; aspect?: ThumbAspect; blob: Blob }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const storagePath = await uploadToCloud(supabase, { projectId: input.projectId, folder: 'uploads', ext: 'jpg', body: input.blob, contentType: 'image/jpeg' })
  const p = input.original.provenance ?? {}
  const { data, error } = await supabase.from('assets').insert({
    owner_id: user.id, project_id: input.projectId, asset_type: 'thumbnail', storage_path: storagePath, source_provider: 'browser-compose', source_url: null,
    license_status: 'generated',
    provenance: { ...p, selected: false, overlayText: input.text, textStyle: input.style, composedFrom: input.original.id, textComposed: true, mimeType: 'image/jpeg', bytes: input.blob.size, width: THUMB_SIZES[input.aspect ?? '16:9'].w, height: THUMB_SIZES[input.aspect ?? '16:9'].h, aspect: input.aspect ?? '16:9', composedAt: new Date().toISOString() },
  }).select('id').single()
  if (error) { await removeFromCloud(storagePath).catch(() => undefined); throw new Error(`No se pudo guardar la miniatura: ${error.message}`) }
  return data as { id: string }
}
