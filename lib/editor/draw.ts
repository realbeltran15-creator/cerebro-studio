/**
 * Canvas drawing of a frame description (scene.ts). Shared by the preview player and the exporter, so both draw the same pixels.
 */
import { TEXT_FONTS, type CaptionStyle, type TextOverlay } from './composition'
import type { TextFrame } from './motion'
import type { Op, VisualOp } from './scene'

export type DrawSource = { src: CanvasImageSource; width: number; height: number }

/** Whether this browser applies canvas filters (brightness, contrast, saturation, blur). Safari does not. */
export function canvasFiltersSupported(ctx?: CanvasRenderingContext2D | null) {
  try { const c = ctx ?? document.createElement('canvas').getContext('2d'); return !!c && 'filter' in c } catch { return false }
}

/** Draws every operation of a frame. `sourceOf` returns the decoded picture of a visual layer, or null when it is not ready (then it is skipped). */
export function drawOps(ctx: CanvasRenderingContext2D, ops: Op[], w: number, h: number, sourceOf: (op: VisualOp) => DrawSource | null) {
  for (const op of ops) {
    if (op.type === 'fill') { ctx.save(); ctx.globalAlpha = op.alpha; ctx.fillStyle = op.color; ctx.fillRect(0, 0, w, h); ctx.restore() }
    else if (op.type === 'visual') drawVisual(ctx, op, w, h, sourceOf(op))
    else if (op.type === 'text') drawText(ctx, op.text, w, h, op.frame)
    else if (op.type === 'caption') drawCaption(ctx, op.text, w, h, op.style, op.progress)
    else if (op.type === 'hook') drawHook(ctx, op.text, w, h, op.alpha)
  }
}

function filterString(op: VisualOp, h: number) {
  const f = op.filters
  const parts: string[] = []
  if (f && f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
  if (f && f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
  if (f && f.saturation !== 1) parts.push(`saturate(${f.saturation})`)
  const blur = (f?.blur ?? 0) + op.blur
  if (blur > 0) parts.push(`blur(${Math.round(blur * h / 100 * 10) / 10}px)`)
  return parts.length ? parts.join(' ') : 'none'
}

/** One picture layer: crop, fit (cover or a box), rotation, opacity, filters and the transition transforms. */
export function drawVisual(ctx: CanvasRenderingContext2D, op: VisualOp, w: number, h: number, s: DrawSource | null) {
  if (op.alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, op.alpha)
  if (op.revealX < 1 || op.revealY < 1) { ctx.beginPath(); ctx.rect(0, 0, w * op.revealX, h * op.revealY); ctx.clip() }
  if (op.offsetX || op.offsetY) ctx.translate(w * op.offsetX, h * op.offsetY)
  if (op.scale !== 1) { ctx.translate(w / 2, h / 2); ctx.scale(op.scale, op.scale); ctx.translate(-w / 2, -h / 2) }
  if (op.backdrop) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h) }
  if (!s || !s.width || !s.height) { ctx.restore(); return }
  const filter = filterString(op, h)
  if (filter !== 'none' && 'filter' in ctx) ctx.filter = filter
  const c = op.crop
  const sx = c ? s.width * c.left : 0, sy = c ? s.height * c.top : 0
  const sw = c ? s.width * (1 - c.left - c.right) : s.width, sh = c ? s.height * (1 - c.top - c.bottom) : s.height
  if (op.fit === 'cover') {
    if (op.rotation) { ctx.translate(w / 2, h / 2); ctx.rotate(op.rotation * Math.PI / 180); ctx.translate(-w / 2, -h / 2) }
    const scale = Math.max(w / sw, h / sh) * op.zoom
    const dw = sw * scale, dh = sh * scale
    // focusX/focusY pick which part of a larger (or zoomed) source stays in frame (0 = left/top edge, 1 = right/bottom).
    ctx.drawImage(s.src, sx, sy, sw, sh, (w - dw) * op.focusX, (h - dh) * op.focusY, dw, dh)
  } else if (op.box) {
    const bw = Math.max(1, op.box.scale * w), bh = bw * sh / sw
    ctx.translate(op.box.x * w, op.box.y * h)
    if (op.box.rotation) ctx.rotate(op.box.rotation * Math.PI / 180)
    if (op.zoom !== 1) {
      // Ken Burns inside the box: the box stays put and the picture moves inside it.
      ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.clip()
      const zw = bw * op.zoom, zh = bh * op.zoom
      ctx.drawImage(s.src, sx, sy, sw, sh, -bw / 2 + (bw - zw) * op.focusX, -bh / 2 + (bh - zh) * op.focusY, zw, zh)
    } else ctx.drawImage(s.src, sx, sy, sw, sh, -bw / 2, -bh / 2, bw, bh)
  }
  ctx.restore()
}

/** Where a box layer lands on the frame (for the viewer's handles): centre, size and rotation in pixels. */
export function boxRect(op: Pick<VisualOp, 'box' | 'crop'>, source: { width: number; height: number } | null, w: number, h: number) {
  if (!op.box) return null
  const c = op.crop
  const sw = (source?.width || 16) * (c ? 1 - c.left - c.right : 1), sh = (source?.height || 9) * (c ? 1 - c.top - c.bottom : 1)
  const bw = op.box.scale * w
  return { cx: op.box.x * w, cy: op.box.y * h, w: bw, h: bw * sh / sw, rotation: op.box.rotation }
}

export function drawHook(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, alpha: number) {
  const size = Math.round(w * 0.075)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  const lines = wrap(ctx, text.toUpperCase(), w * 0.86)
  const lineH = size * 1.15
  const top = Math.round(h * 0.12)
  ctx.lineWidth = Math.max(4, size * 0.12); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff'
  lines.forEach((l, i) => { ctx.strokeText(l, w / 2, top + i * lineH); ctx.fillText(l, w / 2, top + i * lineH) })
  ctx.restore()
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

export function drawCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, style: CaptionStyle = 'box', progress = 0) {
  if (style !== 'box') return drawBoldCaption(ctx, text, w, h, style === 'karaoke' ? progress : null)
  const size = Math.round(Math.min(w, h) * 0.045)
  ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
  const lines = wrap(ctx, text, w * 0.84)
  const lineH = size * 1.25
  const boxH = lines.length * lineH + size * 0.6
  const bottom = h - Math.round(h * (w < h ? 0.18 : 0.07))
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  const boxW = Math.min(w * 0.9, Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 1.2)
  ctx.fillRect((w - boxW) / 2, bottom - boxH, boxW, boxH)
  ctx.fillStyle = '#fff'
  lines.forEach((l, i) => ctx.fillText(l, w / 2, bottom - boxH + size * 0.3 + (i + 1) * lineH))
}

/** Index of the word being spoken at `progress` (0..1) of a cue, weighting each word by its length (a fair stand-in for speech timing). */
export function activeWordIndex(words: string[], progress: number) {
  const weights = words.map(w => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length))
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < words.length; i++) { acc += weights[i]; if (progress * total < acc) return i }
  return Math.max(0, words.length - 1)
}

/** Shorts-style captions: big, uppercase, outlined; with `progress` the spoken word is highlighted. */
function drawBoldCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, progress: number | null) {
  const size = Math.round(Math.min(w, h) * (w < h ? 0.075 : 0.06))
  ctx.save()
  ctx.font = `900 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  const active = progress === null ? -1 : activeWordIndex(words, progress)
  const lines = wrap(ctx, words.join(' '), w * 0.86)
  const lineH = size * 1.2
  const centerY = h * (w < h ? 0.68 : 0.8)
  const top = centerY - ((lines.length - 1) * lineH) / 2
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, size * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  let index = 0
  lines.forEach((line, li) => {
    const lw = line.split(' ')
    let x = (w - ctx.measureText(line).width) / 2
    const y = top + li * lineH
    for (const word of lw) {
      ctx.strokeText(word, x, y)
      ctx.fillStyle = index === active ? '#ffd23f' : '#fff'
      ctx.fillText(word, x, y)
      x += ctx.measureText(`${word} `).width
      index++
    }
  })
  ctx.restore()
}

/** Font size of a text in px for a frame (the same formula everywhere, also for the viewer's hit boxes). */
export const textSize = (t: Pick<TextOverlay, 'sizePct'>, w: number, h: number) => Math.round(Math.min(w, h) * (t.sizePct / 100) * 1.6)

/** Lines and block size of a text, for drawing and for hit-testing it on the viewer. */
export function textLayout(ctx: CanvasRenderingContext2D, t: TextOverlay, w: number, h: number) {
  const size = textSize(t, w, h)
  ctx.font = `${t.bold === false ? 500 : 800} ${size}px ${TEXT_FONTS[t.font ?? 'sans'].css}`
  const lines = wrap(ctx, t.content, w * 0.86)
  const lineH = size * 1.15
  const blockH = lines.length * lineH
  const blockW = Math.max(...lines.map(l => ctx.measureText(l).width), 1)
  const top = t.x !== undefined && t.y !== undefined ? t.y * h - blockH / 2 : t.position === 'top' ? h * 0.1 : t.position === 'center' ? (h - blockH) / 2 : h * 0.72 - blockH
  const cx = t.x !== undefined && t.y !== undefined ? t.x * w : w / 2
  return { size, lines, lineH, blockH, blockW, top, cx }
}

const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }

export function drawText(ctx: CanvasRenderingContext2D, t: TextOverlay, w: number, h: number, f: TextFrame = { alpha: 1, scale: 1, offsetY: 0, visibleChars: null }) {
  if (f.alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = f.alpha
  const L = textLayout(ctx, t, w, h)
  const { size, lines, lineH, blockH, cx } = L
  const top = L.top + f.offsetY * h
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (f.scale !== 1) { const cy = top + blockH / 2; ctx.translate(cx, cy); ctx.scale(f.scale, f.scale); ctx.translate(-cx, -cy) }
  if (t.background) {
    const pad = size * 0.3
    ctx.fillStyle = rgba(t.background, t.backgroundOpacity ?? 0.6)
    ctx.fillRect(cx - L.blockW / 2 - pad, top - pad * 0.5, L.blockW + pad * 2, blockH + pad)
  }
  const ow = t.outlineWidth ?? 10
  ctx.lineJoin = 'round'
  ctx.lineWidth = ow > 0 ? Math.max(t.outlineWidth === undefined ? 3 : 1, size * ow / 100) : 0
  ctx.strokeStyle = t.outline ? t.outline : 'rgba(0,0,0,0.85)'
  ctx.fillStyle = t.color ?? '#fff'
  if (t.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetX = size * 0.06; ctx.shadowOffsetY = size * 0.08 }
  let budget = f.visibleChars ?? Infinity
  lines.forEach((l, i) => {
    if (budget <= 0) return
    const shown = budget >= l.length ? l : l.slice(0, budget)
    budget -= l.length + 1
    const y = top + i * lineH + lineH / 2
    // Typed text keeps its final position: measure the full line and draw the visible part from its left edge.
    if (shown !== l) { const x = cx - ctx.measureText(l).width / 2; ctx.textAlign = 'left'; if (ow > 0) ctx.strokeText(shown, x, y); ctx.fillText(shown, x, y); ctx.textAlign = 'center' }
    else { if (ow > 0) ctx.strokeText(l, cx, y); ctx.fillText(l, cx, y) }
  })
  ctx.restore()
}
